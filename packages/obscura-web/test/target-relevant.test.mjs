/**
 * Quality-based early stop (ADR-0057 addendum): a call should be able to finish BEFORE
 * `topK`/`deadlineMs` are exhausted once it already has enough genuinely curated, relevant
 * results — the tool recognizing "Claude has received a lot of good info, stop" on its own,
 * rather than always grinding through the whole budget even after the goal is met.
 *
 * Clocks are injected (no `deadlineMs` in these tests, or a deadline far in the future) so the
 * only thing that can end the crawl early is the `targetRelevant` gate itself — isolating it from
 * the deadline gate that `deadline.test.mjs` already covers.
 */

import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import { deepResearch, clearSearxngCache, clearFetchCache } from "../src/research.mjs";

beforeEach(() => {
  clearSearxngCache();
  clearFetchCache();
});

const noOllama = {
  checkOllamaImpl: async () => ({ ok: false, hasModel: false }),
  checkRobotsImpl: async () => ({ allowed: true, checked: false }),
  ensureOllamaImpl: async () => false
};

/** N candidates, best-first, as SearXNG would deliver them. */
const pool =
  (n) =>
  async (_q, { page }) =>
    page === 1
      ? Array.from({ length: n }, (_, i) => ({
          title: `T${i}`,
          url: `https://u${i}`,
          snippet: "s",
          score: n - i
        }))
      : [];

/** Ollama available, every page curated at a fixed score — `relevant` mirrors the real
 * curatePage contract (a boolean verdict alongside the 0-10 `relevance` band), since
 * `isGood`/`kept` both key off `relevant === true`, not just the numeric score. */
const curatorAt = (relevance, dropBelowForStub = 3) => ({
  checkOllamaImpl: async () => ({ ok: true, hasModel: true }),
  ensureOllamaImpl: async () => true,
  checkRobotsImpl: async () => ({ allowed: true, checked: false }),
  curateImpl: async () => ({
    relevant: relevance >= dropBelowForStub,
    relevance,
    reason: "stub",
    excerpt: "matched passage"
  })
});

test("targetRelevant: stops dispatching once enough curated-relevant results are in", async () => {
  const out = await deepResearch(
    "q",
    { maxCandidates: 20, topK: 20, concurrency: 1, targetRelevant: 3, expand: false },
    {
      searxngImpl: pool(20),
      fetchImpl: async (url) => ({ content: `body of ${url}` }),
      ...curatorAt(8)
    }
  );
  assert.equal(out.results.length, 3, "stopped right after the 3rd good result, not all 20");
  assert.equal(out.targetReached, true);
  assert.equal(out.partial, true, "3 of 20 planned candidates were never dispatched");
  assert.equal(out.remaining, 17);
  // Best-ranked-first ordering must still hold for the prefix that DID run.
  assert.deepEqual(
    out.results.map((r) => r.url),
    ["https://u0", "https://u1", "https://u2"]
  );
});

test("targetRelevant: default (unset) never engages — identical to pre-existing behaviour", async () => {
  const out = await deepResearch(
    "q",
    { maxCandidates: 5, topK: 5, concurrency: 1, expand: false },
    { searxngImpl: pool(5), fetchImpl: async () => ({ content: "body" }), ...curatorAt(9) }
  );
  assert.equal(out.results.length, 5, "no target => every candidate is still processed");
  assert.equal(out.targetReached, undefined);
  assert.equal(out.partial, undefined);
});

test("targetRelevant: a dropped (below dropBelow) result does NOT count toward the target", async () => {
  const out = await deepResearch(
    "q",
    {
      maxCandidates: 5,
      topK: 5,
      concurrency: 1,
      targetRelevant: 2,
      dropBelow: 5,
      expand: false
    },
    {
      searxngImpl: pool(5),
      fetchImpl: async () => ({ content: "body" }),
      ...curatorAt(3, 5) // relevance 3 < dropBelow 5: junk, correctly dropped, must never satisfy the target
    }
  );
  assert.equal(
    out.targetReached,
    undefined,
    "junk can never satisfy the goal, no matter how much of it"
  );
  assert.equal(out.results.length, 0, "all 5 were fetched, curated, and correctly dropped as junk");
  assert.equal(out.partial, undefined, "topK was fully exhausted, not cut short");
});

test("targetRelevant: a heuristic-fallback verdict (no real curator judgment) does not count", async () => {
  // Ollama unavailable entirely: every result is `relevant:true` via the heuristic fallback, which
  // is an assumption, not a verdict — it must not be able to satisfy a QUALITY target.
  const out = await deepResearch(
    "q",
    { maxCandidates: 4, topK: 4, concurrency: 1, targetRelevant: 1, expand: false },
    { searxngImpl: pool(4), fetchImpl: async () => ({ content: "body" }), ...noOllama }
  );
  assert.equal(out.targetReached, undefined);
  assert.equal(
    out.results.length,
    4,
    "no curator available => the target can't stop the crawl early"
  );
});

test("targetRelevant: reported alongside partial/remaining, not instead of them", async () => {
  // A caller reading `partial:true` alone must not read a deliberate, successful early stop as a
  // failure — `targetReached` is what tells the two apart.
  const out = await deepResearch(
    "q",
    { maxCandidates: 10, topK: 10, concurrency: 2, targetRelevant: 2, expand: false },
    { searxngImpl: pool(10), fetchImpl: async () => ({ content: "body" }), ...curatorAt(7) }
  );
  assert.equal(out.targetReached, true);
  assert.ok(out.partial, "fewer than topK were dispatched, so partial/remaining still fire");
  assert.ok(out.results.length >= 2, "at least the target was met");
});
