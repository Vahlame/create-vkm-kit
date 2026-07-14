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
import { searxngSearch, searchWeb } from "./serp.mjs";
import { checkOllama, curatePage, ensureOllamaServer } from "./ollama-client.mjs";

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

/** Dedupe candidates by URL, preserving first (= best-paginated) occurrence. */
function dedupeByUrl(results) {
  const seen = new Set();
  return results.filter((r) => r && r.url && !seen.has(r.url) && seen.add(r.url));
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
 * @param {string} query
 * @param {{ maxCandidates?: number, topK?: number, passageChars?: number, stealth?: boolean,
 *           searxngUrl?: string }} [opts]
 * @param {{ searxngImpl?: typeof searxngSearch, fetchImpl?: typeof obscuraFetch,
 *           searchImpl?: typeof searchWeb, checkOllamaImpl?: typeof checkOllama,
 *           ensureOllamaImpl?: typeof ensureOllamaServer, curateImpl?: typeof curatePage }} [deps]
 * @returns {Promise<{ source: string, scanned: number, fetched: number, results: Array<{
 *           title:string, url:string, score:number, snippet:string, extraction:"ollama"|"heuristic",
 *           relevant:boolean, fetchFailed?:boolean }> }>}
 */
export async function deepResearch(query, opts = {}, deps = {}) {
  const q = String(query ?? "").trim();
  if (!q) throw new Error("obscura_research: empty query.");

  const maxCandidates = Math.min(Math.max(Number(opts.maxCandidates) || 50, 1), 300);
  const topK = Math.min(Math.max(Number(opts.topK) || 8, 1), 30);
  const passageChars = Math.min(Math.max(Number(opts.passageChars) || 800, 200), 4000);
  const stealth = opts.stealth;
  const searxngUrl = opts.searxngUrl ?? process.env.OBSCURA_SEARXNG_URL ?? "http://127.0.0.1:8888";

  const {
    searxngImpl = searxngSearch,
    fetchImpl = obscuraFetch,
    searchImpl = searchWeb,
    checkOllamaImpl = checkOllama,
    ensureOllamaImpl = ensureOllamaServer,
    curateImpl = curatePage
  } = deps;

  // One availability check per call (not per page) — Ollama absence/presence doesn't change
  // mid-crawl. OBSCURA_RESEARCH_OLLAMA=0 opts out even when a daemon happens to be running.
  let ollamaAvailable = false;
  if (process.env.OBSCURA_RESEARCH_OLLAMA !== "0") {
    await ensureOllamaImpl().catch(() => false);
    const health = await checkOllamaImpl().catch(() => ({ ok: false, hasModel: false }));
    ollamaAvailable = Boolean(health.ok && health.hasModel);
  }

  // Gather: page SearXNG server-side (local, free) until maxCandidates or exhaustion.
  const PAGE_SIZE = 10; // SearXNG's own JSON page unit; walking pageno, not a tunable knob.
  let candidates = [];
  let source = "searxng";
  if (searxngUrl) {
    const pages = Math.ceil(maxCandidates / PAGE_SIZE);
    for (let page = 1; page <= pages; page++) {
      const batch = await searxngImpl(q, { base: searxngUrl, limit: PAGE_SIZE, page }).catch(
        () => null
      );
      if (!batch || !batch.length) break; // exhausted, or SearXNG unreachable this round
      candidates.push(...batch);
      if (candidates.length >= maxCandidates) break;
    }
  }

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

  candidates = dedupeByUrl(candidates).slice(0, maxCandidates);
  const chosen = rankCandidates(candidates, q).slice(0, topK);

  const results = [];
  for (const c of chosen) {
    // Sequential, one page at a time: `content` below is a loop-local variable that goes out
    // of scope (and is eligible for GC) the moment this iteration ends — nothing about a
    // page's full text survives past its own curation, and no page's text is ever combined
    // with another's in a single model call.
    try {
      const { content } = await fetchImpl(c.url, { format: "markdown", stealth });
      let snippet;
      let extraction = "heuristic";
      let relevant = true;
      if (ollamaAvailable) {
        try {
          const curated = await curateImpl({ markdown: content, query: q });
          extraction = "ollama";
          relevant = curated.relevant;
          snippet =
            curated.relevant && curated.excerpt
              ? curated.excerpt.slice(0, passageChars)
              : extractPassage(content, q, { maxChars: passageChars });
        } catch {
          // A single curation failure degrades that one page to the heuristic, not the
          // whole research call — matches the tool's overall "never stop working" contract.
          snippet = extractPassage(content, q, { maxChars: passageChars });
        }
      } else {
        snippet = extractPassage(content, q, { maxChars: passageChars });
      }
      results.push({
        title: c.title,
        url: c.url,
        score: Number(c.score.toFixed(3)),
        snippet: snippet || c.snippet,
        extraction,
        relevant
      });
    } catch {
      // One page failing to fetch shouldn't sink the whole research call — fall back to its
      // SERP snippet so the agent still gets something ranked for that result.
      results.push({
        title: c.title,
        url: c.url,
        score: Number(c.score.toFixed(3)),
        snippet: c.snippet,
        extraction: "heuristic",
        relevant: true,
        fetchFailed: true
      });
    }
  }

  // BM25 picked WHICH pages to fetch, but it's blind to semantics — once Ollama has actually
  // read a page, its relevant/not-relevant verdict is strictly more informed than the lexical
  // score that only decided fetch order. Without this, a page Ollama confirmed relevant could
  // still rank below one it explicitly rejected, purely because BM25 scored the rejected one's
  // title+snippet higher — exactly the kind of blind-to-meaning ordering this whole feature
  // exists to move away from. Stable otherwise: ties keep their original (BM25) order.
  results.sort((a, b) => Number(b.relevant) - Number(a.relevant));

  return { source, scanned: candidates.length, fetched: results.length, results };
}
