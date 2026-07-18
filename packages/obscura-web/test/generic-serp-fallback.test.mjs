/**
 * The generic, similarity-ranked SERP fallback (Scrapling-inspired resilience, see
 * `serp.mjs#genericExtractLinks`'s doc for what did and did not port and why).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { genericExtractLinks, searchWeb, _clearSearchCache } from "../src/serp.mjs";

/** A DuckDuckGo-shaped page whose result markup has "redesigned" — no `result__a`/
 * `result__snippet` classes left, so `parseDuckDuckGo` returns [] even though the page plainly
 * has real results. This is precisely ADR-0051's flagged risk: "the HTML SERP parsers will
 * drift as engines change markup." */
const REDESIGNED_DDG_PAGE = `
<html><body>
<nav>
  <a href="https://duckduckgo.com/settings">Settings</a>
  <a href="https://duckduckgo.com/about">About DuckDuckGo</a>
</nav>
<main>
  <div class="new-result-card">
    <a href="https://docs.searxng.org/dev/search_api.html">SearXNG Search API pageno format json</a>
    <p>The search API lets you search using SearXNG. pageno is the page number, format can be json.</p>
  </div>
  <div class="new-result-card">
    <a href="https://blogspam.example/unrelated">Best 10 Recipes You Have To Try This Summer</a>
    <p>Cooking tips and delicious recipes for your family dinner tonight.</p>
  </div>
</main>
</body></html>`;

test("genericExtractLinks finds real results on a page whose markup a specific parser can't read", () => {
  const results = genericExtractLinks(REDESIGNED_DDG_PAGE, "SearXNG search API pageno json format");
  const urls = results.map((r) => r.url);
  assert.ok(urls.includes("https://docs.searxng.org/dev/search_api.html"));
});

test("genericExtractLinks ranks the query-relevant result above the unrelated one", () => {
  const results = genericExtractLinks(REDESIGNED_DDG_PAGE, "SearXNG search API pageno json format");
  assert.equal(results[0].url, "https://docs.searxng.org/dev/search_api.html");
});

test("genericExtractLinks excludes the SERP's own navigation chrome", () => {
  const results = genericExtractLinks(REDESIGNED_DDG_PAGE, "settings about");
  const urls = results.map((r) => r.url);
  assert.ok(!urls.includes("https://duckduckgo.com/settings"));
  assert.ok(!urls.includes("https://duckduckgo.com/about"));
});

test("genericExtractLinks drops short-text chrome links (Home, Next, icons)", () => {
  const html = `<a href="https://x.com/a">Next</a><a href="https://x.com/b">A properly long and descriptive result title about testing</a>`;
  const results = genericExtractLinks(html, "testing descriptive title");
  const urls = results.map((r) => r.url);
  assert.ok(!urls.includes("https://x.com/a"));
  assert.ok(urls.includes("https://x.com/b"));
});

test("genericExtractLinks filters out real-world noise via the measured similarity floor", () => {
  // Measured, not assumed: unrelated real English text still shares incidental short substrings
  // (0.095-0.213 across several noise pairs) — the floor (0.3) sits above that range, not at 0.
  const html = `<a href="https://x.com/privacy">Read our full privacy policy and terms of service here</a>`;
  const results = genericExtractLinks(html, "quantum computing error correction codes");
  assert.equal(results.length, 0);
});

test("genericExtractLinks respects `limit` and dedupes repeated hrefs", () => {
  const html = Array.from(
    { length: 5 },
    (_, i) => `<a href="https://x.com/${i}">Result number ${i} about testing similarity ranking</a>`
  )
    .concat(`<a href="https://x.com/0">Result number 0 about testing similarity ranking</a>`) // duplicate
    .join("\n");
  const results = genericExtractLinks(html, "testing similarity ranking", { limit: 3 });
  assert.equal(results.length, 3);
  assert.equal(new Set(results.map((r) => r.url)).size, 3);
});

test("genericExtractLinks degrades to empty on garbage input, never throws", () => {
  assert.deepEqual(genericExtractLinks("<not><valid href=broken", "q"), []);
  assert.deepEqual(genericExtractLinks("", "q"), []);
});

// ── Wired into searchWeb's engine loop ──────────────────────────────────────────────────

test("searchWeb falls back to the generic extractor when the named engine parses 0 results", async () => {
  _clearSearchCache();
  const out = await searchWeb(
    "SearXNG search API pageno json format",
    { engines: ["duckduckgo"] },
    { fetchImpl: async () => ({ content: REDESIGNED_DDG_PAGE }), throttleImpl: async () => {} }
  );
  assert.equal(out.source, "duckduckgo-generic");
  assert.ok(out.results.some((r) => r.url === "https://docs.searxng.org/dev/search_api.html"));
});

test("searchWeb still reports honest failure when even the generic fallback finds nothing", async () => {
  _clearSearchCache();
  await assert.rejects(
    () =>
      searchWeb(
        "anything",
        { engines: ["duckduckgo"] },
        {
          fetchImpl: async () => ({ content: "<html><body>no links at all here</body></html>" }),
          throttleImpl: async () => {}
        }
      ),
    /every source failed or returned nothing/
  );
});

// ── IGNORED_EXTENSIONS (ported from Scrapling's links.py, verified against the installed
// package) — a binary/document URL is not a usable "result" for this text-fallback path ──

test("genericExtractLinks skips binary/document links even with a query-relevant title", () => {
  const html = [
    '<a href="https://example.com/searxng-config-reference.pdf">SearXNG configuration reference and search API guide</a>',
    '<a href="https://example.com/searxng-config-reference.html">SearXNG configuration reference and search API guide</a>'
  ].join("\n");
  const results = genericExtractLinks(html, "SearXNG configuration reference search API");
  const urls = results.map((r) => r.url);
  assert.ok(!urls.some((u) => u.endsWith(".pdf")));
  assert.ok(urls.some((u) => u.endsWith(".html")));
});

test("genericExtractLinks: extension check ignores query strings and fragments", () => {
  // A .pdf URL with a trailing query/fragment must still be recognized as a PDF, not accidentally
  // let through because the naive "ends with .pdf" check sees "...pdf?utm_source=x" instead.
  const html =
    '<a href="https://example.com/doc.pdf?utm_source=x#page=3">A properly long descriptive result about testing</a>';
  const results = genericExtractLinks(html, "testing descriptive result");
  assert.equal(results.length, 0);
});

test("genericExtractLinks: a normal .html/.htm/extensionless URL is never filtered as binary", () => {
  const html = [
    '<a href="https://example.com/article.html">A properly long descriptive testing result</a>',
    '<a href="https://example.com/docs/testing">Another properly long descriptive testing result</a>'
  ].join("\n");
  const results = genericExtractLinks(html, "testing descriptive result");
  assert.equal(results.length, 2);
});

test("searchWeb does not attempt the generic fallback on bing-rss (structured XML, not HTML)", async () => {
  _clearSearchCache();
  // Well-formed RSS with a real item, but genericExtractLinks would never even be reached for
  // it — assert the specific parser's own result wins, proving the raw-format branch is skipped.
  const rss = `<rss><channel><item><title>T</title><link>https://x.com/a</link><description>d</description></item></channel></rss>`;
  const out = await searchWeb(
    "q",
    { engines: ["bing-rss"] },
    { fetchImpl: async () => ({ content: rss }), throttleImpl: async () => {} }
  );
  assert.equal(out.source, "bing-rss");
});
