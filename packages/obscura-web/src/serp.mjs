/**
 * Web search, layered:
 *  1. SearXNG JSON (opt-in, OBSCURA_SEARXNG_URL): a self-hosted metasearch instance returns
 *     STRUCTURED results — no HTML parsing, aggregates many engines, no anti-bot wall. This is
 *     the real answer for fast, high-volume, RELEVANT search; queried directly over HTTP.
 *  2. An engine chain rendered THROUGH obscura (default: DuckDuckGo HTML — see DEFAULT_CHAIN).
 *  3. If every source fails/returns nothing, the caller is told to fall back to the native
 *     WebSearch tool (soft enforcement — obscura preferred, native is the safety net).
 *  + Per-query cache. No artificial throttle (obscura is fast; set OBSCURA_SEARCH_MIN_INTERVAL_MS
 *    only if you WANT to space out requests).
 *
 * Honest constraint, verified live: free SERP scraping cannot be fast + high-volume + relevant at
 * once. DuckDuckGo HTML is the only free source that returns relevant results for technical queries,
 * but it rate-limits rapid bursts (→ clean native fallback). `bing-rss` is fast and never
 * rate-limited but its relevance on long/technical queries is poor (it keyword-matches literally).
 * For serious research volume, run SearXNG. Obscura's page FETCH, by contrast, is reliable and is the
 * dependable primitive here.
 */
import { obscuraFetch } from "./obscura-cli.mjs";
import { similarityRatio } from "./text-similarity.mjs";

// ── HTML helpers ────────────────────────────────────────────────────────────
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Decode the small set of HTML entities that show up in SERP titles/snippets. */
export function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Strip tags, collapse whitespace, decode entities → plain text. */
export function stripTags(s) {
  return decodeEntities(String(s).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** DuckDuckGo HTML wraps outbound links in a `/l/?uddg=<encoded>` redirect — unwrap it. */
function ddgResolveHref(href) {
  if (!href) return href;
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      /* fall through */
    }
  }
  return href.startsWith("//") ? "https:" + href : href;
}

// ── Per-engine parsers ──────────────────────────────────────────────────────

/** Parse `https://html.duckduckgo.com/html/` results. */
export function parseDuckDuckGo(html) {
  const results = [];
  const snippets = [];
  const snipRe = /<a[^>]+class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  for (let sm; (sm = snipRe.exec(html)); ) snippets.push(stripTags(sm[1]));
  const linkRe = /<a[^>]+class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let i = 0;
  for (let lm; (lm = linkRe.exec(html)); i++) {
    const url = ddgResolveHref(decodeEntities(lm[1]));
    const title = stripTags(lm[2]);
    if (url && title) results.push({ title, url, snippet: snippets[i] || "" });
  }
  return results;
}

/** Parse `https://www.bing.com/search` results (`<li class="b_algo">` blocks). */
export function parseBing(html) {
  const results = [];
  const liRe = /<li[^>]+class="[^"]*\bb_algo\b[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  for (let m; (m = liRe.exec(html)); ) {
    const block = m[1];
    const a = block.match(/<h2>\s*<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const p = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const url = decodeEntities(a[1]);
    const title = stripTags(a[2]);
    if (url && title) results.push({ title, url, snippet: p ? stripTags(p[1]) : "" });
  }
  return results;
}

/**
 * Parse `https://search.brave.com/search` results (best-effort — Brave's markup is
 * JS-rendered and drifts; obscura gives us the rendered DOM). Looks for the result
 * anchor (`class` containing "result") with an https href, then a nearby snippet.
 */
export function parseBrave(html) {
  const results = [];
  const seen = new Set();
  const aRe =
    /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*class="[^"]*\b(?:result-header|snippet-title|h)\b[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  for (let m; (m = aRe.exec(html)); ) {
    const url = decodeEntities(m[1]);
    const title = stripTags(m[2]);
    if (!title || seen.has(url)) continue;
    seen.add(url);
    const after = html.slice(aRe.lastIndex, aRe.lastIndex + 1500);
    const snip = after.match(/<[^>]+class="[^"]*\bsnippet-description\b[^"]*"[^>]*>([\s\S]*?)<\//i);
    results.push({ title, url, snippet: snip ? stripTags(snip[1]) : "" });
  }
  return results;
}

/**
 * Parse Bing's RSS feed (`?format=rss`) — STRUCTURED XML (title/link/description per <item>), far more
 * stable and machine-friendly than scraping SERP HTML, and it doesn't trip the anti-bot walls that
 * rate-limit HTML scraping. This is the fast, high-volume path obscura is meant for.
 */
export function parseBingRss(xml) {
  const results = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  for (let m; (m = itemRe.exec(xml)); ) {
    const item = m[1];
    const title = stripTags(rssField(item, "title"));
    const url = decodeEntities(rssField(item, "link").trim());
    const snippet = stripTags(rssField(item, "description"));
    if (/^https?:\/\//i.test(url) && title) results.push({ title, url, snippet });
  }
  return results;
}

/** Extract one RSS/XML field, unwrapping a CDATA section if present. */
function rssField(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1].replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "") : "";
}

/** The SERP's own domains — a generically-extracted "result" pointing back at one of these is
 * the engine's own nav/chrome (home, settings, "next page", a self-referential help link), not
 * an actual search result. Kept to the domains this package actually queries; not a general
 * ad/tracker blocklist (out of scope for this fallback). */
const SERP_HOSTS = new Set([
  "duckduckgo.com",
  "bing.com",
  "microsoft.com",
  "brave.com",
  "search.brave.com"
]);

/**
 * Below this, a generically-extracted candidate's title+snippet doesn't resemble the query
 * enough to be worth returning.
 *
 * MEASURED, not guessed — a first draft assumed pure noise scores "near 0" and shipped 0.03;
 * that assumption was wrong and the test written against it caught the gap immediately. Any two
 * real English sentences share short incidental substrings (common bigrams, articles,
 * prepositions), so unrelated text has a real nonzero floor:
 *
 *   relevant pairs (query vs. its actual match):  0.625 - 0.881
 *   noise pairs   (query vs. unrelated chrome):   0.095 - 0.213
 *
 * 0.30 sits in the gap between those two clusters, with margin on both sides. Recalibrate this
 * (`node -e` a batch of realistic pairs through `similarityRatio`, don't hand-pick a number) if
 * `genericExtractLinks` starts feeling too strict or too loose on real fallback traffic.
 */
const GENERIC_MIN_SIMILARITY = 0.3;
const GENERIC_MIN_TITLE_LEN = 12;

/**
 * File extensions that are never a usable "search result" for this fallback — the URL points at
 * a binary/document, not an HTML page `obscura_fetch`'s markdown dump can meaningfully read.
 * Ported from Scrapling's `spiders/links.py#IGNORED_EXTENSIONS` (verified against the installed
 * package, `pip install scrapling`, not the README) — the same reasoning applies here even though
 * the mechanism differs: Scrapling's `LinkExtractor` filters these because a CSS/XPath selector
 * can't run against a non-HTML document; `genericExtractLinks` filters them because a page that
 * IS one of these would come back as an empty or nonsensical markdown "extraction" (or trigger a
 * browser download prompt) rather than readable content. `pdf` stays on the list for the same
 * reason: obscura is a browser, not a PDF-to-markdown converter, and a fetch against a PDF URL is
 * not the same operation as fetching an HTML page.
 */
const IGNORED_EXTENSIONS = new Set([
  // archives
  "7z",
  "7zip",
  "bz2",
  "rar",
  "tar",
  "gz",
  "xz",
  "zip",
  // images
  "mng",
  "pct",
  "bmp",
  "gif",
  "jpg",
  "jpeg",
  "png",
  "tif",
  "tiff",
  "svg",
  "ico",
  "webp",
  // audio/video
  "mp3",
  "wma",
  "ogg",
  "wav",
  "aac",
  "mp4",
  "mov",
  "avi",
  "mpg",
  "webm",
  "flv",
  "wmv",
  "m4a",
  "m4v",
  // office documents
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "doc",
  "docx",
  "odt",
  "ods",
  "odp",
  // other non-HTML
  "pdf",
  "exe",
  "bin",
  "dmg",
  "iso",
  "apk",
  "jar",
  "msi"
]);

/** The last dot-segment of a URL's pathname, lowercased — "" if there isn't one or it's clearly
 * not an extension (too long, e.g. a version number or a hash fragment mistaken for one). */
function urlExtension(url) {
  const path = url.split(/[?#]/, 1)[0];
  const m = /\.([a-z0-9]{1,5})$/i.exec(path);
  return m ? m[1].toLowerCase() : "";
}

/**
 * Last-resort, engine-agnostic link extraction, ranked by textual resemblance to the query.
 *
 * Inspired by Scrapling's adaptive scraping (github.com/D4Vinci/Scrapling) — verified against
 * its actual source, not its README's paraphrase: `parser.py`'s `find_similar`/`__are_alike`
 * relocate a moved DOM element by scoring tag name, text, individual attributes, tree path,
 * parent tag/attributes and sibling list, each via `SequenceMatcher.ratio()` (Ratcliff/
 * Obershelp), against a threshold. This package has no DOM tree to fingerprint that way — SERP
 * records are flat `{title,url,snippet}` produced by regex, not parsed elements — so porting the
 * multi-facet relocation system itself is disproportionate to what it would buy here, on top of
 * being architecturally impossible without a real parser. What DOES port is the underlying
 * primitive, `similarityRatio` (`text-similarity.mjs`), applied to the one signal this package
 * has: does a candidate's text resemble the query.
 *
 * Engaged only when a specific per-engine parser (`parseDuckDuckGo`/`parseBing`/`parseBrave`)
 * returns ZERO results on an otherwise-substantial page — exactly the failure mode ADR-0051
 * already names as this package's known weak point ("the HTML SERP parsers will drift as
 * engines change markup"). Rather than read that as "this engine has nothing" and cascade to
 * the next one, this recovers whatever the page's generic link structure still offers: any
 * `<a href="http...">` with substantial anchor text, minus the engine's own navigation chrome,
 * ranked by resemblance to the query rather than returned in document order.
 */
export function genericExtractLinks(html, query, { limit = 8 } = {}) {
  const q = String(query ?? "")
    .trim()
    .toLowerCase();
  const candidates = [];
  const seen = new Set();
  const aRe = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (let m; (m = aRe.exec(html)); ) {
    const url = decodeEntities(m[1]);
    const title = stripTags(m[2]);
    if (!title || title.length < GENERIC_MIN_TITLE_LEN || seen.has(url)) continue;

    let host;
    try {
      host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      continue; // an unparseable href is not a usable result either way
    }
    if (SERP_HOSTS.has(host)) continue; // the engine's own chrome, not a result
    if (IGNORED_EXTENSIONS.has(urlExtension(url))) continue; // a binary/doc, not a readable page

    seen.add(url);
    // Stop at the NEXT anchor, not just a fixed character count. A fixed 600-char window on a
    // page with short cards (real SERP cards, and this fallback's own tests) runs straight
    // through the current candidate's paragraph and into the NEXT candidate's title+text,
    // polluting both snippets with each other's content — measured, not hypothetical: on a
    // synthetic two-card fixture this pulled two genuinely different candidates' similarity
    // scores to within 0.007 of each other, because both ended up scored against nearly the
    // same blended text. Capping at the next `<a` (falling back to the 600-char window when
    // there isn't one within range) keeps each candidate's snippet actually its own.
    const nextAnchor = html.indexOf("<a", aRe.lastIndex);
    const boundary = nextAnchor === -1 ? html.length : nextAnchor;
    const after = html.slice(aRe.lastIndex, Math.min(aRe.lastIndex + 600, boundary));
    const snippet = stripTags(after).slice(0, 400);
    const rank = q ? similarityRatio(q, `${title} ${snippet}`.toLowerCase()) : 0;
    candidates.push({ title, url, snippet, rank });
  }
  return candidates
    .filter((c) => c.rank > GENERIC_MIN_SIMILARITY)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map(({ rank, ...c }) => c); // eslint-disable-line no-unused-vars -- drop the internal field
}

/** Registry of engines. `bing-rss` returns STRUCTURED XML (stable); the others scrape SERP HTML. */
export const ENGINES = {
  "bing-rss": {
    name: "bing-rss",
    format: "raw",
    buildUrl: (q) => `https://www.bing.com/search?format=rss&q=${encodeURIComponent(q)}`,
    parse: parseBingRss
  },
  duckduckgo: {
    name: "duckduckgo",
    buildUrl: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    parse: parseDuckDuckGo
  },
  bing: {
    name: "bing",
    buildUrl: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
    parse: parseBing
  },
  brave: {
    name: "brave",
    buildUrl: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}`,
    parse: parseBrave
  }
};

// Default = DuckDuckGo HTML: the only free SERP source that returns RELEVANT results for technical
// queries when scraped. It rate-limits rapid bursts — when it blocks, the layered search returns the
// native-fallback signal (relevant) rather than masking it with noise. The other engines are kept in
// ENGINES for opt-in via OBSCURA_SEARCH_ENGINES: `bing-rss` is fast and never rate-limited but its
// relevance on long/technical queries is poor (it keyword-matches literally: "tau"→the Greek letter,
// "pass"→Xbox Game Pass); `bing`/`brave` HTML need live-markup parser maintenance. For genuinely fast,
// high-volume, RELEVANT search, run a SearXNG instance and set OBSCURA_SEARXNG_URL — structured JSON,
// aggregates many engines, no anti-bot wall. Free SERP scraping cannot be fast + high-volume + relevant
// at once; SearXNG is the real answer.
export const DEFAULT_CHAIN = ["duckduckgo"];

/** Resolve the ordered engine chain from an override, OBSCURA_SEARCH_ENGINES, or the default. */
function resolveChain(engines) {
  const names =
    engines ||
    (process.env.OBSCURA_SEARCH_ENGINES
      ? process.env.OBSCURA_SEARCH_ENGINES.split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : DEFAULT_CHAIN);
  return names.map((n) => ENGINES[n]).filter(Boolean);
}

// ── SearXNG (structured) layer ──────────────────────────────────────────────

/**
 * Query a SearXNG instance's JSON API. Returns normalized results, or null when the
 * instance is unreachable/misconfigured (so the caller falls through to scraping).
 * @param {string} query
 * @param {{ base: string, limit?: number, page?: number }} opts `page` maps to SearXNG's
 *   own `pageno` (1-based) — structured, server-side pagination, no anti-bot wall.
 * @param {(url: string, init: object) => Promise<Response>} [fetchImpl]
 * @returns {Promise<Array<{ title: string, url: string, snippet: string }> | null>}
 */
/**
 * @param {object}   opts
 * @param {object}   [opts.meta]  optional out-object; receives `unresponsive` (SearXNG's
 *   `unresponsive_engines`) when the response carries it. An out-param rather than a changed
 *   return type on purpose: every caller and test already treats the return value as the result
 *   array, and this information is diagnostic — needed by exactly one caller, ignorable by the
 *   rest. See `SUSPENDED_ENGINES` below for why it cannot be dropped.
 */
export async function searxngSearch(
  query,
  { base, limit = 8, page = 1, categories = "", meta = null },
  fetchImpl = globalThis.fetch
) {
  if (!base || typeof fetchImpl !== "function") return null;
  const pageno = Math.max(1, Number(page) || 1);
  const cat = categories ? `&categories=${encodeURIComponent(categories)}` : "";
  const url = `${base.replace(/\/+$/, "")}/search?q=${encodeURIComponent(query)}&format=json&pageno=${pageno}${cat}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      // X-Forwarded-For satisfies SearXNG's bot-detection when queried directly (not behind a proxy);
      // without it a locked-down instance can intermittently reject the request.
      headers: { Accept: "application/json", "X-Forwarded-For": "127.0.0.1" }
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !Array.isArray(data.results)) return null;
    // A SearXNG whose engines are all suspended answers HTTP 200 with `results: []` — byte-for-
    // byte indistinguishable from "this query genuinely has no hits" unless you read this field.
    // Dropping it (as this function used to) makes the tool report "no results" when the truth
    // is "your engines are banned", which is the exact opposite of this package's own contract
    // to degrade honestly and "report the gap, not just the result" (ADR-0054 §6).
    if (meta && Array.isArray(data.unresponsive_engines)) {
      meta.unresponsive = data.unresponsive_engines;
    }
    return data.results
      .filter((r) => r && r.url)
      .slice(0, limit)
      .map((r) => ({
        title: String(r.title ?? ""),
        url: String(r.url),
        snippet: String(r.content ?? ""),
        // SearXNG's OWN multi-engine fused score, and the evidence behind it. This used to be
        // dropped here, which was the single most expensive line in the pipeline: `score` is
        // `weight * len(positions) * Σ(1/position)` over every engine that returned the URL
        // (results.py#calculate_score) — i.e. ~108 engines' consensus, already computed, free.
        // `deepResearch` then re-ranked the survivors with BM25 over `snippet`, replacing that
        // consensus with keyword overlap on ~30 tokens of SEO copy. Measured on evals/research:
        // keeping this order beats the BM25 re-rank by +0.115 nDCG@10 / +0.143 MRR.
        //
        // NOTE: the ARRAY ORDER is the ranking, not this field. `get_ordered_results()` sorts
        // by `score` and THEN regroups by category/template (results.py:224-243); re-sorting by
        // `score` undoes that second pass and measured -0.100 recall. Preserve the order given.
        score: typeof r.score === "number" ? r.score : 0,
        engines: Array.isArray(r.engines) ? r.engines.map(String) : [],
        publishedDate: r.publishedDate ?? null
      }));
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ── cache + throttle ────────────────────────────────────────────────────────
const CACHE = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;
let lastCallAt = 0;

const cacheKey = (q, limit) => `${limit}:${String(q).trim().toLowerCase()}`;

function cacheGet(q, limit) {
  const e = CACHE.get(cacheKey(q, limit));
  if (e && Date.now() - e.at < CACHE_TTL_MS) return e.value;
  if (e) CACHE.delete(cacheKey(q, limit));
  return null;
}

function cacheSet(q, limit, value) {
  // Bound memory on a long-lived MCP server: evict the oldest entry past the cap
  // (Map preserves insertion order, so keys().next() is the oldest).
  if (CACHE.size >= 200) CACHE.delete(CACHE.keys().next().value);
  CACHE.set(cacheKey(q, limit), { at: Date.now(), value });
}

/** Test hook: drop cached results between cases. */
export function _clearSearchCache() {
  CACHE.clear();
  lastCallAt = 0;
}

async function throttle() {
  const min = Number(process.env.OBSCURA_SEARCH_MIN_INTERVAL_MS);
  const gap = Number.isFinite(min) ? min : 0;
  const wait = lastCallAt + gap - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

/** Dedupe by URL, preserving order, capped at `limit`. */
function dedupe(results, limit) {
  const seen = new Set();
  const out = [];
  for (const r of results) {
    if (!r || !r.url || seen.has(r.url)) continue;
    seen.add(r.url);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Robust web search. Resolves `{ source, results }` or throws an error whose message
 * tells the agent to use the native WebSearch fallback.
 * @param {string} query
 * @param {{ limit?: number, stealth?: boolean, engines?: string[], searxngUrl?: string }} [opts]
 * @param {{ fetchImpl?: typeof obscuraFetch, searxngImpl?: typeof searxngSearch, throttleImpl?: () => Promise<void> }} [deps]
 * @returns {Promise<{ source: string, results: Array<{ title: string, url: string, snippet: string }> }>}
 */
export async function searchWeb(query, opts = {}, deps = {}) {
  const q = String(query ?? "").trim();
  if (!q) throw new Error("obscura_search: empty query.");
  const limit = Math.min(Math.max(Number(opts.limit) || 8, 1), 20);
  const stealth = opts.stealth;
  // Auto-integrate a local SearXNG: default to 127.0.0.1:8888 so obscura_search uses it whenever it's
  // up (structured, relevant), and falls through to scraping when it isn't (searxngSearch returns null
  // on connection-refused). Set OBSCURA_SEARXNG_URL="" to disable, or to another URL to point elsewhere.
  const searxngUrl = opts.searxngUrl ?? process.env.OBSCURA_SEARXNG_URL ?? "http://127.0.0.1:8888";
  const { fetchImpl = obscuraFetch, searxngImpl = searxngSearch, throttleImpl = throttle } = deps;

  const cached = cacheGet(q, limit);
  if (cached) return cached;

  await throttleImpl();

  // Layer 1 — SearXNG structured JSON.
  if (searxngUrl) {
    const sx = await searxngImpl(q, { base: searxngUrl, limit }).catch(() => null);
    if (sx && sx.length) {
      const value = { source: "searxng", results: dedupe(sx, limit) };
      cacheSet(q, limit, value);
      return value;
    }
  }

  // Layers 2/3 — obscura-rendered SERP across the engine chain.
  const errors = [];
  for (const eng of resolveChain(opts.engines)) {
    try {
      const { content } = await fetchImpl(eng.buildUrl(q), {
        format: eng.format || "html",
        stealth
      });
      const parsed = dedupe(eng.parse(content), limit);
      if (parsed.length) {
        const value = { source: eng.name, results: parsed };
        cacheSet(q, limit, value);
        return value;
      }
      // The specific parser found nothing on an otherwise-substantial page — try the generic,
      // similarity-ranked fallback before giving up on this engine (see genericExtractLinks doc).
      // `format !== "raw"` excludes bing-rss: it's structured XML, and a generic HTML anchor
      // scraper on an RSS feed would find nothing useful anyway.
      if (eng.format !== "raw" && content.length > 500) {
        const generic = dedupe(genericExtractLinks(content, q, { limit }), limit);
        if (generic.length) {
          const value = { source: `${eng.name}-generic`, results: generic };
          cacheSet(q, limit, value);
          return value;
        }
      }
      errors.push(`${eng.name}: 0 results parsed`);
    } catch (e) {
      errors.push(`${eng.name}: ${e?.message || e}`);
    }
  }

  throw new Error(
    `obscura_search: every source failed or returned nothing (${errors.join("; ")}). ` +
      `Fall back to the native WebSearch tool for this query.`
  );
}
