import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Read the value following a `--flag` in an argv array, or null if absent.
 * Shared by the initializer entrypoint (index.js) and resolveKitRepoRoot below.
 * @param {string[]} argv
 * @param {string} name
 * @returns {string | null}
 */
export function flagValue(argv, name) {
  const i = argv.indexOf(name);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  return null;
}

// Pinned basic-memory version. Bumping requires:
//   1. update this constant
//   2. update config/mcp/basic-memory.json
//   3. update scripts/mcp-smoke.mjs
//   4. update docs/es/instalacion.md + docs/en/install.md (User Rules) + docs/{es,en}/install-with-agent.md
//   5. mention the bump in CHANGELOG.md (with rationale: CVE? new tool? compat?)
// Rationale for pinning: `uvx <pkg> mcp` without a version pin pulls latest from
// PyPI on every Cursor restart — a supply-chain RCE if the package is taken over.
export const BASIC_MEMORY_VERSION = "0.21.4";

// Default neural embedder for opt-in semantic recall. Multilingual MiniLM so
// non-English vaults (e.g. Spanish) match by meaning, not just English. Needs the
// Python `[semantic]` extra. Used by BOTH the Cursor mcp.json merge and the
// Claude Code `claude mcp add` path so the two configs stay identical.
export const SEMANTIC_EMBEDDER =
  "fastembed:sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2";

function basicMemoryArgs() {
  return ["--from", `basic-memory==${BASIC_MEMORY_VERSION}`, "basic-memory", "mcp"];
}

/**
 * Canonical `basic-memory` stdio server object ({command, args, env}).
 * @param {string} vaultAbs
 */
export function basicMemoryServer(vaultAbs) {
  return { command: "uvx", args: basicMemoryArgs(), env: { BASIC_MEMORY_HOME: vaultAbs } };
}

/**
 * Canonical `obsidian-memory-hybrid` stdio server object. The UTF-8 env vars keep
 * the Python bridge correct on legacy Windows consoles; `semantic` wires the
 * neural embedder. Shared by the Cursor merge and the Claude Code CLI path.
 * @param {string} vaultAbs
 * @param {string} kitRepoAbs
 * @param {{ semantic?: boolean, vec?: boolean }} [opts] - `vec` enables the
 *   sqlite-vec acceleration (ADR-0025) by setting OBSIDIAN_MEMORY_SQLITE_VEC=1;
 *   it is ranking-identical and falls back to brute force if the extension can't
 *   load, so it is safe to wire on by default (the `--full` preset does).
 */
export function hybridServer(vaultAbs, kitRepoAbs, opts = {}) {
  const { hybridJs, pythonSrc } = hybridMcpPathsFromKitRoot(kitRepoAbs);
  /** @type {Record<string, string>} */
  const env = {
    BASIC_MEMORY_HOME: vaultAbs,
    PYTHONPATH: pythonSrc,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8"
  };
  if (opts && opts.semantic) env.OBSIDIAN_MEMORY_EMBEDDER = SEMANTIC_EMBEDDER;
  if (opts && opts.vec) env.OBSIDIAN_MEMORY_SQLITE_VEC = "1";
  return { command: "node", args: [hybridJs], env };
}

/**
 * Build argv for `claude mcp add <name> -s <scope> -e K=V ... -- <command> <args...>`.
 * Claude Code registers MCP through its CLI (not an mcp.json file), so the
 * initializer shells out with this — reusing the same server objects as Cursor.
 * @param {string} name
 * @param {{ command: string, args?: string[], env?: Record<string,string> }} server
 * @param {string} [scope] local | user | project (default `user` = every chat)
 * @returns {string[]}
 */
export function claudeAddArgv(name, server, scope = "user") {
  const argv = ["mcp", "add", name, "-s", scope];
  for (const [k, v] of Object.entries(server.env || {})) argv.push("-e", `${k}=${v}`);
  argv.push("--", server.command, ...(server.args || []));
  return argv;
}

/** Build argv for `claude mcp remove <name> -s <scope>` (makes `add` idempotent). */
export function claudeRemoveArgv(name, scope = "user") {
  return ["mcp", "remove", name, "-s", scope];
}

/**
 * Build argv for `codex mcp add <name> --env K=V ... -- <command> <args...>`.
 * Codex CLI keeps its servers in `~/.codex/config.toml` and manages the TOML
 * merge itself, so the initializer shells out to the CLI rather than editing the
 * file — the same rationale as the Claude Code path (don't hand-merge a config a
 * vendor tool already merges safely). Verified flag form (developers.openai.com/
 * codex/mcp): name is positional after `add`, `--env KEY=VALUE` is repeatable,
 * and the launcher command follows a `--` separator.
 * @param {string} name
 * @param {{ command: string, args?: string[], env?: Record<string,string> }} server
 * @returns {string[]}
 */
export function codexAddArgv(name, server) {
  const argv = ["mcp", "add", name];
  for (const [k, v] of Object.entries(server.env || {})) argv.push("--env", `${k}=${v}`);
  argv.push("--", server.command, ...(server.args || []));
  return argv;
}

/** Build argv for `codex mcp remove <name>` (makes `add` idempotent). */
export function codexRemoveArgv(name) {
  return ["mcp", "remove", name];
}

/** Escape a string for a TOML basic (double-quoted) string. */
function tomlBasicString(s) {
  return `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Render a `[mcp_servers.<name>]` TOML block for Codex's `~/.codex/config.toml`,
 * used as the copy-paste fallback when the `codex` CLI isn't on PATH. Windows
 * paths (backslashes) and quotes in env values are escaped for TOML.
 * @param {string} name
 * @param {{ command: string, args?: string[], env?: Record<string,string> }} server
 * @returns {string}
 */
export function codexTomlBlock(name, server) {
  const lines = [`[mcp_servers.${name}]`, `command = ${tomlBasicString(server.command)}`];
  const args = server.args || [];
  if (args.length) lines.push(`args = [${args.map(tomlBasicString).join(", ")}]`);
  const env = Object.entries(server.env || {});
  if (env.length) {
    lines.push("", `[mcp_servers.${name}.env]`);
    for (const [k, v] of env) lines.push(`${k} = ${tomlBasicString(v)}`);
  }
  return lines.join("\n");
}

/**
 * Merge basic-memory MCP server entry into an existing mcp.json object.
 * @param {unknown} raw - parsed JSON root object
 * @param {string} vaultAbs - absolute vault path for BASIC_MEMORY_HOME
 * @returns {Record<string, unknown>}
 */
export function mergeBasicMemoryServer(raw, vaultAbs) {
  const base =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? /** @type {Record<string, unknown>} */ (JSON.parse(JSON.stringify(raw)))
      : {};
  const servers = base.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    base.mcpServers = {};
  }
  const mcpServers = /** @type {Record<string, unknown>} */ (base.mcpServers);
  mcpServers["basic-memory"] = basicMemoryServer(vaultAbs);
  return base;
}

/**
 * Add `obsidian-memory-hybrid` MCP (Node bridge + Python FTS5) after `basic-memory` is set.
 * @param {Record<string, unknown>} merged - output of mergeBasicMemoryServer (or compatible)
 * @param {string} vaultAbs - absolute vault root
 * @param {string} kitRepoAbs - absolute path to obsidian-memory-kit clone (contains packages/)
 * @param {{ semantic?: boolean, vec?: boolean }} [opts] - semantic:true wires
 *   OBSIDIAN_MEMORY_EMBEDDER=fastembed so vault_hybrid_search ranks by meaning
 *   (needs the Python `[semantic]` extra); vec:true wires OBSIDIAN_MEMORY_SQLITE_VEC=1
 *   for the in-file sqlite-vec acceleration (needs the `[vec]` extra; ADR-0025).
 */
export function mergeObsidianHybridServer(merged, vaultAbs, kitRepoAbs, opts = {}) {
  const base = /** @type {Record<string, unknown>} */ (JSON.parse(JSON.stringify(merged)));
  const servers = base.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    base.mcpServers = {};
  }
  const mcpServers = /** @type {Record<string, unknown>} */ (base.mcpServers);
  mcpServers["obsidian-memory-hybrid"] = hybridServer(vaultAbs, kitRepoAbs, opts);
  return base;
}

/** @param {string} dir */
export function hybridMcpPathsFromKitRoot(dir) {
  const root = path.resolve(dir);
  return {
    root,
    hybridJs: path.join(root, "packages", "obsidian-memory-mcp", "src", "hybrid-mcp.mjs"),
    pythonSrc: path.join(root, "packages", "obsidian-memory-rag", "src")
  };
}

/**
 * Resolve kit repo root: explicit --repo-root, layout next to this package in a monorepo clone, or walk cwd upward.
 * @param {{ cwd: string, argv: string[], pathExists: (p: string) => Promise<boolean> }} opts
 */
export async function resolveKitRepoRoot({ cwd, argv, pathExists }) {
  const explicit = flagValue(argv, "--repo-root");
  if (explicit) {
    return path.resolve(cwd, explicit);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fromPackage = path.resolve(here, "..", "..", "..");
  const hybridFromPackage = path.join(
    fromPackage,
    "packages",
    "obsidian-memory-mcp",
    "src",
    "hybrid-mcp.mjs"
  );
  if (await pathExists(hybridFromPackage)) {
    return fromPackage;
  }
  let cur = path.resolve(cwd);
  for (let i = 0; i < 28; i++) {
    const hybridJs = path.join(cur, "packages", "obsidian-memory-mcp", "src", "hybrid-mcp.mjs");
    if (await pathExists(hybridJs)) {
      return cur;
    }
    const parent = path.dirname(cur);
    if (parent === cur) {
      break;
    }
    cur = parent;
  }
  return null;
}
