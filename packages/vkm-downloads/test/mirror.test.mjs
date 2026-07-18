/**
 * Mirror probing must (a) measure each candidate through the SAME guarded path as a real download
 * (so private/loopback mirrors are refused, not probed) and (b) rank by measured throughput. Timing
 * is made deterministic with an injected clock and concurrency:1, so the ranking assertion is not
 * flaky. Offline: injected request/DNS.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import net from "node:net";
import { Readable } from "node:stream";
import { probeMirrors, pickFastest } from "../src/mirror.mjs";

function makeRes({ status = 206, headers = {}, body = "" }) {
  const chunks = body ? [Buffer.isBuffer(body) ? body : Buffer.from(body)] : [];
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

function fakeLookup(map = {}) {
  return (host, _o, cb) =>
    cb(null, [{ address: map[host] || (net.isIP(host) ? host : "93.184.216.34"), family: 4 }]);
}

test("probeMirrors ranks mirrors fastest-first by measured throughput", async () => {
  const probeBytes = 1000;
  const requestImpl = fakeRequestImpl(() => ({
    status: 206,
    headers: { "content-range": `bytes 0-${probeBytes - 1}/50000` },
    body: Buffer.alloc(probeBytes)
  }));
  // Scripted clock (concurrency:1 → serialized). Per successful probe now() is called 4x:
  // t0, latencyEnd, tRead0, finish. Fast: 1ms transfer; Slow: 30ms transfer.
  const times = [0, 1, 1, 2, 10, 12, 12, 42];
  const now = () => times.shift();
  const ranked = await probeMirrors(["https://fast.test/f", "https://slow.test/f"], {
    requestImpl,
    lookupImpl: fakeLookup(),
    now,
    probeBytes,
    concurrency: 1
  });
  assert.equal(ranked[0].url, "https://fast.test/f");
  assert.equal(ranked[0].rank, 1);
  assert.ok(ranked[0].throughput_bps > ranked[1].throughput_bps, "fast mirror ranks above slow");
  assert.equal(ranked[0].size_bytes, 50000, "size parsed from content-range total");
});

test("probeMirrors flags a mirror whose size disagrees with the majority", async () => {
  const requestImpl = fakeRequestImpl((urlObj) => ({
    status: 206,
    headers: {
      "content-range": urlObj.hostname === "odd.test" ? "bytes 0-999/999" : "bytes 0-999/50000"
    },
    body: Buffer.alloc(1000)
  }));
  const ranked = await probeMirrors(
    ["https://a.test/f", "https://b.test/f", "https://odd.test/f"],
    { requestImpl, lookupImpl: fakeLookup(), probeBytes: 1000, now: () => Date.now() }
  );
  assert.equal(ranked.find((r) => r.url === "https://odd.test/f").size_mismatch, true);
  assert.ok(!ranked.find((r) => r.url === "https://a.test/f").size_mismatch);
});

test("a failed mirror sorts after OK ones; pickFastest returns the top OK url", async () => {
  const requestImpl = fakeRequestImpl((urlObj) =>
    urlObj.hostname === "bad.test"
      ? new Error("connection refused")
      : { status: 206, headers: { "content-range": "bytes 0-999/1000" }, body: Buffer.alloc(1000) }
  );
  const { url, ranked } = await pickFastest(["https://bad.test/f", "https://good.test/f"], {
    requestImpl,
    lookupImpl: fakeLookup(),
    probeBytes: 1000,
    now: () => Date.now()
  });
  assert.equal(url, "https://good.test/f");
  assert.equal(ranked[ranked.length - 1].ok, false, "the failed mirror is ranked last");
});

test("a mirror resolving to a private address is refused, not probed", async () => {
  const requestImpl = fakeRequestImpl(() => ({
    status: 206,
    headers: { "content-range": "bytes 0-999/1000" },
    body: Buffer.alloc(1000)
  }));
  const ranked = await probeMirrors(["https://internal.test/f"], {
    requestImpl,
    lookupImpl: fakeLookup({ "internal.test": "127.0.0.1" }),
    probeBytes: 1000,
    now: () => Date.now()
  });
  assert.equal(ranked[0].ok, false);
  assert.equal(ranked[0].code, "blocked_address");
});

test("pickFastest throws when no mirror responds", async () => {
  const requestImpl = fakeRequestImpl(() => new Error("dead"));
  await assert.rejects(
    () =>
      pickFastest(["https://x.test/f"], {
        requestImpl,
        lookupImpl: fakeLookup(),
        now: () => Date.now()
      }),
    /No mirror responded/
  );
});
