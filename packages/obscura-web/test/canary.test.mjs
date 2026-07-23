/**
 * `runCanary` (canary.mjs) — the PROACTIVE drift check. All network access is injected
 * (`deps.fetchImpl`); nothing here dials a real search engine, matching the rest of the suite.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { runCanary, CANARY_QUERIES } from "../src/canary.mjs";

const noThrottle = async () => {};

// A substantial (>500 char) page whose result titles echo CANARY_QUERIES[0] closely (title
// wording close to the query, snippet SHORT — see canary.mjs's comment on why: a title that just
// vaguely mentions "python" inside a long paragraph will NOT clear genericExtractLinks' similarity
// gate). `www.mojeek.com` chrome links are included so SERP_HOSTS filtering (serp.mjs) exercises
// the same "own navigation, not a result" path the real engine's page would trigger.
const WORKING_FIXTURE = `<html><body>
  <header><a href="https://www.mojeek.com/">Mojeek home</a>
    <a href="https://www.mojeek.com/about">About Mojeek search engine</a></header>
  <ul class="results">
    <li><a href="https://example.com/py-lc">Python list comprehension tutorial guide</a>
      <p>Examples and best practices for beginners.</p></li>
    <li><a href="https://example.org/js-arr">JavaScript array methods reference guide</a>
      <p>Complete reference with usage examples.</p></li>
  </ul>
  <footer><a href="https://www.mojeek.com/privacy">Privacy policy for Mojeek</a></footer>
</body></html>`;

test("runCanary: a healthy engine reports ok:true with a sample title", async () => {
  const results = await runCanary({
    engines: ["mojeek"],
    deps: {
      fetchImpl: async () => ({ content: WORKING_FIXTURE }),
      searxngImpl: async () => null,
      throttleImpl: noThrottle
    }
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].engine, "mojeek");
  assert.equal(results[0].ok, true);
  assert.ok(results[0].count > 0);
  assert.ok(results[0].sampleTitle.length > 0);
  assert.equal(results[0].error, "");
});

test("runCanary: an engine returning nothing for every query reports ok:false", async () => {
  const results = await runCanary({
    engines: ["mojeek"],
    deps: {
      fetchImpl: async () => ({ content: "<html><body>no results</body></html>" }),
      searxngImpl: async () => null,
      throttleImpl: noThrottle
    }
  });
  assert.equal(results[0].ok, false);
  assert.equal(results[0].count, 0);
});

test("runCanary: a hard failure (thrown fetch) on every query reports ok:false with the error", async () => {
  const results = await runCanary({
    engines: ["duckduckgo"],
    deps: {
      fetchImpl: async () => {
        throw new Error("net::ERR_CONNECTION_RESET");
      },
      searxngImpl: async () => null,
      throttleImpl: noThrottle
    }
  });
  assert.equal(results[0].ok, false);
  assert.match(results[0].error, /ERR_CONNECTION_RESET/);
});

test("runCanary: the SECOND query rescues an engine whose first query came back empty", async () => {
  let call = 0;
  const results = await runCanary({
    engines: ["mojeek"],
    // The 2nd query must be the one WORKING_FIXTURE's titles actually echo — genericExtractLinks'
    // similarity gate is query-specific (see canary.mjs's comment), so an unrelated 2nd query
    // would ALSO come back empty and this test would no longer isolate "does a later query
    // rescue an engine", just "is the fixture matched by anything at all".
    queries: ["completely unrelated first query", CANARY_QUERIES[0]],
    deps: {
      fetchImpl: async () => {
        call++;
        return call === 1
          ? { content: "<html><body>nothing here</body></html>" }
          : { content: WORKING_FIXTURE };
      },
      searxngImpl: async () => null,
      throttleImpl: noThrottle
    }
  });
  assert.equal(results[0].ok, true);
  assert.equal(call, 2);
});

test("runCanary: an unknown engine name is reported, not thrown", async () => {
  const results = await runCanary({
    engines: ["not-a-real-engine"],
    deps: { fetchImpl: async () => ({ content: "" }), throttleImpl: noThrottle }
  });
  assert.equal(results[0].ok, false);
  assert.match(results[0].error, /unknown engine/);
});

test("runCanary: probes every registered engine when none is specified", async () => {
  const results = await runCanary({
    deps: {
      fetchImpl: async () => ({ content: WORKING_FIXTURE }),
      searxngImpl: async () => null,
      throttleImpl: noThrottle
    }
  });
  assert.ok(results.length >= 8); // duckduckgo, bing, brave, bing-rss, mojeek, marginalia, ecosia, startpage, yahoo, qwant
  assert.ok(results.every((r) => typeof r.ok === "boolean"));
});

test("CANARY_QUERIES is non-empty and generic enough to always answer", () => {
  assert.ok(CANARY_QUERIES.length >= 1);
});
