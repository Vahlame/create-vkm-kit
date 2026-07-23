import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDuckDuckGo,
  parseBing,
  parseBrave,
  parseBingRss,
  stripTags,
  decodeEntities,
  searxngSearch,
  searchWeb,
  _clearSearchCache,
  ENGINES,
  DEFAULT_CHAIN
} from "../src/serp.mjs";

const noThrottle = async () => {};

const DDG_FIXTURE = `
<div class="result">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&rut=z">Example &amp; A</a>
  <a class="result__snippet" href="#">First snippet <b>bold</b> text</a>
</div>
<div class="result">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fb">Example B</a>
  <a class="result__snippet">Second snippet</a>
</div>`;

const BING_FIXTURE = `
<ol id="b_results">
  <li class="b_algo"><h2><a href="https://bing-a.com/">Bing &amp; A</a></h2><p>Snippet A here</p></li>
  <li class="b_algo"><h2><a href="https://bing-b.com/">Bing B</a></h2><div class="b_caption"><p>Snippet B</p></div></li>
</ol>`;

const BRAVE_FIXTURE = `
<div class="snippet">
  <a href="https://brave-a.com/" class="result-header"><span class="title">Brave A</span></a>
  <div class="snippet-description">Brave snippet A</div>
</div>`;

// A generic engine's SERP has no bespoke parser — genericExtractLinks scrapes it. Must be >500 chars
// (the generic path's substantial-page guard) and carry result links whose titles resemble the query.
const MOJEEK_FIXTURE = `<html><body>
  <header><a href="https://www.mojeek.com/">Mojeek home</a>
    <a href="https://www.mojeek.com/about">About Mojeek search engine</a></header>
  <ul class="results">
    <li><a href="https://example.com/win-opt">Windows optimization and latency tuning guide</a>
      <p>A thorough guide to reducing input latency and tuning Windows for performance, covering
      CPU, GPU and power settings for responsiveness.</p></li>
    <li><a href="https://example.org/debloat">Debloating Windows for lower latency and optimization</a>
      <p>How to remove background services and optimize Windows responsiveness and latency.</p></li>
  </ul>
  <footer><a href="https://www.mojeek.com/privacy">Privacy policy for the Mojeek engine</a></footer>
</body></html>`;

test("stripTags/decodeEntities clean HTML into plain text", () => {
  assert.equal(stripTags("<b>hi</b>  &amp;  <i>there</i>"), "hi & there");
  assert.equal(decodeEntities("a&#39;b &quot;c&quot; &#x26; d"), 'a\'b "c" & d');
});

test("parseDuckDuckGo unwraps uddg redirects and pairs snippets", () => {
  const r = parseDuckDuckGo(DDG_FIXTURE);
  assert.equal(r.length, 2);
  assert.equal(r[0].url, "https://example.com/a");
  assert.equal(r[0].title, "Example & A");
  assert.equal(r[0].snippet, "First snippet bold text");
  assert.equal(r[1].url, "https://example.org/b");
});

test("parseBing extracts b_algo blocks with title/url/snippet", () => {
  const r = parseBing(BING_FIXTURE);
  assert.equal(r.length, 2);
  assert.equal(r[0].url, "https://bing-a.com/");
  assert.equal(r[0].title, "Bing & A");
  assert.equal(r[0].snippet, "Snippet A here");
  assert.equal(r[1].url, "https://bing-b.com/");
  assert.equal(r[1].snippet, "Snippet B");
});

test("parseBingRss extracts title/link/snippet from RSS items (structured, CDATA-safe)", () => {
  const xml =
    `<rss version="2.0"><channel><title>Bing: q</title><link>https://www.bing.com/</link>` +
    `<item><title>First &amp; Result</title><link>https://a.example/x</link>` +
    `<description>A short snippet.</description></item>` +
    `<item><title><![CDATA[Second]]></title><link>https://b.example/</link>` +
    `<description>Another one</description></item></channel></rss>`;
  const r = parseBingRss(xml);
  assert.equal(r.length, 2, "channel title/link must not be mistaken for items");
  assert.equal(r[0].url, "https://a.example/x");
  assert.equal(r[0].title, "First & Result");
  assert.equal(r[0].snippet, "A short snippet.");
  assert.equal(r[1].title, "Second");
  assert.equal(r[1].url, "https://b.example/");
});

test("parseBrave (best-effort) extracts result header + description", () => {
  const r = parseBrave(BRAVE_FIXTURE);
  assert.ok(r.length >= 1);
  assert.equal(r[0].url, "https://brave-a.com/");
  assert.equal(r[0].title, "Brave A");
  assert.equal(r[0].snippet, "Brave snippet A");
});

test("searxngSearch normalizes JSON results and tolerates failures", async () => {
  const okFetch = async () => ({
    ok: true,
    json: async () => ({
      results: [
        {
          url: "https://s1",
          title: "S1",
          content: "snippet 1",
          score: 4,
          engines: ["google cse", "startpage"],
          publishedDate: "2026-01-02T00:00:00"
        },
        { title: "no url — dropped" },
        { url: "https://s2", title: "S2", content: "snippet 2", score: 1.5, engines: ["brave"] }
      ]
    })
  });
  const r = await searxngSearch("q", { base: "http://127.0.0.1:8888", limit: 8 }, okFetch);
  // `score`/`engines`/`publishedDate` are carried through, not dropped. `score` is SearXNG's
  // own multi-engine consensus (results.py#calculate_score) and dropping it here was what
  // forced the pipeline to re-derive relevance with BM25 over `snippet` — measurably worse.
  assert.deepEqual(r, [
    {
      title: "S1",
      url: "https://s1",
      snippet: "snippet 1",
      score: 4,
      engines: ["google cse", "startpage"],
      publishedDate: "2026-01-02T00:00:00"
    },
    {
      title: "S2",
      url: "https://s2",
      snippet: "snippet 2",
      score: 1.5,
      engines: ["brave"],
      publishedDate: null
    }
  ]);

  // A response without the scoring fields (an older SearXNG, or the shape a test double
  // hands back) must still work — score defaults to 0, which the pipeline reads as "no
  // consensus signal", exactly the state of the scrape-chain fallback.
  const bareFetch = async () => ({
    ok: true,
    json: async () => ({ results: [{ url: "https://s3", title: "S3", content: "c3" }] })
  });
  assert.deepEqual(await searxngSearch("q", { base: "http://x" }, bareFetch), [
    { title: "S3", url: "https://s3", snippet: "c3", score: 0, engines: [], publishedDate: null }
  ]);

  assert.equal(await searxngSearch("q", { base: "http://x" }, async () => ({ ok: false })), null);
  assert.equal(
    await searxngSearch("q", { base: "http://x" }, async () => {
      throw new Error("network");
    }),
    null
  );
});

test("searxngSearch forwards `page` to SearXNG's `pageno` param (defaults to 1)", async () => {
  let capturedUrl;
  const capture = async (url) => {
    capturedUrl = url;
    return { ok: true, json: async () => ({ results: [] }) };
  };
  await searxngSearch("q", { base: "http://127.0.0.1:8888", page: 3 }, capture);
  assert.match(capturedUrl, /[?&]pageno=3\b/);

  await searxngSearch("q", { base: "http://127.0.0.1:8888" }, capture);
  assert.match(capturedUrl, /[?&]pageno=1\b/);
});

test("searchWeb prefers the SearXNG structured layer when it returns results", async () => {
  _clearSearchCache();
  const searxngImpl = async () => [{ title: "SX", url: "https://sx", snippet: "s" }];
  const fetchImpl = async () => {
    throw new Error("engines must not be reached");
  };
  const out = await searchWeb(
    "hello world query one",
    { searxngUrl: "http://127.0.0.1:8888" },
    { searxngImpl, fetchImpl, throttleImpl: noThrottle }
  );
  assert.equal(out.source, "searxng");
  assert.equal(out.results[0].url, "https://sx");
});

test("searchWeb falls through the engine chain: DDG empty → Bing wins", async () => {
  _clearSearchCache();
  const fetchImpl = async (url) => {
    if (url.includes("duckduckgo")) return { content: "<html>no results here</html>" };
    if (url.includes("bing")) return { content: BING_FIXTURE };
    throw new Error("brave down");
  };
  const out = await searchWeb(
    "hello world query two",
    { engines: ["duckduckgo", "bing"] },
    { fetchImpl, searxngImpl: async () => null, throttleImpl: noThrottle }
  );
  assert.equal(out.source, "bing");
  assert.equal(out.results.length, 2);
});

test("searchWeb DEFAULT chain (no override) rotates past a banned DDG to Brave", async () => {
  _clearSearchCache();
  // No `engines` override → uses DEFAULT_CHAIN (duckduckgo, bing, brave, bing-rss). DDG is banned,
  // Bing returns an empty page, Brave answers — proves the amended default rotates, not just an
  // explicit override.
  const fetchImpl = async (url) => {
    if (url.includes("duckduckgo")) throw new Error("ddg rate-limited");
    if (url.includes("bing.com/search") && !url.includes("format=rss"))
      return { content: "<html>nothing</html>" };
    if (url.includes("search.brave.com")) return { content: BRAVE_FIXTURE };
    throw new Error(`unexpected url ${url}`);
  };
  const out = await searchWeb(
    "hello world query rotate",
    {},
    { fetchImpl, searxngImpl: async () => null, throttleImpl: noThrottle }
  );
  assert.equal(out.source, "brave");
  assert.equal(out.results[0].url, "https://brave-a.com/");
});

test("searchWeb DEFAULT chain falls all the way to bing-rss (never-rate-limited last resort)", async () => {
  _clearSearchCache();
  const RSS =
    `<rss version="2.0"><channel><title>Bing: q</title><link>https://www.bing.com/</link>` +
    `<item><title>Last Resort</title><link>https://r.example/x</link>` +
    `<description>from rss</description></item></channel></rss>`;
  const fetchImpl = async (url) => {
    if (url.includes("format=rss")) return { content: RSS }; // only bing-rss answers
    throw new Error("banned"); // DDG, Bing HTML, Brave all down
  };
  const out = await searchWeb(
    "hello world query lastresort",
    {},
    { fetchImpl, searxngImpl: async () => null, throttleImpl: noThrottle }
  );
  assert.equal(out.source, "bing-rss");
  assert.equal(out.results[0].url, "https://r.example/x");
});

test("a generic engine (mojeek, no bespoke parser) recovers results via genericExtractLinks", async () => {
  _clearSearchCache();
  const fetchImpl = async (url) => {
    if (url.includes("mojeek.com/search")) return { content: MOJEEK_FIXTURE };
    throw new Error("others banned");
  };
  const out = await searchWeb(
    "windows optimization latency tuning guide",
    { engines: ["mojeek"] },
    { fetchImpl, searxngImpl: async () => null, throttleImpl: noThrottle }
  );
  assert.equal(
    out.source,
    "mojeek",
    "a genuine generic engine reports its clean name, not -generic"
  );
  assert.ok(out.results.some((r) => r.url === "https://example.com/win-opt"));
  assert.ok(
    !out.results.some((r) => r.url.includes("mojeek.com")),
    "the engine's own chrome is filtered"
  );
});

test("yahoo/qwant are registered generic-extraction engines, opt-in only (not in DEFAULT_CHAIN)", () => {
  // Same posture as startpage: available via OBSCURA_SEARCH_ENGINES, not silently added to the
  // default chain — their generic-extraction viability through obscura's rendered DOM is unverified.
  assert.equal(ENGINES.yahoo.generic, true);
  assert.equal(ENGINES.qwant.generic, true);
  assert.ok(ENGINES.yahoo.buildUrl("q").includes("search.yahoo.com"));
  assert.ok(ENGINES.qwant.buildUrl("q").includes("qwant.com"));
  assert.ok(!DEFAULT_CHAIN.includes("yahoo"));
  assert.ok(!DEFAULT_CHAIN.includes("qwant"));
});

test("a generic engine (yahoo, no bespoke parser) recovers results via genericExtractLinks when explicitly opted in", async () => {
  _clearSearchCache();
  const fetchImpl = async (url) => {
    if (url.includes("search.yahoo.com")) return { content: MOJEEK_FIXTURE };
    throw new Error("others banned");
  };
  const out = await searchWeb(
    "windows optimization latency tuning guide",
    { engines: ["yahoo"] },
    { fetchImpl, searxngImpl: async () => null, throttleImpl: noThrottle }
  );
  assert.equal(out.source, "yahoo");
  assert.ok(out.results.some((r) => r.url === "https://example.com/win-opt"));
});

test("DEFAULT chain reaches a generic engine (mojeek) when the bespoke engines are empty", async () => {
  _clearSearchCache();
  const bigEmpty = `<html><body>${"no results here ".repeat(60)}</body></html>`; // >500, zero links
  const fetchImpl = async (url) => {
    if (url.includes("mojeek.com/search")) return { content: MOJEEK_FIXTURE };
    if (url.includes("format=rss")) return { content: "<rss></rss>" };
    return { content: bigEmpty }; // ddg / bing / brave: substantial page, no result links
  };
  const out = await searchWeb(
    "windows optimization latency tuning guide",
    {},
    { fetchImpl, searxngImpl: async () => null, throttleImpl: noThrottle }
  );
  assert.equal(out.source, "mojeek");
});

test("searchWeb throws a native-fallback message when every source fails", async () => {
  _clearSearchCache();
  const fetchImpl = async () => {
    throw new Error("blocked");
  };
  await assert.rejects(
    () =>
      searchWeb(
        "hello world query three",
        {},
        { fetchImpl, searxngImpl: async () => null, throttleImpl: noThrottle }
      ),
    /native WebSearch/
  );
});

test("searchWeb: every source down + a stale cache entry -> serves it with stale:true, never throws", async () => {
  _clearSearchCache();
  const q = "hello world query stale offline";
  const fetchImpl = async (url) =>
    url.includes("duckduckgo") ? { content: DDG_FIXTURE } : { content: "" };

  // 1st call: a normal live success, populates the cache.
  const fresh = await searchWeb(
    q,
    {},
    { fetchImpl, searxngImpl: async () => null, throttleImpl: noThrottle }
  );
  assert.equal(fresh.source, "duckduckgo");
  assert.ok(!fresh.stale);

  // Force the entry stale WITHOUT a real sleep (see cacheTtlMs's comment on why 0 is meaningful),
  // then make every live source fail — this is the "network is down" scenario.
  process.env.OBSCURA_SEARCH_CACHE_TTL_MS = "0";
  try {
    const failingFetch = async () => {
      throw new Error("net::ERR_INTERNET_DISCONNECTED");
    };
    const out = await searchWeb(
      q,
      {},
      { fetchImpl: failingFetch, searxngImpl: async () => null, throttleImpl: noThrottle }
    );
    assert.equal(out.stale, true);
    assert.equal(out.source, "duckduckgo"); // the STALE entry's own source, unchanged
    assert.deepEqual(out.results, fresh.results);
  } finally {
    delete process.env.OBSCURA_SEARCH_CACHE_TTL_MS;
  }
});

test("searchWeb: no cache entry at all + every source down -> still throws the native-fallback message", async () => {
  _clearSearchCache();
  const fetchImpl = async () => {
    throw new Error("blocked");
  };
  await assert.rejects(
    () =>
      searchWeb(
        "a query that was never searched before",
        {},
        { fetchImpl, searxngImpl: async () => null, throttleImpl: noThrottle }
      ),
    /native WebSearch/
  );
});

test("searchWeb caches by query+limit (second call does not re-fetch)", async () => {
  _clearSearchCache();
  let calls = 0;
  const fetchImpl = async (url) => {
    calls++;
    return url.includes("duckduckgo") ? { content: DDG_FIXTURE } : { content: "" };
  };
  const q = "hello world query four";
  const a = await searchWeb(
    q,
    {},
    { fetchImpl, searxngImpl: async () => null, throttleImpl: noThrottle }
  );
  const b = await searchWeb(
    q,
    {},
    { fetchImpl, searxngImpl: async () => null, throttleImpl: noThrottle }
  );
  assert.equal(a.source, "duckduckgo");
  assert.equal(b.source, "duckduckgo");
  assert.equal(calls, 1, "second call served from cache");
});
