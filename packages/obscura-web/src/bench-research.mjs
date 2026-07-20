/**
 * Retrieval-quality benchmark for the web research pipeline: recall@k, MRR, hit@1, nDCG@k
 * and MAP over a labelled golden set of `(query -> URL that must surface)` pairs.
 *
 * Why this exists before any pipeline change: this repo has already measured, twice, that a
 * ranking change which looks obviously better can be worse. ADR-0021 found equal-weight RRF
 * fusion of a weak signal dropped recall@5 from 1.000 to 0.938. ADR-0026 shipped a
 * cross-encoder reranker whose only numbers measured *here* are negative (Spanish fixture:
 * recall 1.000 -> 0.891). The vault RAG has `bench_recall.py` to catch that class of
 * regression; the web side had nothing. This is the missing half, and it deliberately mirrors
 * `bench_recall.py`'s metric definitions and report shape so the two read the same.
 *
 * What it scores: **candidate ranking only** — the ordering of SERP candidates before any
 * page is fetched. That is exactly the surface ADR-0055 §5 left broken ("BM25 remains the
 * coarse filter that decides which top_k pages are even fetched") and exactly what phases 1-2
 * change. Curation quality is a separate question with a separate scorer, because it needs a
 * live Ollama and is therefore not a deterministic CI gate.
 *
 * Determinism: in fixture mode the SearXNG JSON is frozen on disk, so the numbers are
 * reproducible across machines and the metrics double as a CI regression gate — no network,
 * no engines, no drift. Live mode re-queries a real SearXNG to measure drift on demand.
 */

import { readFile } from "node:fs/promises";

import { canonicalizeUrl } from "./url-identity.mjs";

/** Normalized Discounted Cumulative Gain over a ranked URL list (BEIR/MTEB convention).
 *
 * `DCG@k = Σ (2^gain − 1) / log2(rank + 1)` over the top-k, divided by the same sum for the
 * ideal ordering (gains sorted descending). Binary relevance is the special case where every
 * golden URL has gain 1. Returns 0 when there is no attainable gain.
 *
 * This is the metric that discriminates *ordering* once recall saturates — recall@k cannot
 * tell "golden URL at rank 1" from "golden URL at rank 10", and that difference is the whole
 * point of the ranking work.
 */
export function ndcgAtK(ranked, gains, k) {
  let dcg = 0;
  ranked.slice(0, k).forEach((d, i) => {
    const g = gains.get(d) ?? 0;
    if (g) dcg += (2 ** g - 1) / Math.log2(i + 2);
  });
  const ideal = [...gains.values()].sort((a, b) => b - a).slice(0, k);
  let idcg = 0;
  ideal.forEach((g, i) => {
    idcg += (2 ** g - 1) / Math.log2(i + 2);
  });
  return idcg ? dcg / idcg : 0;
}

/** Average Precision: mean of precision@i taken at each relevant hit.
 *
 * `AP = (1/|R|) · Σ_i precision@i · rel(i)`. A golden URL missing from the ranked list
 * contributes 0 (counted in `|R|`, never adds precision), so AP penalizes recall gaps as well
 * as bad ordering. Returns 0 when the query has no golden URLs.
 */
export function averagePrecision(ranked, relevant) {
  if (!relevant.size) return 0;
  let hits = 0;
  let running = 0;
  ranked.forEach((d, i) => {
    if (relevant.has(d)) {
      hits += 1;
      running += hits / (i + 1);
    }
  });
  return running / relevant.size;
}

/** Read a JSONL golden set. Each line: `{query, relevant: [urls], kind?, fixture?}`.
 * Blank lines and `#` comments are skipped. Throws on a malformed line rather than silently
 * scoring a short set — a bench that quietly drops queries is worse than no bench. */
export async function loadQueries(path) {
  const text = await readFile(path, "utf8");
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (err) {
      throw new Error(`bench: malformed query line: ${line} (${err.message})`, { cause: err });
    }
    if (!obj.query || !Array.isArray(obj.relevant)) {
      throw new Error(`bench: query line missing 'query'/'relevant': ${line}`);
    }
    out.push(obj);
  }
  if (!out.length) throw new Error(`bench: no queries found in ${path}`);
  return out;
}

/** Score a ranking function against the golden set.
 *
 * @param {object}   opts
 * @param {object[]} opts.queries      loaded golden set
 * @param {Function} opts.candidatesFor async (queryObj) -> raw candidate records `{url,...}`
 * @param {Function} opts.rank          async (queryObj, candidates) -> ordered candidates
 * @param {number}   [opts.k=10]        cutoff
 *
 * Pure measurement: never mutates the golden set or the fixtures. All URL comparison goes
 * through `canonicalizeUrl`, so a golden entry written as `https://x.com/a` still matches a
 * SERP that returned `http://www.x.com/a/?utm_source=rss`.
 */
export async function evaluate({ queries, candidatesFor, rank, k = 10 }) {
  const results = [];
  for (const q of queries) {
    const relevant = new Set(q.relevant.map(canonicalizeUrl));
    const candidates = await candidatesFor(q);
    const ordered = await rank(q, candidates);
    const retrieved = ordered.map((c) => canonicalizeUrl(c.url));
    const topk = retrieved.slice(0, k);

    let firstRank = null;
    for (let i = 0; i < topk.length; i++) {
      if (relevant.has(topk[i])) {
        firstRank = i + 1;
        break;
      }
    }
    const foundInTopK = topk.filter((u) => relevant.has(u)).length;
    const gains = new Map([...relevant].map((u) => [u, 1]));

    results.push({
      query: q.query,
      kind: String(q.kind ?? "?"),
      relevant: [...relevant].sort(),
      retrieved: topk,
      // Where the golden URL landed in the FULL ranked output (not just the top-k). Ranking is
      // a permutation of the pool, so `null` here means the crawl never surfaced the answer at
      // all — a GATHER failure, which no reranker can fix. A number greater than k means the
      // answer was crawled and then ranked out — a RANKING failure, fixable here. Conflating
      // the two is how you spend a week improving the wrong stage.
      rankedAt: (() => {
        const i = retrieved.findIndex((u) => relevant.has(u));
        return i === -1 ? null : i + 1;
      })(),
      candidates: candidates.length,
      firstRank,
      recallAtK: relevant.size ? foundInTopK / relevant.size : 0,
      hitAt1: firstRank === 1,
      ndcgAtK: ndcgAtK(topk, gains, k),
      averagePrecision: averagePrecision(topk, relevant)
    });
  }

  const positives = results.filter((r) => r.relevant.length);
  const agg = (fn) =>
    positives.length ? positives.reduce((s, r) => s + fn(r), 0) / positives.length : 0;

  const buckets = new Map();
  for (const r of positives) {
    if (!buckets.has(r.kind)) buckets.set(r.kind, []);
    buckets.get(r.kind).push(r);
  }
  const byKind = {};
  for (const kind of [...buckets.keys()].sort()) {
    const rs = buckets.get(kind);
    const a = (fn) => rs.reduce((s, r) => s + fn(r), 0) / rs.length;
    byKind[kind] = {
      n: rs.length,
      mrr: a((r) => (r.firstRank ? 1 / r.firstRank : 0)),
      recallAtK: a((r) => r.recallAtK),
      hitAt1: a((r) => (r.hitAt1 ? 1 : 0)),
      ndcgAtK: a((r) => r.ndcgAtK),
      map: a((r) => r.averagePrecision)
    };
  }

  return {
    k,
    n: results.length,
    mrr: agg((r) => (r.firstRank ? 1 / r.firstRank : 0)),
    recallAtK: agg((r) => r.recallAtK),
    hitAt1: agg((r) => (r.hitAt1 ? 1 : 0)),
    ndcgAtK: agg((r) => r.ndcgAtK),
    map: agg((r) => r.averagePrecision),
    byKind,
    results
  };
}

/** Human-readable one-screen summary, same shape as `bench_recall.py`'s `format_report`. */
export function formatReport(report, label = "") {
  const lines = [
    `research bench${label ? ` [${label}]` : ""}: n=${report.n} k=${report.k}`,
    `  recall@${report.k} = ${report.recallAtK.toFixed(3)}`,
    `  MRR        = ${report.mrr.toFixed(3)}`,
    `  hit@1      = ${report.hitAt1.toFixed(3)}`,
    `  nDCG@${report.k}   = ${report.ndcgAtK.toFixed(3)}`,
    `  MAP        = ${report.map.toFixed(3)}`,
    "  by kind:"
  ];
  for (const [kind, m] of Object.entries(report.byKind)) {
    lines.push(
      `    ${kind.padEnd(16)} n=${m.n} recall@${report.k}=${m.recallAtK.toFixed(3)} ` +
        `mrr=${m.mrr.toFixed(3)} hit@1=${m.hitAt1.toFixed(3)} ` +
        `ndcg@${report.k}=${m.ndcgAtK.toFixed(3)} map=${m.map.toFixed(3)}`
    );
  }
  // A miss where the golden URL *was* in the pool is a ranking failure (fixable here).
  // A miss where it was never in the pool is a gather failure (fixable in the crawl).
  const misses = report.results.filter((r) => r.relevant.length && r.firstRank === null);
  if (misses.length) {
    lines.push(`  misses (${misses.length}):`);
    for (const r of misses) {
      const why = r.rankedAt
        ? `crawled, ranked #${r.rankedAt} — RANKING`
        : "never crawled — GATHER";
      lines.push(`    [${r.kind}] ${JSON.stringify(r.query)} -> ${why}`);
    }
  }
  return lines.join("\n");
}
