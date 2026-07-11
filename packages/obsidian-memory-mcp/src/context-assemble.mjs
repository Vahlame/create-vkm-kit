/**
 * Single-call context assembly for a task (ADR-0045) — the engine behind the
 * `assemble_context` MCP tool. Relocated from the prompt-compiler's `context-search.mjs`
 * (which becomes a re-export shim until the package is absorbed into vkm-spec): typed
 * observations scoped to the project note (`json-observations` — already-distilled
 * `[category] content` facts) plus a `json-hybrid-search` pass for relevant passages that
 * aren't captured as typed observations yet (STACKS/, PRACTICES/, related projects). Both
 * calls run in PARALLEL over the same Python bridge, so one `assemble_context` round-trip
 * replaces the 3-6 discrete tool calls an agent would otherwise chain (search → read →
 * observations → …) — that round-trip saving is the tool's whole reason to exist, and the
 * `bench-assemble` CI gate keeps it honest.
 *
 * Pure retrieval + classification — empty buckets when nothing's found; a rejected bridge
 * call and a legitimately-empty vault never collapse into the same shape (`backendError`).
 * A `budgetChars` cap trims the assembled payload passages-first (decisions are the last
 * thing to go) so the wire cost stays bounded no matter how big the vault is.
 */
import fs from "node:fs";
import path from "node:path";
import { defaultRagSrc, requireVault, runRagJson } from "./rag-client.mjs";

const HYBRID_LIMIT = 6;
const OBSERVATIONS_LIMIT = 50;
/** Real vault notes are often long, rich prose — cap each snippet so a single match can't
 * dominate the whole package. */
const SNIPPET_CHAR_BUDGET = 320;
/** Cap for the raw-note fallback excerpt — enough to be useful, not a dump. */
const RAW_NOTE_CHAR_BUDGET = 1200;
export const DEFAULT_BUDGET_CHARS = 6000;

function truncate(text, max) {
  if (!text || text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

/** Accent-insensitive lowercase fold (es/en vaults mix both). */
function fold(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Anchor terms of a query: the distinctive words a relevant hit should actually contain.
 * Prefers terms ≥6 chars (common short words like "texto"/"tool" anchor nothing); falls
 * back to ≥4 when the query has no long terms at all.
 * @param {string} query
 * @returns {string[]}
 */
export function anchorTerms(query) {
  const terms = [...new Set(fold(query).split(/[^\p{L}\p{N}_-]+/u))].filter(Boolean);
  const strong = terms.filter((t) => t.length >= 6);
  return strong.length ? strong : terms.filter((t) => t.length >= 4);
}

/** True when any anchor appears in the hit's path, heading or snippet (folded). */
export function hitMatchesAnchors(hit, anchors) {
  if (!anchors.length) return true; // nothing to anchor on → don't drop
  const haystack = fold(`${hit?.path ?? ""} ${hit?.heading ?? ""} ${hit?.snippet ?? ""}`);
  return anchors.some((a) => haystack.includes(a));
}

/** Wraps a runRagJson call so a rejection becomes a tagged result instead of being lost. */
async function attempt(promise) {
  try {
    return { ok: true, value: await promise };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * Trim the assembled buckets to `budgetChars` total content chars. Priority order (first
 * to be dropped → last): broader passages, non-decision observations, tech stack,
 * decisions, currentState. Within a bucket, later entries drop first (they ranked lower).
 * @param {{ historicalDecisions: string[], activePatterns: string[], techStack: string[],
 *   currentState: string | null }} ctx
 * @param {number} budgetChars
 */
export function applyBudget(ctx, budgetChars) {
  const size = () =>
    ctx.historicalDecisions.join("").length +
    ctx.activePatterns.join("").length +
    ctx.techStack.join("").length +
    (ctx.currentState?.length ?? 0);
  const buckets = ["activePatterns", "techStack", "historicalDecisions"];
  for (const bucket of buckets) {
    while (size() > budgetChars && ctx[bucket].length > 0) {
      ctx[bucket].pop();
    }
    if (size() <= budgetChars) return ctx;
  }
  if (size() > budgetChars && ctx.currentState) {
    const others = size() - ctx.currentState.length;
    ctx.currentState = truncate(ctx.currentState, Math.max(0, budgetChars - others)) || null;
  }
  return ctx;
}

/**
 * @param {object} opts
 * @param {string} [opts.vault] - defaults to BASIC_MEMORY_HOME/OBSIDIAN_MEMORY_VAULT
 * @param {string} opts.query - the task/idea, used for hybrid search
 * @param {string} [opts.projectName] - bare project name; scopes observations to
 *   PROJECTS/<name>.md and biases the search toward notes about THIS project
 * @param {number} [opts.budgetChars] - total content-char cap (default 6000)
 * @param {boolean} [opts.includeObservations] - skip the typed-observation passes (default true)
 * @returns {Promise<{
 *   historicalDecisions: string[], activePatterns: string[], techStack: string[],
 *   currentState: string|null, usedFallback: boolean, backendError: string|null
 * }>}
 */
export async function assembleContext({
  vault,
  query,
  projectName,
  budgetChars = DEFAULT_BUDGET_CHARS,
  includeObservations = true
} = {}) {
  const v = requireVault(vault);
  const ragSrc = defaultRagSrc();
  const projectNote = projectName ? `PROJECTS/${projectName}.md` : undefined;
  // Qualify the search with the project name (when known) so ranking favors notes that
  // are actually ABOUT this project, not just any note sharing a generic keyword.
  const searchQuery = projectName ? `${projectName} ${query}` : query;

  const [hybridAttempt, projectAttempt, stackAttempt] = await Promise.all([
    attempt(
      runRagJson(
        [
          "json-hybrid-search",
          "--vault",
          v,
          "--query",
          searchQuery,
          "--limit",
          String(HYBRID_LIMIT),
          // With a project known, --graph fuses in notes one [[wikilink]] hop from the
          // top hits, biasing toward what's actually connected to this project.
          ...(projectName ? ["--graph"] : [])
        ],
        ragSrc
      )
    ),
    projectNote && includeObservations
      ? attempt(
          runRagJson(
            [
              "json-observations",
              "--vault",
              v,
              "--note",
              projectNote,
              "--limit",
              String(OBSERVATIONS_LIMIT)
            ],
            ragSrc
          )
        )
      : Promise.resolve({ ok: true, value: { observations: [] } }),
    // The #stack pass is vault-GLOBAL (facts from every project), so it only runs when a
    // project scopes the request. Without one, importing another project's stack into the
    // bundle actively misleads the consumer (real-world failure: "Web3Forms" from an
    // unrelated web project landed in a text-encryptor spec and steered the LLM to assume
    // a web platform). No project → no stack claims.
    projectName && includeObservations
      ? attempt(
          runRagJson(["json-observations", "--vault", v, "--tag", "stack", "--limit", "20"], ragSrc)
        )
      : Promise.resolve({ ok: true, value: { observations: [] } })
  ]);

  const hybridResult = hybridAttempt.ok ? hybridAttempt.value : { hits: [] };
  const projectObservations = projectAttempt.ok ? projectAttempt.value : { observations: [] };
  const stackObservations = stackAttempt.ok ? stackAttempt.value : { observations: [] };
  const backendError =
    [hybridAttempt, projectAttempt, stackAttempt]
      .map((a) => (a.ok ? null : a.error))
      .find(Boolean) || null;

  const projectObs = Array.isArray(projectObservations?.observations)
    ? projectObservations.observations
    : [];
  const decisions = projectObs
    .filter((o) => /decision/i.test(o?.category || ""))
    .map((o) => o.content)
    .filter(Boolean);

  // "Active patterns" = everything else: non-decision observations on the project note,
  // plus broader related passages from hybrid search (STACKS/PRACTICES/sibling projects).
  const otherObservations = projectObs
    .filter((o) => !/decision/i.test(o?.category || ""))
    .map((o) => `[${o.category}] ${o.content}`)
    .filter(Boolean);
  // Exclude the project note itself from the broader pass — its content is already
  // captured (more precisely) via the typed observations above. Relevance gate: ranked
  // search ALWAYS returns something, even for a query the vault knows nothing about, and
  // RRF scores measure rank, not match quality — so gating is LEXICAL: a hit must contain
  // at least one anchor term of the (project-qualified) query, or it's noise dressed as
  // context and gets dropped. An empty bundle is honest; a padded one misled a real spec
  // into importing an unrelated project's stack (Web3Forms into a text encryptor).
  const anchors = anchorTerms(searchQuery);
  const passages = (Array.isArray(hybridResult?.hits) ? hybridResult.hits : [])
    .filter((h) => h?.path !== projectNote)
    .filter((h) => hitMatchesAnchors(h, anchors))
    .map((h) => (h?.snippet ? `[${h.path}] ${truncate(h.snippet, SNIPPET_CHAR_BUDGET)}` : ""))
    .filter(Boolean);
  const patterns = [...otherObservations, ...passages];

  const techStack = (
    Array.isArray(stackObservations?.observations) ? stackObservations.observations : []
  )
    .map((o) => o.content)
    .filter(Boolean);

  // Real notes are often rich prose without the formal observation syntax — when the
  // project yields zero tagged decisions, fall back to an excerpt of the note itself so
  // its most recent context isn't silently dropped just because it isn't tagged yet.
  let currentState = null;
  if (projectNote && decisions.length === 0) {
    try {
      const raw = fs.readFileSync(path.join(v, projectNote), "utf8");
      const body = raw.replace(/^---[\s\S]*?---\s*/, ""); // strip YAML frontmatter, if any
      currentState = truncate(body.trim(), RAW_NOTE_CHAR_BUDGET) || null;
    } catch {
      currentState = null;
    }
  }

  const ctx = applyBudget(
    { historicalDecisions: decisions, activePatterns: patterns, techStack, currentState },
    Math.max(500, budgetChars)
  );
  return {
    ...ctx,
    usedFallback:
      ctx.historicalDecisions.length === 0 && ctx.activePatterns.length === 0 && !ctx.currentState,
    backendError
  };
}
