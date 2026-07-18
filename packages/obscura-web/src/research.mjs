/**
 * Deep local web research (ADR-0054): scan hundreds of candidates without spending agent
 * tokens on them. The crawl and the ranking both run as local CPU/RAM work — SearXNG
 * pagination (`pageno`, HTTP to a loopback process) and a local BM25 scorer, no LLM calls —
 * and only the top-ranked pages are fetched, excerpted to the passage that actually matches
 * the query, and handed back. The agent pays tokens for a handful of compact passages, never
 * for the pool it was chosen from.
 *
 * Honest constraint (mirrors serp.mjs): reliable, deep pagination needs a local SearXNG
 * instance. Without one, this degrades to `searchWeb`'s single-page scrape chain — going
 * deeper by scraping DuckDuckGo/Bing/Brave page 2+ is exactly the fragile, rate-limited path
 * serp.mjs already avoids, so this does not attempt it.
 */
import { obscuraFetch } from "./obscura-cli.mjs";
import { checkRobots } from "./robots.mjs";
import { stripHiddenContent } from "./sanitize.mjs";
import { searxngSearch, searchWeb } from "./serp.mjs";
import {
  DEFAULT_DROP_BELOW,
  checkOllama,
  curatePage,
  embedPassages,
  ensureOllamaServer,
  expandQuery
} from "./ollama-client.mjs";
import { capPerHost, cosine, mmr, reciprocalRankFusion } from "./rank.mjs";
import { canonicalizeUrl, dedupeByUrl, hash8, hostOf } from "./url-identity.mjs";

// Local, tiny, deliberately not exhaustive — good enough to stop function words from
// dominating BM25 term-frequency on short title+snippet text. Not a substitute for a real
// stopword list; extend only if a measured ranking regression traces back to it.
const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "of",
  "to",
  "in",
  "and",
  "or",
  "for",
  "on",
  "is",
  "are",
  "was",
  "were",
  "de",
  "la",
  "el",
  "los",
  "las",
  "que",
  "y",
  "en",
  "un",
  "una",
  "con",
  "por",
  "para",
  "del"
]);

/**
 * Lowercase, strip punctuation (Unicode-aware), split on whitespace, drop stopwords/1-char
 * tokens. Pure and deterministic — no LLM, no external index.
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Rank search candidates against a query with BM25 (k1=1.5, b=0.75) over their own
 * title+snippet text — the candidate pool IS the corpus, a standard local re-ranking
 * pattern that needs no external index or embedding call. Pure, deterministic, zero tokens.
 * @param {Array<{title:string,url:string,snippet:string}>} candidates
 * @param {string} query
 * @returns {Array<{title:string,url:string,snippet:string,score:number}>} sorted desc by score
 */
export function rankCandidates(candidates, query) {
  const qTerms = [...new Set(tokenize(query))];
  if (!qTerms.length || !candidates.length) {
    return candidates.map((c) => ({ ...c, score: 0 }));
  }

  const docs = candidates.map((c) => tokenize(`${c.title} ${c.snippet}`));
  const N = docs.length;
  const avgLen = docs.reduce((s, d) => s + d.length, 0) / N || 1;

  const df = new Map();
  for (const terms of docs) {
    for (const t of new Set(terms)) df.set(t, (df.get(t) || 0) + 1);
  }
  // +1-smoothed IDF (BM25+-style): stays non-negative even when a query term appears in
  // most of a small candidate pool, which a short, unsmoothed classic IDF would punish.
  const idf = (t) => Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));

  const k1 = 1.5;
  const b = 0.75;
  const scored = candidates.map((c, i) => {
    const terms = docs[i];
    const len = terms.length || 1;
    const tf = new Map();
    for (const t of terms) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    for (const qt of qTerms) {
      const f = tf.get(qt) || 0;
      if (!f) continue;
      score += idf(qt) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * len) / avgLen)));
    }
    return { ...c, score };
  });
  return scored.sort((a, c) => c.score - a.score);
}

/**
 * Deterministic fallback excerpt when the local-LLM curator ({@link curatePage}) is
 * unavailable — a keyword-window heuristic, not a relevance judge. Picks the best
 * keyword-matching paragraph AND the one that follows it (elaboration on a topic rarely
 * repeats the matched term itself, so an isolated single-paragraph pick misses it), or the
 * leading paragraphs when nothing matches at all. Bounded by `maxChars`.
 * @param {string} markdown
 * @param {string} query
 * @param {{ maxChars?: number }} [opts]
 * @returns {string}
 */
export function extractPassage(markdown, query, { maxChars = 800 } = {}) {
  const qTerms = new Set(tokenize(query));
  const paras = String(markdown ?? "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!paras.length) return "";
  if (!qTerms.size) return paras.slice(0, 2).join("\n\n").slice(0, maxChars);

  const hits = paras.map((p) => {
    let h = 0;
    for (const t of tokenize(p)) if (qTerms.has(t)) h++;
    return h;
  });
  const anyHit = hits.some((h) => h > 0);

  let picked;
  if (!anyHit) {
    picked = paras.length > 1 ? [0, 1] : [0];
  } else {
    const bestIdx = hits.reduce((best, h, i) => (h > hits[best] ? i : best), 0);
    picked = [bestIdx, bestIdx + 1].filter((i) => i < paras.length);
  }

  let out = "";
  for (const i of picked) {
    const candidate = out ? `${out}\n\n${paras[i]}` : paras[i];
    if (candidate.length > maxChars) {
      if (!out) out = paras[i].slice(0, maxChars) + "…";
      break;
    }
    out = candidate;
  }
  return out;
}

/** How many pages obscura fetches at once. Each fetch spawns a real headless browser process
 * (ADR-0051's per-request model), so this is a genuine resource dial, not a free win — ADR-0054
 * deferred parallel fetch for exactly that reason. It is reversed here because sequential fetch
 * makes `topK` a latency wall (~1 min for 8 pages, measured in ADR-0054), and the whole point of
 * this redesign is reading many more pages inside a 60 s MCP tool-call budget. 4 concurrent
 * Chromium processes is ~1-2 GB RSS; tune with OBSCURA_RESEARCH_CONCURRENCY. */
const DEFAULT_CONCURRENCY = Math.max(1, Number(process.env.OBSCURA_RESEARCH_CONCURRENCY) || 4);

/** Hard stop on pageno walking. One pageno is already the union of every enabled engine, so a
 * query that comes up short on page 1 is thin, not paginated — walking deeper mostly buys
 * lower-quality tail results and more upstream requests. */
const MAX_PAGES = 5;

/**
 * Wall-clock budget for one `deepResearch` call, in ms.
 *
 * Not a preference — a hard constraint of the transport. The MCP SDK times out ANY request at
 * `DEFAULT_REQUEST_TIMEOUT_MSEC = 60000` (protocol.js:8), and the server cannot extend it:
 * `resetTimeoutOnProgress` defaults to `false` (protocol.js:714), so sending progress
 * notifications does nothing unless the CLIENT opted in, which is not ours to decide. A call
 * that runs long doesn't return slowly — it returns nothing at all, and every page it fetched
 * and curated is thrown away with it.
 *
 * So the pipeline is deadline-aware by construction: at the buzzer it returns the best prefix it
 * finished. That is safe to do precisely because the candidates are ordered before any fetch
 * starts — "what we got through" is the best-ranked slice, not a random sample. `partial: true`
 * and `remaining` report the gap; a thin answer never masquerades as a complete one.
 *
 * 50s leaves ~10s of headroom under the 60s wall for the response to serialize and cross the
 * transport. Raise it only alongside the client's own timeout.
 */
const DEFAULT_DEADLINE_MS = Number(process.env.OBSCURA_RESEARCH_DEADLINE_MS) || 50_000;

/** How many sub-queries may hit SearXNG at once. Low on purpose — see the fan-out comment in
 * `deepResearch`: the engines that answer a `general` query are free-tier scrapes of Google and
 * Startpage, and suspending them costs 180s-3600s (or 15 days behind a Cloudflare CAPTCHA) of a
 * crawl that finds NOTHING for the whole machine. */
const SUBQUERY_CONCURRENCY = Number(process.env.OBSCURA_SUBQUERY_CONCURRENCY) || 2;

/** Max candidates any single host may hold in the fused pool's HEAD (rank.mjs#capPerHost) — the
 * "cap per domain" fase-2 left unwired: one doc-mirror or SEO farm can otherwise fill the whole
 * `maxCandidates` budget with itself, at the expense of every OTHER host's candidates, before the
 * curator ever gets a say. Reorders only (overflow moves to the tail, never dropped) — the same
 * "only the curator rejects" rule every other cheap stage in this pipeline already follows. */
const HOST_CAP = Number(process.env.OBSCURA_RESEARCH_HOST_CAP) || 3;

/** Cosine similarity above which two DIFFERENT kept pages are treated as near-duplicates (a
 * mirror, syndicated copy, or doc-site translation of the same content) rather than two distinct
 * pieces of evidence. High on purpose — this is an OBJECTIVE dedup signal, not a relevance
 * judgment (the pipeline's one hard rule is still "only the curator rejects a page" — this rejects
 * REDUNDANCY, a different question, and only among pages the curator already kept). */
const NEAR_DUP_THRESHOLD = Number(process.env.OBSCURA_RESEARCH_NEAR_DUP_THRESHOLD) || 0.92;

/** Floor of remaining call budget below which the opt-in embedding pass (near-dup + diversify)
 * is skipped rather than attempted — it is one extra network round-trip AFTER every page is
 * already fetched and curated, and a quality enhancement must never be what pushes a call past
 * the MCP transport's hard 60s wall. */
const MIN_MS_FOR_EMBED_PASS = 2000;

/**
 * SearXNG categories to search. Both a quality decision and the ban-resilience one.
 *
 * `general` is a trap on its own. It enables 10 engines, but only 3 are web search
 * (duckduckgo, google cse, startpage) — the rest are Wikipedia, Wikidata, a currency converter
 * and three translators. Measured over the golden set, exactly TWO engines ever returned
 * anything: google cse and startpage. Those are also the only two that get banned. So a
 * `general`-only crawl has no redundancy at all: when they suspend, SearXNG answers 200 with
 * `results: []` and the tool finds nothing.
 *
 * `it` and `science` change that, for free. Measured with `general` fully suspended on this
 * machine (n=0, five engines down):
 *
 *   categories=general      n=0    engines=[]                                    down=5
 *   categories=it           n=21   [github, docker hub, mdn]                     down=0
 *   categories=science      n=21   [arxiv, semantic scholar, openairepublications] down=1
 *   categories=it,science   n=42   (all six)                                     down=1
 *
 * Those engines are site APIs, not Google scrapes — they answer while the scrapers are banned,
 * and they do not ban. And they are the primary sources this pipeline wants: for "indirect
 * prompt injection LLM agent mitigation", `science` returned arxiv papers on the topic while
 * `general` returned Instagram reels.
 *
 * Critically this costs NO extra upstream requests: SearXNG accepts multiple categories in ONE
 * `/search` call and fans out internally. Same request count, more coverage, more redundancy —
 * which is why it is the default rather than an opt-in.
 */
const DEFAULT_CATEGORIES = process.env.OBSCURA_SEARXNG_CATEGORIES || "general,it,science";

/**
 * Cache of SearXNG responses, keyed by (query, page, categories).
 *
 * `searchWeb` has had a cache since ADR-0051, but `deepResearch` calls `searxngSearch` directly
 * and so never had one: re-running a research call re-issued every upstream request from
 * scratch. With expansion that is now ~6 sub-queries x up to 5 pages per call, and the engines
 * that answer are free-tier scrapes that ban by IP.
 *
 * This is not a latency optimization, it is the ban-avoidance measure with the best ratio: the
 * requests it removes are the *duplicate* ones, which by definition buy zero new candidates.
 * Iterating on a research topic — the exact thing this tool exists for, and exactly what banned
 * this machine during development — stops costing upstream quota per iteration.
 *
 * 10 minutes: long enough to cover a work session on one topic, short enough that "search the
 * web" never means "search a stale snapshot of it". Bounded to 300 entries (this is a
 * long-lived MCP process; an unbounded Map here is a slow leak), FIFO eviction.
 */
const SEARX_CACHE = new Map();
const SEARX_CACHE_TTL_MS = Number(process.env.OBSCURA_SEARXNG_CACHE_TTL_MS) || 600_000;
const SEARX_CACHE_MAX = 300;

function cacheKey(query, page, categories) {
  return `${categories}|${page}|${String(query).trim().toLowerCase()}`;
}

/**
 * Wrap `searxngImpl` with the cache.
 *
 * The subtlety is which empty results are cacheable, because "no results" has two causes that
 * look identical (both are `200` + `[]`) and want opposite treatment:
 *
 *   - **exhausted** — the engines answered and this page really has nothing left. A stable fact.
 *     Worth caching: it is what ends the pagination loop, and re-discovering it on every repeat
 *     costs a real upstream request per sub-query for information we already have.
 *   - **banned** — the engines are suspended and answered nothing. A transient failure that
 *     heals in 180s-3600s. Caching it would extend a 3-minute ban into a 10-minute one and turn
 *     a self-healing problem into a sticky one.
 *
 * `unresponsive_engines` is what tells them apart, which is the second job that field does here
 * (the first being honest reporting, see `enginesUnavailable`). A per-call probe is used rather
 * than the caller's shared `meta`, because that one accumulates across the whole fan-out: once
 * any sub-query saw a suspension it would stay set, and every later healthy round would be
 * misread as banned and refuse to cache.
 */
async function cachedSearxng(searxngImpl, query, opts) {
  const key = cacheKey(query, opts.page, opts.categories);
  const hit = SEARX_CACHE.get(key);
  if (hit && Date.now() - hit.at < SEARX_CACHE_TTL_MS) return hit.batch;

  const probe = {};
  const batch = await searxngImpl(query, { ...opts, meta: probe }).catch(() => null);

  // Merge this round's diagnostics up into the caller's accumulator.
  if (opts.meta && probe.unresponsive?.length) opts.meta.unresponsive = probe.unresponsive;

  const banned = Boolean(probe.unresponsive?.length);
  // `null` means the call threw — never cache a transport failure either.
  if (batch && (batch.length > 0 || !banned)) {
    if (SEARX_CACHE.size >= SEARX_CACHE_MAX) {
      SEARX_CACHE.delete(SEARX_CACHE.keys().next().value);
    }
    SEARX_CACHE.set(key, { at: Date.now(), batch });
  }
  return batch;
}

/** Drop every cached SearXNG batch. Exported for tests and for a caller that knows the snapshot
 * is stale (e.g. re-running a topic after an engine recovers from suspension). */
export function clearSearxngCache() {
  SEARX_CACHE.clear();
}

/**
 * Cache of fetched PAGE content, keyed by (url, format, stealth) — the same pattern as
 * `SEARX_CACHE`, one stage later in the pipeline. `obscuraFetch` spawns a real headless browser
 * process per call (ADR-0051's per-request model), so re-fetching the same URL across research
 * calls on the same topic is both slow and one more automated hit against a host that might
 * notice the pattern — the same ban-avoidance argument as the search cache, applied to fetch.
 *
 * Shorter TTL than the search cache (5 min vs 10): re-researching a topic is often specifically
 * to check whether a page's CONTENT changed, so staleness costs more here than it does for a
 * search result list. Bounded to 200 entries, FIFO eviction. A thrown fetch is never cached —
 * `cachedFetch` doesn't catch, so a transient failure is retried next time, not remembered.
 */
const FETCH_CACHE = new Map();
const FETCH_CACHE_TTL_MS = Number(process.env.OBSCURA_RESEARCH_FETCH_CACHE_TTL_MS) || 300_000;
const FETCH_CACHE_MAX = 200;

function fetchCacheKey(url, format, stealth) {
  return `${format}|${stealth}|${url}`;
}

async function cachedFetch(fetchImpl, url, opts) {
  const key = fetchCacheKey(url, opts.format, opts.stealth);
  const hit = FETCH_CACHE.get(key);
  if (hit && Date.now() - hit.at < FETCH_CACHE_TTL_MS) return hit.result;
  const result = await fetchImpl(url, opts);
  if (FETCH_CACHE.size >= FETCH_CACHE_MAX) FETCH_CACHE.delete(FETCH_CACHE.keys().next().value);
  FETCH_CACHE.set(key, { at: Date.now(), result });
  return result;
}

/** Drop every cached page fetch. Exported for tests and for a caller that knows a page changed. */
export function clearFetchCache() {
  FETCH_CACHE.clear();
}

/**
 * Fuse the per-sub-query candidate lists into one ranking with RRF.
 *
 * This is where RRF earns its place, and it is a different job from the one the bench killed.
 * Fusing SearXNG's score with BM25 was falsified (optimal BM25 weight: exactly 0) because both
 * arms ranked the SAME pool and one of them was simply better. Here each sub-query produced its
 * OWN pool from its own phrasing, and the lists are not comparable by score — sub-query A's
 * `score: 4` and sub-query B's `score: 4` were computed against different candidate sets. Ranks
 * are comparable; raw scores are not. That is exactly the situation RRF is for.
 *
 * Equal weights, deliberately. The instinct is to trust the original query most, but the
 * measurement says the opposite: the original colloquial phrasing is the one that returns
 * Instagram reels, and an expansion is what surfaces the answer. Weighting by provenance would
 * re-privilege the phrasing that fails. What RRF rewards instead is CONSENSUS — a page several
 * differently-worded queries all found is a page about the concept, not about the wording — and
 * that is the signal actually worth having.
 *
 * @param {Map<string, object[]>} perQuery  sub-query -> its candidates, best first
 * @returns {object[]} deduped candidates, best first
 */
function fuseSubQueries(perQuery) {
  const lists = [...perQuery.values()];
  if (!lists.length) return [];
  if (lists.length === 1) return lists[0]; // nothing to fuse: keep the delivered order intact

  const byKey = new Map();
  const rankings = lists.map((list) =>
    list.map((c) => {
      const key = canonicalizeUrl(c.url);
      // Keep the first record seen for a URL, but remember every sub-query that found it —
      // `foundBy` is the consensus evidence, and it is what makes a domain cap or a debug
      // trace readable later.
      const prev = byKey.get(key);
      if (prev) prev.foundBy++;
      else byKey.set(key, { ...c, foundBy: 1 });
      return key;
    })
  );

  const fused = reciprocalRankFusion(rankings);
  return [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => byKey.get(key))
    .filter(Boolean);
}

/** Map `fn` over `items` with at most `limit` in flight, preserving INPUT order in the output.
 * Order matters: candidates arrive best-first and the response must not silently reshuffle to
 * whatever finished first. Never rejects — `fn` is expected to encode its own failures.
 *
 * `deadline` (an epoch ms) stops workers from PICKING UP new items; unstarted slots come back
 * `undefined`, which the caller reports rather than hides. This function itself never cancels an
 * ALREADY-claimed item — `fn` runs to whatever completion it has. A caller for whom that is not
 * tight enough (fetch+curate below, where a single item's own internal timeouts can be tens of
 * seconds) wraps its own `fn` in a race against the remaining deadline; a caller whose per-item
 * work is already short and self-bounded (the SearXNG gather loop, each call capped at 10s in
 * serp.mjs) can safely rely on just this gate.
 *
 * `stopWhen` is the same kind of gate as `deadline`, checked at the same point (before picking up
 * a new item, never cancelling one already claimed), but driven by an arbitrary predicate instead
 * of the clock — e.g. "stop once enough GOOD results have come back", so a call that already has
 * what it needs doesn't keep grinding through the rest of `topK` just because time remains.
 */
async function mapWithConcurrency(
  items,
  limit,
  fn,
  { deadline = 0, now = Date.now, stopWhen = null } = {}
) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      if (deadline && now() >= deadline) return;
      if (stopWhen && stopWhen()) return;
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Deep local research. Gathers up to `maxCandidates` SERP candidates by walking SearXNG's
 * `pageno` server-side (local HTTP/CPU, zero agent tokens), ranks them locally with BM25,
 * then fetches only the top `topK`. Each fetched page is curated ONE AT A TIME — its full
 * text goes to the local Ollama model (if available), which understands and relates it to
 * the query rather than just keyword-matching it, returns a verbatim excerpt, and the page's
 * full text is discarded before the next one is fetched (no accumulated context across
 * pages, no page content ever reaches the calling agent). Falls back to the deterministic
 * {@link extractPassage} heuristic per page when Ollama is unavailable or a curation call
 * fails — curation quality varies, the tool never stops working.
 *
 * `targetRelevant` (default 0, disabled) lets a call end EARLY, before `topK`/`deadlineMs` are
 * exhausted, once that many results have been genuinely curated as relevant — the tool
 * recognizing "enough good info" on its own instead of always spending the whole budget even
 * after the goal is met. Reported back as `targetReached: true` so the agent can tell a
 * successful early stop apart from a deadline cutoff (both can leave `remaining` > 0).
 *
 * `dedupeSimilar`/`diversify` (both default false, ADR-0028's own precedent for this class of
 * technique) run ONE batched embedding call over the final kept set — never per-page — to remove
 * near-duplicate pages (`dedupedSimilar` reported) and/or reorder for topical diversity (MMR,
 * `mmrLambda` default 0.5). Skipped when the deadline has too little left
 * (`MIN_MS_FOR_EMBED_PASS`) or the embed model is unavailable; both degrade to the plain curated
 * order rather than failing the call.
 * @param {string} query
 * @param {{ maxCandidates?: number, topK?: number, passageChars?: number, stealth?: boolean,
 *           searxngUrl?: string, targetRelevant?: number, dedupeSimilar?: boolean,
 *           diversify?: boolean, mmrLambda?: number }} [opts]
 * @param {{ searxngImpl?: typeof searxngSearch, fetchImpl?: typeof obscuraFetch,
 *           searchImpl?: typeof searchWeb, checkOllamaImpl?: typeof checkOllama,
 *           ensureOllamaImpl?: typeof ensureOllamaServer, curateImpl?: typeof curatePage,
 *           embedImpl?: typeof embedPassages }} [deps]
 * @returns {Promise<{ source: string, scanned: number, fetched: number, targetReached?: boolean,
 *           dedupedSimilar?: number, results: Array<{ title:string, url:string, score:number,
 *           snippet:string, extraction:"ollama"|"heuristic", relevant:boolean,
 *           fetchFailed?:boolean }> }>}
 */
export async function deepResearch(query, opts = {}, deps = {}) {
  const q = String(query ?? "").trim();
  if (!q) throw new Error("obscura_research: empty query.");

  const maxCandidates = Math.min(Math.max(Number(opts.maxCandidates) || 50, 1), 300);
  // topK default 20, not 8. The old 8 was calibrated for a sequential fetch loop where each
  // page cost ~8s of wall clock; with a bounded-concurrency pool and a deadline it is no longer
  // the latency dial it was. It is now the thing that decides whether the answer is READ:
  // measured, expansion lands the golden URL at mean rank ~22 of the fused pool (fan-out
  // multiplies every rank by roughly the number of sub-queries), so top_k=8 reads 0 of 4 and
  // top_k≈30 reads them. An 8-page budget makes the whole expansion stage pointless.
  const topK = Math.min(Math.max(Number(opts.topK) || 20, 1), 50);
  const passageChars = Math.min(Math.max(Number(opts.passageChars) || 800, 200), 4000);
  const concurrency = Math.min(Math.max(Number(opts.concurrency) || DEFAULT_CONCURRENCY, 1), 8);
  // Expansion fans out one SearXNG round-trip per sub-query, and each of those fans out to ~108
  // upstream engines — so this is a real politeness/latency dial, not just a quality one.
  const subQueries = Math.min(Math.max(Number(opts.subQueries) || 6, 1), 10);
  const expand = opts.expand !== false && process.env.OBSCURA_RESEARCH_EXPAND !== "0";
  const includeRejected = opts.includeRejected === true;
  const dropBelow = Number.isFinite(opts.dropBelow) ? opts.dropBelow : DEFAULT_DROP_BELOW;
  // 0 (default) = disabled, keep grinding through `topK`/`deadlineMs` exactly as before. Set, it
  // lets a call finish EARLY once it already has enough curated, above-threshold results, instead
  // of always spending the whole time/candidate budget even after the goal is met — the point of
  // "Claude receives a lot of good, non-garbage info and tells the tool to stop" is that the tool
  // itself should recognize "enough" and stop reaching for marginal candidates, not just run the
  // clock out. Bounded to `topK` — asking for more good results than pages fetched is a no-op.
  const targetRelevant = Math.min(Math.max(Number(opts.targetRelevant) || 0, 0), topK);
  // Both default OFF (ADR-0028's own precedent for this class of technique: measure before
  // assuming it helps). Both share ONE embedding call over the final kept set (never per-page),
  // so enabling either costs at most one extra network round-trip for the whole call, gated by
  // `MIN_MS_FOR_EMBED_PASS` against the deadline.
  const dedupeSimilar = opts.dedupeSimilar === true;
  const diversify = opts.diversify === true;
  const mmrLambda = Number.isFinite(opts.mmrLambda) ? opts.mmrLambda : 0.5;
  // Durable "seen" set for cross-session mass research — see the doc on `listCoveredHashes`
  // (research-persist.mjs) for why this is a Set of `hash8` and not full URLs.
  const excludeHashes = opts.excludeHashes instanceof Set ? opts.excludeHashes : null;
  const categories = opts.categories ?? DEFAULT_CATEGORIES;
  const now = opts.now ?? Date.now; // injectable so the deadline is testable without sleeping
  const deadlineMs = Number.isFinite(opts.deadlineMs) ? opts.deadlineMs : DEFAULT_DEADLINE_MS;
  const deadline = deadlineMs > 0 ? now() + deadlineMs : 0;
  const stealth = opts.stealth;
  const searxngUrl = opts.searxngUrl ?? process.env.OBSCURA_SEARXNG_URL ?? "http://127.0.0.1:8888";

  const {
    searxngImpl = searxngSearch,
    fetchImpl = obscuraFetch,
    searchImpl = searchWeb,
    checkOllamaImpl = checkOllama,
    ensureOllamaImpl = ensureOllamaServer,
    curateImpl = curatePage,
    expandImpl = expandQuery,
    checkRobotsImpl = checkRobots,
    embedImpl = embedPassages
  } = deps;
  // Scoped to this automated multi-page crawl, not `obscura_fetch`: a user naming one URL by
  // hand has already decided to fetch it (same scoping Scrapling gives its own
  // `robots_txt_obey` — a crawl/spider option, not a single-shot `Fetcher.get` one). Default ON,
  // matching this package's own established ethics (no Google scraping, honest degradation,
  // throttled fan-out) even though Scrapling itself ships the equivalent flag opt-in.
  const respectRobots = process.env.OBSCURA_RESPECT_ROBOTS !== "0";

  // One availability check per call (not per page) — Ollama absence/presence doesn't change
  // mid-crawl. OBSCURA_RESEARCH_OLLAMA=0 opts out even when a daemon happens to be running.
  let ollamaAvailable = false;
  if (process.env.OBSCURA_RESEARCH_OLLAMA !== "0") {
    await ensureOllamaImpl().catch(() => false);
    const health = await checkOllamaImpl().catch(() => ({ ok: false, hasModel: false }));
    ollamaAvailable = Boolean(health.ok && health.hasModel);
  }

  // Expand: ONE local model call for the whole crawl (not one per page), turning the asker's
  // question into several English, canonically-worded queries. This is the stage that decides
  // whether the answer is ever crawled at all — on the golden set's `vocab-mismatch` bucket
  // every miss is `never crawled`, so it is the only stage that can fix them. See
  // ollama-client.mjs#EXPAND_SYSTEM_PROMPT for the probe table behind the prompt's rules.
  //
  // `queries[0]` is always the original: if the asker already knew the exact term, their
  // wording is the best query there is, and a 3.8B model is not reason enough to discard it.
  let queries = [q];
  let concept = "";
  if (ollamaAvailable && expand) {
    try {
      const ex = await expandImpl({ query: q, max: subQueries });
      if (ex.queries.length) queries = ex.queries;
      concept = ex.concept;
    } catch {
      // Expansion is an enhancement, not a dependency: a failure here costs breadth, never
      // the call. Same per-stage degradation contract as curation (ADR-0055 §4).
    }
  }

  // Gather: fan out over the sub-queries CONCURRENTLY. SearXNG's dev server runs
  // `app.run(..., threaded=True)` (webapp.py:1345 — verified, not assumed), so these do not
  // serialize; each one is a loopback round-trip that costs local CPU and zero agent tokens.
  //
  // `limit: maxCandidates` — NOT a fixed page size. The old code asked for 10 per pageno and
  // sliced the rest away, so a 50-candidate crawl cost 5 sequential round-trips to keep 50 of
  // the ~20-29 x 5 results SearXNG had already merged and handed over. One pageno is the union
  // of every enabled engine (~108 here), so ask for the whole page and only walk pageno when
  // the page actually came up short.
  const perQuery = new Map();
  const meta = {};
  let source = "searxng";
  if (searxngUrl) {
    // Sub-queries run at bounded concurrency, NOT all at once. Measured the hard way: every
    // SearXNG query fans out to ~108 upstream engines, and those are free-tier scrapes of
    // Google/Brave/Startpage that rate-limit hard. Firing 6 sub-queries x 5 pages concurrently
    // suspended every engine on this machine within one afternoon of testing — brave and
    // google cse for "too many requests", startpage for a CAPTCHA (searx/settings.yml
    // suspended_times: 180s, 180s, 3600s respectively; a Cloudflare CAPTCHA is 15 DAYS).
    //
    // A suspended engine doesn't error — SearXNG answers 200 with `results: []`. So an
    // unthrottled fan-out doesn't fail loudly, it quietly makes the tool find nothing at all,
    // which is strictly worse than the narrow crawl it replaced. The concurrency cap is the
    // feature working, not a limitation of it.
    await mapWithConcurrency(
      queries,
      SUBQUERY_CONCURRENCY,
      async (sq) => {
        const got = [];
        for (let page = 1; got.length < maxCandidates; page++) {
          // Same deadline the fetch+curate stage races against, checked here too: without it,
          // this loop can walk up to MAX_PAGES sequential SearXNG calls (each with its own 10s
          // AbortController in serp.mjs) per sub-query with no upper bound of its own — a
          // degraded SearXNG (slow, cold-starting, partially banned) could burn the ENTIRE
          // deadline just gathering, before a single page is ever fetched. `mapWithConcurrency`'s
          // own gate (below) stops picking up NEW sub-queries once time is up; this stops an
          // ALREADY-claimed sub-query from walking pages forever past the same deadline.
          if (deadline && now() >= deadline) break;
          const batch = await cachedSearxng(searxngImpl, sq, {
            base: searxngUrl,
            limit: maxCandidates - got.length,
            page,
            categories,
            meta
          });
          if (!batch || !batch.length) break; // exhausted, or SearXNG unreachable this round
          got.push(...batch);
          if (page >= MAX_PAGES) break; // guard: never walk pageno unboundedly on a thin query
        }
        if (got.length) perQuery.set(sq, dedupeByUrl(got));
      },
      { deadline, now }
    );
  }

  let candidates = fuseSubQueries(perQuery);

  if (!candidates.length) {
    // No SearXNG (or empty) — degrade to the existing single-page scrape chain rather than
    // hand-rolling fragile per-engine offset pagination (see module doc).
    const fallback = await searchImpl(q, { limit: Math.min(maxCandidates, 20), stealth }).catch(
      (e) => {
        throw new Error(`obscura_research: ${e?.message || e}`);
      }
    );
    candidates = fallback.results;
    source = fallback.source;
  }

  // No re-ranking. This is the whole of the "ranking" stage now, and that is the finding, not
  // an omission: `searxng-json-order` beat every alternative on evals/research (n=10, k=10) —
  // today's slice+BM25 by +0.115 nDCG@10 / +0.143 MRR / +0.100 hit@1 at equal recall, a raw
  // `score` re-sort by +0.100 recall, and RRF(searxng, bm25) at every weight in a monotone
  // sweep whose optimum was bm25_weight = 0.
  //
  // Two traps this deliberately avoids (both measured, see rank.mjs's header):
  //  1. Removing the old `PAGE_SIZE = 10` slice WITHOUT removing BM25 is the worst option of
  //     all (-0.170 nDCG, -0.300 recall): the slice was the only thing injecting SearXNG's
  //     judgment, and BM25 over a wider pool just has more junk to promote. They had to go
  //     together, which is why this one edit does both.
  //  2. `rankCandidates` is still exported — the bench arms need it, and it remains the only
  //     signal on the SearXNG-less scrape fallback. It is simply not in this path anymore.
  //
  // `capPerHost` runs here, AFTER trusting SearXNG's order and BEFORE the maxCandidates slice —
  // it does not re-rank (relative order among different hosts is untouched), it only keeps one
  // host from filling the slice with itself at every other host's expense. Off (HOST_CAP<=0) is a
  // no-op, matching `capPerHost`'s own contract.
  candidates = capPerHost(dedupeByUrl(candidates), (c) => hostOf(c.url), HOST_CAP).slice(
    0,
    maxCandidates
  );
  // Captured BEFORE the already-covered filter below: `scanned` must report how much was
  // actually crawled and considered, not how much was left after excluding what a previous call
  // already has — otherwise a well-covered topic would misreport itself as barely searched.
  const scannedCount = candidates.length;

  // Skip candidates a PREVIOUS persisted call already covered, so `top_k` is spent on genuinely
  // new pages instead of re-fetching and re-curating ones already sitting in RESEARCH/<topic>/.
  // This is what makes repeated `persist:true` calls on one topic an actually-accumulating mass
  // crawl (Scrapling's crawler checkpoints a `seen` URL set to disk for the same reason — a
  // resumed crawl shouldn't re-walk ground it already covered) rather than the same top hits
  // every time. `alreadyCovered` reports how many were skipped so a call that comes back thin
  // because the topic is simply well-covered reads differently from one that failed to search.
  let alreadyCovered = 0;
  if (excludeHashes && excludeHashes.size) {
    const before = candidates.length;
    candidates = candidates.filter((c) => !excludeHashes.has(hash8(c.url)));
    alreadyCovered = before - candidates.length;
  }

  const chosen = candidates.slice(0, topK);

  // Pages are fetched CONCURRENTLY but each is still curated ALONE: `content` is local to one
  // call of this function, goes out of scope the moment that page's curation returns, and is
  // never combined with another page's text in a single model call. ADR-0055's constraint is
  // about what enters one model call, not about wall-clock ordering — running two independent
  // single-page curations at once accumulates nothing.
  /**
   * Fetch + curate ONE candidate. Extracted so the deadline race below can wrap it without
   * duplicating this body — see that race's own comment for why it exists.
   */
  const processCandidate = async (c) => {
    const base = { title: c.title, url: c.url, score: Number((c.score ?? 0).toFixed(3)) };

    if (respectRobots) {
      const { allowed } = await checkRobotsImpl(c.url).catch(() => ({ allowed: true }));
      if (!allowed) {
        // Never fetched, so there is no verdict — same shape as fetchFailed, `relevant: null`
        // rather than the old hardcoded `true`. `robotsBlocked` (not `fetchFailed`) so the agent
        // can tell "this site said no" apart from "the network failed", which is the same
        // distinction `enginesUnavailable` exists to preserve for search suspension.
        return {
          ...base,
          snippet: c.snippet,
          extraction: "none",
          relevant: null,
          robotsBlocked: true
        };
      }
    }

    let content;
    try {
      // Fetch HTML, not markdown, and strip hidden content before anything downstream (the
      // heuristic extractor OR the LLM curator) ever sees it. Found live, not hypothesized: a
      // page hiding text via `display:none`/`aria-hidden` had that text pass straight through
      // obscura's own `--dump markdown` AND `--dump text` — both are raw DOM-text walks, neither
      // is visibility-aware — and this package's own `scanInjection` (a VISIBLE-text heuristic)
      // flagged zero hits against it either. This crawl is the highest-value target for that gap:
      // it feeds many unvetted pages straight into local-LLM curation and, with `persist:true`,
      // a durable memory bank, with no human reviewing each page first. See `sanitize.mjs`'s doc
      // for what is and isn't caught (inline style/attribute hiding, not class-based CSS rules).
      const { content: html } = await cachedFetch(fetchImpl, c.url, { format: "html", stealth });
      content = stripHiddenContent(html);
    } catch {
      // The page was never read, so there is no verdict to report. `relevant: null` says
      // exactly that. It used to say `true`, which meant an unreadable page outranked one the
      // model had read and explicitly rejected — the sort below now can't do that.
      return {
        ...base,
        snippet: c.snippet,
        extraction: "none",
        relevant: null,
        fetchFailed: true
      };
    }

    const heuristic = () => extractPassage(content, q, { maxChars: passageChars });
    if (!ollamaAvailable)
      return {
        ...base,
        snippet: heuristic() || c.snippet,
        extraction: "heuristic",
        relevant: true
      };

    try {
      const curated = await curateImpl({ markdown: content, query: q });
      // Recompute `relevant` against THIS CALL's `dropBelow`, not `curated.relevant` — curatePage
      // has no `dropBelow` param (its signature is fixed) and derives its own `relevant` from the
      // module-level `DEFAULT_DROP_BELOW`, so a caller using a non-default `dropBelow` would
      // otherwise get a `relevant` that silently disagrees with THIS call's own `kept` filter below
      // (e.g. `dropBelow:7`, `relevance:5` — curatePage says relevant:true against its own baked-in
      // 3, but `kept` drops it anyway). Byte-identical when the caller uses the default.
      const relevant = curated.relevance >= dropBelow;
      // `extraction` must name what actually produced `snippet`. It used to report "ollama"
      // even when the excerpt was empty or the verdict was `relevant:false` and the text below
      // therefore came from extractPassage — the one field an agent has for auditing which
      // path a passage took, lying about the path.
      const useCurated = Boolean(relevant && curated.excerpt);
      return {
        ...base,
        snippet: useCurated ? curated.excerpt.slice(0, passageChars) : heuristic() || c.snippet,
        extraction: useCurated ? "ollama" : "heuristic",
        relevant,
        relevance: curated.relevance,
        ...(curated.reason ? { reason: curated.reason } : {}),
        // curatePage has always reported this (ADR-0055 §2: "never silent"); deepResearch
        // silently dropped it, so a 100k-char page curated on its first 12k looked complete.
        ...(curated.truncated ? { truncated: true } : {})
      };
    } catch {
      // A single curation failure degrades that one page to the heuristic, not the whole
      // research call — matches the tool's overall "never stop working" contract.
      return {
        ...base,
        snippet: heuristic() || c.snippet,
        extraction: "heuristic",
        relevant: true
      };
    }
  };

  // A result counts toward `targetRelevant` only if it was ACTUALLY curated and passed the same
  // threshold `kept` uses below — not a heuristic guess, not "unknown" (fetchFailed/robotsBlocked/
  // timedOut/no-Ollama-available). Those are exactly the cases where the tool has no real verdict,
  // so they cannot honestly count as "enough good info" even though today's `kept` filter (a
  // separate concern: never silently discard an unjudged page) lets them through to the response.
  let goodCount = 0;
  const isGood = (r) =>
    r.relevant === true && typeof r.relevance === "number" && r.relevance >= dropBelow;

  const attempted = await mapWithConcurrency(
    chosen,
    concurrency,
    async (c) => {
      // Bound EACH item to the deadline itself, not to fetchImpl's/curateImpl's own independent
      // timeouts. Measured live against a real SearXNG+Ollama stack: `mapWithConcurrency`'s gate
      // only stops the pool from PICKING UP new items — an item already claimed when the
      // deadline hits used to run to ITS OWN internal timeout (obscuraFetch's default 30s+15s
      // execa margin, curatePage's 30s) before this function could return. With concurrency=4,
      // the worst case is bounded by the SLOWEST of up to 4 concurrent items' own timeouts, which
      // measured 58s wall-clock against a configured 50s deadline — past the MCP transport's
      // hard 60s wall, which is exactly the failure this whole deadline mechanism exists to
      // prevent. Racing each item against the time actually left closes that gap: the worst case
      // is now the deadline itself, not deadline + an unrelated per-operation timeout.
      const base = { title: c.title, url: c.url, score: Number((c.score ?? 0).toFixed(3)) };
      const work = processCandidate(c);
      let result;
      if (!deadline) {
        result = await work;
      } else {
        const msLeft = deadline - now();
        result =
          msLeft <= 0
            ? { ...base, snippet: c.snippet, extraction: "none", relevant: null, timedOut: true }
            : await Promise.race([
                work,
                new Promise((resolve) =>
                  setTimeout(
                    () =>
                      resolve({
                        ...base,
                        snippet: c.snippet,
                        extraction: "none",
                        relevant: null,
                        timedOut: true
                      }),
                    msLeft
                  )
                )
              ]);
      }
      // Concurrent workers can race this increment past `targetRelevant` by up to `concurrency-1`
      // (several in-flight items finishing "good" around the same tick) — the gate stops NEW
      // dispatch, it never throws away work already in flight. Documented overshoot, not a bug.
      if (isGood(result)) goodCount++;
      return result;
    },
    { deadline, now, stopWhen: targetRelevant > 0 ? () => goodCount >= targetRelevant : null }
  );

  // Slots the deadline stopped us from starting come back `undefined`; slots the deadline
  // interrupted MID-FLIGHT come back with `timedOut: true` (see the race above). Both are the
  // same REPORTED gap from the agent's point of view — a candidate that never got a real
  // verdict — so `remaining` counts both: `partial`/`remaining` say how much of the plan went
  // unread, so a thin answer can't pass for a complete one. Calling again continues from a warm
  // SearXNG (its idle timer is still running) and, with `persist:true`, the RESEARCH/ bank
  // already dedupes by URL hash (ADR-0056) — so depth accumulates across calls without a
  // job-handle machine.
  const results = attempted.filter(Boolean);
  const timedOutCount = results.filter((r) => r.timedOut).length;
  const remaining = chosen.length - results.length + timedOutCount;
  // Reached ON PURPOSE, not cut off — distinguishes "you asked for N good results and got them"
  // from "the clock ran out". Both can leave `remaining` > 0 (candidates in `chosen` never
  // dispatched), so without this flag the two look identical from outside: a thin-looking result
  // that is actually a complete success would read as a failure.
  const targetReached = targetRelevant > 0 && goodCount >= targetRelevant;

  // Order by the curator's score, which is now a real ordering rather than the single bit it
  // used to be. A page the model read and scored 9 should outrank one it scored 4; before
  // ADR-0057 the model's judgment was compressed to `relevant: boolean` and applied as one
  // binary partition, discarding everything it knew about how MUCH a page helps.
  //
  // Results with no verdict (heuristic path, or never fetched) sort between confirmed and
  // rejected: unknown is not a positive, and it is not a negative either.
  const verdictRank = (r) =>
    typeof r.relevance === "number" ? r.relevance : r.relevant === null ? -1 : 5;
  results.sort((a, b) => verdictRank(b) - verdictRank(a));

  // Drop the garbage. This is the reversal of ADR-0055 §6 ("relevant:false still returns a
  // result, not silence"), which was a defensible call when the verdict was one bit from a
  // model that could not explain itself — but it means the "entity that removes the garbage"
  // never removed any, and the agent paid tokens for Instagram reels so it could reject them
  // itself. With a banded score and a `reason`, the model can say WHY, and a conservative
  // threshold at the top of the wrong-topic band spends the false-drop risk where it is
  // smallest. Never silent: `dropped` is reported, and `include_rejected` brings them back.
  const kept = includeRejected
    ? results
    : results.filter((r) => typeof r.relevance !== "number" || r.relevance >= dropBelow);
  const dropped = results.length - kept.length;

  // Opt-in embedding pass over the FINAL kept set — near-dup removal and/or MMR diversification.
  // ONE batched embed call for the whole set (never per-page), gated by the deadline so a quality
  // enhancement can never be what pushes a call past the MCP transport's hard 60s wall. `kept` is
  // already best-first (sorted above, filtering preserves order), so the near-dup pass keeping the
  // FIRST occurrence in a similarity cluster correctly keeps the highest-ranked copy.
  let finalResults = kept;
  let dedupedSimilar = 0;
  const embedBudgetOk = !deadline || deadline - now() > MIN_MS_FOR_EMBED_PASS;
  if ((dedupeSimilar || diversify) && kept.length > 1 && embedBudgetOk) {
    try {
      const texts = kept.map((r) => r.snippet || r.title || "");
      const vectors = await embedImpl({ texts });
      const vectorOf = new Map(kept.map((r, i) => [r, vectors[i]]));

      if (dedupeSimilar) {
        const survivors = [];
        for (const r of kept) {
          const v = vectorOf.get(r);
          const isDup =
            v && survivors.some((s) => cosine(v, vectorOf.get(s)) >= NEAR_DUP_THRESHOLD);
          if (isDup) dedupedSimilar++;
          else survivors.push(r);
        }
        finalResults = survivors;
      }
      if (diversify) {
        finalResults = mmr(
          finalResults,
          (r) => vectorOf.get(r),
          (r) => r.relevance ?? 0,
          mmrLambda
        );
      }
    } catch {
      // Enhancement, never a dependency: embed model absent, Ollama down, or the batch call
      // otherwise failed — degrades to the plain curated order, same "never stop working"
      // contract as expansion/curation.
    }
  }

  // How many candidates a host's own robots.txt said not to fetch — reported for the same
  // reason `enginesUnavailable` is: the agent needs "this site declined" to read differently
  // from "the network failed" or "the model rejected it", since only one of those means a
  // retry could ever help.
  const robotsBlocked = results.filter((r) => r.robotsBlocked).length;

  // Engines SearXNG could not reach this round. Surfaced, never swallowed: a suspended engine
  // returns 200 + `results: []`, so without this a rate-limited machine reports "nothing found"
  // for a query whose answer is sitting on page 1 of a search engine it is currently banned
  // from. The agent needs to tell "no such page exists" apart from "come back in 3 minutes",
  // because those call for opposite next moves.
  const suspended = (meta.unresponsive ?? [])
    .map((e) => (Array.isArray(e) ? `${e[0]}: ${e[1]}` : String(e)))
    .filter(Boolean);

  return {
    source,
    scanned: scannedCount,
    fetched: results.length,
    ...(remaining ? { partial: true, remaining } : {}),
    ...(targetReached ? { targetReached: true } : {}),
    ...(dropped ? { dropped } : {}),
    ...(dedupedSimilar ? { dedupedSimilar } : {}),
    ...(robotsBlocked ? { robotsBlocked } : {}),
    ...(alreadyCovered ? { alreadyCovered } : {}),
    ...(suspended.length ? { enginesUnavailable: suspended } : {}),
    // How the crawl was actually widened. `queries` is the single most useful debugging field
    // in the response: when a research call comes back thin, the answer is almost always that
    // the expansion went somewhere useless, and without this you cannot see that from outside.
    // Reported only when expansion actually did something, so the default single-query shape is
    // unchanged and costs no tokens.
    ...(queries.length > 1 ? { queries } : {}),
    ...(concept ? { concept } : {}),
    results: finalResults
  };
}
