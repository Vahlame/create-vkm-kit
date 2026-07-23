/**
 * Seed-URL site crawler (ADR-0062) — the one crawl mode `obscura_research` never had.
 *
 * `obscura_research` DISCOVERS pages by querying a search engine (walking SearXNG's `pageno`);
 * it never follows a site's own internal links. This module is the complement: given a few seed
 * URLs, walk the `<a href>` graph BREADTH-FIRST within a domain allowlist, down to a depth cap,
 * extracting each page's visible text + source attribution (title/author/published date) and,
 * optionally, its PDF/image assets. It exists for the "download whole doc/tutorial sites" job the
 * search-driven crawl structurally can't do.
 *
 * Design mirrors research.mjs/deep-research.mjs's split: the pure, single-responsibility helpers
 * and the whole BFS live HERE (fully unit-testable with injected deps — no real network, no real
 * clock, no real filesystem); the background-job registry (state, budget, snapshot, run report)
 * is the thin wrapper in crawl-job.mjs, exactly as deep-research.mjs wraps research.mjs.
 *
 * Reuses, never re-implements: `stripHiddenContent` (sanitize.mjs) for the same hidden-content
 * defense the research crawl uses; `canonicalizeUrl`/`hostOf`/`hash8` (url-identity.mjs) for
 * dedup and the durable seen-set; `checkRobots` (robots.mjs) for per-host compliance; and the
 * `RESEARCH/<topic>/sources/` bank (research-persist.mjs) both for persistence AND for free
 * resumability — `listCoveredHashes` already IS the on-disk "seen" set a resumable crawler needs.
 *
 * The boundary (ADR-0062): this crawler NEVER solves a CAPTCHA or defeats a login/paywall. A page
 * that comes back as a login/anti-bot interstitial is recorded `blocked: gated` and its links are
 * NOT followed — the same back-off-when-blocked posture obscura itself takes with Cloudflare.
 */
import * as cheerio from "cheerio";
import { stripHiddenContent } from "./sanitize.mjs";
import { extractMainContent } from "./content-extract.mjs";
import { OriginCircuitBreaker } from "./circuit-breaker.mjs";
import { canonicalizeUrl, hostOf, hash8 } from "./url-identity.mjs";

/** `<a href>` values that are not real navigations to another document. */
const NON_NAV_HREF_RE = /^\s*(#|javascript:|mailto:|tel:|data:|blob:|about:)/i;

/** Path suffix that marks a link as a PDF asset (content-type is re-verified at download time —
 * this is only the discovery heuristic). */
const PDF_PATH_RE = /\.pdf($|[?#])/i;

/** Interstitial/login/anti-bot text markers. A DELIBERATE SUBSET, documented not hidden (same
 * honesty contract as robots.mjs): obscura returns only a page's rendered content, never its HTTP
 * status or the final redirected URL, so gating can only be inferred from the body. These are the
 * high-signal, low-false-positive phrases that a human would read as "you can't see the content
 * without signing in / passing a bot check." Missing one costs a wasted fetch (the page is kept as
 * if real); it can never cause the crawler to try to DEFEAT the wall, which it has no code to do. */
const GATED_MARKERS = [
  "just a moment...", // Cloudflare interstitial title
  "checking your browser before accessing",
  "enable javascript and cookies to continue", // Cloudflare
  "verify you are human",
  "please verify you are a human",
  "cf-challenge",
  "cf-browser-verification",
  "/cdn-cgi/challenge-platform", // Cloudflare challenge script path
  "g-recaptcha",
  "grecaptcha",
  "h-captcha",
  "hcaptcha",
  "please complete the security check",
  "attention required! | cloudflare",
  "sign in to continue",
  "log in to continue",
  "please log in to view",
  "subscribe to read the full",
  "this content is available to subscribers"
];

/**
 * Absolute http(s) links found in `<a href>`, resolved against `baseUrl`, deduped in first-seen
 * order. Fragment-only, `javascript:`, `mailto:`, `tel:`, `data:` and unparseable hrefs are
 * dropped; the fragment is stripped from every kept URL (same page). Never throws — a malformed
 * `html`/`baseUrl` yields `[]`.
 * @param {string} html
 * @param {string} baseUrl absolute URL the page was fetched from (relative hrefs resolve against it)
 * @returns {string[]}
 */
export function extractLinks(html, baseUrl) {
  let $;
  try {
    $ = cheerio.load(String(html ?? ""));
  } catch {
    return [];
  }
  const out = [];
  const seen = new Set();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || NON_NAV_HREF_RE.test(href)) return;
    let abs;
    try {
      abs = new URL(href, baseUrl);
    } catch {
      return;
    }
    if (abs.protocol !== "http:" && abs.protocol !== "https:") return;
    abs.hash = "";
    const s = abs.toString();
    if (seen.has(s)) return;
    seen.add(s);
    out.push(s);
  });
  return out;
}

/**
 * PDF and image asset URLs referenced by the page, resolved against `baseUrl`, deduped. PDFs come
 * from `<a href>` whose path looks like a `.pdf`; images from `<img src>` and `<img srcset>` /
 * `<source srcset>` candidates. Each entry is `{ url, kind: "pdf"|"image" }`. The content-type is
 * NOT trusted from the extension here — the downloader re-checks the real `Content-Type` header
 * before writing (assets.mjs) — so a mislabeled link costs one skipped download, never a wrong file.
 * @param {string} html
 * @param {string} baseUrl
 * @returns {{ url: string, kind: "pdf"|"image" }[]}
 */
export function extractAssets(html, baseUrl) {
  let $;
  try {
    $ = cheerio.load(String(html ?? ""));
  } catch {
    return [];
  }
  /** @type {{ url: string, kind: "pdf"|"image" }[]} */
  const out = [];
  const seen = new Set();
  const add = (raw, kind) => {
    if (!raw) return;
    let abs;
    try {
      abs = new URL(raw, baseUrl);
    } catch {
      return;
    }
    if (abs.protocol !== "http:" && abs.protocol !== "https:") return;
    abs.hash = "";
    const s = abs.toString();
    const key = `${kind}:${s}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ url: s, kind });
  };

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (href && PDF_PATH_RE.test(href)) add(href.trim(), "pdf");
  });
  $("img[src]").each((_, el) => add(($(el).attr("src") || "").trim(), "image"));
  // srcset: "url1 1x, url2 2x" — take each candidate's URL (the token before the first space).
  $("img[srcset], source[srcset]").each((_, el) => {
    const srcset = $(el).attr("srcset") || "";
    for (const candidate of srcset.split(",")) {
      const url = candidate.trim().split(/\s+/)[0];
      if (url) add(url, "image");
    }
  });
  return out;
}

/** First non-empty string from a list of cheerio lookups, trimmed. */
function firstMeta($, selectors) {
  for (const sel of selectors) {
    const el = $(sel).first();
    if (!el.length) continue;
    const v = (el.attr("content") ?? el.attr("datetime") ?? el.text() ?? "").trim();
    if (v) return v;
  }
  return "";
}

/** Walk parsed JSON-LD (object, array, or `@graph`) collecting the first `datePublished` and the
 * first `author` name found anywhere in the tree. Defensive: any shape that isn't what we expect
 * is simply skipped, never thrown on. */
function scanJsonLd(node, acc) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) scanJsonLd(item, acc);
    return;
  }
  if (Array.isArray(node["@graph"])) scanJsonLd(node["@graph"], acc);
  if (!acc.published && typeof node.datePublished === "string")
    acc.published = node.datePublished.trim();
  if (!acc.author) {
    const a = node.author;
    if (typeof a === "string") acc.author = a.trim();
    else if (a && typeof a === "object") {
      const name = Array.isArray(a) ? a[0]?.name : a.name;
      if (typeof name === "string") acc.author = name.trim();
    }
  }
}

/**
 * Source attribution for a page: `{ title, author, published }` (empty strings when absent). Reads
 * OpenGraph/Twitter/standard `<meta>` tags, `<title>`/`<h1>`, `<time datetime>`, and any JSON-LD
 * (`application/ld+json`) block, in that precedence. This is the data that lets a later article
 * attribute a fact to its real source — the whole point of requirement ② — so it is extracted for
 * EVERY page, kept or not. Never throws.
 * @param {string} html
 * @returns {{ title: string, author: string, published: string }}
 */
export function extractMetadata(html) {
  let $;
  try {
    $ = cheerio.load(String(html ?? ""));
  } catch {
    return { title: "", author: "", published: "" };
  }
  const acc = { author: "", published: "" };
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw) return;
    try {
      scanJsonLd(JSON.parse(raw), acc);
    } catch {
      /* a malformed JSON-LD block is ignored, never fatal */
    }
  });

  const title = firstMeta($, [
    'meta[property="og:title"]',
    'meta[name="twitter:title"]',
    "title",
    "h1"
  ]);
  const author =
    firstMeta($, [
      'meta[name="author"]',
      'meta[property="article:author"]',
      'meta[property="og:article:author"]',
      'meta[name="twitter:creator"]',
      'a[rel="author"]',
      '[itemprop="author"] [itemprop="name"]',
      '[itemprop="author"]'
    ]) || acc.author;
  const published =
    firstMeta($, [
      'meta[property="article:published_time"]',
      'meta[name="article:published_time"]',
      'meta[name="date"]',
      'meta[property="og:updated_time"]',
      'meta[itemprop="datePublished"]',
      "time[datetime]"
    ]) || acc.published;

  return { title, author, published };
}

/** Normalize a user-supplied `allow` list into host rules and host+path prefix rules. An entry
 * with a `/` (or a scheme) is a PREFIX rule matched against `host+pathname`; a bare host is a HOST
 * rule matched exactly or as a parent domain (`docs.foo.com` also matches `foo.com`'s subdomains
 * only via an explicit entry — endsWith on `.entry`, never a bare-suffix over-match). `www.` is
 * stripped everywhere so it never causes a scope miss. */
function normalizeAllow(allow) {
  const hostRules = [];
  const prefixRules = [];
  for (const raw of allow ?? []) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    let e = raw
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "");
    e = e.replace(/^www\./, "");
    if (e.includes("/")) {
      prefixRules.push(e.replace(/\/+$/, "") || e);
    } else {
      hostRules.push(e);
    }
  }
  return { hostRules, prefixRules };
}

/**
 * Is `url` allowed to be crawled under this scope? With an explicit `allow` list, the url must
 * match one of its host rules (exact host or a subdomain of it) or one of its host+path prefix
 * rules. With no `allow`, scope defaults to the seed hosts (stay on-site) — the safe default a
 * "crawl this doc site" request means. Unparseable/off-scheme urls are out of scope.
 * @param {string} url
 * @param {{ hostRules: string[], prefixRules: string[] }} allowRules from {@link normalizeAllow}
 * @param {string[]} seedHosts hostOf() of each seed, used when allowRules is empty
 * @returns {boolean}
 */
export function inScope(url, allowRules, seedHosts) {
  const h = hostOf(url);
  if (!h) return false;
  const { hostRules, prefixRules } = allowRules;
  if (!hostRules.length && !prefixRules.length) {
    return seedHosts.some((sh) => h === sh || h.endsWith(`.${sh}`));
  }
  if (hostRules.some((r) => h === r || h.endsWith(`.${r}`))) return true;
  if (prefixRules.length) {
    let pathish;
    try {
      const u = new URL(url);
      pathish = `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname}`;
    } catch {
      return false;
    }
    if (prefixRules.some((r) => pathish.startsWith(r))) return true;
  }
  return false;
}

/**
 * Does this page read as a login/paywall/anti-bot wall rather than real content? Returns a short
 * reason string when gated, or `null` when it looks like a normal page. Heuristic and honest about
 * it (see {@link GATED_MARKERS}) — obscura hands us only the rendered body, so this is a body scan,
 * not an HTTP-status check. A very short body that is mostly a login form counts too.
 * @param {string} html
 * @returns {string|null}
 */
export function detectGated(html) {
  const s = String(html ?? "");
  const lower = s.toLowerCase();
  for (const marker of GATED_MARKERS) {
    if (lower.includes(marker)) return `gated: matched "${marker}"`;
  }
  // A tiny page dominated by a password field is a login wall even without a known marker phrase.
  if (s.length < 4000 && /<input[^>]+type=["']?password/i.test(s)) {
    return "gated: page is essentially a login form";
  }
  return null;
}

/**
 * Keep-filter for a page's extracted text. Empty/absent `keywords` means "keep everything" (no
 * filter). Otherwise a page is kept if its text contains ANY keyword (case-insensitive substring)
 * — the crawl still TRAVERSES non-matching pages to reach matching ones, this only decides what
 * gets persisted/exported.
 * @param {string} text
 * @param {string[]} [keywords]
 * @returns {boolean}
 */
export function matchesKeywords(text, keywords) {
  if (!keywords || !keywords.length) return true;
  const lower = String(text ?? "").toLowerCase();
  return keywords.some((k) => k && lower.includes(String(k).toLowerCase()));
}

/** @param {number} ms @returns {Promise<void>} */
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run the whole breadth-first crawl for a set of seeds. Pure of ambient state: every side effect
 * (fetch, robots, persist, asset download, export, sleep, clock) is an injected dependency, and
 * cooperative cancellation + progress are the `shouldStop`/`onPage` callbacks — so crawl-job.mjs
 * can drive budget/stop/snapshot without this function knowing anything about jobs.
 *
 * @param {object} opts
 * @param {string[]} opts.seeds absolute http(s) seed URLs (1+)
 * @param {string[]} [opts.allow] domain / host+path-prefix allowlist (default: seed hosts)
 * @param {number} [opts.maxDepth] link hops from a seed (default 3)
 * @param {number} [opts.maxPages] hard ceiling on pages fetched (default 200)
 * @param {string[]} [opts.keywords] keep-filter (default: keep all)
 * @param {string} opts.topic RESEARCH/<topic>/ slug (validated by persistImpl)
 * @param {boolean} [opts.downloadAssets] download PDFs/images of kept pages (default true)
 * @param {number} [opts.assetMaxCount] hard cap on total assets downloaded (default 0 = unlimited)
 * @param {number} [opts.perHostCap] max NEW links enqueued per host (default 0 = unlimited)
 * @param {boolean} [opts.respectRobots] obey robots.txt (default true)
 * @param {boolean} [opts.stealth] obscura anti-detection when fetching (default undefined = on)
 * @param {number} [opts.paceMs] politeness pause between fetches (default 1000)
 * @param {number} [opts.persistEvery] flush persist+export every N kept pages (default 10)
 * @param {string} [opts.researchDir] override OBSCURA_RESEARCH_DIR (tests)
 * @param {object} deps
 * @param {(url:string, o:object)=>Promise<{content:string}>} deps.fetchImpl obscuraFetch-shaped
 * @param {Function} deps.persistImpl persistResults-shaped
 * @param {Function} deps.coveredHashesImpl listCoveredHashes-shaped
 * @param {Function} deps.exportImpl writeCrawlExport-shaped
 * @param {Function} [deps.robotsImpl] checkRobots-shaped (used when respectRobots)
 * @param {Function} [deps.assetImpl] downloadAsset-shaped (used when downloadAssets)
 * @param {typeof extractMainContent} [deps.extractImpl] main-content extraction (falls back to
 *   stripHiddenContent's full-body text when it finds no article)
 * @param {OriginCircuitBreaker} [deps.breakerImpl] per-host circuit breaker for this crawl call
 * @param {()=>boolean} [deps.shouldStop] cooperative cancel — checked at the top of every page
 * @param {(rec:object)=>void} [deps.onPage] progress callback, one call per processed page
 * @param {(ms:number)=>Promise<void>} [deps.sleepImpl]
 * @returns {Promise<{ crawled:number, kept:number, gated:number, fetchFailed:number,
 *   robotsBlocked:number, circuitOpen:number, assetsSaved:number, rows:object[],
 *   persistedWritten:number, persistedUpdated:number, exportPaths:{json?:string,csv?:string},
 *   stoppedReason:string|null }>}
 */
export async function crawlSite(opts, deps) {
  const {
    seeds,
    allow,
    maxDepth = 3,
    maxPages = 200,
    keywords,
    topic,
    downloadAssets = true,
    assetMaxCount = 0,
    perHostCap = 0,
    respectRobots = true,
    stealth,
    paceMs = 1000,
    persistEvery = 10,
    researchDir
  } = opts;
  const {
    fetchImpl,
    persistImpl,
    coveredHashesImpl,
    exportImpl,
    robotsImpl,
    assetImpl,
    extractImpl = extractMainContent,
    breakerImpl = new OriginCircuitBreaker(),
    shouldStop = () => false,
    onPage = () => {},
    sleepImpl = defaultSleep
  } = deps;
  const breaker = breakerImpl;

  const seedList = (seeds ?? []).filter((s) => typeof s === "string" && s.trim());
  const seedHosts = [...new Set(seedList.map((s) => hostOf(s)).filter(Boolean))];
  const allowRules = normalizeAllow(allow);

  // The durable, cross-run seen-set: URLs a PREVIOUS crawl of this topic already banked. Reused,
  // not re-invented — this is exactly listCoveredHashes's purpose (see its doc). A failure to read
  // it degrades to "nothing skipped", never a crash.
  const covered = await coveredHashesImpl(topic, researchDir).catch(() => new Set());

  const seenCanonical = new Set();
  const hostLinkCount = new Map();
  /** @type {{url:string, depth:number, seed:string}[]} */
  const frontier = [];
  for (const s of seedList) {
    const key = canonicalizeUrl(s);
    if (seenCanonical.has(key)) continue;
    seenCanonical.add(key);
    frontier.push({ url: s, depth: 0, seed: s });
  }

  /** @type {object[]} */
  const rows = [];
  /** @type {object[]} */
  let pendingKept = [];
  let crawled = 0;
  let kept = 0;
  let gated = 0;
  let fetchFailed = 0;
  let robotsBlocked = 0;
  let circuitOpen = 0;
  let assetsSaved = 0;
  let persistedWritten = 0;
  let persistedUpdated = 0;
  /** @type {string|null} */
  let stoppedReason = null;
  /** @type {{json?:string,csv?:string}} */
  let exportPaths = {};

  const flush = async () => {
    if (pendingKept.length) {
      // A persist failure (e.g. missing_root) PROPAGATES on purpose — unlike a single page's fetch,
      // a research bank that cannot be written is a real, typed configuration error the caller must
      // see, not something to skip. crawl-job.mjs maps the throw to a failed job state. `pendingKept`
      // is intentionally left uncleared on failure, so nothing is silently dropped.
      const p = await persistImpl({
        topic,
        query: `crawl:${seedHosts.join(",") || "seeds"}`,
        results: pendingKept,
        researchDir
      });
      persistedWritten += p.written ?? 0;
      persistedUpdated += p.updated ?? 0;
      pendingKept = [];
    }
    try {
      exportPaths = await exportImpl({ topic, rows, researchDir });
    } catch {
      /* export is best-effort — the persisted notes are the source of truth; a failed export
         write (e.g. a transient FS error) must not sink a long crawl. */
    }
  };

  while (frontier.length && crawled < maxPages) {
    if (shouldStop()) {
      stoppedReason = "stopped";
      break;
    }
    const item = frontier.shift();
    if (!item) break;

    if (respectRobots && robotsImpl) {
      const { allowed } = await robotsImpl(item.url).catch(() => ({ allowed: true }));
      if (!allowed) {
        robotsBlocked++;
        rows.push({ url: item.url, depth: item.depth, seed: item.seed, status: "robots-blocked" });
        onPage({ url: item.url, depth: item.depth, status: "robots-blocked" });
        continue;
      }
    }

    const host = hostOf(item.url);
    if (breaker.isOpen(host)) {
      // This host has failed `failureThreshold` times already this crawl — skip the fetch
      // rather than pay for an attempt almost certain to fail too (circuit-breaker.mjs).
      circuitOpen++;
      rows.push({ url: item.url, depth: item.depth, seed: item.seed, status: "circuit-open" });
      onPage({ url: item.url, depth: item.depth, status: "circuit-open" });
      continue;
    }

    let html;
    try {
      const res = await fetchImpl(item.url, { format: "html", stealth });
      html = res.content;
    } catch (e) {
      breaker.recordFailure(host);
      fetchFailed++;
      rows.push({
        url: item.url,
        depth: item.depth,
        seed: item.seed,
        status: "fetch-failed",
        error: e?.message ?? String(e)
      });
      onPage({ url: item.url, depth: item.depth, status: "fetch-failed" });
      continue;
    }
    breaker.recordSuccess(host);
    crawled++;

    const gatedReason = detectGated(html);
    if (gatedReason) {
      gated++;
      rows.push({ url: item.url, depth: item.depth, seed: item.seed, status: gatedReason });
      onPage({ url: item.url, depth: item.depth, status: "gated" });
      // Do NOT follow links out of a gated page and do NOT try to defeat the wall (ADR-0062).
      if (paceMs > 0) await sleepImpl(paceMs);
      continue;
    }

    const meta = extractMetadata(html);
    // Readability-based main-content extraction trims nav/sidebar/footer boilerplate before the
    // keyword filter and persisted snippet; falls back to the full sanitized body when no
    // article-shaped content is found (docs indexes, forums, non-article pages).
    const text = extractImpl(html, { url: item.url }) ?? stripHiddenContent(html);
    const keep = matchesKeywords(text, keywords);

    /** @type {{url:string,title:string,author:string,date:string,depth:number,seed:string,
     *   status:string,assets?:object[]}} */
    const row = {
      url: item.url,
      title: meta.title,
      author: meta.author,
      date: meta.published,
      depth: item.depth,
      seed: item.seed,
      status: keep ? "kept" : "skipped-no-keyword"
    };

    if (keep) {
      kept++;
      pendingKept.push({
        url: item.url,
        title: meta.title,
        author: meta.author,
        published: meta.published,
        snippet: text,
        extraction: "crawl",
        relevant: true
      });

      if (downloadAssets && assetImpl) {
        const found = extractAssets(html, item.url);
        const savedForRow = [];
        for (const a of found) {
          if (assetMaxCount > 0 && assetsSaved >= assetMaxCount) break;
          if (respectRobots && robotsImpl) {
            const { allowed } = await robotsImpl(a.url).catch(() => ({ allowed: true }));
            if (!allowed) continue;
          }
          const r = await assetImpl(a.url, { topic, kind: a.kind, researchDir }).catch(() => null);
          if (r && r.saved) {
            assetsSaved++;
            savedForRow.push({ url: a.url, kind: a.kind, path: r.path, bytes: r.bytes });
          }
        }
        if (savedForRow.length) row.assets = savedForRow;
      }

      if (pendingKept.length >= persistEvery) await flush();
    }

    rows.push(row);
    onPage({ url: item.url, depth: item.depth, status: row.status, title: meta.title });

    if (item.depth < maxDepth) {
      for (const link of extractLinks(html, item.url)) {
        const key = canonicalizeUrl(link);
        if (seenCanonical.has(key)) continue;
        if (covered.has(hash8(link))) {
          // Already banked by a previous run — mark seen so we neither refetch nor re-enqueue.
          seenCanonical.add(key);
          continue;
        }
        if (!inScope(link, allowRules, seedHosts)) continue;
        const lh = hostOf(link);
        if (perHostCap > 0) {
          const n = hostLinkCount.get(lh) ?? 0;
          if (n >= perHostCap) continue;
          hostLinkCount.set(lh, n + 1);
        }
        seenCanonical.add(key);
        frontier.push({ url: link, depth: item.depth + 1, seed: item.seed });
      }
    }

    if (paceMs > 0) await sleepImpl(paceMs);
  }

  if (!stoppedReason) {
    stoppedReason = crawled >= maxPages ? "max_pages" : "frontier_empty";
  }
  await flush();

  return {
    crawled,
    kept,
    gated,
    fetchFailed,
    robotsBlocked,
    circuitOpen,
    assetsSaved,
    rows,
    persistedWritten,
    persistedUpdated,
    exportPaths,
    stoppedReason
  };
}
