/**
 * Thin client for the `obsidian-memory-rag` Python backend (BM25 + semantic search,
 * structured observations/relations, audit, indexing — invoked as `python -m
 * obsidian_memory_rag <json-subcommand> ...`, stdout is one JSON object).
 *
 * Lives in its own module (not hybrid-mcp.mjs) for the same reason extract.mjs does:
 * hybrid-mcp.mjs's top-level `main()` spawns a StdioServerTransport that waits on stdin
 * forever, so anything that wants to reuse the Python bridge (tests, or another package
 * in this monorepo) should import THIS file, not hybrid-mcp.mjs.
 *
 * Env:
 * - BASIC_MEMORY_HOME or OBSIDIAN_MEMORY_VAULT — default vault when a caller omits one
 * - OBSIDIAN_MEMORY_RAG_SRC — override path to .../obsidian-memory-rag/src
 * - OBSIDIAN_MEMORY_PYTHON — python executable (default: python3 non-Windows, python on Windows)
 */
import { execa } from "execa";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function defaultPython() {
  if (process.env.OBSIDIAN_MEMORY_PYTHON) return process.env.OBSIDIAN_MEMORY_PYTHON;
  return process.platform === "win32" ? "python" : "python3";
}

export function defaultVaultFromEnv() {
  const raw = process.env.BASIC_MEMORY_HOME || process.env.OBSIDIAN_MEMORY_VAULT;
  if (!raw) return null;
  return path.resolve(raw);
}

export function defaultRagSrc() {
  if (process.env.OBSIDIAN_MEMORY_RAG_SRC) {
    return path.resolve(process.env.OBSIDIAN_MEMORY_RAG_SRC);
  }
  return path.resolve(__dirname, "../../obsidian-memory-rag/src");
}

export function requireVault(vaultArg) {
  const v = vaultArg ? path.resolve(vaultArg) : defaultVaultFromEnv();
  if (!v) {
    throw new Error(
      "Missing vault: pass a vault path explicitly or set BASIC_MEMORY_HOME / OBSIDIAN_MEMORY_VAULT"
    );
  }
  return v;
}

export function pythonNotFoundError(py) {
  return new Error(
    `Python executable "${py}" not found on PATH. Install Python 3.11+ (with the ` +
      `obsidian-memory-rag package importable) or set OBSIDIAN_MEMORY_PYTHON to its full path.`
  );
}

/**
 * Run `python -m obsidian_memory_rag <...args>` and parse its stdout as JSON.
 * @param {string[]} args
 * @param {string} [ragSrc] - defaults to {@link defaultRagSrc}
 * @returns {Promise<unknown>}
 */
export async function runRagJson(args, ragSrc = defaultRagSrc()) {
  const py = defaultPython();
  const env = { ...process.env };
  const parts = [ragSrc, env.PYTHONPATH].filter(Boolean);
  env.PYTHONPATH = parts.join(path.delimiter);
  let r;
  try {
    r = await execa(py, ["-m", "obsidian_memory_rag", ...args], {
      env,
      reject: false,
      stripFinalNewline: true
    });
  } catch (e) {
    // reject:false normally turns failures into a result, but a spawn error
    // (e.g. the Python binary is missing) can still throw.
    if (e && e.code === "ENOENT") throw pythonNotFoundError(py);
    throw e;
  }
  if (r.exitCode !== 0) {
    if (r.code === "ENOENT" || /\bENOENT\b/.test(r.shortMessage || "")) {
      throw pythonNotFoundError(py);
    }
    const detail = r.stderr || r.shortMessage || r.stdout || "(no output)";
    throw new Error(`obsidian-memory-rag exited ${r.exitCode ?? "?"}: ${detail}`);
  }
  try {
    return JSON.parse(r.stdout);
  } catch (e) {
    const head = (r.stdout || "").slice(0, 400);
    throw new Error(
      `obsidian-memory-rag returned non-JSON output (${e.message}). First 400 chars: ${head}`
    );
  }
}
