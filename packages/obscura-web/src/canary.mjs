/**
 * Per-engine SERP drift check.
 *
 * `genericExtractLinks` (serp.mjs) already recovers a bespoke parser's silent failure at request
 * time — but that's a REACTIVE cushion, only exercised when a real `obscura_search` call happens
 * to hit the broken engine. This module is the PROACTIVE counterpart: probe every registered
 * engine against a couple of queries that are virtually guaranteed to return something on any
 * general-purpose engine ("python", "javascript"), so a parser/URL-pattern break (the SERP's own
 * markup changed) surfaces as `ok:false` before an agent's real research call ever depends on it.
 *
 * Deliberately excluded from `npm test` — this hits real search engines over the network, exactly
 * the ban-avoidance risk the rest of the package works around avoiding. Run it manually or on a
 * schedule via `node src/canary-run.mjs`.
 */
import { searchWeb, ENGINES, _clearSearchCache } from "./serp.mjs";

/**
 * Common enough that any working general-purpose engine returns SOMETHING for both, but
 * multi-word and specific — NOT a bare single word. `genericExtractLinks`'s similarity gate
 * (serp.mjs, `GENERIC_MIN_SIMILARITY`) scores a candidate's `title+snippet` against the query via
 * Ratcliff/Obershelp `SequenceMatcher.ratio()`, which is dominated by the LENGTH of both sides — a
 * one-word query like "python" against a normal-length snippet structurally can't clear the 0.3
 * floor even on a perfectly healthy engine (measured: ratio ~0.11-0.30 for realistic snippet
 * lengths). A 3-5 word query close to the matched title's own wording clears it comfortably
 * (measured: ratio ~0.56 on a realistic fixture) — this affects ONLY the 6 generic-extraction
 * engines (mojeek/marginalia/ecosia/startpage/yahoo/qwant); the 4 bespoke-parser engines
 * (duckduckgo/bing/brave/bing-rss) parse structured markup regardless of query wording.
 */
export const CANARY_QUERIES = Object.freeze([
  "python list comprehension tutorial",
  "javascript array methods reference"
]);

/**
 * @param {{ engines?: string[], queries?: readonly string[], deps?: object }} [opts]
 *   `deps` forwards to `searchWeb` (fetchImpl/searxngImpl/throttleImpl) — tests inject fixtures
 *   here; the live CLI runner passes nothing and gets the real obscura fetch + real pacing.
 * @returns {Promise<Array<{ engine: string, ok: boolean, count: number, sampleTitle: string, error: string }>>}
 */
export async function runCanary({
  engines = Object.keys(ENGINES),
  queries = CANARY_QUERIES,
  deps = {}
} = {}) {
  const results = [];
  for (const engine of engines) {
    if (!ENGINES[engine]) {
      results.push({ engine, ok: false, count: 0, sampleTitle: "", error: "unknown engine" });
      continue;
    }
    let ok = false;
    let count = 0;
    let sampleTitle = "";
    let lastError = "";
    for (const query of queries) {
      // searchWeb's own per-query cache is keyed by (query, limit) only, not by the `engines`
      // override — cleared before every probe so this engine's result can't be a stale hit left
      // over from probing a DIFFERENT engine on the same query a moment ago.
      _clearSearchCache();
      try {
        const out = await searchWeb(query, { engines: [engine], searxngUrl: "" }, deps);
        if (out?.results?.length) {
          ok = true;
          count = out.results.length;
          sampleTitle = out.results[0]?.title || "";
          break; // one query answering is enough to prove the engine is alive
        }
        lastError = "0 results";
      } catch (e) {
        lastError = e?.message || String(e);
      }
    }
    results.push({ engine, ok, count, sampleTitle, error: ok ? "" : lastError });
  }
  return results;
}
