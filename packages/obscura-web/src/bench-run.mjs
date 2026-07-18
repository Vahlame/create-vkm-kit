#!/usr/bin/env node
/**
 * Run the research bench over the frozen fixtures and print one report per ranking arm.
 *
 * The arms DECOMPOSE the loss rather than just scoring a winner. Today's pipeline makes two
 * independent lossy decisions between SearXNG and the fetch loop, and lumping them together
 * would say something regressed without saying which half to fix:
 *
 *   today               slice to PAGE_SIZE=10, then re-rank with BM25 over title+snippet
 *                       (faithful reproduction of serp.mjs + research.mjs as they ship)
 *   no-slice-bm25       whole pool, still BM25          -> isolates the slice
 *   searxng-json-order  whole pool, delivered order     -> isolates the re-rank
 *   searxng-score-sort  whole pool, re-sorted by score  -> isolates the category-grouping pass
 *
 * Measured result (n=10, k=10): `searxng-json-order` — doing nothing — wins every metric.
 * See rank.mjs's header for the table and the two traps it encodes.
 *
 * Usage:
 *   node src/bench-run.mjs [--k 10] [--json]
 *   node src/bench-run.mjs --sweep     # BM25 fusion-weight sweep (the evidence for w=0)
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { evaluate, formatReport, loadQueries } from "./bench-research.mjs";
import { EVALS_DIR, FIXTURES_DIR, QUERIES_PATH, fixtureName } from "./bench-capture.mjs";
import { rankCandidates } from "./research.mjs";
import { reciprocalRankFusion } from "./rank.mjs";
import { dedupeByUrl } from "./url-identity.mjs";

/** SearXNG's `PAGE_SIZE` as research.mjs hardcodes it today (research.mjs:213). */
const TODAY_PAGE_SIZE = 10;

/** Load a frozen fixture and map it the way `serp.mjs#searxngSearch` maps a live response:
 * `{title, url, content}` -> `{title, url, snippet}`. Everything else — score, positions,
 * engines, publishedDate — is preserved here so an arm can choose to use it. */
async function loadFixture(query, categories = "general") {
  const raw = await readFile(join(FIXTURES_DIR, fixtureName(query, categories)), "utf8");
  const body = JSON.parse(raw);
  return (body.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url,
    snippet: r.content ?? "",
    score: typeof r.score === "number" ? r.score : 0,
    positions: r.positions ?? [],
    engines: r.engines ?? [],
    publishedDate: r.publishedDate ?? null
  }));
}

const ARMS = {
  /** Faithful reproduction of what ships today. */
  today: (q, cands) => {
    const paged = cands.slice(0, TODAY_PAGE_SIZE); // searxngSearch(limit: PAGE_SIZE).slice
    const deduped = dedupeByUrl(paged);
    return rankCandidates(deduped, q.query); // BM25 over title+snippet, blind to `score`
  },
  /** Same BM25 re-rank, but over the whole pool: how much does the slice alone cost? */
  "no-slice-bm25": (q, cands) => rankCandidates(dedupeByUrl(cands), q.query),
  /** SearXNG's delivered order, untouched — the true zero-work baseline.
   *
   * `get_ordered_results()` (results.py:191-244) is TWO passes: sort by the fused `score`,
   * THEN regroup by category/template (`gresults.insert`, :224-243). The JSON arrives in the
   * post-grouping order, so this arm is what you get by simply not reranking. */
  "searxng-json-order": (_q, cands) => dedupeByUrl(cands),
  /** Raw `score` re-sorted, which UNDOES SearXNG's category-grouping pass. Kept as a
   * cautionary arm: it looks like "use SearXNG's ranking" and is measurably not that. */
  "searxng-score-sort": (_q, cands) => dedupeByUrl([...cands].sort((a, b) => b.score - a.score))
};

/** Attach a local BM25 score to each candidate without reordering them. `rankCandidates`
 * returns them sorted and carrying `score`, which collides with SearXNG's own `score` — so
 * read it off by URL and store it under `bm25` instead of letting it clobber the stronger
 * signal. (That collision is live in research.mjs today: the response's `score` field claims
 * to be relevance but is raw BM25, even after Ollama has read the page.) */
function withBm25(candidates, query) {
  const scored = new Map(rankCandidates(candidates, query).map((c) => [c.url, c.score]));
  return candidates.map((c) => ({ ...c, bm25: scored.get(c.url) ?? 0 }));
}

/** RRF fusion of SearXNG's order with BM25, at a given BM25 weight.
 *
 * This lives in the bench, not in rank.mjs, on purpose: the sweep below measured its best
 * weight to be exactly 0, so it is a falsified hypothesis, not pipeline code. Keeping it
 * runnable here is what makes the claim "BM25 adds nothing" re-checkable by the next person
 * instead of folklore they have to take on faith — delete the experiment and all that's left
 * of it is an assertion in a comment. */
function fuseForSweep(candidates, bm25Weight) {
  if (!candidates.length) return [];
  const byKey = new Map(candidates.map((c) => [c.url, c]));
  const rankBy = (fn) => [...candidates].sort((a, b) => fn(b) - fn(a)).map((c) => c.url);
  const scores = reciprocalRankFusion(
    [rankBy((c) => c.score ?? 0), rankBy((c) => c.bm25 ?? 0)],
    [1.0, bm25Weight]
  );
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([url]) => byKey.get(url));
}

/** Sweep BM25's fusion weight against the golden set. The vault RAG needed GRAPH_WEIGHT=0.1
 * (not 1.0) to avoid a weak signal dragging recall down (ADR-0021); this is the same question
 * asked of the same kind of signal, and it gets the same treatment: measured, not chosen.
 * Answer here was stronger than "small": zero. */
async function sweep(queries, k) {
  const rows = [];
  for (const w of [0, 0.1, 0.2, 0.3, 0.5, 0.75, 1.0, 1.5]) {
    const r = await evaluate({
      queries,
      candidatesFor: (q) => loadFixture(q.query),
      rank: async (q, cands) => fuseForSweep(withBm25(dedupeByUrl(cands), q.query), w),
      k
    });
    rows.push({ w, ...r });
  }
  console.log(`BM25_WEIGHT sweep (searxngWeight=1.0, k=${k}, n=${rows[0].n}):\n`);
  console.log("  w      recall@k  MRR     hit@1   nDCG@k  MAP");
  for (const r of rows) {
    console.log(
      `  ${String(r.w).padEnd(6)} ${r.recallAtK.toFixed(3).padEnd(9)} ${r.mrr.toFixed(3)}   ` +
        `${r.hitAt1.toFixed(3)}   ${r.ndcgAtK.toFixed(3)}   ${r.map.toFixed(3)}`
    );
  }
  const best = rows.reduce((a, b) => (b.ndcgAtK > a.ndcgAtK ? b : a));
  console.log(`\n  best nDCG@${k}: w=${best.w} (${best.ndcgAtK.toFixed(3)})`);
}

async function main() {
  const args = process.argv.slice(2);
  const kArg = args.indexOf("--k");
  const k = kArg !== -1 ? Number(args[kArg + 1]) : 10;
  const asJson = args.includes("--json");
  const doSweep = args.includes("--sweep");

  const queries = await loadQueries(QUERIES_PATH);
  const have = new Set(await readdir(FIXTURES_DIR).catch(() => []));
  const scorable = queries.filter((q) => have.has(fixtureName(q.query, "general")));
  if (scorable.length < queries.length) {
    console.error(
      `warning: ${queries.length - scorable.length} queries have no fixture — run bench-capture.mjs`
    );
  }
  if (!scorable.length) {
    console.error(`no fixtures in ${FIXTURES_DIR}; run: node src/bench-capture.mjs`);
    process.exitCode = 1;
    return;
  }

  if (doSweep) {
    await sweep(scorable, k);
    return;
  }

  const reports = {};
  for (const [name, rank] of Object.entries(ARMS)) {
    reports[name] = await evaluate({
      queries: scorable,
      candidatesFor: (q) => loadFixture(q.query),
      rank: async (q, cands) => rank(q, cands),
      k
    });
  }

  if (asJson) {
    console.log(JSON.stringify(reports, null, 2));
    return;
  }

  for (const [name, r] of Object.entries(reports)) {
    console.log(formatReport(r, name));
    console.log();
  }

  const base = reports.today;
  console.log(`delta vs "today" (n=${base.n}, k=${k}, fixtures under ${EVALS_DIR}):`);
  const fmt = (d) => (d >= 0 ? `+${d.toFixed(3)}` : d.toFixed(3));
  for (const [name, r] of Object.entries(reports)) {
    if (name === "today") continue;
    console.log(
      `  ${name.padEnd(16)} nDCG@${k} ${fmt(r.ndcgAtK - base.ndcgAtK)}  ` +
        `recall@${k} ${fmt(r.recallAtK - base.recallAtK)}  ` +
        `MRR ${fmt(r.mrr - base.mrr)}  hit@1 ${fmt(r.hitAt1 - base.hitAt1)}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
