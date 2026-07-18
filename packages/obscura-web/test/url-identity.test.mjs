import assert from "node:assert/strict";
import test from "node:test";

import { canonicalizeUrl, dedupeByUrl, hash8, hostOf, normalizeUrl } from "../src/url-identity.mjs";

// ── normalizeUrl / hash8: the FROZEN pair ──────────────────────────────────────────────
//
// These name the files in RESEARCH/<topic>/sources/<hash8>-<slug>.md (ADR-0056), so their
// output is persisted state on a real user's disk. The literal digests below are the whole
// point of this block: if a change to normalizeUrl shifts them, by-URL dedup silently stops
// matching notes already in the bank and it starts accumulating duplicates. This test is the
// tripwire — if it goes red, the fix is almost never "update the expected value".

test("hash8 digests are frozen (RESEARCH/ filenames depend on them)", () => {
  assert.equal(hash8("https://example.com/a"), "2dce0a4c");
  assert.equal(hash8("https://docs.searxng.org/dev/search_api.html"), "998af772");
});

test("normalizeUrl keeps the scheme and non-root trailing slash (frozen semantics)", () => {
  // Deliberately NOT unified — canonicalizeUrl is where that happens.
  assert.notEqual(normalizeUrl("http://example.com/a"), normalizeUrl("https://example.com/a"));
  assert.notEqual(normalizeUrl("https://example.com/a"), normalizeUrl("https://example.com/a/"));
  assert.notEqual(
    normalizeUrl("https://example.com/a?utm_source=x"),
    normalizeUrl("https://example.com/a")
  );
});

test("normalizeUrl lowercases host, drops fragment and a bare root slash", () => {
  assert.equal(normalizeUrl("https://EXAMPLE.com/a#frag"), "https://example.com/a");
  assert.equal(normalizeUrl("https://example.com/"), "https://example.com");
});

test("normalizeUrl degrades instead of throwing on unparseable input", () => {
  assert.equal(normalizeUrl("not a url"), "not a url");
  assert.equal(normalizeUrl(null), "");
});

test("hash8 is stable across equivalent-by-normalizeUrl spellings", () => {
  assert.equal(hash8("https://EXAMPLE.com/a#frag"), hash8("https://example.com/a"));
});

// ── canonicalizeUrl: the aggressive one ────────────────────────────────────────────────

test("canonicalizeUrl unifies scheme, www and non-root trailing slash", () => {
  const want = canonicalizeUrl("https://example.com/a");
  assert.equal(canonicalizeUrl("http://example.com/a"), want);
  assert.equal(canonicalizeUrl("https://www.example.com/a"), want);
  assert.equal(canonicalizeUrl("https://example.com/a/"), want);
  assert.equal(canonicalizeUrl("https://EXAMPLE.com/a#frag"), want);
});

test("canonicalizeUrl strips tracking params but keeps meaningful ones", () => {
  assert.equal(
    canonicalizeUrl("https://example.com/a?utm_source=x&fbclid=y"),
    "https://example.com/a"
  );
  assert.equal(
    canonicalizeUrl("https://example.com/a?id=7&utm_medium=z"),
    "https://example.com/a?id=7"
  );
});

test("canonicalizeUrl is order-insensitive for query params", () => {
  assert.equal(
    canonicalizeUrl("https://example.com/a?b=2&a=1"),
    canonicalizeUrl("https://example.com/a?a=1&b=2")
  );
});

test("canonicalizeUrl keeps genuinely different pages apart", () => {
  assert.notEqual(
    canonicalizeUrl("https://example.com/a"),
    canonicalizeUrl("https://example.com/b")
  );
  assert.notEqual(
    canonicalizeUrl("https://example.com/a?id=1"),
    canonicalizeUrl("https://example.com/a?id=2")
  );
  assert.notEqual(
    canonicalizeUrl("https://a.example.com/x"),
    canonicalizeUrl("https://b.example.com/x")
  );
});

test("canonicalizeUrl leaves the bare root with no trailing slash", () => {
  assert.equal(canonicalizeUrl("https://example.com/"), "https://example.com");
  assert.equal(canonicalizeUrl("https://example.com"), "https://example.com");
});

test("canonicalizeUrl degrades instead of throwing on unparseable input", () => {
  assert.equal(canonicalizeUrl("not a url"), "not a url");
  assert.equal(canonicalizeUrl(undefined), "");
});

// ── hostOf ─────────────────────────────────────────────────────────────────────────────

test("hostOf strips www and lowercases", () => {
  assert.equal(hostOf("https://WWW.Example.com/a/b"), "example.com");
  assert.equal(hostOf("https://docs.searxng.org/dev/search_api.html"), "docs.searxng.org");
  assert.equal(hostOf("garbage"), "");
});

// ── dedupeByUrl ────────────────────────────────────────────────────────────────────────

test("dedupeByUrl keeps the first (best-ranked) copy and drops later duplicates", () => {
  const out = dedupeByUrl([
    { url: "https://example.com/a", score: 10 },
    { url: "http://www.example.com/a/?utm_source=spam", score: 1 },
    { url: "https://example.com/b", score: 5 }
  ]);
  assert.deepEqual(
    out.map((r) => r.score),
    [10, 5]
  );
});

test("dedupeByUrl drops records without a usable url", () => {
  const out = dedupeByUrl([
    { url: "https://example.com/a" },
    { url: "" },
    null,
    { title: "no url" }
  ]);
  assert.equal(out.length, 1);
});
