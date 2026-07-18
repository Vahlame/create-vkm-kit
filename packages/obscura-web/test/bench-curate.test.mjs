import assert from "node:assert/strict";
import test from "node:test";

import { evaluateCuration, formatCurationReport } from "../src/bench-curate.mjs";

const ENTRIES = [
  { query: "q", url: "https://good.example/a", label: "relevant" },
  { query: "q", url: "https://bad.example/b", label: "irrelevant" }
];
const FIXTURES = new Map([
  ["https://good.example/a", "the real page text for a"],
  ["https://bad.example/b", "the real page text for b"]
]);

test("evaluateCuration: a perfect curator scores accuracy 1.0, no false positives/negatives", async () => {
  const curate = async ({ markdown }) => ({
    relevance: markdown.includes(" a") ? 9 : 1,
    reason: "stub"
  });
  const r = await evaluateCuration({ entries: ENTRIES, fixtures: FIXTURES, curate });
  assert.equal(r.n, 2);
  assert.equal(r.accuracy, 1.0);
  assert.equal(r.falsePositiveCount, 0);
  assert.equal(r.falseNegativeCount, 0);
  assert.equal(r.errors, 0);
});

test("evaluateCuration: false positive rate is scoped to the irrelevant bucket, not all entries", async () => {
  // Both pages scored high — the relevant one is correctly kept, the irrelevant one is the
  // exact expensive mistake this bench exists to catch.
  const curate = async () => ({ relevance: 9, reason: "everything looks relevant to me" });
  const r = await evaluateCuration({ entries: ENTRIES, fixtures: FIXTURES, curate });
  assert.equal(r.accuracy, 0.5);
  assert.equal(r.falsePositiveCount, 1);
  assert.equal(r.falsePositiveRate, 1.0, "1 of the 1 irrelevant entry was a false positive");
  assert.equal(r.falseNegativeCount, 0);
});

test("evaluateCuration: a curator call throwing counts as an error, never crashes the bench", async () => {
  const curate = async ({ markdown }) => {
    if (markdown.includes("for b")) throw new Error("model timeout");
    return { relevance: 9, reason: "ok" };
  };
  const r = await evaluateCuration({ entries: ENTRIES, fixtures: FIXTURES, curate });
  assert.equal(r.errors, 1);
  assert.equal(r.n, 2);
  const errored = r.results.find((res) => res.url === "https://bad.example/b");
  assert.equal(errored.correct, false, "an error can never count as a correct verdict");
  assert.match(errored.reason, /^ERROR: model timeout/);
});

test("evaluateCuration: dropBelow is the reference threshold, applied uniformly regardless of the model's own default", async () => {
  const curate = async () => ({ relevance: 4, reason: "borderline" });
  const strict = await evaluateCuration({
    entries: ENTRIES,
    fixtures: FIXTURES,
    curate,
    dropBelow: 5
  });
  const lenient = await evaluateCuration({
    entries: ENTRIES,
    fixtures: FIXTURES,
    curate,
    dropBelow: 3
  });
  // Same model, same scores, same fixtures — only dropBelow differs, so the SAME relevance:4 must
  // flip from "irrelevant" to "relevant" as the threshold crosses it.
  assert.equal(strict.results[0].gotRelevant, false);
  assert.equal(lenient.results[0].gotRelevant, true);
});

test("evaluateCuration: throws a clear error rather than silently skipping an entry with no fixture", async () => {
  const entries = [{ query: "q", url: "https://missing.example", label: "relevant" }];
  await assert.rejects(
    () =>
      evaluateCuration({ entries, fixtures: new Map(), curate: async () => ({ relevance: 9 }) }),
    /no fixture for https:\/\/missing\.example/
  );
});

test("evaluateCuration: band separation is the gap between mean relevant and mean irrelevant scores", async () => {
  const curate = async ({ markdown }) => ({ relevance: markdown.includes(" a") ? 8 : 2 });
  const r = await evaluateCuration({ entries: ENTRIES, fixtures: FIXTURES, curate });
  assert.equal(r.meanRelevantScore, 8);
  assert.equal(r.meanIrrelevantScore, 2);
  assert.equal(r.separation, 6);
});

test("formatCurationReport: renders the headline numbers and lists misses with their reason", () => {
  const report = {
    n: 2,
    accuracy: 0.5,
    errors: 0,
    falsePositiveCount: 1,
    falsePositiveRate: 1.0,
    falseNegativeCount: 0,
    meanRelevantScore: 9,
    meanIrrelevantScore: 9,
    separation: 0,
    meanMs: 1234,
    results: [
      {
        label: "irrelevant",
        gotRelevant: true,
        relevance: 9,
        url: "https://bad.example/b",
        query: "q",
        correct: false,
        reason: "confidently wrong"
      }
    ]
  };
  const out = formatCurationReport(report, "test-model");
  assert.match(out, /\[test-model\]/);
  assert.match(out, /accuracy=0\.500/);
  assert.match(out, /false positives.*: 1/);
  assert.match(out, /1234ms\/page/);
  assert.match(out, /bad\.example\/b/);
  assert.match(out, /confidently wrong/);
});
