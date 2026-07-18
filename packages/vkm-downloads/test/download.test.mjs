/**
 * Drives the real downloadTo / resolveMetadata against a FAKE request/response and a fake DNS
 * lookup — no sockets, no DNS, but the real streaming, redirect-following, size-cap, hashing, and
 * root-check run. Files are written to a throwaway temp dir. Proves the guarantees that matter:
 *  - a scheme other than http(s) never touches the network;
 *  - a host resolving to a private address is refused before any request is issued;
 *  - redirects are followed AND re-validated (a redirect to a private IP is refused);
 *  - the byte cap trips on declared Content-Length and, authoritatively, mid-stream — with the
 *    partial file deleted;
 *  - a clean download lands inside the root with the correct bytes/size/SHA-256.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { statfs } from "node:fs/promises";
import { downloadTo, resolveMetadata, assertDiskSpace, DiskSpaceError } from "../src/download.mjs";

function tmpDir() {
  return mkdtempSync(path.join(tmpdir(), "vkm-dl-"));
}

/** A fake IncomingMessage: a Readable body carrying statusCode + lowercase headers. */
function makeRes({ status = 200, headers = {}, body = "" }) {
  const chunks =
    body == null || body === "" ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(body)];
  const res = Readable.from(chunks);
  res.statusCode = status;
  res.headers = headers;
  return res;
}

/**
 * Build a fake requestImpl from a route function `(urlObj, method) -> route | Error`, where route
 * is `{ status, headers, body }`. `spy` (optional) records every (urlObj, options) dispatched.
 */
function fakeRequestImpl(routeFn, spy) {
  return (urlObj, options) => {
    if (spy) spy(urlObj, options);
    const req = new EventEmitter();
    req.setTimeout = () => req;
    req.destroy = () => req;
    req.end = () => {
      setImmediate(() => {
        const route = routeFn(urlObj, options.method);
        if (route instanceof Error) req.emit("error", route);
        else req.emit("response", makeRes(route));
      });
    };
    return req;
  };
}

/** DNS fake: echoes a literal IP host as-is, maps named hosts to a fixed public/private address. */
function fakeLookup(map = {}) {
  return (hostname, _opts, cb) => {
    const address = map[hostname] || (net.isIP(hostname) ? hostname : "93.184.216.34");
    cb(null, [{ address, family: net.isIP(address) || 4 }]);
  };
}

test("downloadTo: clean download lands inside the root with correct bytes/size/sha256", async () => {
  const dir = tmpDir();
  try {
    const body = "hello world, this is the file body";
    const requestImpl = fakeRequestImpl(() => ({
      status: 200,
      headers: { "content-type": "text/plain", "content-length": String(body.length) },
      body
    }));
    const out = await downloadTo("https://cdn.test/path/doc.txt", {
      destDir: dir,
      requestImpl,
      lookupImpl: fakeLookup()
    });
    assert.equal(path.dirname(out.path), path.resolve(dir), "file is inside the download root");
    assert.equal(out.filename, "doc.txt");
    assert.equal(out.size_bytes, body.length);
    assert.equal(out.sha256, createHash("sha256").update(body).digest("hex"));
    assert.equal(readFileSync(out.path, "utf8"), body);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("downloadTo: a non-http(s) scheme never reaches the network", async () => {
  const dir = tmpDir();
  let calls = 0;
  try {
    const requestImpl = fakeRequestImpl(
      () => ({ status: 200, body: "x" }),
      () => calls++
    );
    await assert.rejects(
      () =>
        downloadTo("file:///etc/passwd", { destDir: dir, requestImpl, lookupImpl: fakeLookup() }),
      /http\(s\)/
    );
    assert.equal(calls, 0, "requestImpl must not be called for a bad scheme");
    assert.equal(readdirSync(dir).length, 0, "nothing written");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("downloadTo: a host resolving to a private address is refused before any request", async () => {
  const dir = tmpDir();
  let calls = 0;
  try {
    const requestImpl = fakeRequestImpl(
      () => ({ status: 200, body: "x" }),
      () => calls++
    );
    await assert.rejects(
      () =>
        downloadTo("https://internal.test/secret", {
          destDir: dir,
          requestImpl,
          lookupImpl: fakeLookup({ "internal.test": "127.0.0.1" })
        }),
      /private\/loopback/
    );
    assert.equal(calls, 0, "requestImpl must not be called when the host is blocked");
    assert.equal(readdirSync(dir).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("downloadTo: follows redirects and re-validates each hop", async () => {
  const dir = tmpDir();
  const seen = [];
  try {
    const requestImpl = fakeRequestImpl(
      (urlObj) => {
        if (urlObj.href === "https://cdn.test/a")
          return { status: 302, headers: { location: "https://cdn.test/b/final.bin" }, body: "" };
        return {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
          body: "BIN"
        };
      },
      (urlObj) => seen.push(urlObj.href)
    );
    const out = await downloadTo("https://cdn.test/a", {
      destDir: dir,
      requestImpl,
      lookupImpl: fakeLookup()
    });
    assert.deepEqual(seen, ["https://cdn.test/a", "https://cdn.test/b/final.bin"]);
    assert.equal(out.filename, "final.bin");
    assert.equal(readFileSync(out.path, "utf8"), "BIN");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("downloadTo: a redirect to a private address is refused", async () => {
  const dir = tmpDir();
  try {
    const requestImpl = fakeRequestImpl((urlObj) => {
      if (urlObj.hostname === "cdn.test")
        return { status: 302, headers: { location: "http://127.0.0.1:11434/api" }, body: "" };
      return { status: 200, body: "should-never-be-read" };
    });
    await assert.rejects(
      () =>
        downloadTo("https://cdn.test/a", {
          destDir: dir,
          requestImpl,
          lookupImpl: fakeLookup() // literal 127.0.0.1 echoes to itself → blocked
        }),
      /private\/loopback/
    );
    assert.equal(readdirSync(dir).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("downloadTo: rejects on a declared Content-Length over the cap, before streaming", async () => {
  const dir = tmpDir();
  try {
    const requestImpl = fakeRequestImpl(() => ({
      status: 200,
      headers: { "content-length": "1000000" },
      body: "x".repeat(10)
    }));
    await assert.rejects(
      () =>
        downloadTo("https://cdn.test/big.bin", {
          destDir: dir,
          maxBytes: 100,
          requestImpl,
          lookupImpl: fakeLookup()
        }),
      /exceeds the 100-byte cap/
    );
    assert.equal(readdirSync(dir).length, 0, "no file created");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("downloadTo: aborts mid-stream when the body exceeds the cap, deleting the partial file", async () => {
  const dir = tmpDir();
  try {
    // No Content-Length (chunked-style): the cap can only be enforced by counting bytes as they
    // arrive — the authoritative guard against a lying/omitted Content-Length.
    const requestImpl = fakeRequestImpl(() => ({
      status: 200,
      headers: {},
      body: "y".repeat(500)
    }));
    await assert.rejects(
      () =>
        downloadTo("https://cdn.test/stream.bin", {
          destDir: dir,
          maxBytes: 100,
          requestImpl,
          lookupImpl: fakeLookup()
        }),
      /exceeds the 100-byte cap/
    );
    assert.equal(readdirSync(dir).length, 0, "partial file must be deleted on abort");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("downloadTo: surfaces a non-2xx status as an error", async () => {
  const dir = tmpDir();
  try {
    const requestImpl = fakeRequestImpl(() => ({ status: 404, body: "nope" }));
    await assert.rejects(
      () =>
        downloadTo("https://cdn.test/missing", {
          destDir: dir,
          requestImpl,
          lookupImpl: fakeLookup()
        }),
      /HTTP 404/
    );
    assert.equal(readdirSync(dir).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveMetadata: returns filename/type/size via HEAD and writes nothing", async () => {
  const dir = tmpDir();
  try {
    const requestImpl = fakeRequestImpl((_u, method) => {
      assert.equal(method, "HEAD");
      return {
        status: 200,
        headers: { "content-type": "application/pdf", "content-length": "2048" },
        body: ""
      };
    });
    const meta = await resolveMetadata("https://cdn.test/files/report.pdf", {
      requestImpl,
      lookupImpl: fakeLookup()
    });
    assert.equal(meta.filename, "report.pdf");
    assert.equal(meta.content_type, "application/pdf");
    assert.equal(meta.size_bytes, 2048);
    assert.equal(meta.final_url, "https://cdn.test/files/report.pdf");
    assert.equal(readdirSync(dir).length, 0, "resolve must never write to disk");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveMetadata: falls back to GET-and-abort when HEAD is refused", async () => {
  const requestImpl = fakeRequestImpl((_u, method) => {
    if (method === "HEAD") return { status: 405, headers: {}, body: "" };
    return { status: 200, headers: { "content-type": "application/zip" }, body: "PK..." };
  });
  const meta = await resolveMetadata("https://cdn.test/archive.zip", {
    requestImpl,
    lookupImpl: fakeLookup()
  });
  assert.equal(meta.content_type, "application/zip");
  assert.equal(meta.filename, "archive.zip");
});

test("resolveMetadata: rejects a non-http(s) scheme", async () => {
  await assert.rejects(() => resolveMetadata("data:text/plain,hi"), /http\(s\)/);
});

test("assertDiskSpace: refuses a download bigger than free space, no-ops on unknown size", async () => {
  const dir = tmpDir();
  try {
    const s = await statfs(dir);
    const free = s.bavail * s.bsize;
    await assert.rejects(() => assertDiskSpace(dir, free + 1, 0), DiskSpaceError);
    await assertDiskSpace(dir, NaN); // unknown size → cannot guard → must not throw
    await assertDiskSpace(dir, 1, 0); // trivially fits → must not throw
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
