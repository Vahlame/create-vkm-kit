/**
 * Robust web search that "stops being fragile" by layering, in order:
 *  1. SearXNG JSON (opt-in, OBSCURA_SEARXNG_URL): a self-hosted metasearch instance
 *     returns STRUCTURED results — no HTML parsing, the #1 source of scraper breakage,
 *     and it aggregates/rotates many upstream engines. Queried directly over HTTP: a
 *     localhost instance needs no stealth (obscura's value is fetching the *upstream*
 *     engines, which SearXNG itself handles).
 *  2. Multi-engine SERP rendered THROUGH obscura (always-on default): obscura runs real
 *     JS with anti-detection, so a search-results page is far less likely to hit a bot
 *     wall/CAPTCHA than a bare HTTP client. Parsed with per-engine resilient extractors.
 *  3. Engine fallback chain (DuckDuckGo HTML → Bing → Brave): three independent providers,
 *     first with >=1 result wins, so one engine changing markup or blocking != total failure.
 *  + Per-query cache + a min-interval throttle to avoid tripping rate limits.
 *  If every layer fails, the caller is told to fall back to the native WebSearch tool
 *  (soft enforcement — obscura is preferred, native is the safety net).
 *
 * HTML parsing is inherently best-effort: the parsers below are tuned to each engine's
 * known markup and unit-tested against fixtures, but real SERPs drift. Layers 1 and the
 * native fallback are what make the whole thing dependable, not any single parser.
 */
import { obscuraFetch } from "./obscura-cli.mjs";

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

/** Registry of scrape-able engines (each: a SERP URL builder + a parser). */
export const ENGINES = {
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

export const DEFAULT_CHAIN = ["duckduckgo", "bing", "brave"];

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
 * @param {{ base: string, limit?: number }} opts
 * @param {(url: string, init: object) => Promise<Response>} [fetchImpl]
 * @returns {Promise<Array<{ title: string, url: string, snippet: string }> | null>}
 */
export async function searxngSearch(query, { base, limit = 8 }, fetchImpl = globalThis.fetch) {
  if (!base || typeof fetchImpl !== "function") return null;
  const url = `${base.replace(/\/+$/, "")}/search?q=${encodeURIComponent(query)}&format=json`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" }
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !Array.isArray(data.results)) return null;
    return data.results
      .filter((r) => r && r.url)
      .slice(0, limit)
      .map((r) => ({
        title: String(r.title ?? ""),
        url: String(r.url),
        snippet: String(r.content ?? "")
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
  const gap = Number.isFinite(min) ? min : 800;
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
  const searxngUrl = opts.searxngUrl ?? process.env.OBSCURA_SEARXNG_URL;
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
      const { content } = await fetchImpl(eng.buildUrl(q), { format: "html", stealth });
      const parsed = dedupe(eng.parse(content), limit);
      if (parsed.length) {
        const value = { source: eng.name, results: parsed };
        cacheSet(q, limit, value);
        return value;
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
