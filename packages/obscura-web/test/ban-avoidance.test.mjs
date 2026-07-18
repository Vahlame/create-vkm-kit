/**
 * Not banning the machine you run on (ADR-0057 §6).
 *
 * The engines that answer a `general` SearXNG query are free-tier scrapes of Google and
 * Startpage. They ban by IP, the ban outlives a SearXNG restart, and a banned instance answers
 * HTTP 200 with `results: []` — so the tool doesn't fail, it silently finds nothing.
 *
 * Measured over the golden set: exactly TWO engines ever returned a result (google cse, 220
 * results / 7 golden; startpage, 110 / 6). `general` has no redundancy to lose. Hence the three
 * defences pinned here: search categories that don't ban, cache away duplicate requests, and cap
 * how many sub-queries go out at once.
 */

import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import { clearFetchCache, clearSearxngCache, deepResearch } from "../src/research.mjs";

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

const oneResult = (page) =>
  page === 1 ? [{ title: "T", url: "https://t", snippet: "s", score: 1 }] : [];

test("the crawl asks for it+science, not just general", async () => {
  // `general` enables 10 engines of which only 3 are web search at all (the rest are Wikipedia,
  // Wikidata, a currency converter and three translators). `it` and `science` add github, mdn,
  // docker hub, arxiv, semantic scholar — site APIs that answer while the scrapers are banned
  // and that do not ban. Measured with general fully suspended: general n=0, it n=21,
  // science n=21, it,science n=42.
  clearSearxngCache();
  const seen = [];
  await deepResearch(
    "q",
    { searxngUrl: "http://x", maxCandidates: 10, topK: 1 },
    {
      searxngImpl: async (_q, { page, categories }) => {
        seen.push(categories);
        return oneResult(page);
      },
      fetchImpl: async () => ({ content: "body" }),
      ...noOllama
    }
  );
  assert.ok(seen.length > 0);
  for (const c of seen) {
    assert.match(c, /general/);
    assert.match(c, /it/);
    assert.match(c, /science/);
  }
});

test("adding categories costs ZERO extra upstream requests", async () => {
  // The whole reason this is a default rather than an opt-in: SearXNG accepts a comma list and
  // fans out internally. If it ever became one call per category it would multiply the very load
  // it was added to survive — so this asserts the request count is independent of the list.
  let calls = 0;
  const deps = () => ({
    searxngImpl: async (_q, { page }) => {
      calls++;
      return oneResult(page);
    },
    fetchImpl: async () => ({ content: "body" }),
    ...noOllama
  });

  clearSearxngCache();
  await deepResearch("q", { searxngUrl: "http://x", topK: 1, categories: "general" }, deps());
  const oneCategory = calls;

  clearSearxngCache();
  calls = 0;
  await deepResearch(
    "q",
    { searxngUrl: "http://x", topK: 1, categories: "general,it,science" },
    deps()
  );
  assert.equal(calls, oneCategory, "three categories cost exactly what one category costs");
});

test("a repeated crawl issues no upstream requests at all", async () => {
  // The duplicate request is what bans you: it buys zero new candidates and spends real quota
  // against engines that count by IP. Iterating on a topic is the thing this tool exists for.
  let calls = 0;
  const deps = {
    searxngImpl: async (_q, { page }) => {
      calls++;
      return oneResult(page);
    },
    fetchImpl: async () => ({ content: "body" }),
    ...noOllama
  };
  const opts = { searxngUrl: "http://x", maxCandidates: 10, topK: 1 };

  clearSearxngCache();
  const a = await deepResearch("same query", opts, deps);
  const first = calls;
  const b = await deepResearch("same query", opts, deps);

  assert.ok(first > 0, "the first crawl really did hit the network");
  assert.equal(calls, first, "the second crawl added nothing — including the exhaustion probe");
  assert.deepEqual(
    a.results.map((r) => r.url),
    b.results.map((r) => r.url),
    "and it returns the same candidates"
  );
});

test("an exhausted page IS cached — that empty is a fact, not a failure", async () => {
  // Pagination ends when a page comes back empty. With healthy engines that emptiness is stable,
  // so re-probing it on every repeat spends one upstream request per sub-query to re-learn what
  // we already knew. Distinguishing it from a ban is the whole reason `unresponsive` is read here.
  let calls = 0;
  const deps = {
    searxngImpl: async (_q, { page }) => {
      calls++;
      return oneResult(page); // page 2+ is empty, engines healthy
    },
    fetchImpl: async () => ({ content: "body" }),
    ...noOllama
  };
  const opts = { searxngUrl: "http://x", maxCandidates: 10, topK: 1 };

  clearSearxngCache();
  await deepResearch("q", opts, deps);
  const first = calls;
  await deepResearch("q", opts, deps);
  assert.equal(calls, first, "the empty page-2 probe was cached too");
});

test("a BANNED empty is never cached — a 3-minute ban must not become a 10-minute one", async () => {
  // Same 200 + [] as an exhausted page, opposite meaning. `unresponsive_engines` is the only
  // thing separating them: caching this would freeze a transient, self-healing failure for the
  // whole TTL, so a user who waits out the suspension would still get nothing.
  let calls = 0;
  const deps = {
    searxngImpl: async (_q, { meta }) => {
      calls++;
      if (meta) meta.unresponsive = [["google cse", "Suspended: too many requests"]];
      return [];
    },
    searchImpl: async () => {
      throw new Error("every source failed or returned nothing");
    },
    fetchImpl: async () => ({ content: "" }),
    ...noOllama
  };
  const opts = { searxngUrl: "http://x", maxCandidates: 10, topK: 1 };

  clearSearxngCache();
  await deepResearch("q", opts, deps).catch(() => {});
  const after1 = calls;
  await deepResearch("q", opts, deps).catch(() => {});

  assert.ok(calls > after1, "the retry really re-asked; a ban was not frozen into the cache");
});

test("the cache is keyed by categories, not just the query text", async () => {
  // Same words, different engine set, different answers — `general` and `it` are not the same
  // search and must not share a cache entry.
  let calls = 0;
  const deps = {
    searxngImpl: async (_q, { page }) => {
      calls++;
      return oneResult(page);
    },
    fetchImpl: async () => ({ content: "body" }),
    ...noOllama
  };

  clearSearxngCache();
  await deepResearch("q", { searxngUrl: "http://x", topK: 1, categories: "general" }, deps);
  const afterGeneral = calls;
  await deepResearch("q", { searxngUrl: "http://x", topK: 1, categories: "it" }, deps);

  assert.ok(afterGeneral > 0);
  assert.ok(calls > afterGeneral, "the `it` crawl really searched instead of reusing `general`");
});

test("sub-queries are throttled — an unthrottled fan-out is what banned this machine", async () => {
  clearSearxngCache();
  let inFlight = 0;
  let peak = 0;
  await deepResearch(
    "q",
    { searxngUrl: "http://x", maxCandidates: 10, topK: 1 },
    {
      // Six sub-queries, as a real expansion would produce.
      expandImpl: async () => ({ concept: "c", queries: ["a", "b", "c", "d", "e", "f"] }),
      checkOllamaImpl: async () => ({ ok: true, hasModel: true }),
      ensureOllamaImpl: async () => true,
      curateImpl: async () => ({ relevance: 8, reason: "r", excerpt: "e" }),
      checkRobotsImpl: async () => ({ allowed: true, checked: false }),
      searxngImpl: async (_q, { page }) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setImmediate(r));
        inFlight--;
        return oneResult(page);
      },
      fetchImpl: async () => ({ content: "body" })
    }
  );
  assert.ok(peak > 0, "the fan-out ran");
  assert.ok(peak <= 2, `at most 2 sub-queries in flight, saw ${peak}`);
});
