/**
 * Write-time hygiene lint for vault writes (ADR pending — "drift dies at the
 * write path").
 *
 * Why: a 2026-07-12 manual hygiene pass on a real vault found three classes of
 * silent drift that no tool prevented at the source — non-canonical
 * observation categories (`[DECISIÓN]`, `[LECCIÓN GENERAL]` — invisible to
 * `vault_observations(category:'decision')`), `[[wikilinks]]` written against
 * targets that never existed, and notes born with zero relations (orphans the
 * graph can't reach). All were cheap to prevent when the text was written and
 * expensive to find months later.
 *
 * Contract: lint inspects ONLY the text being written in this call (full
 * content for a write, the appended chunk, each edit's `newText`) — it never
 * nags about pre-existing lines the caller didn't touch. It returns warnings
 * for the tool result's `warnings` array and NEVER blocks a write; an internal
 * lint failure degrades to "no warnings", not to a failed write.
 */
import { realpath } from "node:fs/promises";
import { loadSchemaConfig } from "./schema-config.mjs";
import { listMarkdownFiles } from "./vault-fs.mjs";

/** Canonical observation categories (lowercase English — the set the doctrine
 * teaches and `vault_observations` filters by). Extend per-vault with
 * `memory-schema.json` → `observationCategories: [...]` (union, not replace). */
export const CANONICAL_CATEGORIES = [
  "fact",
  "decision",
  "gotcha",
  "hypothesis",
  "failure",
  "fix",
  "root_cause",
  "pattern",
  "lesson"
];

/** Known non-canonical spellings → their canonical category. Accent-sensitive
 * on purpose: keys are stored NFC-normalized and lowercased before lookup. */
const CATEGORY_ALIASES = new Map([
  ["decisión", "decision"],
  ["decisiones", "decision"],
  ["regla", "decision"],
  ["lección", "lesson"],
  ["leccion", "lesson"],
  ["lección general", "lesson"],
  ["lecciones", "lesson"],
  ["aprendizaje", "lesson"],
  ["hecho", "fact"],
  ["hechos", "fact"],
  ["fallo", "failure"],
  ["falla", "failure"],
  ["causa raíz", "root_cause"],
  ["causa raiz", "root_cause"]
]);

/** `- [category] …` list items, tolerating the bolded variant `- **[category]`
 * (seen in the wild). GFM task checkboxes (`- [ ]`, `- [x]`) are excluded by
 * the category-shape check below, not by this regex. */
const OBS_RE = /^[ \t]*- (?:\*\*)?\[([^\]\n]{1,60})\]/gm;

/** Category candidates are word-ish: letters (any script), spaces, `_`, `-`.
 * Brackets holding dates, versions or checkboxes are not categories. */
const CATEGORY_SHAPE_RE = /^[\p{L}][\p{L} _-]{0,30}$/u;

const WIKILINK_RE = /\[\[([^\]\n]+?)\]\]/g;

/** Folders where a note is knowledge (vs infra) — a NEW note here with zero
 * [[wikilinks]] is born an orphan, which is exactly how the 18-orphan drift
 * accumulated. */
const KNOWLEDGE_DIRS = ["PROJECTS/", "STACKS/", "PRACTICES/", "RULES/"];

const MAX_WARNINGS = 8;

/**
 * Normalize a wikilink target for resolution: strip alias/heading, extension,
 * slashes and case.
 * @param {string} raw inner text of a [[...]]
 * @returns {string} normalized target ("" when the link is alias-only junk)
 */
function normalizeTarget(raw) {
  const target = raw.split("|")[0].split("#")[0].trim();
  return target
    .replace(/\\/g, "/")
    .replace(/\.md$/i, "")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
}

/**
 * Lint the text being written to `relPath`. See module docstring for the
 * only-what-you-wrote contract.
 * @param {string} vaultAbs
 * @param {string} relPath vault-relative path being written
 * @param {string[]} snippets exactly the text this call introduces
 * @param {{newNote?: boolean}} [opts] newNote: this write CREATES the file
 * @returns {Promise<string[]>} warnings (empty when clean or lint failed)
 */
export async function lintForWrite(vaultAbs, relPath, snippets, opts = {}) {
  if (!relPath.toLowerCase().endsWith(".md")) return [];
  try {
    const warnings = [];
    const text = snippets.filter((s) => typeof s === "string").join("\n");

    // --- Observation categories -----------------------------------------
    const allowed = new Set(CANONICAL_CATEGORIES);
    try {
      const { config } = await loadSchemaConfig(vaultAbs);
      if (Array.isArray(config?.observationCategories)) {
        for (const c of config.observationCategories) {
          if (typeof c === "string" && c.trim()) allowed.add(c.trim().toLowerCase());
        }
      }
    } catch {
      /* schema config problems are reported by checkSchemaForWrite, not here */
    }
    for (const m of text.matchAll(OBS_RE)) {
      const raw = m[1];
      // GFM task checkboxes are list items with brackets, not observations.
      if (raw.trim() === "" || /^[xX]$/.test(raw.trim())) continue;
      if (!CATEGORY_SHAPE_RE.test(raw)) continue; // date, version, …
      const norm = raw.normalize("NFC").toLowerCase().trim();
      if (allowed.has(norm)) {
        if (raw !== norm) {
          warnings.push(
            `observation category "[${raw}]" — write it lowercase as "[${norm}]" so ` +
              `vault_observations(category:'${norm}') finds it`
          );
        }
        continue;
      }
      const alias = CATEGORY_ALIASES.get(norm);
      warnings.push(
        alias
          ? `observation category "[${raw}]" is non-canonical — use "[${alias}]" so ` +
              `vault_observations(category:'${alias}') finds it`
          : `unknown observation category "[${raw}]" — canonical set: ` +
              `${CANONICAL_CATEGORIES.join(", ")} (extend via memory-schema.json ` +
              `"observationCategories" if intentional)`
      );
    }

    // --- Wikilink resolution ---------------------------------------------
    const targets = [];
    for (const m of text.matchAll(WIKILINK_RE)) {
      const raw = m[1];
      // Template placeholders ([[PROJECTS/<proyecto>]]) are deliberate.
      if (raw.includes("<") || raw.includes(">")) continue;
      const norm = normalizeTarget(raw);
      if (norm) targets.push({ raw: raw.split("|")[0].split("#")[0].trim(), norm });
    }
    if (targets.length > 0 || opts.newNote) {
      const vaultReal = await realpath(vaultAbs);
      const names = new Set();
      for (const rel of await listMarkdownFiles(vaultReal)) {
        const noExt = rel.slice(0, -3).toLowerCase();
        names.add(noExt);
        names.add(noExt.split("/").pop());
      }
      // The note being written resolves to itself even before it exists.
      const selfNoExt = relPath.replace(/\\/g, "/").replace(/\.md$/i, "").toLowerCase();
      names.add(selfNoExt);
      names.add(selfNoExt.split("/").pop());
      const reported = new Set();
      for (const { raw, norm } of targets) {
        if (names.has(norm) || names.has(norm.split("/").pop())) continue;
        if (reported.has(norm)) continue;
        reported.add(norm);
        warnings.push(
          `[[${raw}]] does not resolve to any vault note — fix the name or create the note ` +
            `(vault_audit will flag it as a broken link otherwise)`
        );
      }
    }

    // --- Orphan at birth ---------------------------------------------------
    // Placeholder-only links ([[X/<...>]]) do NOT count as connections: a note
    // copied from a template is still unlinked until the placeholder is filled.
    const relFwd = relPath.replace(/\\/g, "/");
    if (
      opts.newNote &&
      KNOWLEDGE_DIRS.some((d) => relFwd.toUpperCase().startsWith(d)) &&
      !relFwd.toUpperCase().includes("TEMPLATE") &&
      targets.length === 0
    ) {
      warnings.push(
        `new note has no [[wikilinks]] — link it (e.g. "- part_of [[...]]" / "- uses [[...]]") ` +
          `so the graph and recall can reach it`
      );
    }

    if (warnings.length > MAX_WARNINGS) {
      const extra = warnings.length - MAX_WARNINGS;
      return [...warnings.slice(0, MAX_WARNINGS), `…and ${extra} more lint warning(s)`];
    }
    return warnings;
  } catch {
    // Hygiene aid, not integrity: a lint crash must never fail or delay a write.
    return [];
  }
}
