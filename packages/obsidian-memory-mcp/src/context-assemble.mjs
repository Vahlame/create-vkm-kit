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
import { readFile } from "node:fs/promises";
import { defaultRagSrc, requireVault, runRagJson } from "./rag-client.mjs";
import { safeVaultPath } from "./vault-fs.mjs";
import { wrapUntrusted } from "./untrusted.mjs";

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

/** Light plural stem so "códigos" anchors "código" and vice versa (es/en -s plurals). */
function stem(term) {
  return term.length > 4 && term.endsWith("s") ? term.slice(0, -1) : term;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Word-boundary match so a stemmed term (e.g. "statu" from "status") can't substring-match
 * an unrelated word ("statue") — `s?` re-admits the plural the stem() call above removed. */
function anchorMatches(haystack, anchor) {
  return new RegExp(`\\b${escapeRegExp(anchor)}s?\\b`).test(haystack);
}

/**
 * Anchor terms of a query: the distinctive words a relevant hit should actually contain.
 * Prefers terms ≥6 chars (common short words like "texto"/"tool" anchor nothing); falls
 * back to ≥4, then — for a fully short/vague query ("fix bug") — to every raw term, so the
 * relevance gate below never sees an empty anchor list and silently admits everything.
 * Plural-stemmed and deduped.
 * @param {string} query
 * @returns {string[]}
 */
export function anchorTerms(query) {
  const terms = [...new Set(fold(query).split(/[^\p{L}\p{N}_-]+/u))].filter(Boolean);
  const strong = terms.filter((t) => t.length >= 6);
  const medium = strong.length ? strong : terms.filter((t) => t.length >= 4);
  const chosen = medium.length ? medium : terms;
  return [...new Set(chosen.map(stem))];
}

/**
 * True when the hit is plausibly relevant. Measured on the real vault (tier-1 campaign,
 * 22 scenarios), the reliable signals are:
 *  - TWO anchors landing in the same passage (shared vocabulary is real, not coincidence);
 *  - or ONE anchor CORROBORATED by a retrieval channel: the hit ranked in the lexical
 *    BM25 channel at all, or in the semantic channel's top 3. A lone generic word on a
 *    deep vector-only hit ("generador" matching an icon-design lesson for a QR query) is
 *    exactly the noise this gate exists to kill — while a top-ranked hit with one anchor
 *    ("taller" for a bike-shop query, bm25 #1) is the recall we must NOT lose.
 * Requires `--explain` ranks on the hits; when absent (defensive), corroboration falls
 * back to anchors only.
 * @param {{ path?: string, heading?: string, snippet?: string,
 *           bm25_rank?: number|null, vector_rank?: number|null }} hit
 * @param {string[]} anchors
 */
export function hitMatchesAnchors(hit, anchors) {
  if (!anchors.length) return true; // empty query — genuinely nothing to anchor on
  const haystack = fold(`${hit?.path ?? ""} ${hit?.heading ?? ""} ${hit?.snippet ?? ""}`);
  let matches = 0;
  for (const a of anchors) {
    if (anchorMatches(haystack, a)) matches += 1;
  }
  if (matches >= Math.min(2, anchors.length)) return true;
  if (matches >= 1) {
    const bm25 = hit?.bm25_rank;
    const vec = hit?.vector_rank;
    const vecTop = typeof vec === "number" && vec <= 3;
    // Without a project, BM25 presence is tautological for a single matched word (the
    // word IS in the text) — only the semantic channel counts as independent
    // corroboration. With a project, the query is already project-qualified, so the
    // looser bar buys recall where it's safe.
    return hit?._scoped ? (bm25 !== null && bm25 !== undefined) || vecTop : vecTop;
  }
  return false;
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
 * @param {boolean} [opts.includeResearch] - include RESEARCH/** passages (default false,
 *   i.e. the hybrid-search pass is scoped to section:"memory" — spec vkm-research R4)
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
  includeObservations = true,
  includeResearch = false
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
          // Ranks feed the relevance gate (hitMatchesAnchors) — they never reach the
          // consumer, so the extra diagnostic fields cost zero wire tokens downstream.
          "--explain",
          // With a project known, --graph fuses in notes one [[wikilink]] hop from the
          // top hits, biasing toward what's actually connected to this project.
          ...(projectName ? ["--graph"] : []),
          // Default excludes RESEARCH/** from the broader passage pass (R4): web
          // research is curated-but-unverified data, and mixing it unasked into a
          // spec/decision context is exactly the contamination R4 exists to prevent.
          ...(includeResearch ? [] : ["--section", "memory"])
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
    .filter((h) => hitMatchesAnchors({ ...h, _scoped: Boolean(projectName) }, anchors))
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
      const fp = await safeVaultPath(v, projectNote); // throws if projectNote escapes the vault
      const raw = await readFile(fp, "utf8");
      const body = raw.replace(/^---[\s\S]*?---\s*/, ""); // strip YAML frontmatter, if any
      const excerpt = truncate(body.trim(), RAW_NOTE_CHAR_BUDGET);
      currentState = excerpt ? wrapUntrusted(excerpt, projectNote) : null;
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
