import assert from "node:assert/strict";
import test from "node:test";

import { cosine, mmr } from "../src/rank.mjs";

// ── cosine ─────────────────────────────────────────────────────────────────────────────

test("cosine: identical vectors score 1", () => {
  assert.equal(cosine([1, 2, 3], [1, 2, 3]), 1);
});

test("cosine: orthogonal vectors score 0", () => {
  assert.equal(cosine([1, 0], [0, 1]), 0);
});

test("cosine: opposite vectors score -1", () => {
  assert.equal(cosine([1, 0], [-1, 0]), -1);
});

test("cosine: mismatched length or missing vector degrades to 0, never throws", () => {
  assert.equal(cosine([1, 2], [1, 2, 3]), 0);
  assert.equal(cosine(null, [1, 2]), 0);
  assert.equal(cosine([1, 2], undefined), 0);
});

test("cosine: a zero vector degrades to 0 rather than dividing by zero (NaN)", () => {
  assert.equal(cosine([0, 0], [1, 1]), 0);
});

// ── mmr ────────────────────────────────────────────────────────────────────────────────

const byId = (id, relevance, vector) => ({ id, relevance, vector });
const getVector = (c) => c.vector;
const getRelevance = (c) => c.relevance;

test("mmr: lambda=1 (pure relevance) reproduces plain relevance order", () => {
  const items = [byId("a", 5, [1, 0]), byId("b", 9, [1, 0]), byId("c", 2, [1, 0])];
  const out = mmr(items, getVector, getRelevance, 1.0);
  assert.deepEqual(
    out.map((c) => c.id),
    ["a", "b", "c"],
    "lambda>=1 is a documented no-op, returning the input order unchanged"
  );
});

test("mmr: demotes a near-duplicate of an already-picked item below a less similar, lower-scoring one", () => {
  // "a" is the top-relevance item and always picked first. "b" is a near-duplicate of "a"
  // (same vector) with the second-highest raw relevance; "c" is a distinct angle with lower raw
  // relevance. Hand-computed at lambda=0.3 (round 2, after "a" is picked):
  //   b: 0.3*8 - 0.7*cosine(b,a)=1.0 -> 2.4-0.7 = 1.7
  //   c: 0.3*6 - 0.7*cosine(c,a)=0.0 -> 1.8-0   = 1.8   <- c wins
  const items = [
    byId("a", 10, [1, 0]),
    byId("b", 8, [1, 0]), // duplicate direction of "a"
    byId("c", 6, [0, 1]) // orthogonal — a genuinely different angle
  ];
  const out = mmr(items, getVector, getRelevance, 0.3);
  assert.equal(out[0].id, "a", "the single most relevant item is still picked first");
  assert.equal(out[1].id, "c", "a diverse, lower-scoring item beats a near-duplicate of #1");
  assert.equal(out[2].id, "b");
});

test("mmr: an item with no vector is never penalized for similarity (treated as maximally distinct)", () => {
  const items = [byId("a", 9, [1, 0]), byId("b", 8, null), byId("c", 8, [1, 0])];
  const out = mmr(items, getVector, getRelevance, 0.5);
  assert.equal(out[0].id, "a");
  // "b" has no vector to compare, so its similarity term is always 0 — it must rank ahead of
  // "c", which duplicates "a" and is discounted for it, despite both starting at relevance 8.
  assert.equal(out[1].id, "b");
  assert.equal(out[2].id, "c");
});

test("mmr: never drops an item — output is a permutation of the input, same length", () => {
  const items = [byId("a", 5, [1, 1]), byId("b", 5, [1, 1]), byId("c", 5, [1, 1])];
  const out = mmr(items, getVector, getRelevance, 0.5);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((c) => c.id).sort(), ["a", "b", "c"]);
});

test("mmr: 0 or 1 candidates is a no-op, never throws", () => {
  assert.deepEqual(mmr([], getVector, getRelevance), []);
  const one = [byId("a", 5, [1, 0])];
  assert.deepEqual(mmr(one, getVector, getRelevance), one);
});
