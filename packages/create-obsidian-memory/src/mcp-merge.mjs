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

function basicMemoryArgs() {
  return ["--from", `basic-memory==${BASIC_MEMORY_VERSION}`, "basic-memory", "mcp"];
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
  mcpServers["basic-memory"] = {
    command: "uvx",
    args: basicMemoryArgs(),
    env: { BASIC_MEMORY_HOME: vaultAbs }
  };
  return base;
}

/**
 * Add `obsidian-memory-hybrid` MCP (Node bridge + Python FTS5) after `basic-memory` is set.
 * @param {Record<string, unknown>} merged - output of mergeBasicMemoryServer (or compatible)
 * @param {string} vaultAbs - absolute vault root
 * @param {string} kitRepoAbs - absolute path to cursor-obsidian-memory-guide clone (contains packages/)
 */
export function mergeObsidianHybridServer(merged, vaultAbs, kitRepoAbs) {
  const base = /** @type {Record<string, unknown>} */ (JSON.parse(JSON.stringify(merged)));
  const servers = base.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    base.mcpServers = {};
  }
  const mcpServers = /** @type {Record<string, unknown>} */ (base.mcpServers);
  const hybridJs = path.join(
    kitRepoAbs,
    "packages",
    "obsidian-memory-mcp",
    "src",
    "hybrid-mcp.mjs"
  );
  const pythonSrc = path.join(kitRepoAbs, "packages", "obsidian-memory-rag", "src");
  mcpServers["obsidian-memory-hybrid"] = {
    command: "node",
    args: [hybridJs],
    env: {
      BASIC_MEMORY_HOME: vaultAbs,
      PYTHONPATH: pythonSrc
    }
  };
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
