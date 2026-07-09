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
 * - OBSIDIAN_MEMORY_RAG_TIMEOUT_MS — subprocess timeout in ms (default 120000 / 2min)
 */
import { execa } from "execa";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Default timeout for the RAG subprocess: generous enough for a legitimate
 * large-vault semantic reindex, but bounded so a hung/misbehaving Python
 * backend cannot block an MCP call (and leak the process) indefinitely. */
const DEFAULT_RAG_TIMEOUT_MS = 120_000;

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
 * Subprocess timeout (ms) from OBSIDIAN_MEMORY_RAG_TIMEOUT_MS, falling back to
 * {@link DEFAULT_RAG_TIMEOUT_MS} when unset or not a finite non-negative number.
 * @returns {number}
 */
export function defaultRagTimeoutMs() {
  const raw = process.env.OBSIDIAN_MEMORY_RAG_TIMEOUT_MS;
  if (raw === undefined || raw === "") return DEFAULT_RAG_TIMEOUT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_RAG_TIMEOUT_MS;
}

/**
 * Spawn `command spawnArgs`, wait (bounded by `opts.timeoutMs`), and parse
 * stdout as JSON. Extracted from {@link runRagJson} so tests can exercise the
 * timeout/error-handling paths against a fake, quick-to-spawn executable (e.g.
 * `node -e "setTimeout(()=>{}, 999999)"`) instead of the real Python backend.
 * @param {string} command
 * @param {string[]} spawnArgs
 * @param {{env?: NodeJS.ProcessEnv, timeoutMs?: number}} [opts]
 * @returns {Promise<unknown>}
 */
export async function runRagJsonRaw(command, spawnArgs, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? defaultRagTimeoutMs();
  let r;
  try {
    r = await execa(command, spawnArgs, {
      env: opts.env ?? process.env,
      reject: false,
      stripFinalNewline: true,
      // 0/undefined means "no timeout" to execa; only pass a positive value.
      ...(timeoutMs > 0 ? { timeout: timeoutMs } : {})
    });
  } catch (e) {
    // reject:false normally turns failures into a result, but a spawn error
    // (e.g. the Python binary is missing) can still throw.
    if (e && e.code === "ENOENT") throw pythonNotFoundError(command);
    throw e;
  }
  if (r.timedOut) {
    throw new Error(
      `obsidian-memory-rag timed out after ${timeoutMs}ms and was killed. The Python backend ` +
        `may be hung, or the vault/operation needs more time than ` +
        `OBSIDIAN_MEMORY_RAG_TIMEOUT_MS currently allows (${timeoutMs}ms) — raise it and retry.`
    );
  }
  if (r.exitCode !== 0) {
    if (r.code === "ENOENT" || /\bENOENT\b/.test(r.shortMessage || "")) {
      throw pythonNotFoundError(command);
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

/**
 * Run `python -m obsidian_memory_rag <...args>` and parse its stdout as JSON.
 * @param {string[]} args
 * @param {string} [ragSrc] - defaults to {@link defaultRagSrc}
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<unknown>}
 */
export async function runRagJson(args, ragSrc = defaultRagSrc(), opts = {}) {
  const py = defaultPython();
  const env = { ...process.env };
  const parts = [ragSrc, env.PYTHONPATH].filter(Boolean);
  env.PYTHONPATH = parts.join(path.delimiter);
  return runRagJsonRaw(py, ["-m", "obsidian_memory_rag", ...args], {
    env,
    timeoutMs: opts.timeoutMs
  });
}
