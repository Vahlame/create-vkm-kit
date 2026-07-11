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
import { assembleContext, anchorTerms } from "@vkmikc/obsidian-memory-mcp/src/context-assemble.mjs";
import { compileOrchestrationPackage } from "./compile-xml.mjs";
import { defaultSystemRole, thinContextNote, backendErrorNote } from "./prompt-defaults.mjs";
import { draftSpec, ensureOllamaServer, OllamaUnavailableError } from "./ollama-client.mjs";

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
  // Decisions are project-scoped and safe to summarize. Broader passages are NOT folded
  // in: they already travel in the XML's knowledge section, and for a topic the vault
  // barely knows they'd smuggle tangential content into the spec (tier-2 finding: two
  // polysemy passages became a legal-code "current state" for a QR-generator idea).
  const parts = (context?.historicalDecisions ?? []).slice(0, 3).filter(Boolean);
  return truncate(parts.join(" · "), CURRENT_STATE_MAX);
}

/** Compact, LLM-facing serialization of the vault context — bounded, bulleted, no raw dump. */
export function serializeContext(context, { idea, project } = {}) {
  const blocks = [];
  if (context?.historicalDecisions?.length) {
    blocks.push("Decisions:\n" + context.historicalDecisions.map((d) => `- ${d}`).join("\n"));
  }
  // What the LLM is ALLOWED to see differs from what the human sees. The compiled XML
  // always carries every budgeted passage, source-labeled, for the human to review. The
  // 3.8B drafting model, however, demonstrably weaves in whatever it is shown (tier-2
  // campaign: a legal-code passage — matched only through the polysemous word "código" —
  // ended up inside a QR-generator spec despite relevance-first prompt rules). So on
  // UNSCOPED requests only high-confidence passages (≥2 anchor terms of the idea in the
  // passage text) reach the model; project-scoped bundles pass whole, they are already
  // project-filtered. Don't give a filler-model ammunition to hallucinate with.
  let patterns = context?.activePatterns ?? [];
  if (!project && idea && patterns.length) {
    const anchors = anchorTerms(idea);
    const needed = Math.min(2, anchors.length || 1);
    patterns = patterns.filter((p) => {
      const hay = String(p).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      let matches = 0;
      for (const a of anchors) if (hay.includes(a) && ++matches >= needed) return true;
      return false;
    });
  }
  if (patterns.length) {
    blocks.push("Patterns:\n" + patterns.map((p) => `- ${p}`).join("\n"));
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
      // On-demand server start (default-host only — resource policy: no login autostart,
      // one loaded model, short keep_alive). Best-effort: if it can't come up, draftSpec's
      // preflight throws conn_refused and we fall back.
      await ensureOllamaServer({ host: ollamaHost });
      const { spec: drafted } = await draftSpec({
        idea,
        context: serializeContext(context, { idea, project }),
        project,
        lang,
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
