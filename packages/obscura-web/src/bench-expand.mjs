#!/usr/bin/env node
/**
 * Measure query expansion by the only thing that matters: does the golden URL enter the pool?
 *
 * This exists because eyeballing `concept` strings is not evaluation. Three prompt drafts were
 * judged that way and the judgement was wrong every time — the "perfect" draft turned out to be
 * copying answers out of its own examples, and the "improved" one bled a Kubernetes term into a
 * SQLite query. Whether a `concept` string LOOKS canonical to a reader is not the question. The
 * question is whether the expansion causes the answer to be crawled, and that is measurable.
 *
 * Scores the `vocab-mismatch` bucket of evals/research, where every miss is `never crawled` and
 * therefore the only bucket expansion can possibly move. Live by construction: it must issue
 * real SearXNG queries for the sub-queries a model just invented, so it cannot run off frozen
 * fixtures the way bench-run.mjs does.
 *
 * Usage:
 *   node src/bench-expand.mjs                                  # every pulled model
 *   node src/bench-expand.mjs --models phi4-mini:3.8b-q4_K_M   # one
 *   node src/bench-expand.mjs --kind lexical                   # a different bucket
 */

import { ensureSearxng, stopSearxng } from "./ensure-searxng.mjs";
import { expandQuery, ensureOllamaServer } from "./ollama-client.mjs";
import { loadQueries } from "./bench-research.mjs";
import { QUERIES_PATH, searxngRaw } from "./bench-capture.mjs";
import { canonicalizeUrl } from "./url-identity.mjs";
import { reciprocalRankFusion } from "./rank.mjs";

const SOCIAL = /instagram|facebook|tiktok|twitter|x\.com|reddit|youtube|pinterest|linkedin/i;

/** Rank of the first golden URL in a candidate list, or null. */
function goldenRank(urls, golden) {
  const i = urls.findIndex((u) => golden.has(canonicalizeUrl(u)));
  return i === -1 ? null : i + 1;
}

async function poolFor(base, query) {
  const body = await searxngRaw(base, query).catch(() => null);
  return (body?.results ?? []).filter((r) => r?.url).map((r) => r.url);
}

/**
 * Fusion strategies for per-sub-query pools. This is a comparison, not a choice, because the
 * first measurement showed the obvious strategy is the wrong one.
 */
const FUSIONS = {
  /** Equal-weight RRF — rewards CONSENSUS across sub-queries. */
  rrf(pools) {
    const fused = reciprocalRankFusion(pools.map((urls) => urls.map(canonicalizeUrl)));
    return [...fused.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u);
  },

  /** Round-robin interleave — rewards each sub-query's OWN best.
   *
   * Consensus is the wrong objective here and RRF only does consensus. The entire premise of
   * expansion is that one well-phrased sub-query surfaces a page the others cannot: that page
   * appears in exactly ONE pool and collects one RRF term, while a generically-related page that
   * every phrasing returns collects five and wins. RRF systematically demotes the thing
   * expansion exists to find. Interleaving guarantees every sub-query's #1 lands in the first
   * N slots regardless of whether anything corroborates it.
   */
  interleave(pools) {
    const lists = pools.map((urls) => urls.map(canonicalizeUrl));
    const out = [];
    const seen = new Set();
    const depth = Math.max(0, ...lists.map((l) => l.length));
    for (let i = 0; i < depth; i++) {
      for (const list of lists) {
        const u = list[i];
        if (!u || seen.has(u)) continue;
        seen.add(u);
        out.push(u);
      }
    }
    return out;
  },

  /** Best-rank-wins: score a URL by its best position in any pool, ties broken by how many
   * pools found it. A middle ground — keeps interleave's "one good sub-query is enough" while
   * still letting corroboration break ties. */
  bestrank(pools) {
    const best = new Map();
    pools.forEach((urls) => {
      urls.forEach((raw, i) => {
        const u = canonicalizeUrl(raw);
        const prev = best.get(u);
        if (!prev) best.set(u, { rank: i, found: 1 });
        else {
          prev.rank = Math.min(prev.rank, i);
          prev.found++;
        }
      });
    });
    return [...best.entries()]
      .sort((a, b) => a[1].rank - b[1].rank || b[1].found - a[1].found)
      .map(([u]) => u);
  }
};

async function main() {
  const args = process.argv.slice(2);
  const mArg = args.indexOf("--models");
  const models =
    mArg !== -1 ? args[mArg + 1].split(",") : ["phi4-mini:3.8b-q4_K_M", "qwen3.5:4b-q4_K_M"];
  const kArg = args.indexOf("--kind");
  const kind = kArg !== -1 ? args[kArg + 1] : "vocab-mismatch";

  const queries = (await loadQueries(QUERIES_PATH)).filter((q) => q.kind === kind);
  if (!queries.length) {
    console.error(`no queries of kind=${kind} in ${QUERIES_PATH}`);
    process.exitCode = 1;
    return;
  }

  await ensureOllamaServer().catch(() => {});
  const base = await ensureSearxng();
  if (!base) {
    console.error("SearXNG unreachable — this bench is live by construction.");
    process.exitCode = 1;
    return;
  }

  try {
    // Baseline: the original query alone, which is what shipped before expansion existed.
    console.log(`\n=== baseline: original query only (kind=${kind}, n=${queries.length})\n`);
    const baseline = [];
    for (const q of queries) {
      const golden = new Set(q.relevant.map(canonicalizeUrl));
      const urls = await poolFor(base, q.query);
      const rank = goldenRank(urls, golden);
      const junk = urls.filter((u) => SOCIAL.test(u)).length;
      baseline.push({ query: q.query, rank, n: urls.length, junk });
      console.log(
        `  ${rank ? `FOUND @${String(rank).padStart(2)}` : "  MISS   "}  ` +
          `pool=${String(urls.length).padStart(3)}  social=${String(junk).padStart(2)}  ${q.query.slice(0, 52)}`
      );
    }
    const baseFound = baseline.filter((r) => r.rank).length;
    const baseJunk = baseline.reduce((s, r) => s + r.junk, 0);
    console.log(`\n  found ${baseFound}/${queries.length}   social junk ${baseJunk}`);

    for (const model of models) {
      console.log(`\n=== expanded: ${model}\n`);
      const rows = [];
      for (const q of queries) {
        const golden = new Set(q.relevant.map(canonicalizeUrl));
        let sub = [q.query];
        let concept = "";
        const t0 = Date.now();
        try {
          const ex = await expandQuery({ query: q.query, max: 6, model, timeoutMs: 120_000 });
          if (ex.queries.length) sub = ex.queries;
          concept = ex.concept;
        } catch (e) {
          console.log(`  EXPAND FAILED: ${e.message}`);
        }
        const ms = Date.now() - t0;

        const pools = [];
        for (const sq of sub) pools.push(await poolFor(base, sq));
        // Which sub-query, if any, actually surfaced the answer — the whole diagnostic.
        const via = sub.findIndex((_, i) => goldenRank(pools[i] ?? [], golden) !== null);

        const ranks = {};
        for (const [name, fuse] of Object.entries(FUSIONS)) {
          ranks[name] = goldenRank(fuse(pools), golden);
        }
        rows.push(ranks);

        const shown = Object.entries(ranks)
          .map(([n, r]) => `${n}=${r ? `@${r}` : "MISS"}`)
          .join("  ");
        console.log(`  ${shown}   ${ms}ms  concept=${JSON.stringify(concept)}`);
        console.log(`      ${q.query.slice(0, 62)}`);
        sub.slice(1).forEach((s, i) => console.log(`        ${via === i + 1 ? "->" : "  "} ${s}`));
        if (via > 0) console.log(`      surfaced by sub-query #${via}`);
        else if (via === 0) console.log("      surfaced by the ORIGINAL query");
      }
      console.log("");
      for (const name of Object.keys(FUSIONS)) {
        const found = rows.filter((r) => r[name]).length;
        // Rank matters as much as presence: top_k defaults to 8, so an answer fused to rank 40
        // is in the pool and still never read. "in top 8" is the number that decides whether
        // the agent actually sees it.
        const inTopK = rows.filter((r) => r[name] && r[name] <= 8).length;
        const meanRank = rows.filter((r) => r[name]).map((r) => r[name]);
        const avg = meanRank.length
          ? (meanRank.reduce((a, b) => a + b, 0) / meanRank.length).toFixed(1)
          : "-";
        console.log(
          `  ${name.padEnd(11)} found ${found}/${queries.length} (${found - baseFound >= 0 ? "+" : ""}${found - baseFound} vs baseline)   ` +
            `IN TOP-8: ${inTopK}/${queries.length}   mean rank ${avg}`
        );
      }
    }
  } finally {
    stopSearxng();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
