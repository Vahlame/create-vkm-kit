/**
 * Safety envelope of the asset downloader (assets.mjs, ADR-0062). Every path is exercised with an
 * injected `fetchImpl` (no network) and a real temp research root (so the actual write + root-check
 * run). Proves the download refuses everything it must: non-http URLs, non-ok responses, types
 * outside the allowlist (incl. scriptable SVG), a kind/Content-Type mismatch, an oversized body
 * (both via Content-Length and via mid-stream byte counting), and that an accepted asset lands with
 * a sanitized, hash-prefixed, type-forced filename under <topic>/assets/.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { downloadAsset } from "../src/assets.mjs";
import { hash8 } from "../src/url-identity.mjs";

/** Minimal web-Response stand-in: a streamed body over one chunk + a headers.get(). */
function fakeResponse({
  ok = true,
  status = 200,
  contentType,
  bytes = Buffer.alloc(0),
  chunks
} = {}) {
  const parts = chunks ?? [bytes];
  const headers = new Map();
  if (contentType) headers.set("content-type", contentType);
  headers.set("content-length", String(parts.reduce((n, c) => n + c.length, 0)));
  let i = 0;
  return {
    ok,
    status,
    headers: { get: (k) => headers.get(k.toLowerCase()) ?? null },
    body: {
      getReader: () => ({
        read: async () =>
          i < parts.length ? { done: false, value: new Uint8Array(parts[i++]) } : { done: true },
        cancel: async () => {}
      })
    },
    arrayBuffer: async () => Buffer.concat(parts)
  };
}

async function withRoot(fn) {
  const root = await mkdtemp(path.join(tmpdir(), "vkm-assets-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("downloadAsset saves a valid PDF with a sanitized, hash-prefixed, .pdf filename", async () => {
  await withRoot(async (root) => {
    const fetchImpl = async () =>
      fakeResponse({ contentType: "application/pdf", bytes: Buffer.from("%PDF-1.7 data") });
    const url = "https://foo.com/files/My Guide!.pdf?v=2";
    const r = await downloadAsset(
      url,
      { topic: "t", kind: "pdf", researchDir: root },
      { fetchImpl }
    );
    assert.equal(r.saved, true);
    assert.equal(r.bytes, Buffer.from("%PDF-1.7 data").length);
    const name = path.basename(r.path);
    assert.ok(name.startsWith(`${hash8(url)}-`), "filename is hash8-prefixed");
    assert.ok(name.endsWith(".pdf"), "extension forced from content-type");
    assert.ok(!/[^A-Za-z0-9._-]/.test(name), "no unsafe characters survive");
    assert.deepEqual(Buffer.from(await readFile(r.path)), Buffer.from("%PDF-1.7 data"));
  });
});

test("downloadAsset refuses a type outside the allowlist (text/html)", async () => {
  await withRoot(async (root) => {
    const fetchImpl = async () =>
      fakeResponse({ contentType: "text/html", bytes: Buffer.from("<html>") });
    const r = await downloadAsset(
      "https://foo.com/x",
      { topic: "t", researchDir: root },
      { fetchImpl }
    );
    assert.equal(r.saved, false);
    assert.match(r.reason, /type_not_allowed/);
  });
});

test("downloadAsset refuses SVG (scriptable XML), even asked as an image", async () => {
  await withRoot(async (root) => {
    const fetchImpl = async () =>
      fakeResponse({ contentType: "image/svg+xml", bytes: Buffer.from("<svg onload=...>") });
    const r = await downloadAsset(
      "https://foo.com/x.svg",
      { topic: "t", kind: "image", researchDir: root },
      { fetchImpl }
    );
    assert.equal(r.saved, false);
    assert.match(r.reason, /type_not_allowed/);
  });
});

test("downloadAsset refuses a kind/Content-Type mismatch", async () => {
  await withRoot(async (root) => {
    const fetchImpl = async () =>
      fakeResponse({ contentType: "image/png", bytes: Buffer.from("x") });
    const r = await downloadAsset(
      "https://foo.com/a.pdf",
      { topic: "t", kind: "pdf", researchDir: root },
      { fetchImpl }
    );
    assert.equal(r.saved, false);
    assert.match(r.reason, /type_mismatch/);
  });
});

test("downloadAsset refuses an oversized body by streamed byte count", async () => {
  await withRoot(async (root) => {
    // Two 40-byte chunks = 80 bytes; cap at 50. Content-Length here matches, so this exercises the
    // mid-stream counter, not the declared-length short-circuit.
    const chunks = [Buffer.alloc(40, 1), Buffer.alloc(40, 2)];
    const fetchImpl = async () => fakeResponse({ contentType: "application/pdf", chunks });
    const r = await downloadAsset(
      "https://foo.com/big.pdf",
      { topic: "t", kind: "pdf", researchDir: root, maxBytes: 50 },
      { fetchImpl }
    );
    assert.equal(r.saved, false);
    assert.equal(r.reason, "too_large");
    // Nothing was written.
    const dir = path.join(root, "t", "assets");
    const entries = await readdir(dir).catch(() => []);
    assert.equal(entries.length, 0);
  });
});

test("downloadAsset short-circuits on a Content-Length over the cap", async () => {
  await withRoot(async (root) => {
    const fetchImpl = async () =>
      fakeResponse({ contentType: "application/pdf", bytes: Buffer.alloc(100, 7) });
    const r = await downloadAsset(
      "https://foo.com/big.pdf",
      { topic: "t", kind: "pdf", researchDir: root, maxBytes: 50 },
      { fetchImpl }
    );
    assert.equal(r.saved, false);
    assert.equal(r.reason, "too_large");
  });
});

test("downloadAsset refuses a non-http(s) URL without fetching", async () => {
  await withRoot(async (root) => {
    let called = false;
    const fetchImpl = async () => {
      called = true;
      return fakeResponse({ contentType: "application/pdf" });
    };
    const r = await downloadAsset(
      "file:///etc/passwd",
      { topic: "t", researchDir: root },
      { fetchImpl }
    );
    assert.deepEqual(r, { saved: false, reason: "not_http" });
    assert.equal(called, false);
  });
});

test("downloadAsset reports a non-ok HTTP status", async () => {
  await withRoot(async (root) => {
    const fetchImpl = async () => fakeResponse({ ok: false, status: 404 });
    const r = await downloadAsset(
      "https://foo.com/missing.pdf",
      { topic: "t", researchDir: root },
      { fetchImpl }
    );
    assert.equal(r.saved, false);
    assert.equal(r.reason, "http_404");
  });
});
