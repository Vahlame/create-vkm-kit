/**
 * CI regression gate for research retrieval quality — the web-side counterpart of the vault
 * RAG's `tests/test_bench_recall.py`.
 *
 * It drives the REAL `deepResearch`, not a reimplementation of it. That distinction is the
 * point: `bench-run.mjs` reproduces the old pipeline inside its own `today` arm so the arms
 * can be compared, and a gate built on that reproduction would keep passing while the actual
 * shipped pipeline drifted away from it. Here SearXNG is injected from a frozen fixture and
 * `obscuraFetch` is stubbed, so what gets scored is the ordering `deepResearch` itself
 * produces, offline and deterministically.
 *
 * Thresholds sit a margin below the measured numbers so they catch a real regression without
 * flaking on a fixture refresh. If one goes red, run `node src/bench-run.mjs` for the
 * per-arm decomposition before assuming the pipeline is at fault — it may be the fixtures.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test, { beforeEach } from "node:test";

import { FIXTURES_DIR, QUERIES_PATH, fixtureName } from "../src/bench-capture.mjs";
import { evaluate, formatReport, loadQueries } from "../src/bench-research.mjs";
import { deepResearch, clearFetchCache, clearSearxngCache } from "../src/research.mjs";

// The SearXNG cache is module-global state (that is the point — it spans research calls to keep
// duplicate queries off the upstream engines that ban by IP). Tests must therefore be hermetic
// by construction: without this, a test asserting "one upstream call" silently passes on a
// cache hit left by whichever test ran before it.
beforeEach(() => {
  clearSearxngCache();
  clearFetchCache();
});

// The evals/ fixtures live at the repo root and are not part of the published package — skip
// rather than fail when this package is checked out standalone (same guard as the vault RAG's
// `needs_fixture`).
const havePresent = existsSync(QUERIES_PATH) && existsSync(FIXTURES_DIR);

/** Serve a frozen fixture as if it were SearXNG. `page > 1` is empty: the fixtures capture
 * pageno=1, which is already the union of every enabled engine. */
function searxngFromFixture(fixture) {
  return async (_q, { limit, page }) => {
    if (page > 1) return [];
    return fixture.results
      .filter((r) => r && r.url)
      .slice(0, limit)
      .map((r) => ({
        title: String(r.title ?? ""),
        url: String(r.url),
        snippet: String(r.content ?? ""),
        score: typeof r.score === "number" ? r.score : 0,
        engines: r.engines ?? [],
        publishedDate: r.publishedDate ?? null
      }));
  };
}

/** Run the real pipeline over a fixture and return the candidate order it chose to fetch. */
async function pipelineOrder(query, fixture, topK) {
  const out = await deepResearch(
    query,
    { maxCandidates: 100, topK, searxngUrl: "http://fixture" },
    {
      searxngImpl: searxngFromFixture(fixture),
      // Content is irrelevant here — this gate scores WHICH pages the pipeline picks, which is
      // the stage ADR-0057 changed. Curation quality is a separate question with a separate
      // scorer, because it needs a live Ollama and so cannot be a deterministic CI gate.
      fetchImpl: async (url) => ({ content: `body of ${url}` }),
      checkOllamaImpl: async () => ({ ok: false, hasModel: false }),
      ensureOllamaImpl: async () => false,
      // The golden set's URLs are real (sqlite.org, ollama.com, ...). Without this, a "deterministic,
      // offline" CI gate would make real robots.txt requests to real hosts on every run — exactly
      // the network-dependence this file's own header says it exists to avoid.
      checkRobotsImpl: async () => ({ allowed: true, checked: false })
    }
  );
  return out.results;
}

test(
  "research bench: the shipped pipeline holds its measured retrieval floor",
  { skip: !havePresent },
  async () => {
    const queries = await loadQueries(QUERIES_PATH);
    const have = new Set(await readdir(FIXTURES_DIR));
    const scorable = queries.filter((q) => have.has(fixtureName(q.query, "general")));
    assert.ok(scorable.length >= 10, `expected >=10 fixtured queries, got ${scorable.length}`);

    const fixtures = new Map();
    for (const q of scorable) {
      fixtures.set(
        q.query,
        JSON.parse(await readFile(join(FIXTURES_DIR, fixtureName(q.query, "general")), "utf8"))
      );
    }

    const report = await evaluate({
      queries: scorable,
      candidatesFor: (q) => fixtures.get(q.query).results.map((r) => ({ url: r.url })),
      rank: async (q) => pipelineOrder(q.query, fixtures.get(q.query), 10),
      k: 10
    });

    const floors = { recallAtK: 0.65, mrr: 0.45, hitAt1: 0.35, ndcgAtK: 0.5 };
    for (const [metric, floor] of Object.entries(floors)) {
      assert.ok(
        report[metric] >= floor,
        `${metric} = ${report[metric].toFixed(3)} fell below the ${floor} floor\n\n${formatReport(report, "pipeline")}`
      );
    }
  }
);

test(
  "research bench: reranking the pool would regress the gate",
  { skip: !havePresent },
  async () => {
    // The inverse assertion, and the reason the floors above are trustworthy: they are not
    // numbers any ordering happens to clear. Re-ranking the same fixtures with the BM25 the
    // pipeline used to apply drops it under the floor — so if someone reintroduces a lexical
    // rerank, the gate above fails rather than quietly passing.
    const { rankCandidates } = await import("../src/research.mjs");
    const queries = await loadQueries(QUERIES_PATH);
    const have = new Set(await readdir(FIXTURES_DIR));
    const scorable = queries.filter((q) => have.has(fixtureName(q.query, "general")));

    const fixtures = new Map();
    for (const q of scorable) {
      fixtures.set(
        q.query,
        JSON.parse(await readFile(join(FIXTURES_DIR, fixtureName(q.query, "general")), "utf8"))
      );
    }

    const report = await evaluate({
      queries: scorable,
      candidatesFor: (q) =>
        fixtures.get(q.query).results.map((r) => ({
          title: r.title ?? "",
          url: r.url,
          snippet: r.content ?? ""
        })),
      rank: async (q, cands) => rankCandidates(cands.slice(0, 10), q.query),
      k: 10
    });

    assert.ok(
      report.ndcgAtK < 0.5,
      `BM25 reranking scored nDCG@10 = ${report.ndcgAtK.toFixed(3)}, at or above the 0.5 floor — ` +
        "either the fixtures changed materially or the floors need re-deriving from a fresh sweep"
    );
  }
);
