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
