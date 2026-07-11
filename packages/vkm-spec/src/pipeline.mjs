/**
 * The deterministic core of vkm-spec: idea + optional project → vault context (via the
 * relocated `assembleContext` retrieval engine) → a spec (deterministic fields, optionally
 * enriched by a local Ollama draft) → the compiled <orchestration_package> XML.
 *
 * HARD INVARIANT (CI-pinned): this ALWAYS returns a working `xml`. If `llm` is on but Ollama
 * is unreachable/slow/wrong, the `draftSpec` failure is caught, the deterministic spec is
 * used instead, and `source: "fallback"` is surfaced — never an exception to the caller.
 * The XML is the same shape either way; only the field CONTENT is richer when Ollama helps.
 */
import { assembleContext } from "@vkmikc/obsidian-memory-mcp/src/context-assemble.mjs";
import { compileOrchestrationPackage } from "./compile-xml.mjs";
import { defaultSystemRole, thinContextNote, backendErrorNote } from "./prompt-defaults.mjs";
import { draftSpec, OllamaUnavailableError } from "./ollama-client.mjs";

const CURRENT_STATE_MAX = 600;

function truncate(text, max) {
  if (!text || text.length <= max) return text || "";
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Distill a `currentStateSummary` (<= 600 chars) from the retrieval buckets for the
 * deterministic path — prefer the raw-note excerpt the engine already produced, else stitch
 * a few decisions/patterns together so the field isn't empty when there IS context.
 */
export function deriveCurrentState(context) {
  if (context?.currentState) return truncate(context.currentState, CURRENT_STATE_MAX);
  const parts = [
    ...(context?.historicalDecisions ?? []).slice(0, 3),
    ...(context?.activePatterns ?? []).slice(0, 2)
  ].filter(Boolean);
  return truncate(parts.join(" · "), CURRENT_STATE_MAX);
}

/** Compact, LLM-facing serialization of the vault context — bounded, bulleted, no raw dump. */
export function serializeContext(context) {
  const blocks = [];
  if (context?.historicalDecisions?.length) {
    blocks.push("Decisions:\n" + context.historicalDecisions.map((d) => `- ${d}`).join("\n"));
  }
  if (context?.activePatterns?.length) {
    blocks.push("Patterns:\n" + context.activePatterns.map((p) => `- ${p}`).join("\n"));
  }
  if (context?.techStack?.length) {
    blocks.push("Tech stack:\n" + context.techStack.map((t) => `- ${t}`).join("\n"));
  }
  if (context?.currentState) {
    blocks.push("Current state:\n" + context.currentState);
  }
  return blocks.join("\n\n");
}

/** The vault-context note for the XML (unchanged from the donor): a backend failure and a
 * legitimately-thin vault get DIFFERENT notes; an Ollama fallback gets none (it's not a
 * vault-context problem — the `source` field carries that signal instead). */
function contextNote(lang, context) {
  if (context.backendError) return backendErrorNote(lang, context.backendError);
  if (context.usedFallback) return thinContextNote(lang);
  return undefined;
}

/**
 * @param {object} opts
 * @param {string} opts.idea
 * @param {string|null} [opts.project]
 * @param {string} [opts.vault] - explicit vault root; defaults to BASIC_MEMORY_HOME/OBSIDIAN_MEMORY_VAULT
 * @param {"es"|"en"} [opts.lang]
 * @param {boolean} [opts.llm] - attempt the Ollama draft pass (default true)
 * @param {number} [opts.budgetChars] - vault-context char budget (default 6000)
 * @param {string} [opts.ollamaHost]
 * @param {string} [opts.model]
 * @param {(tokenCountSoFar: number) => void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{
 *   xml: string,
 *   spec: object,
 *   context: object,
 *   source: "ollama"|"fallback",
 *   backendError: string|null,
 *   ollamaError: string|null
 * }>}
 */
export async function buildSpec({
  idea,
  project = null,
  vault,
  lang = "es",
  llm = true,
  budgetChars = 6000,
  ollamaHost,
  model,
  onProgress,
  signal
} = {}) {
  if (!idea || !String(idea).trim()) {
    throw new Error("buildSpec requires a non-empty `idea`.");
  }

  const context = await assembleContext({
    vault,
    query: idea,
    projectName: project || undefined,
    budgetChars
  });

  // Deterministic spec — the baseline that ALWAYS exists, Ollama or not.
  const fallbackSpec = {
    systemRole: defaultSystemRole(lang, project || null),
    userIntent: idea,
    functionalRequirements: [],
    constraints: [],
    currentStateSummary: deriveCurrentState(context)
  };

  let spec = fallbackSpec;
  let source = "fallback";
  let ollamaError = null;

  if (llm) {
    try {
      const { spec: drafted } = await draftSpec({
        idea,
        context: serializeContext(context),
        host: ollamaHost,
        model,
        onProgress,
        signal
      });
      // The model owns only its slice; the deterministic values stay as the floor.
      spec = { ...fallbackSpec, ...drafted };
      source = "ollama";
    } catch (e) {
      if (e instanceof OllamaUnavailableError) {
        ollamaError = e.reason || e.message;
        // keep the deterministic spec + source "fallback" — the HARD INVARIANT.
      } else {
        throw e; // a genuinely unexpected bug, not a graceful-degradation case
      }
    }
  }

  const xml = compileOrchestrationPackage({
    lang,
    systemRole: spec.systemRole,
    techStack: context.techStack,
    currentState: spec.currentStateSummary || context.currentState || undefined,
    historicalDecisions: context.historicalDecisions,
    activePatterns: context.activePatterns,
    userIntent: spec.userIntent,
    functionalRequirements: spec.functionalRequirements?.length
      ? spec.functionalRequirements
      : undefined,
    constraints: spec.constraints?.length ? spec.constraints : undefined,
    note: contextNote(lang, context)
  });

  return { xml, spec, context, source, backendError: context.backendError, ollamaError };
}
