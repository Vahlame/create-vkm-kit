/**
 * The background job manager over injected request/DNS (no sockets, real temp-dir writes). Proves
 * the "download large/slow files, sets of files, and pick the fastest mirror" contract:
 *  - a single file downloads to disk with the right bytes/size/sha256;
 *  - a set of files all complete;
 *  - with mirrors, the injected fastest is the one downloaded;
 *  - cancel aborts an in-flight transfer and removes the partial;
 *  - an interrupted download RESUMES from its .part via HTTP Range.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { JobManager } from "../src/jobs.mjs";

const tmpDir = () => mkdtempSync(path.join(tmpdir(), "vkm-jobs-"));

function makeRes({ status = 200, headers = {}, body = "" }) {
  const chunks =
    body === "" || body == null ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(body)];
  const res = Readable.from(chunks);
  res.statusCode = status;
  res.headers = headers;
  return res;
}

function fakeRequestImpl(routeFn) {
  return (urlObj, options) => {
    const req = new EventEmitter();
    req.setTimeout = () => req;
    req.destroy = () => req;
    req.end = () =>
      setImmediate(() => {
        const r = routeFn(urlObj, options);
        if (r instanceof Error) req.emit("error", r);
        else req.emit("response", makeRes(r));
      });
    return req;
  };
}

const fakeLookup = () => (host, _o, cb) =>
  cb(null, [{ address: net.isIP(host) ? host : "93.184.216.34", family: 4 }]);

function withDirs(fn) {
  return async () => {
    const dir = tmpDir();
    const stateDir = tmpDir();
    try {
      await fn({ dir, stateDir });
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(stateDir, { recursive: true, force: true });
    }
  };
}

test(
  "download_start completes a single file to disk with correct size + sha256",
  withDirs(async ({ dir, stateDir }) => {
    const body = "the file contents, streamed to disk in the background";
    const requestImpl = fakeRequestImpl(() => ({
      status: 200,
      headers: { "content-type": "text/plain", "content-length": String(body.length) },
      body
    }));
    const mgr = new JobManager({ requestImpl, lookupImpl: fakeLookup(), stateDir });
    const started = mgr.start({ files: [{ urls: ["https://cdn.test/doc.txt"] }], destDir: dir });
    assert.equal(started.state, "running");
    assert.ok(started.job_id);
    await mgr.wait(started.job_id);
    const st = mgr.status(started.job_id);
    assert.equal(st.state, "done");
    const f = st.files[0];
    assert.equal(f.state, "done");
    assert.equal(f.filename, "doc.txt");
    assert.equal(f.size_bytes, body.length);
    assert.equal(f.sha256, createHash("sha256").update(body).digest("hex"));
    assert.equal(readFileSync(f.path, "utf8"), body);
  })
);

test(
  "download_start downloads a SET of files, all to disk",
  withDirs(async ({ dir, stateDir }) => {
    const bodies = { "https://cdn.test/a.bin": "aaaa", "https://cdn.test/b.bin": "bbbbbb" };
    const requestImpl = fakeRequestImpl((urlObj) => {
      const body = bodies[urlObj.href];
      return { status: 200, headers: { "content-length": String(body.length) }, body };
    });
    const mgr = new JobManager({ requestImpl, lookupImpl: fakeLookup(), stateDir });
    const s = mgr.start({
      files: [{ urls: ["https://cdn.test/a.bin"] }, { urls: ["https://cdn.test/b.bin"] }],
      destDir: dir
    });
    await mgr.wait(s.job_id);
    const st = mgr.status(s.job_id);
    assert.equal(st.state, "done");
    assert.deepEqual(
      st.files.map((f) => f.state),
      ["done", "done"]
    );
    assert.equal(readFileSync(path.join(dir, "a.bin"), "utf8"), "aaaa");
    assert.equal(readFileSync(path.join(dir, "b.bin"), "utf8"), "bbbbbb");
  })
);

test(
  "download_start with mirrors downloads from the (injected) fastest and records the ranking",
  withDirs(async ({ dir, stateDir }) => {
    const body = "content from the fastest mirror";
    const requestImpl = fakeRequestImpl(() => ({
      status: 200,
      headers: { "content-length": String(body.length) },
      body
    }));
    const pickFastest = async (urls) => ({
      url: urls[1],
      ranked: [
        { url: urls[1], ok: true, throughput_bps: 9000, latency_ms: 1, rank: 1 },
        { url: urls[0], ok: true, throughput_bps: 100, latency_ms: 9, rank: 2 }
      ]
    });
    const mgr = new JobManager({ requestImpl, lookupImpl: fakeLookup(), stateDir, pickFastest });
    const s = mgr.start({
      files: [{ urls: ["https://slow.test/f.bin", "https://fast.test/f.bin"] }],
      destDir: dir
    });
    await mgr.wait(s.job_id);
    const f = mgr.status(s.job_id).files[0];
    assert.equal(f.state, "done");
    assert.equal(f.chosen_url, "https://fast.test/f.bin");
    assert.equal(f.mirrors[0].rank, 1);
    assert.equal(readFileSync(f.path, "utf8"), body);
  })
);

test(
  "download_cancel aborts an in-flight download and removes the partial",
  withDirs(async ({ dir, stateDir }) => {
    // A response that emits one chunk then stalls forever — cancel must tear it down.
    const requestImpl = (_urlObj, _options) => {
      const req = new EventEmitter();
      req.setTimeout = () => req;
      req.destroy = () => req;
      req.end = () =>
        setImmediate(() => {
          let sent = false;
          const res = new Readable({
            read() {
              if (!sent) {
                sent = true;
                this.push(Buffer.alloc(1024));
              } // then never push again → stalls until destroyed
            }
          });
          res.statusCode = 200;
          res.headers = { "content-length": "999999999" };
          req.emit("response", res);
        });
      return req;
    };
    const mgr = new JobManager({ requestImpl, lookupImpl: fakeLookup(), stateDir });
    const s = mgr.start({ files: [{ urls: ["https://cdn.test/big.bin"] }], destDir: dir });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    mgr.cancel(s.job_id);
    await mgr.wait(s.job_id);
    const st = mgr.status(s.job_id);
    assert.equal(st.state, "cancelled");
    assert.equal(st.files[0].state, "cancelled");
    assert.equal(readdirSync(dir).length, 0, "the .part must be removed on cancel");
  })
);

test(
  "download_start resumes from an existing .part via HTTP Range",
  withDirs(async ({ dir, stateDir }) => {
    const full = "ABCDEFGHIJ"; // 10 bytes; first 5 already on disk as a .part
    writeFileSync(path.join(dir, "file.bin.part"), "ABCDE");
    let seenRange = null;
    const requestImpl = fakeRequestImpl((_urlObj, options) => {
      seenRange = options.headers?.range;
      return {
        status: 206,
        headers: { "content-range": "bytes 5-9/10", "content-type": "application/octet-stream" },
        body: "FGHIJ"
      };
    });
    const mgr = new JobManager({ requestImpl, lookupImpl: fakeLookup(), stateDir });
    const s = mgr.start({ files: [{ urls: ["https://cdn.test/file.bin"] }], destDir: dir });
    await mgr.wait(s.job_id);
    const f = mgr.status(s.job_id).files[0];
    assert.match(seenRange, /^bytes=5-/, "must request a resume from byte 5");
    assert.equal(f.state, "done");
    assert.equal(f.size_bytes, 10);
    assert.equal(readFileSync(f.path, "utf8"), full);
    assert.equal(f.sha256, createHash("sha256").update(full).digest("hex"));
  })
);

test(
  "download_status lists all jobs when no id is given; unknown id is a typed miss",
  withDirs(async ({ dir, stateDir }) => {
    const requestImpl = fakeRequestImpl(() => ({
      status: 200,
      headers: { "content-length": "2" },
      body: "hi"
    }));
    const mgr = new JobManager({ requestImpl, lookupImpl: fakeLookup(), stateDir });
    const s = mgr.start({ files: [{ urls: ["https://cdn.test/x.bin"] }], destDir: dir });
    await mgr.wait(s.job_id);
    const all = mgr.status();
    assert.equal(all.jobs.length, 1);
    assert.equal(all.jobs[0].job_id, s.job_id);
    assert.equal(mgr.status("nope").code, "no_job");
  })
);
