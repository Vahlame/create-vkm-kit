import assert from "node:assert/strict";
import test from "node:test";

import { similarityRatio } from "../src/text-similarity.mjs";

const close = (got, want, eps = 1e-9) =>
  assert.ok(Math.abs(got - want) < eps, `expected ~${want}, got ${got}`);

// Pinned against Python's difflib.SequenceMatcher(None, a, b).ratio() — the exact algorithm
// this ports (verified against Scrapling's actual source, not its README).

test("identical strings score 1.0", () => {
  close(similarityRatio("same", "same"), 1.0);
});

test("completely disjoint strings score 0", () => {
  close(similarityRatio("abc", "xyz"), 0);
});

test("classic difflib example: abcd/bcde -> 0.75", () => {
  // Longest common contiguous run is "bcd" (length 3). ratio = 2*3 / (4+4) = 0.75.
  // This is difflib's own canonical worked example.
  close(similarityRatio("abcd", "bcde"), 0.75);
});

test("is symmetric", () => {
  close(
    similarityRatio("hello world", "world hello"),
    similarityRatio("world hello", "hello world")
  );
});

test("both-empty is defined as 1 (nothing differs), one-empty as 0", () => {
  close(similarityRatio("", ""), 1.0);
  close(similarityRatio("", "x"), 0);
  close(similarityRatio("x", ""), 0);
});

test("is contiguous-substring based, not token-overlap: reordered words score lower than an exact match", () => {
  const exact = similarityRatio("prompt injection mitigation", "prompt injection mitigation");
  const reordered = similarityRatio("prompt injection mitigation", "mitigation prompt injection");
  assert.ok(reordered < exact, "same words, different order must not score as an exact match");
  assert.ok(reordered > 0, "but a real shared substring still contributes something");
});

test("credits multiple disjoint matching runs, not just the single longest one", () => {
  // "the cat sat" vs "the dog sat": two separate runs match ("the " and " sat"), not just one.
  const r = similarityRatio("the cat sat", "the dog sat");
  const singleRunOnly = (2 * "the ".length) / ("the cat sat".length + "the dog sat".length);
  assert.ok(r > singleRunOnly, "the second matching run (' sat') must add to the score");
});

test("case-sensitive by design — callers normalize case, this stays a faithful primitive", () => {
  assert.ok(similarityRatio("ABC", "abc") < similarityRatio("ABC", "ABC"));
});

test("partial overlap lands strictly between 0 and 1", () => {
  const r = similarityRatio("prompt injection attack", "OWASP prompt injection risk");
  assert.ok(r > 0 && r < 1);
});
