/**
 * Unit coverage for the seed-URL crawler engine (crawl.mjs), ADR-0062. Everything here is pure or
 * fully injected — no real network, no real clock, no real filesystem, no obscura binary. Proves:
 *  - link extraction resolves relatives, strips fragments, drops non-navigations, dedupes;
 *  - asset extraction finds pdf hrefs + img src/srcset, deduped;
 *  - metadata reads OG/meta/time/JSON-LD with the documented precedence;
 *  - inScope honors default (seed hosts + subdomains), explicit host rules, and path-prefix rules;
 *  - detectGated flags Cloudflare/reCAPTCHA/login-form bodies and passes real pages;
 *  - crawlSite does BFS within depth/page caps, dedupes, resumes from a covered-hash set, does not
 *    follow gated pages, filters by keyword, obeys robots, downloads assets, batches persist+export,
 *    and honors cooperative shouldStop.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  extractLinks,
  extractAssets,
  extractMetadata,
  inScope,
  detectGated,
  matchesKeywords,
  crawlSite
} from "../src/crawl.mjs";
import { hash8 } from "../src/url-identity.mjs";

// ── extractLinks ────────────────────────────────────────────────────────────────────────────

test("extractLinks resolves relative URLs against the base and strips fragments", () => {
  const html = `<a href="/docs/a">A</a> <a href="b.html">B</a> <a href="#top">top</a>
    <a href="https://other.com/x#frag">X</a> <a href="mailto:z@x.com">mail</a>`;
  const links = extractLinks(html, "https://foo.com/docs/index.html");
  assert.deepEqual(links, [
    "https://foo.com/docs/a",
    "https://foo.com/docs/b.html",
    "https://other.com/x"
  ]);
});

test("extractLinks dedupes and drops javascript:/tel:/data: schemes", () => {
  const html = `<a href="/a">1</a><a href="/a">dup</a><a href="javascript:void(0)">j</a>
    <a href="tel:+1">t</a>`;
  assert.deepEqual(extractLinks(html, "https://foo.com/"), ["https://foo.com/a"]);
});

test("extractLinks returns [] for junk input without throwing", () => {
  assert.deepEqual(extractLinks(null, "https://foo.com/"), []);
  assert.deepEqual(extractLinks("<a href='/x'>x</a>", "not a url"), []);
});

// ── extractAssets ───────────────────────────────────────────────────────────────────────────

test("extractAssets finds pdf hrefs and image src/srcset, resolved and deduped", () => {
  const html = `
    <a href="/files/guide.pdf">guide</a>
    <a href="/files/guide.pdf">dup</a>
    <a href="report.PDF?v=2">report</a>
    <img src="/img/a.png">
    <img srcset="/img/b-1x.jpg 1x, /img/b-2x.jpg 2x">
    <a href="/page.html">not an asset</a>`;
  const assets = extractAssets(html, "https://foo.com/docs/");
  assert.deepEqual(assets, [
    { url: "https://foo.com/files/guide.pdf", kind: "pdf" },
    { url: "https://foo.com/docs/report.PDF?v=2", kind: "pdf" },
    { url: "https://foo.com/img/a.png", kind: "image" },
    { url: "https://foo.com/img/b-1x.jpg", kind: "image" },
    { url: "https://foo.com/img/b-2x.jpg", kind: "image" }
  ]);
});

// ── extractMetadata ─────────────────────────────────────────────────────────────────────────

test("extractMetadata prefers OpenGraph/meta and reads article:published_time + author", () => {
  const html = `<html><head>
    <title>Fallback Title</title>
    <meta property="og:title" content="Real Title">
    <meta name="author" content="Ada Lovelace">
    <meta property="article:published_time" content="2026-01-02T00:00:00Z">
  </head><body><h1>H</h1></body></html>`;
  assert.deepEqual(extractMetadata(html), {
    title: "Real Title",
    author: "Ada Lovelace",
    published: "2026-01-02T00:00:00Z"
  });
});

test("extractMetadata falls back to <title>, <time datetime>, and JSON-LD", () => {
  const html = `<html><head>
    <title>Only Title</title>
    <script type="application/ld+json">
      {"@type":"Article","author":{"name":"Grace Hopper"},"datePublished":"2025-12-31"}
    </script>
  </head><body><time datetime="2025-06-01">June</time></body></html>`;
  const meta = extractMetadata(html);
  assert.equal(meta.title, "Only Title");
  assert.equal(meta.author, "Grace Hopper");
  // article:published_time absent → the <time datetime> wins over JSON-LD (meta precedence first).
  assert.equal(meta.published, "2025-06-01");
});

test("extractMetadata never throws on malformed JSON-LD", () => {
  const html = `<script type="application/ld+json">{ not json </script><title>T</title>`;
  assert.equal(extractMetadata(html).title, "T");
});

// ── inScope ─────────────────────────────────────────────────────────────────────────────────

test("inScope default: seed host and its subdomains are in, others out", () => {
  const rules = { hostRules: [], prefixRules: [] };
  assert.equal(inScope("https://foo.com/a", rules, ["foo.com"]), true);
  assert.equal(inScope("https://docs.foo.com/a", rules, ["foo.com"]), true);
  assert.equal(inScope("https://evil.com/a", rules, ["foo.com"]), false);
  assert.equal(inScope("https://notfoo.com/a", rules, ["foo.com"]), false);
});

test("inScope explicit host rule and host+path prefix rule", () => {
  const hostRule = { hostRules: ["foo.com"], prefixRules: [] };
  assert.equal(inScope("https://foo.com/anything", hostRule, ["seed.com"]), true);
  assert.equal(
    inScope("https://seed.com/anything", hostRule, ["seed.com"]),
    false,
    "explicit allow overrides the seed-host default"
  );

  const prefixRule = { hostRules: [], prefixRules: ["foo.com/docs"] };
  assert.equal(inScope("https://foo.com/docs/api", prefixRule, []), true);
  assert.equal(inScope("https://foo.com/blog/x", prefixRule, []), false);
});

// ── detectGated ─────────────────────────────────────────────────────────────────────────────

test("detectGated flags Cloudflare, reCAPTCHA, and login-form bodies", () => {
  assert.ok(detectGated("<title>Just a moment...</title>"));
  assert.ok(detectGated("<div class='g-recaptcha'></div>"));
  assert.ok(detectGated("<form><input type='password' name='pw'></form>"));
  assert.equal(
    detectGated("<html><body><h1>Real docs</h1><p>content here</p></body></html>"),
    null
  );
});

// ── matchesKeywords ─────────────────────────────────────────────────────────────────────────

test("matchesKeywords: empty keeps all; otherwise any case-insensitive substring", () => {
  assert.equal(matchesKeywords("anything", []), true);
  assert.equal(matchesKeywords("anything", undefined), true);
  assert.equal(matchesKeywords("Optimize your CPU", ["cpu"]), true);
  assert.equal(matchesKeywords("nothing relevant", ["cpu", "gpu"]), false);
});

// ── crawlSite: the BFS engine, fully injected ───────────────────────────────────────────────

/** Build injected deps over an in-memory `site` (url -> html). Records persist/export/asset calls. */
function harness(site, over = {}) {
  const calls = { persisted: [], exported: 0, assets: [], fetched: [] };
  const deps = {
    fetchImpl: async (url) => {
      calls.fetched.push(url);
      if (!(url in site)) throw new Error(`404 ${url}`);
      return { content: site[url] };
    },
    persistImpl: async ({ results }) => {
      calls.persisted.push(...results);
      return { written: results.length, updated: 0, topic: "t", dir: "d" };
    },
    coveredHashesImpl: async () => new Set(over.covered ?? []),
    exportImpl: async () => {
      calls.exported++;
      return { json: "crawl.json", csv: "crawl.csv" };
    },
    robotsImpl: async (url) => ({ allowed: !(over.robotsBlocked ?? new Set()).has(url) }),
    assetImpl: async (url, { kind }) => {
      calls.assets.push({ url, kind });
      return { saved: true, path: `assets/${kind}`, bytes: 100 };
    },
    sleepImpl: async () => {},
    ...over.deps
  };
  return { deps, calls };
}

test("crawlSite walks internal links breadth-first within maxDepth", async () => {
  const site = {
    "https://foo.com/": `<a href="/a">a</a><a href="/b">b</a>`,
    "https://foo.com/a": `<a href="/a1">a1</a>`,
    "https://foo.com/a1": `<p>leaf</p>`,
    "https://foo.com/b": `<p>leaf b</p>`
  };
  const { deps, calls } = harness(site);
  const out = await crawlSite(
    { seeds: ["https://foo.com/"], topic: "t", maxDepth: 1, paceMs: 0, downloadAssets: false },
    deps
  );
  // depth 0: /, depth 1: /a and /b — /a1 is depth 2, beyond maxDepth 1, never fetched.
  assert.deepEqual(
    new Set(calls.fetched),
    new Set(["https://foo.com/", "https://foo.com/a", "https://foo.com/b"])
  );
  assert.equal(out.crawled, 3);
  assert.equal(out.stoppedReason, "frontier_empty");
});

test("crawlSite honors maxPages and never refetches a duplicate URL", async () => {
  const site = {
    "https://foo.com/": `<a href="/a">a</a><a href="/a">dup</a><a href="/b">b</a><a href="/c">c</a>`,
    "https://foo.com/a": `<a href="/">home again</a>`,
    "https://foo.com/b": `<p>b</p>`,
    "https://foo.com/c": `<p>c</p>`
  };
  const { deps, calls } = harness(site);
  const out = await crawlSite(
    {
      seeds: ["https://foo.com/"],
      topic: "t",
      maxDepth: 5,
      maxPages: 2,
      paceMs: 0,
      downloadAssets: false
    },
    deps
  );
  assert.equal(out.crawled, 2, "stops at maxPages");
  assert.equal(out.stoppedReason, "max_pages");
  // "/" appears twice in links + as a back-link from /a, but is fetched at most once.
  const homeFetches = calls.fetched.filter((u) => u === "https://foo.com/").length;
  assert.equal(homeFetches, 1);
});

test("crawlSite resumes: a URL already in the covered set is neither fetched nor enqueued", async () => {
  const site = {
    "https://foo.com/": `<a href="/old">old</a><a href="/new">new</a>`,
    "https://foo.com/old": `<p>old</p>`,
    "https://foo.com/new": `<p>new</p>`
  };
  const { deps, calls } = harness(site, { covered: [hash8("https://foo.com/old")] });
  await crawlSite(
    { seeds: ["https://foo.com/"], topic: "t", maxDepth: 2, paceMs: 0, downloadAssets: false },
    deps
  );
  assert.ok(!calls.fetched.includes("https://foo.com/old"), "covered URL skipped");
  assert.ok(calls.fetched.includes("https://foo.com/new"), "new URL still crawled");
});

test("crawlSite does not follow links out of a gated page", async () => {
  const site = {
    "https://foo.com/": `<a href="/wall">wall</a><a href="/ok">ok</a>`,
    "https://foo.com/wall": `<title>Just a moment...</title><a href="/secret">secret</a>`,
    "https://foo.com/ok": `<p>ok</p>`,
    "https://foo.com/secret": `<p>secret</p>`
  };
  const { deps, calls } = harness(site);
  const out = await crawlSite(
    { seeds: ["https://foo.com/"], topic: "t", maxDepth: 3, paceMs: 0, downloadAssets: false },
    deps
  );
  assert.equal(out.gated, 1);
  assert.ok(
    !calls.fetched.includes("https://foo.com/secret"),
    "gated page's links are not followed"
  );
});

test("crawlSite keyword filter persists only matching pages, still traverses the rest", async () => {
  // Anchor text is deliberately keyword-free so the keep-filter is exercised on the PAGE text,
  // not on link labels the seed happens to carry.
  const site = {
    "https://foo.com/": `<a href="/one">link one</a><a href="/two">link two</a>`,
    "https://foo.com/one": `<p>How to optimize your CPU voltage</p>`,
    "https://foo.com/two": `<p>unrelated content</p><a href="/three">next page</a>`,
    "https://foo.com/three": `<p>tuning the GPU clock</p>`
  };
  const { deps, calls } = harness(site);
  const out = await crawlSite(
    {
      seeds: ["https://foo.com/"],
      topic: "t",
      maxDepth: 3,
      keywords: ["cpu", "gpu"],
      paceMs: 0,
      downloadAssets: false
    },
    deps
  );
  const keptUrls = calls.persisted.map((r) => r.url).sort();
  assert.deepEqual(keptUrls, ["https://foo.com/one", "https://foo.com/three"]);
  assert.equal(out.kept, 2);
  assert.ok(
    calls.fetched.includes("https://foo.com/two"),
    "non-matching page still traversed to reach /three"
  );
});

test("crawlSite obeys robots.txt via the injected robots checker", async () => {
  const site = {
    "https://foo.com/": `<a href="/blocked">no</a><a href="/allowed">yes</a>`,
    "https://foo.com/blocked": `<p>should not be read</p>`,
    "https://foo.com/allowed": `<p>ok</p>`
  };
  const { deps, calls } = harness(site, { robotsBlocked: new Set(["https://foo.com/blocked"]) });
  const out = await crawlSite(
    { seeds: ["https://foo.com/"], topic: "t", maxDepth: 2, paceMs: 0, downloadAssets: false },
    deps
  );
  assert.equal(out.robotsBlocked, 1);
  assert.ok(!calls.fetched.includes("https://foo.com/blocked"));
});

test("crawlSite downloads assets of kept pages and records them", async () => {
  const site = {
    "https://foo.com/": `<a href="/doc">doc</a>`,
    "https://foo.com/doc": `<p>content</p><a href="/g.pdf">pdf</a><img src="/i.png">`
  };
  const { deps, calls } = harness(site);
  const out = await crawlSite(
    { seeds: ["https://foo.com/"], topic: "t", maxDepth: 2, paceMs: 0, downloadAssets: true },
    deps
  );
  assert.equal(out.assetsSaved, 2);
  assert.deepEqual(calls.assets.map((a) => a.kind).sort(), ["image", "pdf"]);
});

test("crawlSite stops cooperatively when shouldStop flips", async () => {
  const site = {
    "https://foo.com/": `<a href="/a">a</a>`,
    "https://foo.com/a": `<a href="/b">b</a>`,
    "https://foo.com/b": `<p>b</p>`
  };
  let stop = false;
  const { deps, calls } = harness(site, { deps: { shouldStop: () => stop } });
  // Flip stop right after the first page is fetched.
  const origFetch = deps.fetchImpl;
  deps.fetchImpl = async (url) => {
    const r = await origFetch(url);
    stop = true;
    return r;
  };
  const out = await crawlSite(
    { seeds: ["https://foo.com/"], topic: "t", maxDepth: 3, paceMs: 0, downloadAssets: false },
    deps
  );
  assert.equal(out.stoppedReason, "stopped");
  assert.equal(calls.fetched.length, 1);
});

test("crawlSite flushes persist + export at the end", async () => {
  const site = { "https://foo.com/": `<p>hello world</p>` };
  const { deps, calls } = harness(site);
  const out = await crawlSite(
    { seeds: ["https://foo.com/"], topic: "t", paceMs: 0, downloadAssets: false },
    deps
  );
  assert.equal(out.persistedWritten, 1);
  assert.ok(calls.exported >= 1);
  assert.deepEqual(out.exportPaths, { json: "crawl.json", csv: "crawl.csv" });
});

// ── circuit breaker (ADR-0062 amendment) ────────────────────────────────────────────────────

test("circuit breaker skips remaining URLs on a host after repeated failures", async () => {
  const site = {
    // /f1../f4 deliberately absent from `site` — fetchImpl (see harness) throws for each.
    "https://foo.com/": `<a href="/f1">1</a><a href="/f2">2</a><a href="/f3">3</a><a href="/f4">4</a>`
  };
  const { deps, calls } = harness(site);
  const out = await crawlSite(
    { seeds: ["https://foo.com/"], topic: "t", maxDepth: 1, paceMs: 0, downloadAssets: false },
    deps
  );
  assert.equal(out.fetchFailed, 3, "first 3 same-host failures are attempted (default threshold)");
  assert.equal(out.circuitOpen, 1, "the 4th is skipped once the circuit opens");
  assert.ok(!calls.fetched.includes("https://foo.com/f4"), "circuit-open URL is never fetched");
  const row = out.rows.find((r) => r.url === "https://foo.com/f4");
  assert.equal(row.status, "circuit-open");
});

test("circuit breaker tracks hosts independently — a healthy host is unaffected", async () => {
  // Two seeds (not a cross-host link — a link to a non-seed host is out of scope by default and
  // would never be enqueued regardless of the breaker) so bar.com is crawled independently of
  // foo.com's failures.
  const site = {
    "https://foo.com/": `<a href="/f1">1</a><a href="/f2">2</a><a href="/f3">3</a>`,
    "https://bar.com/ok": `<p>fine</p>`
  };
  const { deps, calls } = harness(site);
  const out = await crawlSite(
    {
      seeds: ["https://foo.com/", "https://bar.com/ok"],
      allow: ["foo.com", "bar.com"],
      topic: "t",
      maxDepth: 1,
      paceMs: 0,
      downloadAssets: false
    },
    deps
  );
  assert.equal(out.circuitOpen, 0, "foo.com never accrues a 4th attempt in this run");
  assert.ok(calls.fetched.includes("https://bar.com/ok"), "a different host is never skipped");
});

// ── content extraction (ADR-0062 amendment) ─────────────────────────────────────────────────

test("crawlSite uses extractImpl's result for the persisted snippet when it finds an article", async () => {
  const site = {
    "https://foo.com/": `<article>real content with nav/footer noise around it</article>`
  };
  const { deps, calls } = harness(site, { deps: { extractImpl: () => "STUBBED MAIN CONTENT" } });
  const out = await crawlSite(
    { seeds: ["https://foo.com/"], topic: "t", maxDepth: 0, paceMs: 0, downloadAssets: false },
    deps
  );
  assert.equal(out.kept, 1);
  assert.equal(calls.persisted[0].snippet, "STUBBED MAIN CONTENT");
});

test("crawlSite falls back to the full sanitized body when extractImpl finds no article", async () => {
  const site = { "https://foo.com/": `<p>short body text</p>` };
  const { deps, calls } = harness(site, { deps: { extractImpl: () => null } });
  await crawlSite(
    { seeds: ["https://foo.com/"], topic: "t", maxDepth: 0, paceMs: 0, downloadAssets: false },
    deps
  );
  assert.equal(calls.persisted[0].snippet, "short body text");
});
