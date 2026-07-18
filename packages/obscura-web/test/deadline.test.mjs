/**
 * The 60s MCP wall (ADR-0057).
 *
 * `DEFAULT_REQUEST_TIMEOUT_MSEC = 60000` in the MCP SDK (shared/protocol.js:8) applies to every
 * request including `tools/call`, and the server cannot extend it — `resetTimeoutOnProgress`
 * defaults to `false` (protocol.js:714), so emitting progress notifications changes nothing
 * unless the CLIENT opted in, which is not this package's decision to make.
 *
 * The consequence is not "slow calls are slow". It is that a call which overruns returns
 * NOTHING: every page it fetched, every curation it ran, all discarded, and the agent gets a
 * timeout error instead of an answer. That is what makes the deadline load-bearing rather than
 * a nicety — and what licenses raising top_k from 8 to 20, which is the change that makes query
 * expansion pay off at all (the fused pool puts the answer at mean rank ~22).
 *
 * Clocks are injected throughout: a test that proves a deadline by sleeping is a test that is
 * slow, flaky, and lies on a loaded CI box.
 */

import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import { deepResearch, clearSearxngCache, clearFetchCache } from "../src/research.mjs";

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

test("deadline: returns the finished PREFIX and reports the gap", async () => {
  let clock = 0;
  const out = await deepResearch(
    "q",
    { maxCandidates: 10, topK: 10, concurrency: 1, deadlineMs: 25, now: () => clock },
    {
      searxngImpl: pool(10),
      fetchImpl: async (url) => {
        clock += 10; // three fetches blow a 25ms budget
        return { content: `body of ${url}` };
      },
      ...noOllama
    }
  );

  assert.ok(out.results.length > 0, "finished work is returned, never thrown away");
  assert.ok(out.results.length < 10, "the deadline actually stopped the crawl");
  assert.equal(out.partial, true);
  assert.equal(out.remaining, 10 - out.results.length);
  // Candidates are ordered BEFORE any fetch, so the prefix that got done is the best-ranked
  // slice. That is what makes a partial answer honest rather than a random sample — and it is
  // why the ordering work had to land before the deadline work.
  assert.equal(out.results[0].url, "https://u0");
});

test("deadline: a crawl that finishes in time carries no partial flag", async () => {
  const out = await deepResearch(
    "q",
    { maxCandidates: 10, topK: 1, deadlineMs: 60_000 },
    { searxngImpl: pool(1), fetchImpl: async () => ({ content: "body" }), ...noOllama }
  );
  assert.equal(out.partial, undefined);
  assert.equal(out.remaining, undefined);
  assert.equal(out.results.length, 1);
});

test("deadline: work already in flight, with time to spare, finishes normally", async () => {
  // The gate stops the pool from PICKING UP new items past the deadline; an item already
  // claimed gets the time actually left, not zero. A fast item well inside that budget must
  // complete for real, not be falsely marked timedOut just because the deadline exists.
  const out = await deepResearch(
    "q",
    { maxCandidates: 10, topK: 1, concurrency: 1, deadlineMs: 5000 },
    {
      searxngImpl: pool(1),
      fetchImpl: async (url) => ({ content: `body of ${url}` }), // resolves immediately
      ...noOllama
    }
  );
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].timedOut, undefined);
  assert.equal(out.partial, undefined);
});

test("deadline: an item already in flight is cut off at the deadline, not its own timeout (regression)", async () => {
  // Found live against a real SearXNG+Ollama stack: a call configured with a 50s deadline took
  // 58s wall-clock. Root cause — the old code let an in-flight item run to fetchImpl's/
  // curateImpl's OWN independent timeout (obscuraFetch ~45s worst case, curatePage 30s) instead
  // of the deadline that was supposed to bound the whole call, which can blow straight through
  // the MCP transport's hard 60s wall and lose everything, including work already finished.
  //
  // `msLeft` is computed from the real clock at claim time and raced via a real `setTimeout`
  // regardless of whether `now`/`deadline` are otherwise faked, so this is tested with real
  // (small) delays rather than an injected clock: deadlineMs is short (30ms) and the fetch is
  // deliberately much slower (300ms) than that remaining budget.
  const out = await deepResearch(
    "q",
    { maxCandidates: 10, topK: 1, concurrency: 1, deadlineMs: 30 },
    {
      searxngImpl: pool(1),
      fetchImpl: () =>
        new Promise((resolve) => setTimeout(() => resolve({ content: "slow" }), 300)),
      ...noOllama
    }
  );
  assert.equal(out.results[0].timedOut, true, "cut off at ~30ms, not left running for 300ms");
  assert.equal(out.results[0].relevant, null, "no verdict — the page was never really read");
  assert.equal(out.partial, true);
  assert.equal(out.remaining, 1);
});

test("deadline: deadlineMs:0 disables the budget (for a caller that owns its own timeout)", async () => {
  let clock = 0;
  const out = await deepResearch(
    "q",
    { maxCandidates: 10, topK: 5, concurrency: 1, deadlineMs: 0, now: () => clock },
    {
      searxngImpl: pool(5),
      fetchImpl: async (url) => {
        clock += 10_000;
        return { content: `body of ${url}` };
      },
      ...noOllama
    }
  );
  assert.equal(out.results.length, 5, "no budget => every candidate is read");
  assert.equal(out.partial, undefined);
});

test("deadline: `fetched` counts what was read, `scanned` what was crawled", async () => {
  // A partial call must not misreport its own depth in either direction: the agent decides
  // whether to call again based on these two numbers.
  let clock = 0;
  const out = await deepResearch(
    "q",
    { maxCandidates: 30, topK: 30, concurrency: 1, deadlineMs: 25, now: () => clock },
    {
      searxngImpl: pool(30),
      fetchImpl: async (url) => {
        clock += 10;
        return { content: `body of ${url}` };
      },
      ...noOllama
    }
  );
  assert.equal(out.scanned, 30, "the crawl really did scan 30 candidates");
  assert.equal(out.fetched, out.results.length, "`fetched` is pages actually read");
  assert.ok(out.fetched < 30);
  assert.equal(out.remaining, 30 - out.fetched);
});

// ── The GATHER phase must respect the deadline too, not just fetch+curate (regression) ──
//
// `mapWithConcurrency`'s SearXNG fan-out call originally didn't pass `{ deadline, now }` at
// all — an oversight found by tracing every caller of the deadline, not by a failing test (none
// existed to fail). Each individual SearXNG call is capped at 10s of its own (serp.mjs), but the
// per-sub-query page-walk loop had no ceiling of its own: a degraded SearXNG could walk up to
// MAX_PAGES sequential 10s-timeout calls per sub-query with none of that time coming out of the
// call's overall budget, burning it entirely before a single page was ever fetched.

test("deadline: the SearXNG page-walk loop stops once the deadline passes, mid-gather", async () => {
  let clock = 0;
  let calls = 0;
  const searxngImpl = async (_q, { page }) => {
    calls++;
    clock += 30; // three pages comfortably clears a 50ms budget
    // Never empty, never reaches maxCandidates alone — without the fix this walks all 5 pages.
    return [{ title: `T${page}`, url: `https://p${page}`, snippet: "s", score: 1 }];
  };
  await deepResearch(
    "q",
    { maxCandidates: 100, topK: 1, expand: false, deadlineMs: 50, now: () => clock },
    { searxngImpl, fetchImpl: async () => ({ content: "body" }), ...noOllama }
  );
  assert.ok(calls < 5, `expected the page walk to stop before MAX_PAGES, saw ${calls} calls`);
});

test("deadline: gather-phase fan-out stops picking up new sub-queries once time is up", async () => {
  // The outer `mapWithConcurrency` gate, exercised at the GATHER call site specifically —
  // distinct from the fetch+curate call site the earlier tests in this file cover.
  let clock = 0;
  const seenQueries = [];
  const searxngImpl = async (q, { page }) => {
    seenQueries.push(q);
    clock += 40;
    return page === 1 ? [{ title: "T", url: `https://${q}`, snippet: "s", score: 1 }] : [];
  };
  await deepResearch(
    "q",
    { maxCandidates: 10, topK: 1, deadlineMs: 50, now: () => clock, concurrency: 1 },
    {
      searxngImpl,
      expandImpl: async () => ({
        concept: "c",
        queries: ["q", "sub1", "sub2", "sub3", "sub4", "sub5"]
      }),
      // expand and curation share the same ollamaAvailable gate — expandImpl needs ok:true to
      // run at all, so curateImpl/checkRobotsImpl must be stubbed too, or this test would make
      // real network calls to Ollama and to robots.txt for `https://sub1` etc.
      checkOllamaImpl: async () => ({ ok: true, hasModel: true }),
      ensureOllamaImpl: async () => true,
      curateImpl: async () => ({ relevance: 5, reason: "stub", excerpt: "" }),
      checkRobotsImpl: async () => ({ allowed: true, checked: false }),
      fetchImpl: async () => ({ content: "body" })
    }
  );
  assert.ok(
    seenQueries.length < 6,
    `expected the fan-out to stop picking up sub-queries once time ran out, saw ${seenQueries.length}`
  );
});
