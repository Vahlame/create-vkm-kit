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
export const DEFAULT_MODEL = process.env.OBSCURA_OLLAMA_MODEL || "phi4-mini:3.8b-q4_K_M";
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
  let version = null;
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

const CURATE_SYSTEM_PROMPT = [
  "You are a careful research assistant. You are shown ONE web page's text and a research QUERY.",
  "Decide whether the page has information relevant to the query — including information that is",
  "topically related or usefully connected even when it does NOT share the query's exact wording.",
  "Understand the content, don't just keyword-match it.",
  "If relevant: extract the specific passage(s) VERBATIM from the page (do not paraphrase, do not",
  "invent anything not present in the page) that should be kept.",
  "If nothing on the page is relevant to the query: say so plainly.",
  "Respond ONLY with a JSON object matching the requested schema."
].join("\n");

const CurationSchema = z.object({
  relevant: z.boolean(),
  excerpt: z.string().optional().default("")
});

const CURATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    relevant: { type: "boolean" },
    excerpt: { type: "string" }
  },
  required: ["relevant", "excerpt"]
};

/**
 * Curate ONE fetched page against a query via the local model: real understanding instead of
 * keyword overlap. Stateless (one page in, one verdict out — no accumulated context across
 * calls). Throws {@link OllamaUnavailableError} on ANY failure; the caller degrades to the
 * local heuristic extractor.
 * @param {{ markdown: string, query: string, model?: string, host?: string, keepAlive?: string,
 *           maxInputChars?: number, signal?: AbortSignal, timeoutMs?: number }} opts
 * @returns {Promise<{ relevant: boolean, excerpt: string, truncated: boolean }>}
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

    const text = String(markdown ?? "");
    const truncated = text.length > maxInputChars;
    const pageText = truncated ? text.slice(0, maxInputChars) : text;

    let res;
    try {
      res = await fetch(`${host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: CURATE_SYSTEM_PROMPT },
            { role: "user", content: `QUERY: ${query}\n\nPAGE TEXT:\n${pageText}` }
          ],
          format: CURATION_JSON_SCHEMA,
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

    let parsed;
    try {
      parsed = JSON.parse(body?.message?.content ?? "");
    } catch (e) {
      throw new OllamaUnavailableError(
        `Ollama returned non-JSON content: ${e?.message || e}`,
        "bad_json"
      );
    }
    const validated = CurationSchema.safeParse(parsed);
    if (!validated.success) {
      throw new OllamaUnavailableError(
        `Ollama curation output failed schema validation: ${validated.error.message}`,
        "schema_reject"
      );
    }
    return { ...validated.data, truncated };
  } finally {
    cleanup();
  }
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
