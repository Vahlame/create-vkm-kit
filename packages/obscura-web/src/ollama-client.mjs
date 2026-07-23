/**
 * Minimal Ollama client over plain `fetch` (ADR-0055) — a deliberately-scoped, self-contained
 * copy of `vkm-spec/src/ollama-client.mjs`'s proven pattern (checkOllama / typed unavailable
 * error / on-demand spawn / structured-output `format`), NOT a cross-package import: obscura-web
 * stays independently runnable, same convention as `untrusted-web.mjs`. Same default model/host
 * as vkm-spec on purpose — if the user already has Ollama up for spec-drafting, deep research
 * shares that daemon for free instead of requiring a second one.
 *
 * The one job this module does beyond "is Ollama up": `curatePage` reads ONE fetched page's
 * text against a research query and returns a verbatim, curated excerpt (or "not relevant") —
 * real understanding instead of keyword overlap, so information that doesn't share the query's
 * wording still gets recognized. Called once per page, statelessly (no shared context across
 * pages — a page's full text is never accumulated or kept beyond its own call), so `deepResearch`
 * can process an arbitrarily long crawl one page at a time without ever growing a context.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const DEFAULT_OLLAMA_HOST = process.env.OBSCURA_OLLAMA_HOST || "http://127.0.0.1:11434";

/**
 * Model for {@link curatePage} — chosen by a real bake-off (ADR-0057 fifth addendum,
 * `bench-curate.mjs` + `evals/research/curation.jsonl`), not by carrying ADR-0055's original pick
 * forward unexamined.
 *
 * Measured (n=8, accuracy / false-positive-rate on labelled irrelevant pages / latency), against
 * the exact live failure that motivated the bake-off (MDN `WritableStreamDefaultWriter` pages
 * scored `relevance:9` for a SQLite WAL query):
 *
 *   phi4-mini:3.8b-q4_K_M (this default)   accuracy 0.625   FP-rate 0.750   3.6s/page
 *   qwen3.5:4b-q4_K_M                      accuracy 0.500   FP-rate 0.750   3.9s/page
 *   qwen3.5:9b-q4_K_M                      accuracy 0.375   FP-rate 0.000  40.6s/page (half timed out at 60s)
 *
 * `qwen3.5:9b` is the only one that stopped scoring the MDN pages relevant, but 40.6s/page with
 * half its calls not finishing inside 60s disqualifies it on latency alone — one page alone could
 * burn `deepResearch`'s entire ~50s call budget. Of the two viable options, `qwen3.5:4b` does not
 * beat phi4-mini: lower accuracy, an IDENTICAL false-positive rate on the hard case (both still
 * called 3 of 4 MDN pages relevant), and a hair slower. So this stays phi4-mini — not because it
 * solves the false-positive failure (it doesn't; neither viable model does at this size class on
 * this hardware), but because switching would trade a known small loss for no measured gain.
 *
 * Caveat, same as {@link DEFAULT_EXPAND_MODEL}'s own: n=8 is small, and "0.750 for both" is
 * exactly 3 of 4 — a coincidence of a tiny denominator is plausible. Widen
 * `evals/research/curation.jsonl` before treating this as settled. A rubric fix is the next
 * unexplored lever (`CURATE_SYSTEM_PROMPT`'s 9-10 band names "official documentation" as a
 * top-score marker, and MDN genuinely is one — just for the wrong topic), not attempted here.
 */
export const DEFAULT_MODEL = process.env.OBSCURA_OLLAMA_MODEL || "phi4-mini:3.8b-q4_K_M";

/**
 * Model for {@link expandQuery} — deliberately NOT the curation default.
 *
 * Curation and expansion are different jobs and a 3.8B can do exactly one of them. Curation is
 * a reading-comprehension task: the page is right there, and the model only has to judge and
 * quote it. Expansion is a RECALL task: the model must already know that "hidden instructions
 * on a page" is called prompt injection, and phi4-mini simply does not.
 *
 * Measured end-to-end on evals/research's vocab-mismatch bucket (does the golden URL enter the
 * pool at all?): baseline 1/4 · phi4-mini 1/4 (+0, and it doubled the social-media junk in the
 * pool) · qwen3.5:4b 3/4 (+2). Expansion on phi4-mini is not merely useless, it is net
 * NEGATIVE — more junk crawled for zero extra answers found.
 *
 * That is why this is a separate knob rather than a bump of DEFAULT_MODEL. ADR-0055 chose
 * phi4-mini so a `vkm-spec` user got curation free from the same daemon with nothing new to
 * pull, and that reasoning still holds for curation. If this model is not pulled, `checkOllama`
 * reports `hasModel: false`, `expandQuery` throws `model_missing`, and `deepResearch` degrades
 * to the single original query — which the measurement says is the RIGHT behavior for a
 * phi4-mini-only host, not a consolation prize.
 *
 * Caveat on the evidence: n=4 with visible run-to-run variance (3/4 then 2/4 across runs). This
 * is a directional call, not a settled one. Widen evals/research before treating it as settled.
 */
export const DEFAULT_EXPAND_MODEL = process.env.OBSCURA_OLLAMA_EXPAND_MODEL || "qwen3.5:4b-q4_K_M";
/** Survives the whole `deepResearch` page loop (several sequential calls), unlike vkm-spec's
 * bursty single-shot 2m default — still short enough to free the ~3GB of RAM afterward. */
export const DEFAULT_KEEP_ALIVE = process.env.OBSCURA_OLLAMA_KEEP_ALIVE || "5m";
export const MIN_OLLAMA_VERSION = "0.5.13";
/** Page text past this length is truncated before it reaches the model — keeps per-page
 * latency bounded on CPU-only hardware. Document, don't silently degrade: `curatePage` reports
 * `truncated: true` when this fires. */
export const DEFAULT_MAX_INPUT_CHARS = 12_000;

/** The one error `deepResearch` catches to fall back to the local heuristic extractor. */
export class OllamaUnavailableError extends Error {
  /** @param {string} message @param {string} [reason] */
  constructor(message, reason = "unavailable") {
    super(message);
    this.name = "OllamaUnavailableError";
    this.reason = reason;
  }
}

/** "Semver-ish" compare, no dependency: numeric-field compare, pre-release-suffix tolerant. */
export function compareVersions(a, b) {
  const parse = (v) =>
    String(v)
      .split(".")
      .map((part) => parseInt(part, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Probe a local Ollama. Never throws — a down daemon is a normal, expected state here.
 * @param {{ host?: string, model?: string, signal?: AbortSignal }} [opts]
 * @returns {Promise<{ ok: boolean, version: string|null, hasModel: boolean }>}
 */
export async function checkOllama({
  host = DEFAULT_OLLAMA_HOST,
  model = DEFAULT_MODEL,
  signal
} = {}) {
  let version;
  try {
    const res = await fetch(`${host}/api/version`, { signal });
    if (!res.ok) return { ok: false, version: null, hasModel: false };
    const json = await res.json();
    version = typeof json?.version === "string" ? json.version : null;
  } catch {
    return { ok: false, version: null, hasModel: false };
  }
  const ok = version ? compareVersions(version, MIN_OLLAMA_VERSION) >= 0 : false;

  let hasModel = false;
  try {
    const res = await fetch(`${host}/api/tags`, { signal });
    if (res.ok) {
      const json = await res.json();
      const models = Array.isArray(json?.models) ? json.models : [];
      hasModel = models.some((m) => m?.name === model || m?.model === model);
    }
  } catch {
    hasModel = false;
  }
  return { ok, version, hasModel };
}

// The rubric is anchored to concrete bands, not left as a bare "rate 0-10". A small model given
// an unanchored scale clusters everything at 5-7 and the number carries no signal; given named
// bands it has something to match the page against. The bands are also what makes a drop
// threshold meaningful — "below 3" means "the model placed this in the wrong-topic band", not
// "the model felt lukewarm".
//
// A domain-check step ("is the page's technology the SAME as the query's, even if it shares
// generic words") was tried and measured here (ADR-0057 seventh addendum) as a targeted fix for
// the confirmed live false-positive (MDN `WritableStreamDefaultWriter` pages scored relevant for
// a SQLite query). Over 3 trials with the revision vs 2 without (`bench-curate-run.mjs`,
// `phi4-mini`), the false-positive rate improved inconsistently (0.75/0.75 -> 0.5/0.75/0.75) while
// the false-negative rate got WORSE — the same instruction that made the model reject
// WritableStream also made it reject `sqlite.org/wal.html` and `lockingv3.html` themselves in two
// of three runs, exactly the vocab-mismatch/over-literal failure ADR-0055 exists to prevent.
// Reverted: net effect across both error types was a wash-to-worse, not the clean win the FP-rate
// alone suggested. A 3.8B model's variance on this task looks larger than what one prompt
// revision can reliably move — left as a known, unresolved limitation rather than a "fixed"
// claim the evidence doesn't support.
const CURATE_SYSTEM_PROMPT = [
  "You are a careful research assistant. You are shown ONE web page's text and a research QUERY.",
  "",
  "Score how much the page helps answer the query, 0-10, using these bands:",
  "  0-2  Wrong topic. Nothing on this page bears on the query. Marketing, an unrelated",
  "       subject, a login wall, a link farm, a social-media post with no substance.",
  "  3-4  Right general subject, but does not address the question — mentions it in passing,",
  "       or is an index/listing page that points elsewhere.",
  "  5-6  Partially useful: touches the question, or answers a neighbouring one.",
  "  7-8  Directly addresses the question with specifics.",
  "  9-10 Authoritative and directly on point: the official documentation, the spec, the",
  "       source, or the definitive treatment.",
  "",
  "Judge by MEANING, not wording. A page can score high while sharing none of the query's",
  "words — that is normal and expected, because new information rarely restates the question.",
  "Conversely a page stuffed with the query's exact words can be a 0. Understand the content;",
  "do not keyword-match it.",
  "",
  "If the score is 3 or more, extract the passage(s) VERBATIM from the page that carry the",
  "useful information — copy them exactly, never paraphrase, never add anything not present on",
  "the page. If the score is below 3, leave `excerpt` empty.",
  "",
  "Give a `reason` of at most 12 words: what the page is, and why that score.",
  "Respond ONLY with a JSON object matching the requested schema."
].join("\n");

/** Pages scoring below this are dropped from the response (ADR-0057, reversing ADR-0055 §6).
 *
 * Deliberately at the TOP of the wrong-topic band, not at the middle of the scale. The judge is
 * a small local model, and a false drop is invisible — the agent never learns the page existed,
 * so it cannot second-guess it, which is exactly the failure mode ADR-0026 measured when a weak
 * reranker's margin cut threw away correct answers. Dropping only what the model put in the
 * "nothing to do with the query" band spends that risk where it is smallest and still removes
 * the Instagram reels, which is what the whole thing is for. `include_rejected: true` and the
 * reported `dropped` count keep it auditable rather than silent.
 */
export const DEFAULT_DROP_BELOW = Number(process.env.OBSCURA_RESEARCH_DROP_BELOW) || 3;

const CurationSchema = z.object({
  relevance: z.number().min(0).max(10),
  reason: z.string().optional().default(""),
  excerpt: z.string().optional().default("")
});

const CURATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    relevance: { type: "integer", minimum: 0, maximum: 10 },
    reason: { type: "string" },
    excerpt: { type: "string" }
  },
  required: ["relevance", "reason", "excerpt"]
};

/**
 * Shared "one structured JSON call to /api/chat" plumbing behind both {@link curatePage}
 * (ADR-0055) and {@link summarizeNotes} (ADR-0056 local consolidation) — health-check, POST,
 * HTTP/JSON/abort error handling all collapse into the single {@link OllamaUnavailableError}
 * every caller degrades on. Returns the raw parsed JSON payload; the caller validates its own
 * schema (curation vs. summary shapes differ).
 * @param {{ host: string, model: string, keepAlive: string, systemPrompt: string,
 *           userContent: string, jsonSchema: object, signal?: AbortSignal, timeoutMs: number }} opts
 * @returns {Promise<unknown>}
 */
async function chatJSON({
  host,
  model,
  keepAlive,
  systemPrompt,
  userContent,
  jsonSchema,
  signal,
  timeoutMs
}) {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort(signal?.reason ?? new Error("aborted"));
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason ?? new Error("aborted"));
    else signal.addEventListener("abort", onExternalAbort, { once: true });
  }
  const timer =
    timeoutMs > 0
      ? setTimeout(() => controller.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
      : null;
  const cleanup = () => {
    if (timer) clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onExternalAbort);
  };

  try {
    const health = await checkOllama({ host, model, signal: controller.signal });
    if (!health.version) {
      throw new OllamaUnavailableError(`Ollama not reachable at ${host}`, "conn_refused");
    }
    if (!health.ok) {
      throw new OllamaUnavailableError(
        `Ollama ${health.version} is older than the required ${MIN_OLLAMA_VERSION}`,
        "version_too_old"
      );
    }
    if (!health.hasModel) {
      throw new OllamaUnavailableError(
        `Model "${model}" is not pulled on the Ollama host — run: ollama pull ${model}`,
        "model_missing"
      );
    }

    let res;
    try {
      res = await fetch(`${host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent }
          ],
          format: jsonSchema,
          // Reasoning models (Qwen3, gpt-oss, …) think before answering, and every call here
          // wants a small constrained JSON object, not deliberation. Measured on
          // `qwen3.5:4b-q4_K_M`: with thinking on, 3 of 4 expansion calls came back with an
          // EMPTY `message.content` ("Unexpected end of JSON input") and the one that answered
          // took 40s against phi4-mini's ~1s — the model spent its budget in `message.thinking`,
          // which is a separate field this client never reads.
          //
          // Safe on non-thinking models and on older Ollama alike: `think` landed in 0.9, and
          // Ollama decodes request bodies with Go's encoding/json, which ignores unknown fields
          // rather than rejecting them (it does not set DisallowUnknownFields — doing so would
          // break every older client). So a pre-0.9 daemon drops this silently.
          think: false,
          stream: false,
          keep_alive: keepAlive
        }),
        signal: controller.signal
      });
    } catch (e) {
      throw new OllamaUnavailableError(
        `Could not POST /api/chat to ${host}: ${e?.message || e}`,
        controller.signal.aborted ? "timeout" : classifyFetchError(e)
      );
    }

    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 200);
      } catch {
        /* ignore body read failure */
      }
      throw new OllamaUnavailableError(
        `Ollama /api/chat returned HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
        res.status === 404 ? "model_missing" : "http_error"
      );
    }

    let body;
    try {
      body = await res.json();
    } catch (e) {
      throw new OllamaUnavailableError(
        `Ollama returned a non-JSON response: ${e?.message || e}`,
        "bad_json"
      );
    }
    if (controller.signal.aborted) {
      throw new OllamaUnavailableError(`Ollama request timed out after ${timeoutMs}ms`, "timeout");
    }

    try {
      return JSON.parse(body?.message?.content ?? "");
    } catch (e) {
      throw new OllamaUnavailableError(
        `Ollama returned non-JSON content: ${e?.message || e}`,
        "bad_json"
      );
    }
  } finally {
    cleanup();
  }
}

/**
 * Curate ONE fetched page against a query via the local model: real understanding instead of
 * keyword overlap. Stateless (one page in, one verdict out — no accumulated context across
 * calls). Throws {@link OllamaUnavailableError} on ANY failure; the caller degrades to the
 * local heuristic extractor.
 * @param {{ markdown: string, query: string, model?: string, host?: string, keepAlive?: string,
 *           maxInputChars?: number, signal?: AbortSignal, timeoutMs?: number }} opts
 * @returns {Promise<{ relevance: number, reason: string, excerpt: string, relevant: boolean, truncated: boolean }>}
 */
export async function curatePage({
  markdown,
  query,
  model = DEFAULT_MODEL,
  host = DEFAULT_OLLAMA_HOST,
  keepAlive = DEFAULT_KEEP_ALIVE,
  maxInputChars = DEFAULT_MAX_INPUT_CHARS,
  signal,
  timeoutMs = 30_000
}) {
  const text = String(markdown ?? "");
  const truncated = text.length > maxInputChars;
  const pageText = truncated ? text.slice(0, maxInputChars) : text;
  const parsed = await chatJSON({
    host,
    model,
    keepAlive,
    systemPrompt: CURATE_SYSTEM_PROMPT,
    userContent: `QUERY: ${query}\n\nPAGE TEXT:\n${pageText}`,
    jsonSchema: CURATION_JSON_SCHEMA,
    signal,
    timeoutMs
  });
  const validated = CurationSchema.safeParse(parsed);
  if (!validated.success) {
    throw new OllamaUnavailableError(
      `Ollama curation output failed schema validation: ${validated.error.message}`,
      "schema_reject"
    );
  }
  const { relevance, reason, excerpt } = validated.data;
  return {
    relevance,
    reason,
    excerpt,
    // `relevant` is kept as a derived boolean rather than replaced: it is part of the frontmatter
    // of every note already written to RESEARCH/<topic>/sources/ (ADR-0056), so dropping it would
    // change the on-disk schema of a bank that exists. Additive, not a migration.
    relevant: relevance >= DEFAULT_DROP_BELOW,
    truncated
  };
}

// ── Embeddings (ADR-0057 fourth phase) ────────────────────────────────────────────────────
//
// Deliberately narrow scope, matching this pipeline's one hard rule (only the curator rejects a
// page): embeddings here NEVER judge relevance. They are used for two things only — (1) near-dup
// detection across already-fetched sources (a high cosine score between two DIFFERENT pages is
// objective evidence of duplication, not a relevance judgment), and (2) picking which chunks of a
// page too long for `DEFAULT_MAX_INPUT_CHARS` reach the curator, instead of a blind prefix
// truncation that silently loses whatever answer lives in the tail. A separate model from
// curation/expansion on purpose — `/api/embed` needs an embedding-head model, not a chat one.
export const DEFAULT_EMBED_MODEL = process.env.OBSCURA_OLLAMA_EMBED_MODEL || "qwen3-embedding:0.6b";

/**
 * Embed a batch of passages in ONE request (Ollama's `/api/embed` accepts an `input` array and
 * returns embeddings in the same order) — batching, not one call per passage, because a chunked
 * page can easily produce a dozen passages and this runs once per page, not once per crawl.
 *
 * Throws {@link OllamaUnavailableError} on ANY failure, same contract as `curatePage`/
 * `expandQuery`: the caller degrades (skip near-dup/chunk-selection, fall back to the existing
 * truncation) rather than failing the whole research call over an enhancement.
 *
 * @param {{ texts: string[], model?: string, host?: string, keepAlive?: string,
 *           signal?: AbortSignal, timeoutMs?: number }} opts
 * @returns {Promise<number[][]>} one embedding vector per input text, same order
 */
export async function embedPassages({
  texts,
  model = DEFAULT_EMBED_MODEL,
  host = DEFAULT_OLLAMA_HOST,
  keepAlive = DEFAULT_KEEP_ALIVE,
  signal,
  timeoutMs = 30_000
}) {
  const input = (texts ?? []).map((t) => String(t ?? ""));
  if (!input.length) return [];

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort(signal?.reason ?? new Error("aborted"));
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason ?? new Error("aborted"));
    else signal.addEventListener("abort", onExternalAbort, { once: true });
  }
  const timer =
    timeoutMs > 0
      ? setTimeout(() => controller.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
      : null;
  const cleanup = () => {
    if (timer) clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onExternalAbort);
  };

  try {
    const health = await checkOllama({ host, model, signal: controller.signal });
    if (!health.version) {
      throw new OllamaUnavailableError(`Ollama not reachable at ${host}`, "conn_refused");
    }
    if (!health.hasModel) {
      throw new OllamaUnavailableError(
        `Model "${model}" is not pulled on the Ollama host — run: ollama pull ${model}`,
        "model_missing"
      );
    }

    let res;
    try {
      res = await fetch(`${host}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, input, keep_alive: keepAlive }),
        signal: controller.signal
      });
    } catch (e) {
      throw new OllamaUnavailableError(
        `Could not POST /api/embed to ${host}: ${e?.message || e}`,
        controller.signal.aborted ? "timeout" : classifyFetchError(e)
      );
    }

    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 200);
      } catch {
        /* ignore body read failure */
      }
      throw new OllamaUnavailableError(
        `Ollama /api/embed returned HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
        res.status === 404 ? "model_missing" : "http_error"
      );
    }

    let body;
    try {
      body = await res.json();
    } catch (e) {
      throw new OllamaUnavailableError(
        `Ollama returned a non-JSON response: ${e?.message || e}`,
        "bad_json"
      );
    }
    if (controller.signal.aborted) {
      throw new OllamaUnavailableError(`Ollama request timed out after ${timeoutMs}ms`, "timeout");
    }
    const embeddings = Array.isArray(body?.embeddings) ? body.embeddings : null;
    if (!embeddings || embeddings.length !== input.length) {
      throw new OllamaUnavailableError(
        `Ollama /api/embed returned ${embeddings?.length ?? 0} embeddings for ${input.length} inputs`,
        "bad_json"
      );
    }
    return embeddings;
  } finally {
    cleanup();
  }
}

// ── Query-transform cache (expandQuery + translateQuery) ─────────────────────────────────────
//
// Both are LLM calls keyed by the exact input query. A caller that repeats a query — iterating
// `obscura_research` on the same topic (ADR-0057 explicitly expects this: "vary query across
// calls... stop once alreadyCovered stops growing"), or `obscura_search` re-run with the same
// non-English phrasing — re-pays the same model call for an answer that cannot have changed.
// Same bounded Map+TTL+FIFO shape as research.mjs's SEARX_CACHE, one cache shared by both
// functions since they are the same mechanism (a query-string in, a query-string(s) out LLM
// call) rather than two near-duplicate caches. A thrown call is never cached — the `run`
// callback isn't awaited past the point that would populate the entry, so a transient Ollama
// failure is retried next time, not remembered, matching research.mjs's `cachedFetch` contract.
const QUERY_CACHE = new Map();
const QUERY_CACHE_TTL_MS = Number(process.env.OBSCURA_EXPAND_CACHE_TTL_MS) || 600_000;
const QUERY_CACHE_MAX = 300;

function queryCacheKey(kind, query, host, model, max) {
  return `${kind}|${host}|${model}|${max ?? ""}|${String(query).trim().toLowerCase()}`;
}

async function cachedQueryCall(key, run) {
  const hit = QUERY_CACHE.get(key);
  if (hit && Date.now() - hit.at < QUERY_CACHE_TTL_MS) return hit.value;
  const value = await run();
  if (QUERY_CACHE.size >= QUERY_CACHE_MAX) QUERY_CACHE.delete(QUERY_CACHE.keys().next().value);
  QUERY_CACHE.set(key, { at: Date.now(), value });
  return value;
}

/** Drop every cached expansion/translation. Exported for tests and for a caller that knows a
 * query's answer should no longer be treated as fresh. */
export function clearQueryCache() {
  QUERY_CACHE.clear();
}

// ── Query expansion (ADR-0057) ────────────────────────────────────────────────────────────
//
// Every instruction below is a measured finding, not a preference. Probing one real question
// ("how do I stop my agent obeying hidden instructions on a page", whose canonical answer is
// OWASP's LLM01 page) through four phrasings against the live SearXNG:
//
//   phrasing         n    OWASP found at    social-media junk in pool
//   ES colloquial    28   not at all        13   (rank 1 was a Facebook post; rank 4 was a
//                                                 page about disciplining children)
//   EN colloquial    26   not at all         4
//   ES technical     21   not at all         1
//   EN technical     24   rank 4             0
//
// The two axes COMPOSE and neither is sufficient alone — translating without lifting the
// vocabulary still misses, and lifting the vocabulary without translating still misses. That
// is why this prompt insists on both at once, and it is the entire reason this function
// exists: on the golden set's `vocab-mismatch` bucket, every miss is `never crawled`, so no
// amount of reranking downstream can recover a page the engines were never asked for.
//
// This also relocates ADR-0055's diagnosis. That ADR blamed BM25 for discarding pages whose
// vocabulary didn't match the query. Measured, the engines never return them in the first
// place — the failure is a stage earlier than the ADR looked.
const EXPAND_SYSTEM_PROMPT = [
  "You turn ONE research question into web-search queries that surface the authoritative answer.",
  "You are a search strategist, not an answerer: never answer the question, only produce queries.",
  "",
  "Work in two steps, in this order.",
  "",
  "STEP 1 — `concept`: name what the asker is ACTUALLY describing, using the term the field uses.",
  "The asker describes a symptom or a goal in everyday words. Practitioners have a name for it,",
  "and that name is what the documentation is written under. Recover the name.",
  // ── Why there are no few-shot examples here, despite the obvious temptation ───────────────
  // Two drafts had them, and both measured worse than none on a 3.8B:
  //
  //  (a) Examples that happened to BE the golden set's answers ('write lock contention',
  //      'structured output', 'prompt injection') scored a perfect 4/4 — by copying them out
  //      of the prompt. The single query whose answer was NOT in the examples still failed,
  //      which is what gave it away. Never few-shot with anything in evals/research.
  //  (b) Examples from unrelated domains (first contentful paint, CrashLoopBackOff, TLS
  //      validation, lost update anomaly) scored 0/4 AND bled across: a SQLite question came
  //      back expanded as "sqlite crash loop backoff". The examples became a menu to
  //      pattern-match against instead of a demonstration to reason from.
  //
  // The example-free prompt is the best of the three measured (it is the only one that ever
  // recovered SQLITE_BUSY). This is a real property of small models, not a prompt-writing
  // failure — and it caps how far this stage can go on a 3.8B. See docs/adr/0057 for the
  // model bake-off that follows from it.
  "This step is the whole job. Engines match the TERM, not the intent: a query that describes",
  "the symptom returns blog posts and social media, a query that names the concept returns the",
  "documentation.",
  "",
  "BUT: leave `concept` EMPTY unless you are sure. A term you half-remember, or one that merely",
  "sounds like it belongs to the right field, is worse than no term at all — it is a real term",
  "for a DIFFERENT thing, so the engines return real, well-ranked, completely irrelevant pages,",
  "and nothing downstream can tell they are off-topic from the query alone. An empty `concept`",
  "costs breadth; a confidently wrong one poisons the whole search. When unsure, emit `concept`",
  'as "" and write queries from the asker\'s own words instead.',
  "",
  "STEP 2 — `queries`: write search queries built AROUND `concept`.",
  "  - ENGLISH, always. Specs, docs, standards and source code are written in English; a",
  "    non-English query returns translations, blogs and social posts instead of primary sources.",
  "  - KEYWORDS, NOT SENTENCES. 3-8 words. Drop articles, politeness, 'how do I'.",
  "  - The FIRST query must be the bare `concept` plus the specific technology it applies to.",
  "  - The rest must reach pages the first would miss: the artifact's own name (spec, RFC, API,",
  "    error code) if one exists; the practical framing (mitigation, configuration, the literal",
  "    error text). Two queries returning the same page are one wasted query.",
  "  - DO NOT INVENT specifics you were not given: no fabricated version numbers, product names,",
  "    error codes or standard IDs. Vague-but-true beats precise-but-invented, which returns",
  "    nothing at all.",
  "",
  "Respond ONLY with a JSON object matching the requested schema."
].join("\n");

const ExpansionSchema = z.object({
  concept: z.string().optional().default(""),
  queries: z.array(z.string()).default([])
});

const EXPANSION_JSON_SCHEMA = {
  type: "object",
  properties: {
    concept: { type: "string" },
    queries: { type: "array", items: { type: "string" } }
  },
  required: ["concept", "queries"]
};

/**
 * Expand one research question into a set of search queries that reach primary sources.
 *
 * The ORIGINAL query is always kept and always first — the asker may already know the exact
 * term, in which case their wording is the best query there is, and a small local model is not
 * a good enough reason to throw it away. The expansions are added after it, never instead.
 *
 * Costs one local model call per `deepResearch`, not one per page: unlike curation this is a
 * whole-crawl decision, so its latency is amortized across every page fetched.
 *
 * @param {{ query: string, max?: number, model?: string, host?: string, keepAlive?: string,
 *           signal?: AbortSignal, timeoutMs?: number }} opts
 * @returns {Promise<{ concept: string, queries: string[] }>} `queries[0]` is always the original
 * @throws {OllamaUnavailableError} on any failure — the caller degrades to `[original]`
 */
export async function expandQuery({
  query,
  max = 6,
  model = DEFAULT_EXPAND_MODEL,
  host = DEFAULT_OLLAMA_HOST,
  keepAlive = DEFAULT_KEEP_ALIVE,
  signal,
  timeoutMs = 30_000
}) {
  const original = String(query ?? "").trim();
  if (!original) return { concept: "", queries: [] };

  return cachedQueryCall(queryCacheKey("expand", original, host, model, max), async () => {
    const parsed = await chatJSON({
      host,
      model,
      keepAlive,
      systemPrompt: EXPAND_SYSTEM_PROMPT,
      userContent: `QUESTION: ${original}\n\nEmit at most ${max - 1} queries.`,
      jsonSchema: EXPANSION_JSON_SCHEMA,
      signal,
      timeoutMs
    });
    const validated = ExpansionSchema.safeParse(parsed);
    if (!validated.success) {
      throw new OllamaUnavailableError(
        `Ollama expansion output failed schema validation: ${validated.error.message}`,
        "schema_reject"
      );
    }

    // Dedupe case-insensitively against the original and each other: a small model asked for six
    // angles will happily return the same query twice, and each duplicate costs a real SearXNG
    // round-trip (which fans out to ~108 upstream engines) for zero new candidates.
    const seen = new Set([original.toLowerCase()]);
    const queries = [original];
    for (const raw of validated.data.queries) {
      const q = String(raw ?? "").trim();
      if (!q || q.length > 200) continue; // a "query" that long is a sentence the model leaked
      const key = q.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      queries.push(q);
      if (queries.length >= max) break;
    }
    return { concept: String(validated.data.concept ?? "").trim(), queries };
  });
}

// ── Query translation for obscura_search (ADR-0051 amendment 2026-07-22) ────────────────────
//
// `obscura_search` searches the query verbatim. For a non-English asker that measurably loses
// primary sources — specs, docs, standards and source code are written in English, the SAME finding
// EXPAND_SYSTEM_PROMPT above paid for with real measurement. `obscura_research` already fixes this
// via full query expansion (concept-lifting + multi-query fan-out); `obscura_search` is a
// single-shot tool, so it wants only the LIGHT half: translate the one query to English, nothing
// more. Kept deliberately minimal so it costs at most one fast model call — and only when the query
// even looks non-English (see looksNonEnglish), so English searches pay nothing.
const TRANSLATE_SYSTEM_PROMPT = [
  "You translate ONE web-search query into English. Output search KEYWORDS, not a sentence.",
  "Rules:",
  "  - If the query is ALREADY English, return it VERBATIM, unchanged.",
  "  - Otherwise translate it to natural English search keywords.",
  "  - Preserve technical terms, product names, error codes and identifiers EXACTLY — never",
  "    translate or 'correct' them (a SQLITE_BUSY stays SQLITE_BUSY).",
  "  - Never answer the query, never add words that weren't in it, never explain.",
  "Respond ONLY with a JSON object matching the requested schema."
].join("\n");

const TranslateSchema = z.object({ query: z.string() });
const TRANSLATE_JSON_SCHEMA = {
  type: "object",
  properties: { query: { type: "string" } },
  required: ["query"]
};

/** High-precision non-English function words — each is rare in an English technical query, so a hit
 * is strong evidence the query is not English even when it's pure ASCII (accent-less Spanish/
 * Portuguese/Italian/French the non-ASCII check alone would miss). Kept small on purpose: a
 * false POSITIVE here costs one model call that returns the query ~unchanged, a false negative
 * costs a verbatim search — both cheap, so precision matters more than recall. */
const NON_ENGLISH_STOPWORDS = new Set([
  "de",
  "la",
  "el",
  "los",
  "las",
  "que",
  "como",
  "cómo",
  "para",
  "con",
  "por",
  "una",
  "del",
  "en",
  "qué",
  "cuál",
  "cuando",
  "cuándo",
  "donde",
  "dónde",
  "porque",
  "según",
  "más",
  "también",
  "desde",
  "das",
  "dos",
  "não",
  "você",
  "che",
  "per",
  "il",
  "della",
  "les",
  "des",
  "une",
  "est",
  "pour",
  "avec",
  "dans",
  "comment",
  "pourquoi"
]);

/**
 * Cheap gate: does `query` look non-English? True on any non-ASCII letter, or any high-precision
 * non-English function word. False for clean English (or an ASCII noun-only query), so the
 * translation model call is skipped for it. Honestly imperfect: an accent-less, stopword-free
 * non-English query (bare technical nouns) reads as "English" and is searched verbatim — which,
 * being mostly cognate/identifier text, is usually fine anyway.
 * @param {string} query
 * @returns {boolean}
 */
export function looksNonEnglish(query) {
  const q = String(query ?? "");
  // Any non-ASCII code unit (accents, CJK, …): a charCodeAt scan, not a regex — no control-char
  // escape for eslint's no-control-regex to flag, and no literal control bytes in source.
  for (let i = 0; i < q.length; i++) if (q.charCodeAt(i) > 0x7f) return true;
  for (const tok of q.toLowerCase().split(/[^a-z]+/)) {
    if (tok && NON_ENGLISH_STOPWORDS.has(tok)) return true;
  }
  return false;
}

/**
 * Translate ONE search query to English for `obscura_search`. Returns `{ query, translated }` —
 * `translated` is whether the model actually changed it (an already-English query comes back
 * verbatim, `translated:false`). An empty or over-long ("leaked a paragraph") model output degrades
 * to the original, `translated:false`, rather than searching garbage. Throws
 * {@link OllamaUnavailableError} on any transport/model failure — the caller degrades to the
 * original query, exactly the enhancement-not-dependency contract {@link expandQuery} has.
 * @param {{ query: string, model?: string, host?: string, keepAlive?: string,
 *           signal?: AbortSignal, timeoutMs?: number }} opts
 * @returns {Promise<{ query: string, translated: boolean }>}
 */
export async function translateQuery({
  query,
  model = DEFAULT_EXPAND_MODEL,
  host = DEFAULT_OLLAMA_HOST,
  keepAlive = DEFAULT_KEEP_ALIVE,
  signal,
  timeoutMs = 20_000
}) {
  const original = String(query ?? "").trim();
  if (!original) return { query: "", translated: false };

  return cachedQueryCall(queryCacheKey("translate", original, host, model), async () => {
    const parsed = await chatJSON({
      host,
      model,
      keepAlive,
      systemPrompt: TRANSLATE_SYSTEM_PROMPT,
      userContent: `QUERY: ${original}`,
      jsonSchema: TRANSLATE_JSON_SCHEMA,
      signal,
      timeoutMs
    });
    const validated = TranslateSchema.safeParse(parsed);
    if (!validated.success) {
      throw new OllamaUnavailableError(
        `Ollama translation output failed schema validation: ${validated.error.message}`,
        "schema_reject"
      );
    }
    const english = String(validated.data.query ?? "").trim();
    if (!english || english.length > 300) return { query: original, translated: false };
    return { query: english, translated: english.toLowerCase() !== original.toLowerCase() };
  });
}

// ── Lead generation (ADR-0057) ────────────────────────────────────────────────────────────
//
// Zero-shot ON PURPOSE — the exact lesson EXPAND_SYSTEM_PROMPT above already paid for. Two
// earlier drafts of THAT prompt with few-shot examples both measured worse than the
// example-free version on a 3.8B: golden-answer examples get copied out regardless of fit, and
// unrelated-domain examples cross-bleed into the answer. Nothing about proposing leads makes
// that finding not apply, so no examples were added here either. Runs on DEFAULT_EXPAND_MODEL,
// not DEFAULT_MODEL, for the same reason expansion does: proposing NEW search directions the
// session has not tried yet is a recall task, not a reading-comprehension one — the same
// bake-off result as expansion (phi4-mini cannot do this, qwen3.5:4b can).
/** @type {readonly ["subtopic", "related", "analogy", "application"]} */
export const LEAD_KINDS = ["subtopic", "related", "analogy", "application"];

const LEADS_SYSTEM_PROMPT = [
  "You plan the NEXT web searches of an ongoing research session, like a human researcher who",
  "reads what the last round found and decides where to dig next.",
  "You are given the session OBJECTIVE, the queries ALREADY SEARCHED, and compact FINDINGS from",
  "the latest round. Propose the next searches, each typed as exactly one kind:",
  '  - "subtopic": digs deeper into something the findings surfaced.',
  '  - "related": a correlated area the findings point at that the session has not covered yet.',
  '  - "analogy": a technique or pattern from a DIFFERENT field that plausibly transfers to the',
  "    objective.",
  '  - "application": a concrete use, improvement, or feature idea for the objective, worth',
  "    researching.",
  "Rules:",
  "  - ENGLISH keywords, 3-8 words. No sentences, no articles, no 'how do I'.",
  "  - Every lead must plausibly advance the OBJECTIVE. Do not chase findings that drifted",
  "    off-topic.",
  "  - Never repeat or trivially rephrase an ALREADY SEARCHED query.",
  "  - DO NOT INVENT specifics you were not given: no fabricated product names, versions, error",
  "    codes or standard IDs. Vague-but-true beats precise-but-invented.",
  "  - Prefer diversity: at most 2 leads of the same kind.",
  '  - "why": ONE short clause tying the lead to the objective.',
  "Respond ONLY with a JSON object matching the requested schema."
].join("\n");

const LeadsSchema = z.object({
  leads: z
    .array(
      z.object({
        query: z.string(),
        kind: z.enum(LEAD_KINDS),
        why: z.string().optional().default("")
      })
    )
    .default([])
});

const LEADS_JSON_SCHEMA = {
  type: "object",
  properties: {
    leads: {
      type: "array",
      items: {
        type: "object",
        properties: {
          query: { type: "string" },
          kind: { type: "string", enum: LEAD_KINDS },
          why: { type: "string" }
        },
        required: ["query", "kind", "why"]
      }
    }
  },
  required: ["leads"]
};

/** Join formatted bullet lines with "\n", dropping WHOLE lines from the FRONT once the result
 * would exceed `capChars` — keeps the most recently pushed entries. For `done` that keeps the
 * queries just searched (the ones a "don't repeat yourself" prompt needs most) over turn-one
 * history; for `findings` (always a single round, no recency to speak of) it is a harmless
 * plain cap. Always keeps at least one line, even one longer than the whole budget, rather than
 * ever returning empty text for a non-empty input. */
function capLines(lines, capChars) {
  const kept = [];
  let total = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const sep = kept.length ? 1 : 0; // the joining "\n" this line would add
    if (total + sep + lines[i].length > capChars && kept.length > 0) break;
    kept.unshift(lines[i]);
    total += sep + lines[i].length;
  }
  return kept.join("\n");
}

/**
 * Propose the next searches for an ongoing `deepResearch` session (ADR-0057's iterative
 * subtopic/related/analogy/application expansion), reading the latest round's curated findings
 * the same way a human researcher decides where to dig next. An enhancement over the crawl,
 * never a dependency — same contract as {@link expandQuery}: {@link OllamaUnavailableError}
 * degrades to "no new leads this round", not a failed research round.
 *
 * @param {{ objective: string, findings: Array<{ title: string, note: string }>,
 *           done?: string[], max?: number, model?: string, host?: string, keepAlive?: string,
 *           signal?: AbortSignal, timeoutMs?: number }} opts
 * @returns {Promise<{ leads: Array<{ query: string, kind: "subtopic"|"related"|"analogy"|"application", why: string }> }>}
 * @throws {OllamaUnavailableError} on any failure — the caller degrades to zero new leads
 */
export async function generateLeads({
  objective,
  findings,
  done = [],
  max = 5,
  model = DEFAULT_EXPAND_MODEL,
  host = DEFAULT_OLLAMA_HOST,
  keepAlive = DEFAULT_KEEP_ALIVE,
  signal,
  timeoutMs = 30_000
}) {
  const trimmedObjective = String(objective ?? "").trim();
  if (!trimmedObjective) return { leads: [] };

  const doneLines = (done ?? []).map((q) => `- ${String(q ?? "")}`);
  const findingLines = (findings ?? []).map(
    (f) => `- ${String(f?.title ?? "")} — ${String(f?.note ?? "")}`
  );
  const userContent =
    `OBJECTIVE: ${trimmedObjective}\n\n` +
    `ALREADY SEARCHED:\n${capLines(doneLines, 2000)}\n\n` +
    `LATEST FINDINGS:\n${capLines(findingLines, 6000)}\n\n` +
    `Emit at most ${max} leads.`;

  const parsed = await chatJSON({
    host,
    model,
    keepAlive,
    systemPrompt: LEADS_SYSTEM_PROMPT,
    userContent,
    jsonSchema: LEADS_JSON_SCHEMA,
    signal,
    timeoutMs
  });
  const validated = LeadsSchema.safeParse(parsed);
  if (!validated.success) {
    throw new OllamaUnavailableError(
      `Ollama leads output failed schema validation: ${validated.error.message}`,
      "schema_reject"
    );
  }

  // Post-filter, same spirit as expandQuery's dedupe loop above: a small model asked for N
  // leads will happily repeat something already searched, or repeat itself within one batch —
  // each duplicate would cost a real SearXNG round-trip downstream for zero new candidates.
  const doneSet = new Set(
    (done ?? []).map((q) =>
      String(q ?? "")
        .trim()
        .toLowerCase()
    )
  );
  const seen = new Set();
  const leads = [];
  for (const raw of validated.data.leads) {
    const query = String(raw.query ?? "").trim();
    if (!query || query.length > 200) continue; // a "query" that long is a sentence leaked in
    const key = query.toLowerCase();
    if (doneSet.has(key) || seen.has(key)) continue;
    seen.add(key);
    leads.push({ query, kind: raw.kind, why: String(raw.why ?? "").trim() });
    if (leads.length >= max) break;
  }
  return { leads };
}

const SUMMARIZE_SYSTEM_PROMPT = [
  "You are a careful research librarian. You are shown research notes — verbatim excerpts from",
  "web pages — about a TOPIC, and must write (or extend) a synthesized draft summary.",
  "Cite verbatim as much as possible rather than paraphrasing; never invent content that is not",
  "present in the notes. If an EXISTING DRAFT SUMMARY is given, integrate the new notes into it",
  "rather than discarding what it already covers.",
  "Respond ONLY with a JSON object matching the requested schema."
].join("\n");

const SummarySchema = z.object({ summary: z.string() });

const SUMMARY_JSON_SCHEMA = {
  type: "object",
  properties: { summary: { type: "string" } },
  required: ["summary"]
};

/**
 * Draft (or extend) a topic's `summary.md` from its persisted source notes (ADR-0056,
 * `obscura_consolidate` — the "local" half of R7''s dual consolidation; the other half is
 * Claude's own `/vkm-research` skill). One call per map/reduce step — the caller
 * ({@link "./research-persist.mjs"}'s `consolidateTopic`) is responsible for keeping
 * `notesText` under its own `maxInputChars` budget and never splitting a single note across
 * calls; this function just makes the one structured call. Throws
 * {@link OllamaUnavailableError} on ANY failure — unlike {@link curatePage}, there is no
 * heuristic fallback for a synthesized summary (a summary a 3.8B model didn't actually write
 * would be worse than no summary).
 * @param {{ topic: string, notesText: string, priorSummary?: string, model?: string,
 *           host?: string, keepAlive?: string, signal?: AbortSignal, timeoutMs?: number }} opts
 * @returns {Promise<{ summary: string }>}
 */
export async function summarizeNotes({
  topic,
  notesText,
  priorSummary,
  model = DEFAULT_MODEL,
  host = DEFAULT_OLLAMA_HOST,
  keepAlive = DEFAULT_KEEP_ALIVE,
  signal,
  timeoutMs = 60_000
}) {
  const userContent =
    `TOPIC: ${topic}\n\n` +
    (priorSummary
      ? `EXISTING DRAFT SUMMARY (extend/refine, don't discard useful content):\n${priorSummary}\n\n`
      : "") +
    `SOURCE NOTES:\n${notesText}`;
  const parsed = await chatJSON({
    host,
    model,
    keepAlive,
    systemPrompt: SUMMARIZE_SYSTEM_PROMPT,
    userContent,
    jsonSchema: SUMMARY_JSON_SCHEMA,
    signal,
    timeoutMs
  });
  const validated = SummarySchema.safeParse(parsed);
  if (!validated.success) {
    throw new OllamaUnavailableError(
      `Ollama summary output failed schema validation: ${validated.error.message}`,
      "schema_reject"
    );
  }
  return validated.data;
}

/** The winget/user-local install location on Windows (not on PATH in already-open shells);
 * elsewhere we rely on PATH. */
export function localOllamaBinary() {
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    const candidate = path.join(process.env.LOCALAPPDATA, "Programs", "Ollama", "ollama.exe");
    if (existsSync(candidate)) return candidate;
  }
  return "ollama";
}

/**
 * Best-effort on-demand server start — only ever spawns for the DEFAULT localhost host (a
 * custom host is user-managed and never touched). Never throws.
 * @param {{ host?: string, waitMs?: number }} [opts]
 * @returns {Promise<boolean>} true when a server is reachable by the time we return
 */
export async function ensureOllamaServer({ host = DEFAULT_OLLAMA_HOST, waitMs = 8000 } = {}) {
  if (host !== DEFAULT_OLLAMA_HOST) return false;
  if ((await checkOllama({ host })).version) return true;
  let spawnFailed = false;
  try {
    const child = spawn(localOllamaBinary(), ["serve"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: {
        ...process.env,
        OLLAMA_MAX_LOADED_MODELS: process.env.OLLAMA_MAX_LOADED_MODELS || "1",
        OLLAMA_KEEP_ALIVE: DEFAULT_KEEP_ALIVE
      }
    });
    child.on("error", () => {
      spawnFailed = true;
    });
    child.unref();
  } catch {
    return false;
  }
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline && !spawnFailed) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    if ((await checkOllama({ host })).version) return true;
  }
  return false;
}

/** Node's fetch wraps low-level socket errors in `cause`; surface the useful ones. */
function classifyFetchError(e) {
  const code = e?.cause?.code || e?.code;
  if (code === "ECONNREFUSED") return "conn_refused";
  return "network";
}
