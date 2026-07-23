import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cacheDir, cacheFilePath, loadCacheFile, saveCacheFile } from "../src/persistent-cache.mjs";

function withEnv(value, fn) {
  const prev = process.env.OBSCURA_CACHE_DIR;
  if (value === undefined) delete process.env.OBSCURA_CACHE_DIR;
  else process.env.OBSCURA_CACHE_DIR = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.OBSCURA_CACHE_DIR;
    else process.env.OBSCURA_CACHE_DIR = prev;
  }
}

test("cacheDir/cacheFilePath: unset OBSCURA_CACHE_DIR means disk persistence is off", () => {
  withEnv(undefined, () => {
    assert.equal(cacheDir(), "");
    assert.equal(cacheFilePath("search-cache.json"), null);
  });
});

test("cacheDir/cacheFilePath: set OBSCURA_CACHE_DIR joins the filename under it", () => {
  withEnv("/tmp/obscura-cache", () => {
    assert.equal(cacheDir(), "/tmp/obscura-cache");
    assert.equal(
      cacheFilePath("search-cache.json"),
      path.join("/tmp/obscura-cache", "search-cache.json")
    );
  });
});

test("loadCacheFile: a missing file degrades to {} rather than throwing", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "obscura-cache-test-"));
  try {
    assert.deepEqual(loadCacheFile(path.join(dir, "nope.json")), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadCacheFile: corrupt JSON degrades to {} rather than throwing", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "obscura-cache-test-"));
  try {
    const file = path.join(dir, "corrupt.json");
    writeFileSync(file, "{not valid json");
    assert.deepEqual(loadCacheFile(file), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadCacheFile: a JSON array (not an object) also degrades to {}", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "obscura-cache-test-"));
  try {
    const file = path.join(dir, "array.json");
    writeFileSync(file, "[1,2,3]");
    assert.deepEqual(loadCacheFile(file), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saveCacheFile + loadCacheFile round-trip a Map's entries", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "obscura-cache-test-"));
  try {
    const file = path.join(dir, "cache.json");
    const map = new Map([
      ["key1", { at: 1000, value: "a" }],
      ["key2", { at: 2000, value: { nested: true } }]
    ]);
    saveCacheFile(file, map);
    const loaded = loadCacheFile(file);
    assert.deepEqual(loaded, {
      key1: { at: 1000, value: "a" },
      key2: { at: 2000, value: { nested: true } }
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saveCacheFile creates the parent directory if it doesn't exist yet", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "obscura-cache-test-"));
  try {
    const file = path.join(dir, "nested", "deeper", "cache.json");
    saveCacheFile(file, new Map([["k", { at: 1, value: "v" }]]));
    assert.ok(existsSync(file));
    assert.deepEqual(loadCacheFile(file), { k: { at: 1, value: "v" } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saveCacheFile is atomic: no leftover .tmp file after a successful write", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "obscura-cache-test-"));
  try {
    const file = path.join(dir, "cache.json");
    saveCacheFile(file, new Map([["k", { at: 1, value: "v" }]]));
    const entries = readdirSync(dir);
    assert.deepEqual(entries, ["cache.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saveCacheFile overwrites a previous version cleanly", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "obscura-cache-test-"));
  try {
    const file = path.join(dir, "cache.json");
    saveCacheFile(file, new Map([["k", { at: 1, value: "old" }]]));
    saveCacheFile(file, new Map([["k", { at: 2, value: "new" }]]));
    assert.deepEqual(loadCacheFile(file), { k: { at: 2, value: "new" } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saveCacheFile never throws even on an unwritable path", () => {
  // A NUL byte is invalid in a path on every platform Node supports — forces a synchronous
  // fs error, which saveCacheFile must swallow (best-effort persistence, never a broken call).
  assert.doesNotThrow(() => {
    saveCacheFile("\0invalid", new Map([["k", { at: 1, value: "v" }]]));
  });
});

test("loadCacheFile round trips the raw JSON content read back from disk", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "obscura-cache-test-"));
  try {
    const file = path.join(dir, "cache.json");
    saveCacheFile(file, new Map([["k", { at: 1, value: "v" }]]));
    const raw = readFileSync(file, "utf8");
    assert.deepEqual(JSON.parse(raw), { k: { at: 1, value: "v" } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
