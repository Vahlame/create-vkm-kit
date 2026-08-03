import path from "node:path";
import { hookInterpreter } from "./hook-interpreter.mjs";
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
//   3. update docs/es/instalacion.md + docs/en/install.md (User Rules) + docs/{es,en}/install-with-agent.md
//   4. mention the bump in CHANGELOG.md (with rationale: CVE? new tool? compat?)
// scripts/mcp-smoke.mjs imports this constant, so the CI smoke test always
// exercises whatever is pinned here — it is not a step to remember.
// Rationale for pinning: `uvx <pkg> mcp` without a version pin pulls latest from
// PyPI on every Cursor restart — a supply-chain RCE if the package is taken over.
export const BASIC_MEMORY_VERSION = "0.21.4";

// Default neural embedder for opt-in semantic recall. Multilingual MiniLM so
// non-English vaults (e.g. Spanish) match by meaning, not just English. Needs the
// Python `[semantic]` extra. Used by BOTH the Cursor mcp.json merge and the
// Claude Code `claude mcp add` path so the two configs stay identical.
export const SEMANTIC_EMBEDDER =
  "fastembed:sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2";

/**
 * Rewrite a server's `{command, args}` to start through `vkm-runhidden.exe`.
 *
 * # Why the MCP SERVERS need this, not just the hooks
 *
 * ADR-0078 routed hook entries through the launcher and stopped there. But an MCP server
 * is a long-lived process the agent host starts the same way it starts a hook — from a
 * `command` string in a config file — and every one of ours is console-subsystem:
 * `node` for the three Node sidecars, `uvx` (Python) for basic-memory. Whichever way the
 * host spawns them, the user loses:
 *
 *   - host does NOT pass CREATE_NO_WINDOW  -> each server gets a real console window at
 *     session start, appearing and taking the foreground.
 *   - host DOES pass CREATE_NO_WINDOW      -> each server has NO console, so every child
 *     it later spawns — the Python RAG backend on every vault search, one obscura process
 *     per fetched page during research — is handed a brand new VISIBLE one by Windows.
 *
 * The second case is the nastier one, because it is not fixable downstream: a child cannot
 * inherit a console its parent does not have. Fixing the registration fixes both ends at
 * once — the server itself is windowless, and it owns a hidden console for its whole tree.
 *
 * Same contract and same caveat as {@link hookInterpreter}: the value is written into a
 * config file as an ABSOLUTE path, so it is only ever used after `installRunHidden` has
 * put the launcher there in this same run. Off Windows, or with the launcher genuinely
 * absent (a source checkout with no Go), the server object is returned untouched and
 * everything behaves identically — it just flashes like it used to.
 *
 * `launcher` is an explicit INPUT rather than something this function probes for. These
 * builders describe a config file's contents and must be pure: a version that called
 * `hookInterpreter()` itself produced a different server object depending on whether the
 * machine running it happened to have `~/.claude/bin/vkm-runhidden.exe` — which made the
 * output untestable and the decision invisible at the call site. `resolveLauncher()`
 * makes that probe once, where the install actually happens.
 *
 * @template {{ command: string, args?: string[] }} T
 * @param {T} server
 * @param {string|null|undefined} launcher absolute path, or null for "start it directly"
 * @returns {T} the same shape, started through the launcher when one was given
 */
function viaRunHidden(server, launcher) {
  if (!launcher) return server;
  return { ...server, command: launcher, args: [server.command, ...(server.args ?? [])] };
}

/**
 * The launcher to register servers through on this machine, or null when there is none
 * to use (off Windows, or a checkout that never built it). Call it ONCE per install and
 * thread the result — see {@link viaRunHidden} for why the builders do not probe.
 *
 * `claudeDir` exists so the answer follows the home being INSTALLED INTO rather than the
 * home of whoever is running the installer. Omitting it kept the probe pinned to
 * `os.homedir()`, which is why no test with a temp home could ever observe this decision —
 * and an install that resolved the launcher before putting it on disk shipped silently.
 *
 * @param {string} [claudeDir] the `.claude` directory of the install (default: this user's)
 * @returns {string|null}
 */
export function resolveLauncher(claudeDir) {
  const interpreter = claudeDir ? hookInterpreter(claudeDir) : hookInterpreter();
  return interpreter === "node" ? null : interpreter;
}

function basicMemoryArgs() {
  return ["--from", `basic-memory==${BASIC_MEMORY_VERSION}`, "basic-memory", "mcp"];
}

/**
 * Canonical `basic-memory` stdio server object ({command, args, env}).
 * @param {string} vaultAbs
 * @param {{ launcher?: string|null }} [opts] - `launcher` starts the server through
 *   `vkm-runhidden.exe` so it (and everything it spawns) stays windowless; see
 *   {@link viaRunHidden}. Omitted = started directly, the pre-5.0 behaviour.
 */
export function basicMemoryServer(vaultAbs, opts = {}) {
  return viaRunHidden(
    { command: "uvx", args: basicMemoryArgs(), env: { BASIC_MEMORY_HOME: vaultAbs } },
    opts.launcher
  );
}

/**
 * Canonical `obsidian-memory-hybrid` stdio server object. The UTF-8 env vars keep
 * the Python bridge correct on legacy Windows consoles; `semantic` wires the
 * neural embedder. Shared by the Cursor merge and the Claude Code CLI path.
 * @param {string} vaultAbs
 * @param {string} kitRepoAbs
 * @param {{ semantic?: boolean, vec?: boolean, rerank?: boolean, pinFailures?: boolean,
 *   usage?: boolean, postgres?: boolean, pgDsn?: string|null, launcher?: string|null }} [opts] -
 *   `launcher` starts the server through
 *   `vkm-runhidden.exe` (see {@link viaRunHidden}); the rest: `vec`
 *   enables the sqlite-vec acceleration (ADR-0025) via OBSIDIAN_MEMORY_SQLITE_VEC=1
 *   (ranking-identical, safe fallback, on under `--full`). `rerank` turns on the
 *   cross-encoder reranker (ADR-0026) via OBSIDIAN_MEMORY_RERANK=1 — opt-in only
 *   (needs the `[rerank]` extra and downloads a model on first use; uses the
 *   multilingual default model), so it is NOT enabled by `--full`. `pinFailures`
 *   wires OBSIDIAN_MEMORY_PIN_FAILURES=1 (resurface recorded lessons on matching
 *   tasks) and `usage` wires OBSIDIAN_MEMORY_USAGE_BOOST=1 (boost notes the agent
 *   demonstrably used) — the ADR-0038 retrieval levers, part of the default stack.
 *   `postgres` wires VKM_PG=1 (the vkm-memory-pg Postgres projection layer) and
 *   `pgDsn` wires VKM_PG_DSN (front an EXTERNAL Postgres server instead of the
 *   embedded PGlite datadir). Falsy values never write a key — an absent toggle
 *   must leave no trace in the user's config.
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
  if (opts && opts.rerank) env.OBSIDIAN_MEMORY_RERANK = "1";
  if (opts && opts.pinFailures) env.OBSIDIAN_MEMORY_PIN_FAILURES = "1";
  if (opts && opts.usage) env.OBSIDIAN_MEMORY_USAGE_BOOST = "1";
  if (opts && opts.postgres) env.VKM_PG = "1";
  if (opts && opts.pgDsn) env.VKM_PG_DSN = opts.pgDsn;
  return viaRunHidden({ command: "node", args: [hybridJs], env }, opts.launcher);
}

/**
 * Canonical `obscura-web` stdio server object ({command, args, env}) — the MCP that exposes
 * obscura_fetch / obscura_search / obscura_research, backed by the local obscura headless
 * browser (ADR-0051) and, for research persistence + consolidation (ADR-0056), the vault's
 * `RESEARCH/` section. Shared by the Cursor merge and the Claude Code / Codex CLI paths.
 * @param {string} kitRepoAbs absolute path to the kit clone (contains packages/)
 * @param {{ binPath?: string|null, searxngUrl?: string|null, researchDir?: string|null,
 *   launcher?: string|null }} [opts] - `launcher` starts the server through
 *   `vkm-runhidden.exe` (see {@link viaRunHidden}). `binPath` wires
 *   OBSCURA_BIN (the installer's ~/.vkm/obscura binary); when null, obscura-web uses
 *   `obscura` on PATH. `searxngUrl` wires OBSCURA_SEARXNG_URL for the structured search layer.
 *   `researchDir` wires OBSCURA_RESEARCH_DIR (root for `obscura_research({persist:true})` and
 *   `obscura_consolidate`); the installer defaults it to `<vault>/RESEARCH`, overridable via
 *   `--obscura-research-dir`.
 */
export function obscuraWebServer(kitRepoAbs, opts = {}) {
  const { obscuraMcpJs } = obscuraWebMcpPathsFromKitRoot(kitRepoAbs);
  /** @type {Record<string, string>} */
  const env = {};
  if (opts && opts.binPath) env.OBSCURA_BIN = opts.binPath;
  if (opts && opts.searxngUrl) env.OBSCURA_SEARXNG_URL = opts.searxngUrl;
  if (opts && opts.researchDir) env.OBSCURA_RESEARCH_DIR = opts.researchDir;
  return viaRunHidden({ command: "node", args: [obscuraMcpJs], env }, opts.launcher);
}

/**
 * Canonical `vkm-downloads` stdio server object ({command, args, env}) — the MCP that exposes
 * download_resolve / download_file, a guarded file-download manager (ADR-0058). Deliberately a
 * SEPARATE package/flag from obscura-web: this one writes bytes to the user's disk, a different
 * risk surface, so opting into stealth web READS (--obscura) must not silently grant disk WRITES.
 * Shared by the Cursor merge and the Claude Code / Codex CLI paths.
 * @param {string} kitRepoAbs absolute path to the kit clone (contains packages/)
 * @param {{ downloadDir?: string|null, maxBytes?: number|null, launcher?: string|null }} [opts] -
 *   `launcher` starts the server through `vkm-runhidden.exe` (see {@link viaRunHidden}).
 *   `downloadDir` wires
 *   VKM_DOWNLOAD_DIR (default, when unset, is ~/Downloads/vkm-kit inside the server); `maxBytes`
 *   wires VKM_DOWNLOAD_MAX_BYTES (default 500MB).
 */
export function downloadsServer(kitRepoAbs, opts = {}) {
  const { downloadsMcpJs } = downloadsMcpPathsFromKitRoot(kitRepoAbs);
  /** @type {Record<string, string>} */
  const env = {};
  if (opts && opts.downloadDir) env.VKM_DOWNLOAD_DIR = opts.downloadDir;
  if (opts && opts.maxBytes) env.VKM_DOWNLOAD_MAX_BYTES = String(opts.maxBytes);
  return viaRunHidden({ command: "node", args: [downloadsMcpJs], env }, opts.launcher);
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
 * Return a deep copy of an mcp.json-shaped object with `name` set to `server`.
 *
 * The four `merge*Server` helpers below were this exact function written out four
 * times — clone through JSON, re-create `mcpServers` unless it is a real object,
 * assign one key — differing only in the id and which factory produced the value.
 *
 * Copying rather than mutating is deliberate: the caller's `parsed` is the user's
 * own `~/.cursor/mcp.json`, and a merge that failed half-way must not leave it
 * partly rewritten in memory before the atomic write.
 *
 * @param {unknown} raw an mcp.json-shaped object (anything else starts from empty)
 * @param {string} name the server id — a FROZEN contract, see buildServerList
 * @param {object} server the server object to install under it
 * @returns {Record<string, unknown>}
 */
function withServer(raw, name, server) {
  const base =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? /** @type {Record<string, unknown>} */ (JSON.parse(JSON.stringify(raw)))
      : {};
  const servers = base.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    base.mcpServers = {};
  }
  /** @type {Record<string, unknown>} */ (base.mcpServers)[name] = server;
  return base;
}

/**
 * Set `basic-memory` — the one required server — in an mcp.json-shaped object.
 * @param {unknown} raw
 * @param {string} vaultAbs absolute vault root
 * @param {{ launcher?: string|null }} [opts] see {@link basicMemoryServer}
 * @returns {Record<string, unknown>}
 */
export function mergeBasicMemoryServer(raw, vaultAbs, opts = {}) {
  return withServer(raw, "basic-memory", basicMemoryServer(vaultAbs, opts));
}

/**
 * Add `obsidian-memory-hybrid` (Node bridge + Python FTS5) after `basic-memory` is set.
 * @param {Record<string, unknown>} merged output of mergeBasicMemoryServer (or compatible)
 * @param {string} vaultAbs absolute vault root
 * @param {string} kitRepoAbs absolute path to the kit clone (contains packages/)
 * @param {{ semantic?: boolean, vec?: boolean, rerank?: boolean, pinFailures?: boolean,
 *   usage?: boolean, postgres?: boolean, pgDsn?: string|null, launcher?: string|null }} [opts]
 *   passed straight to {@link hybridServer} — see its JSDoc for the full mapping.
 * @returns {Record<string, unknown>}
 */
export function mergeObsidianHybridServer(merged, vaultAbs, kitRepoAbs, opts = {}) {
  return withServer(merged, "obsidian-memory-hybrid", hybridServer(vaultAbs, kitRepoAbs, opts));
}

/**
 * Add `obscura-web` (stealth fetch + robust search via the local obscura browser).
 * @param {Record<string, unknown>} merged output of a prior merge (or compatible)
 * @param {string} kitRepoAbs absolute path to the kit clone
 * @param {{ binPath?: string|null, searxngUrl?: string|null, researchDir?: string|null,
 *   launcher?: string|null }} [opts] passed to {@link obscuraWebServer}
 * @returns {Record<string, unknown>}
 */
export function mergeObscuraWebServer(merged, kitRepoAbs, opts = {}) {
  return withServer(merged, "obscura-web", obscuraWebServer(path.resolve(kitRepoAbs), opts));
}

/**
 * Add `vkm-downloads` (guarded file-download manager, ADR-0058).
 * @param {Record<string, unknown>} merged output of a prior merge (or compatible)
 * @param {string} kitRepoAbs absolute path to the kit clone
 * @param {{ downloadDir?: string|null, launcher?: string|null }} [opts] passed to
 *   {@link downloadsServer}
 * @returns {Record<string, unknown>}
 */
export function mergeDownloadsServer(merged, kitRepoAbs, opts = {}) {
  return withServer(merged, "vkm-downloads", downloadsServer(path.resolve(kitRepoAbs), opts));
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

/** @param {string} dir */
export function obscuraWebMcpPathsFromKitRoot(dir) {
  const root = path.resolve(dir);
  return {
    root,
    obscuraMcpJs: path.join(root, "packages", "obscura-web", "src", "obscura-mcp.mjs")
  };
}

/** @param {string} dir */
export function downloadsMcpPathsFromKitRoot(dir) {
  const root = path.resolve(dir);
  return {
    root,
    downloadsMcpJs: path.join(root, "packages", "vkm-downloads", "src", "downloads-mcp.mjs")
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
