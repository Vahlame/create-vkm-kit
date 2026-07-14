/**
 * Opt-in frontmatter schema validation for vault writes.
 *
 * The vault deliberately has no database schema; what teams actually need is
 * far smaller: "notes in PROJECTS/ must carry title/type/tags frontmatter".
 * That contract lives in a committed vault-root file `memory-schema.json`
 * (user intent — it travels with the vault, NOT the derived sidecar dir):
 *
 *   {
 *     "folders": {
 *       "PROJECTS": { "required": ["title", "type", "tags"] },
 *       "*":        { "required": ["title"] }
 *     },
 *     "enforce": false
 *   }
 *
 * Folder = first path segment of the note ("*" is the fallback for everything
 * without a specific entry, including vault-root notes). `enforce: false`
 * (default) reports violations as warnings on the write result; `true` turns
 * them into a thrown error and the file is not written.
 *
 * Scope is deliberately required-keys-presence ONLY — checked with a line
 * regex, no YAML parser dependency. Typed/enum/format validation is a
 * database's job (ADR-0037); if you need it, you want Postgres, not a
 * markdown vault.
 */
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export const SCHEMA_CONFIG_NAME = "memory-schema.json";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** Per-vault cache keyed on the config file's mtime so hot write paths don't
 * re-parse an unchanged file. */
const cache = new Map();

/**
 * Load (and cache) the vault's schema config. Missing file → null (validation
 * is a no-op). A malformed file also yields null but carries a warning so the
 * writer can surface "your schema config is broken" instead of silently
 * skipping validation.
 * @param {string} vaultAbs
 * @returns {Promise<{config: object|null, warning?: string}>}
 */
export async function loadSchemaConfig(vaultAbs) {
  const fp = join(vaultAbs, SCHEMA_CONFIG_NAME);
  let mtimeMs;
  try {
    mtimeMs = (await stat(fp)).mtimeMs;
  } catch {
    cache.delete(vaultAbs);
    return { config: null };
  }
  const hit = cache.get(vaultAbs);
  if (hit && hit.mtimeMs === mtimeMs) return hit.value;

  let value;
  try {
    const parsed = JSON.parse(await readFile(fp, "utf8"));
    const folders = parsed && typeof parsed.folders === "object" ? parsed.folders : null;
    // Optional extra allowed observation categories for the write-time lint
    // (vault-lint.mjs) — carried through even when frontmatter "folders"
    // validation is not configured.
    const cats = Array.isArray(parsed?.observationCategories) ? parsed.observationCategories : null;
    value =
      folders || cats
        ? {
            config: {
              ...(folders ? { folders } : {}),
              enforce: parsed.enforce === true,
              ...(cats ? { observationCategories: cats } : {})
            }
          }
        : {
            config: null,
            warning: `${SCHEMA_CONFIG_NAME}: no "folders" object or "observationCategories" — ignored`
          };
  } catch (err) {
    value = {
      config: null,
      warning: `${SCHEMA_CONFIG_NAME}: invalid JSON — ignored (${err.message})`
    };
  }
  cache.set(vaultAbs, { mtimeMs, value });
  return value;
}

/**
 * Check a note's frontmatter against the schema config. Returns the missing
 * required keys (empty array = compliant or not covered). Non-markdown paths
 * are never validated.
 * @param {string} relPath vault-relative path, posix or platform separators
 * @param {string} content full note content about to be written
 * @param {{folders: Record<string, {required?: string[]}>}} config
 * @returns {string[]} missing key names
 */
export function validateFrontmatter(relPath, content, config) {
  // A config may carry only observationCategories (for the lint) and no
  // frontmatter rules at all.
  if (!config || !config.folders || !relPath.toLowerCase().endsWith(".md")) return [];
  const norm = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const folder = norm.includes("/") ? norm.split("/", 1)[0] : "";
  const rule = config.folders[folder] ?? config.folders["*"];
  const required = Array.isArray(rule?.required) ? rule.required : [];
  if (required.length === 0) return [];

  const fm = content.match(FRONTMATTER_RE);
  const block = fm ? fm[1] : "";
  const missing = [];
  for (const key of required) {
    // Top-level `key:` line (allows indent-free YAML keys only, by design).
    const re = new RegExp(`^${escapeRe(String(key))}\\s*:`, "m");
    if (!re.test(block)) missing.push(String(key));
  }
  return missing;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Convenience for the write path: validate and translate the outcome into
 * either a thrown error (enforce) or a warnings array to attach to the write
 * result. Also forwards a malformed-config warning.
 * @param {string} vaultAbs
 * @param {string} relPath
 * @param {string} content
 * @returns {Promise<string[]>} warnings (empty when compliant / unconfigured)
 */
export async function checkSchemaForWrite(vaultAbs, relPath, content) {
  const { config, warning } = await loadSchemaConfig(vaultAbs);
  const warnings = warning ? [warning] : [];
  if (!config) return warnings;
  const missing = validateFrontmatter(relPath, content, config);
  if (missing.length === 0) return warnings;
  const msg = `frontmatter missing required key(s): ${missing.join(", ")} (${SCHEMA_CONFIG_NAME})`;
  if (config.enforce) {
    throw new Error(`schema violation: ${msg}`);
  }
  warnings.push(msg);
  return warnings;
}
