/**
 * Engine suspension must be REPORTED, not swallowed (ADR-0057).
 *
 * Found by rate-limiting this machine into a wall during development: after an afternoon of
 * fixture capture and probe queries, every upstream engine was suspended —
 *
 *   brave       "Suspended: too many requests"    (settings.yml: 180s)
 *   google cse  "Suspended: too many requests"    (180s)
 *   startpage   "Suspended: CAPTCHA"              (3600s; a Cloudflare CAPTCHA is 1296000s)
 *   duckduckgo  "Suspended: timeout"
 *   wikidata    "Suspended: access denied"        (180s)
 *
 * — and SearXNG answered **HTTP 200 with `results: []`**. Not an error. Byte-identical to "this
 * query has no hits". The pipeline dropped `unresponsive_engines`, so it told the agent it
 * found nothing about prompt injection, while the real answer sat on page 1 of a search engine
 * it was temporarily banned from.
 *
 * The two situations demand opposite next moves — rephrase the query vs. wait three minutes —
 * so collapsing them is the worst kind of dishonesty this package can commit. Hence these tests.
 */

import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import { deepResearch, clearSearxngCache, clearFetchCache } from "../src/research.mjs";
import { searxngSearch } from "../src/serp.mjs";

// The SearXNG cache is module-global state (that is the point — it spans research calls to keep
// duplicate queries off the upstream engines that ban by IP). Tests must therefore be hermetic
// by construction: without this, a test asserting "one upstream call" silently passes on a
// cache hit left by whichever test ran before it.
beforeEach(() => {
  clearSearxngCache();
  clearFetchCache();
});

const noOllama = {
  checkOllamaImpl: async () => ({ ok: false, hasModel: false }),
  checkRobotsImpl: async () => ({ allowed: true, checked: false }),
  ensureOllamaImpl: async () => false
};

/** A SearXNG whose engines are all banned: 200 OK, empty results, populated diagnostics. */
const suspendedBody = {
  query: "q",
  results: [],
  unresponsive_engines: [
    ["brave", "Suspended: too many requests"],
    ["startpage", "Suspended: CAPTCHA"]
  ]
};

test("searxngSearch surfaces unresponsive_engines through the meta out-param", async () => {
  const meta = {};
  const fetchImpl = async () => ({ ok: true, json: async () => suspendedBody });
  const out = await searxngSearch("q", { base: "http://x", meta }, fetchImpl);

  assert.deepEqual(out, [], "no results, exactly as the live wall behaved");
  assert.deepEqual(meta.unresponsive, [
    ["brave", "Suspended: too many requests"],
    ["startpage", "Suspended: CAPTCHA"]
  ]);
});

test("searxngSearch without a meta out-param still works (every other caller ignores it)", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => suspendedBody });
  const out = await searxngSearch("q", { base: "http://x" }, fetchImpl);
  assert.deepEqual(out, []);
});

test("searxngSearch leaves meta.unresponsive unset on a healthy response", async () => {
  const meta = {};
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ results: [{ url: "https://a", title: "A", content: "c", score: 1 }] })
  });
  const out = await searxngSearch("q", { base: "http://x", meta }, fetchImpl);
  assert.equal(out.length, 1);
  assert.equal(meta.unresponsive, undefined, "a healthy round must not fabricate a warning");
});

test("deepResearch reports enginesUnavailable instead of a bare empty result", async () => {
  // The regression this exists to prevent: 'scanned: 0, results: []' with no explanation, which
  // reads as "the web has nothing on this" when it means "you are banned for three minutes".
  const out = await deepResearch(
    "prompt injection",
    { searxngUrl: "http://x", maxCandidates: 10, topK: 5 },
    {
      searxngImpl: async (_q, { meta }) => {
        if (meta) meta.unresponsive = suspendedBody.unresponsive_engines;
        return [];
      },
      // No candidates => the scrape chain is tried next; make it fail like the live DDG timeout.
      searchImpl: async () => {
        throw new Error("every source failed or returned nothing");
      },
      fetchImpl: async () => ({ content: "" }),
      ...noOllama
    }
  ).catch((e) => e);

  // Whether it throws or returns empty, the suspension detail must reach the caller somehow.
  const text = out instanceof Error ? out.message : JSON.stringify(out);
  assert.match(text, /brave|startpage|Suspended|every source failed/i);
});

test("deepResearch carries enginesUnavailable alongside real results (partial degradation)", async () => {
  // The common case is not total: some engines are banned, others still answer. The results are
  // real but thinner than they look, and only this field says so.
  const out = await deepResearch(
    "q",
    { searxngUrl: "http://x", maxCandidates: 10, topK: 1 },
    {
      searxngImpl: async (_q, { page, meta }) => {
        if (meta) meta.unresponsive = [["startpage", "Suspended: CAPTCHA"]];
        return page === 1 ? [{ title: "T", url: "https://t", snippet: "s", score: 1 }] : [];
      },
      fetchImpl: async () => ({ content: "body" }),
      ...noOllama
    }
  );

  assert.equal(out.results.length, 1, "the engines that DID answer still produce results");
  assert.deepEqual(out.enginesUnavailable, ["startpage: Suspended: CAPTCHA"]);
});

test("deepResearch omits enginesUnavailable when every engine answered", async () => {
  const out = await deepResearch(
    "q",
    { searxngUrl: "http://x", maxCandidates: 10, topK: 1 },
    {
      searxngImpl: async (_q, { page }) =>
        page === 1 ? [{ title: "T", url: "https://t", snippet: "s", score: 1 }] : [],
      fetchImpl: async () => ({ content: "body" }),
      ...noOllama
    }
  );
  assert.equal(out.enginesUnavailable, undefined, "a healthy crawl must not cry wolf");
});
