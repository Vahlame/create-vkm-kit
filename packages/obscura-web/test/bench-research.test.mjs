import assert from "node:assert/strict";
import test from "node:test";

import { averagePrecision, evaluate, formatReport, ndcgAtK } from "../src/bench-research.mjs";

const close = (got, want, eps = 1e-9) =>
  assert.ok(Math.abs(got - want) < eps, `expected ~${want}, got ${got}`);

// ── Metric formulas, pinned to hand-computed values ────────────────────────────────────
//
// Independent of any corpus or fixture: if these drift, the metric itself changed, not the
// pipeline. Mirrors bench_recall.py's `test_metric_formulas_match_hand_computed`.

test("ndcgAtK: golden at rank 1 is perfect", () => {
  const gains = new Map([["b", 1]]);
  close(ndcgAtK(["b", "a", "c"], gains, 3), 1.0);
});

test("ndcgAtK: golden at rank 2 is 1/log2(3)", () => {
  // DCG = (2^1-1)/log2(2+1) = 1/1.5849625 ; IDCG = (2^1-1)/log2(2) = 1
  const gains = new Map([["b", 1]]);
  close(ndcgAtK(["a", "b", "c"], gains, 3), 1 / Math.log2(3));
});

test("ndcgAtK: two goldens, one found at rank 2", () => {
  // DCG = 0 + 1/log2(3) ; IDCG = 1/log2(2) + 1/log2(3)
  const gains = new Map([
    ["b", 1],
    ["c", 1]
  ]);
  const want = 1 / Math.log2(3) / (1 + 1 / Math.log2(3));
  close(ndcgAtK(["a", "b"], gains, 2), want);
});

test("ndcgAtK: no attainable gain returns 0, never NaN", () => {
  assert.equal(ndcgAtK(["a", "b"], new Map(), 2), 0);
});

test("ndcgAtK: respects the k cutoff", () => {
  const gains = new Map([["z", 1]]);
  assert.equal(ndcgAtK(["a", "b", "z"], gains, 2), 0);
});

test("averagePrecision: single golden at rank 2 is 0.5", () => {
  close(averagePrecision(["a", "b", "c"], new Set(["b"])), 0.5);
});

test("averagePrecision: both goldens at the top is 1.0", () => {
  close(averagePrecision(["b", "c", "a"], new Set(["b", "c"])), 1.0);
});

test("averagePrecision: goldens at ranks 2 and 3", () => {
  // (1/2 + 2/3) / 2
  close(averagePrecision(["a", "b", "c"], new Set(["b", "c"])), (1 / 2 + 2 / 3) / 2);
});

test("averagePrecision: a missing golden is counted in |R| and drags the score", () => {
  // Only b is found (rank 1); c never appears. AP = (1/1) / 2 = 0.5
  close(averagePrecision(["b", "x"], new Set(["b", "c"])), 0.5);
});

test("averagePrecision: no goldens returns 0, never NaN", () => {
  assert.equal(averagePrecision(["a"], new Set()), 0);
});

// ── evaluate() ─────────────────────────────────────────────────────────────────────────

const QUERIES = [
  { query: "q1", relevant: ["https://good.example/a"], kind: "lexical" },
  { query: "q2", relevant: ["https://good.example/b"], kind: "vocab-mismatch" }
];

const POOL = {
  q1: [{ url: "https://spam.example/1" }, { url: "https://good.example/a" }],
  q2: [{ url: "https://good.example/b" }, { url: "https://spam.example/2" }]
};

const candidatesFor = async (q) => POOL[q.query];

test("evaluate: scores a ranker and buckets by kind", async () => {
  const identity = async (_q, cands) => cands;
  const r = await evaluate({ queries: QUERIES, candidatesFor, rank: identity, k: 10 });

  assert.equal(r.n, 2);
  close(r.recallAtK, 1.0); // both goldens present in top-10
  close(r.hitAt1, 0.5); // only q2's golden is at rank 1
  close(r.mrr, (1 / 2 + 1 / 1) / 2);
  assert.deepEqual(Object.keys(r.byKind).sort(), ["lexical", "vocab-mismatch"]);
  close(r.byKind["vocab-mismatch"].hitAt1, 1.0);
  close(r.byKind.lexical.hitAt1, 0.0);
});

test("evaluate: a better ranker scores strictly higher on nDCG", async () => {
  const identity = async (_q, cands) => cands;
  const golden = async (q, cands) =>
    [...cands].sort(
      (a, b) => Number(q.relevant.includes(b.url)) - Number(q.relevant.includes(a.url))
    );

  const base = await evaluate({ queries: QUERIES, candidatesFor, rank: identity, k: 10 });
  const best = await evaluate({ queries: QUERIES, candidatesFor, rank: golden, k: 10 });

  assert.ok(best.ndcgAtK > base.ndcgAtK, "an oracle ranker must beat the pool order");
  close(best.hitAt1, 1.0);
});

test("evaluate: URL matching is canonical, not literal", async () => {
  // The golden set says `https://good.example/a`; the SERP returned a tracking-tagged,
  // www-prefixed, http variant. These are the same page and must score as a hit.
  const queries = [{ query: "q", relevant: ["https://good.example/a"], kind: "lexical" }];
  const messy = async () => [{ url: "http://www.good.example/a/?utm_source=rss" }];
  const r = await evaluate({ queries, candidatesFor: messy, rank: async (_q, c) => c, k: 10 });
  close(r.hitAt1, 1.0);
});

test("evaluate: separates a ranking miss from a gather miss", async () => {
  const queries = [
    { query: "ranked-out", relevant: ["https://good.example/a"], kind: "lexical" },
    { query: "never-crawled", relevant: ["https://good.example/z"], kind: "lexical" }
  ];
  const pool = {
    "ranked-out": [
      { url: "https://s.example/1" },
      { url: "https://s.example/2" },
      { url: "https://good.example/a" }
    ],
    "never-crawled": [{ url: "https://s.example/3" }]
  };
  const r = await evaluate({
    queries,
    candidatesFor: async (q) => pool[q.query],
    rank: async (_q, c) => c,
    k: 2 // cutoff pushes the golden of the first query out of top-k
  });

  const [rankedOut, neverCrawled] = r.results;
  assert.equal(rankedOut.firstRank, null);
  assert.equal(rankedOut.rankedAt, 3, "the answer WAS crawled — this is a ranking failure");
  assert.equal(neverCrawled.firstRank, null);
  assert.equal(neverCrawled.rankedAt, null, "the answer was never crawled — a gather failure");

  const out = formatReport(r);
  assert.match(out, /crawled, ranked #3 — RANKING/);
  assert.match(out, /never crawled — GATHER/);
});

test("formatReport renders the headline metrics and kind buckets", async () => {
  const r = await evaluate({ queries: QUERIES, candidatesFor, rank: async (_q, c) => c, k: 10 });
  const out = formatReport(r, "fixture");
  assert.match(out, /research bench \[fixture\]: n=2 k=10/);
  assert.match(out, /recall@10 = 1\.000/);
  assert.match(out, /vocab-mismatch/);
});
