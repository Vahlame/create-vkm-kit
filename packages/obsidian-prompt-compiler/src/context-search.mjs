/**
 * Pulls vault context for the compiler WITHOUT calling any LLM: typed observations
 * (`json-observations`, already-distilled `[category] content` facts — exactly the
 * "hard facts, not prose" the compiler needs) scoped to the project note when one was
 * resolved, plus a `json-hybrid-search` pass for anything relevant that isn't captured as
 * a typed observation yet (STACKS/, PRACTICES/, related projects). Both calls reuse the
 * same Python bridge the obsidian-memory-hybrid MCP server uses — see
 * @vkmikc/obsidian-memory-mcp/src/rag-client.mjs.
 *
 * Pure retrieval + classification — empty buckets when nothing's found, no fallback text.
 * compile-xml.mjs owns the "No histórico registrado" copy and renders it.
 */
import fs from "node:fs";
import path from "node:path";
import {
  defaultRagSrc,
  requireVault,
  runRagJson
} from "@vkmikc/obsidian-memory-mcp/src/rag-client.mjs";

const HYBRID_LIMIT = 6;
const OBSERVATIONS_LIMIT = 50;
/** Real vault notes are often long, rich prose (no per-line bullets) — a hit's snippet can
 * be several paragraphs. Cap each one so a single match can't dominate the whole package,
 * and so unrelated-but-keyword-matching projects can't bury the project's own context. */
const SNIPPET_CHAR_BUDGET = 320;
/** Cap for the raw-note fallback excerpt — enough to be useful, not enough to be a dump. */
const RAW_NOTE_CHAR_BUDGET = 1200;

function truncate(text, max) {
  if (!text || text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

/** Wraps a runRagJson call so a rejection becomes a tagged result instead of being lost —
 * so a genuinely empty vault and a broken Python backend don't collapse into the same
 * "nothing found" shape (see backendError below). */
async function attempt(promise) {
  try {
    return { ok: true, value: await promise };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * @param {object} opts
 * @param {string} [opts.vault] - defaults to BASIC_MEMORY_HOME/OBSIDIAN_MEMORY_VAULT
 * @param {string} opts.query - the user's free-text idea, used for hybrid search
 * @param {string} [opts.projectNote] - path/name of PROJECTS/<project>.md, if resolved
 * @param {string} [opts.projectName] - bare project name, used to bias the search query
 *   toward notes about THIS project instead of any vault note sharing a keyword
 * @returns {Promise<{
 *   historicalDecisions: string[], activePatterns: string[], techStack: string[],
 *   currentState: string|null, usedFallback: boolean, backendError: string|null
 * }>}
 */
export async function searchContext({ vault, query, projectNote, projectName } = {}) {
  const v = requireVault(vault);
  const ragSrc = defaultRagSrc();
  // Qualify the search with the project name (when known) so ranking favors notes that
  // are actually ABOUT this project, not just any note sharing a generic keyword (e.g.
  // "conexión"/"reconexión" matching an unrelated project's own websocket lessons).
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
          // With a project known, its own note is usually the top hit internally (the
          // query is qualified with its name) — --graph then fuses in notes one
          // [[wikilink]] hop from THAT hit, biasing toward what's actually connected to
          // this project instead of any note sharing a generic technical keyword.
          ...(projectName ? ["--graph"] : [])
        ],
        ragSrc
      )
    ),
    projectNote
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
    attempt(
      runRagJson(["json-observations", "--vault", v, "--tag", "stack", "--limit", "20"], ragSrc)
    )
  ]);

  // A rejected call and a call that legitimately returned nothing must not look the same
  // to the caller — the compiler needs to tell "no history in the vault" apart from
  // "couldn't reach the vault at all" (see backendError on the return value).
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
  // plus broader related passages from hybrid search (STACKS/PRACTICES/sibling projects) —
  // both map to the same knowledge_base_context/active_patterns leaf in the XML schema.
  const otherObservations = projectObs
    .filter((o) => !/decision/i.test(o?.category || ""))
    .map((o) => `[${o.category}] ${o.content}`)
    .filter(Boolean);
  // Exclude the project note itself from the broader search pass — its content is
  // already captured (more precisely) via the typed observations above, so including it
  // again here would just duplicate the same facts as one big raw-text snippet.
  const passages = (Array.isArray(hybridResult?.hits) ? hybridResult.hits : [])
    .filter((h) => h?.path !== projectNote)
    .map((h) => (h?.snippet ? `[${h.path}] ${truncate(h.snippet, SNIPPET_CHAR_BUDGET)}` : ""))
    .filter(Boolean);
  const patterns = [...otherObservations, ...passages];

  const techStack = (
    Array.isArray(stackObservations?.observations) ? stackObservations.observations : []
  )
    .map((o) => o.content)
    .filter(Boolean);

  // Real notes are often rich prose without the formal "- [category] ..." observation
  // syntax — `decisions` comes back empty even though the note is full of decisions in
  // plain text. When that happens, fall back to an excerpt of the note itself (read
  // directly off disk — no Python round-trip needed for a known, trusted path) so the
  // project's most recent context isn't silently dropped just because it isn't tagged yet.
  let currentState = null;
  if (projectNote && decisions.length === 0) {
    try {
      const raw = fs.readFileSync(path.join(v, projectNote), "utf8");
      const body = raw.replace(/^---[\s\S]*?---\s*/, ""); // strip YAML frontmatter, if any
      currentState = truncate(body.trim(), RAW_NOTE_CHAR_BUDGET) || null;
    } catch {
      currentState = null; // note unreadable/missing — leave it to the caller's fallback
    }
  }

  return {
    historicalDecisions: decisions,
    activePatterns: patterns,
    techStack,
    currentState,
    usedFallback: decisions.length === 0 && patterns.length === 0 && !currentState,
    backendError
  };
}
