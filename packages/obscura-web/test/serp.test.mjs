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
  _clearSearchCache
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
        { url: "https://s1", title: "S1", content: "snippet 1" },
        { title: "no url — dropped" },
        { url: "https://s2", title: "S2", content: "snippet 2" }
      ]
    })
  });
  const r = await searxngSearch("q", { base: "http://127.0.0.1:8888", limit: 8 }, okFetch);
  assert.deepEqual(r, [
    { title: "S1", url: "https://s1", snippet: "snippet 1" },
    { title: "S2", url: "https://s2", snippet: "snippet 2" }
  ]);

  assert.equal(await searxngSearch("q", { base: "http://x" }, async () => ({ ok: false })), null);
  assert.equal(
    await searxngSearch("q", { base: "http://x" }, async () => {
      throw new Error("network");
    }),
    null
  );
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
    { fetchImpl, throttleImpl: noThrottle }
  );
  assert.equal(out.source, "bing");
  assert.equal(out.results.length, 2);
});

test("searchWeb throws a native-fallback message when every source fails", async () => {
  _clearSearchCache();
  const fetchImpl = async () => {
    throw new Error("blocked");
  };
  await assert.rejects(
    () => searchWeb("hello world query three", {}, { fetchImpl, throttleImpl: noThrottle }),
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
  const a = await searchWeb(q, {}, { fetchImpl, throttleImpl: noThrottle });
  const b = await searchWeb(q, {}, { fetchImpl, throttleImpl: noThrottle });
  assert.equal(a.source, "duckduckgo");
  assert.equal(b.source, "duckduckgo");
  assert.equal(calls, 1, "second call served from cache");
});
