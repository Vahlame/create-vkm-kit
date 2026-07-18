import assert from "node:assert/strict";
import test from "node:test";

import { chunkText, selectChunksByRelevance } from "../src/chunk.mjs";

test("chunkText: short text under chunkChars stays a single chunk", () => {
  const text = "First paragraph.\n\nSecond paragraph.";
  const chunks = chunkText(text, { chunkChars: 1500 });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], text);
});

test("chunkText: splits at paragraph boundaries once chunkChars is exceeded", () => {
  const paras = Array.from({ length: 10 }, (_, i) => `Paragraph ${i} `.repeat(20));
  const text = paras.join("\n\n");
  const chunks = chunkText(text, { chunkChars: 500, overlapChars: 0 });
  assert.ok(chunks.length > 1, "a long page must produce more than one chunk");
  for (const c of chunks) assert.ok(c.length <= 600, "no chunk wildly exceeds the target size");
  // No paragraph's text is silently lost across the whole set of chunks.
  const joined = chunks.join(" ");
  for (let i = 0; i < 10; i++) assert.match(joined, new RegExp(`Paragraph ${i} `));
});

test("chunkText: consecutive chunks overlap so a boundary paragraph is never orphaned", () => {
  const paras = Array.from({ length: 6 }, (_, i) =>
    `Section${i} content here filling space. `.repeat(10)
  );
  const text = paras.join("\n\n");
  const chunks = chunkText(text, { chunkChars: 400, overlapChars: 100 });
  assert.ok(chunks.length >= 2);
  // The tail of chunk[0] reappears at the head of chunk[1].
  const tailOfFirst = chunks[0].slice(-50);
  assert.ok(chunks[1].includes(tailOfFirst.slice(0, 30)));
});

test("chunkText: a single paragraph longer than chunkChars becomes its own oversized chunk, never truncated", () => {
  const huge = Array(1000).fill("word").join(" "); // ~5000 chars, no paragraph breaks at all
  const chunks = chunkText(huge, { chunkChars: 500 });
  assert.equal(chunks.length, 1, "nothing to split on, so it must not be silently cut");
  assert.equal(chunks[0], huge, "the whole paragraph survives, not a truncated prefix");
});

test("chunkText: degrades to an empty array on garbage/empty input, never throws", () => {
  assert.deepEqual(chunkText(""), []);
  assert.deepEqual(chunkText(null), []);
  assert.deepEqual(chunkText(undefined), []);
  assert.deepEqual(chunkText("   \n\n   "), []);
});

test("chunkText: preserves original document order", () => {
  const paras = Array.from({ length: 8 }, (_, i) => `Marker${i} `.repeat(30));
  const chunks = chunkText(paras.join("\n\n"), { chunkChars: 300, overlapChars: 0 });
  const order = chunks.map((c) => Number(/Marker(\d+)/.exec(c)[1]));
  const sorted = [...order].sort((a, b) => a - b);
  assert.deepEqual(order, sorted, "chunks must come back in the order they appear in the page");
});

// ── selectChunksByRelevance ──────────────────────────────────────────────────────────────

test("selectChunksByRelevance: picks the chunk closest to the query, not the first one", () => {
  const chunks = ["about cats", "about dogs", "about birds"]; // each 10-11 chars
  const vectors = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ];
  const query = [0, 1, 0]; // matches "about dogs" exactly
  const out = selectChunksByRelevance(chunks, vectors, query, 11); // budget for exactly ONE chunk
  assert.deepEqual(out, ["about dogs"]);
});

test("selectChunksByRelevance: returns selections in ORIGINAL document order, not similarity order", () => {
  const chunks = ["first, low relevance", "second, high relevance", "third, medium relevance"];
  const vectors = [
    [0, 1],
    [1, 0],
    [0.7, 0.3]
  ];
  const query = [1, 0]; // best match is chunks[1], then chunks[2], then chunks[0]
  const out = selectChunksByRelevance(chunks, vectors, query, 10_000);
  assert.deepEqual(out, chunks, "budget fits everything, so original order must be preserved");
});

test("selectChunksByRelevance: stops once the char budget would be exceeded", () => {
  const chunks = ["x".repeat(50), "y".repeat(50), "z".repeat(50)];
  const vectors = [
    [1, 0],
    [0.9, 0.1],
    [0, 1]
  ];
  const query = [1, 0]; // best-to-worst: x, y, z
  const out = selectChunksByRelevance(chunks, vectors, query, 110); // room for ~2 chunks + join
  assert.equal(out.length, 2);
  assert.deepEqual(out, [chunks[0], chunks[1]], "kept the two best-scoring, in original order");
});

test("selectChunksByRelevance: a single chunk that alone exceeds the budget is still returned, never empty", () => {
  const chunks = ["z".repeat(500)];
  const out = selectChunksByRelevance(chunks, [[1, 0]], [1, 0], 100);
  assert.equal(out.length, 1, "never return nothing — a truncated-by-budget chunk beats silence");
});

test("selectChunksByRelevance: empty chunk list returns an empty array, never throws", () => {
  assert.deepEqual(selectChunksByRelevance([], [], [1, 0], 1000), []);
});
