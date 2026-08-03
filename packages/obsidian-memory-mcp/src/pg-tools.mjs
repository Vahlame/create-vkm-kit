/**
 * Postgres-projection tool logic for the hybrid sidecar (vault_pg_status /
 * vault_graph_hops / vault_timeline). No MCP import — same separation as
 * extract.mjs: hybrid-mcp.mjs registers the tools and delegates here.
 *
 * The @vkmikc/vkm-memory-pg subpaths are imported LAZILY inside the enabled
 * code paths only, and only the light ones — /client and /paths, never the
 * adapter — so this process never loads PGlite WASM and works unchanged while
 * the projection layer is disabled or the sibling package is absent.
 *
 * Expected sibling exports (frozen cross-agent seam):
 *  - "@vkmikc/vkm-memory-pg/client": `ensureServiceRunning({ vaultAbs, env, kitRootHint })`
 *    — best-effort start of the per-vault pg-service (we call it with
 *    `{ vaultAbs: vault, env }`); `PgServiceUnavailableError` (matched by
 *    error NAME, not instanceof, so no hard link is needed).
 *  - "@vkmikc/vkm-memory-pg/paths": `vaultPgDir(vaultAbs, env)` — absolute
 *    per-vault dir containing service.json / service.token (file names and
 *    shapes are frozen contracts).
 *
 * Read tools (graph/timeline) NEVER auto-start the service: they discover it
 * via service.json + service.token and fail with an actionable message when it
 * is not running. Only vault_pg_status ensures — reads stay side-effect-free.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** True when the Postgres projection layer is enabled for this process. */
export function pgEnabled(env = process.env) {
  return env.VKM_PG === "1" || Boolean(env.VKM_PG_DSN && String(env.VKM_PG_DSN).trim() !== "");
}

/** The single how-to-enable message every disabled/unavailable path points at. */
export function disabledMessage() {
  return (
    "Postgres projection off. Enable: VKM_PG=1 (or create-vkm-kit --postgres), " +
    "or start manually: node packages/vkm-memory-pg/src/pg-service.mjs --vault <vault>"
  );
}

/**
 * Shape a GET /api/health payload for the tool result: pass the health JSON
 * through and add one `hint` when the projection has no rows yet, so the agent
 * learns the backfill command from the status call instead of from an error.
 * @param {Record<string, any>} health
 * @returns {Record<string, any>}
 */
export function formatStatus(health) {
  if (!health || typeof health !== "object") return health;
  const out = { ...health };
  if (out.notes === 0) {
    out.hint = "Projection empty (0 notes): run vkm-pg-migrate to backfill from the vault.";
  }
  return out;
}

/**
 * Validate vault_graph_hops arguments and build the /api/graph query string.
 * Zod already enforces most of this on the wire; this keeps the pure module
 * independently safe (and testable) regardless of the caller.
 * @param {{ from: string, depth?: number, direction?: string, types?: string,
 *           limit?: number, scope?: string }} args
 * @returns {URLSearchParams}
 */
export function buildGraphParams({
  from,
  depth = 2,
  direction = "both",
  types,
  limit = 50,
  scope
}) {
  if (typeof from !== "string" || from.trim() === "") {
    throw new Error(
      "from is required: a vault-relative note path incl. .md, e.g. 'PROJECTS/app.md'"
    );
  }
  if (!Number.isInteger(depth) || depth < 1 || depth > 4) {
    throw new Error("depth must be an integer between 1 and 4");
  }
  if (!["out", "in", "both"].includes(direction)) {
    throw new Error("direction must be one of: out, in, both");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new Error("limit must be an integer between 1 and 200");
  }
  const params = new URLSearchParams({
    from: from.trim(),
    depth: String(depth),
    direction,
    limit: String(limit)
  });
  if (types != null && String(types).trim() !== "") {
    const list = String(types)
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (list.length) params.set("types", list.join(","));
  }
  const scopeValue = validateScope(scope);
  if (scopeValue != null) params.set("scope", scopeValue);
  return params;
}

/** Wrap a reason into the uniform "off + how to enable (+ why)" tool error. */
function unavailable(reason) {
  return new Error(`${disabledMessage()} (${reason})`);
}

/** Duck-typed check for the client package's unavailability error (no hard link). */
function isPgServiceUnavailableError(err) {
  return Boolean(err) && err.name === "PgServiceUnavailableError";
}

const defaultLoadClient = () => import("@vkmikc/vkm-memory-pg/client");
const defaultLoadPaths = () => import("@vkmikc/vkm-memory-pg/paths");

/**
 * `process.kill(pid, 0)` liveness probe — the same staleness rule service.lock
 * uses. EPERM means "alive but not ours", which still counts as alive.
 * @param {number} pid
 */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

/**
 * Side-effect-free discovery of the running pg-service for `vault`: resolve the
 * per-vault dir via the /paths subpath (`vaultPgDir`), then read the frozen service.json
 * (port/pid) and service.token files. Throws the uniform unavailable error when
 * anything is missing or the recorded pid is gone.
 * @param {{ vault: string, env: NodeJS.ProcessEnv, loadPaths: () => Promise<any> }} deps
 * @returns {Promise<{ port: number, token: string }>}
 */
async function serviceInfo({ vault, env, loadPaths }) {
  let paths;
  try {
    paths = await loadPaths();
  } catch (err) {
    throw unavailable(`@vkmikc/vkm-memory-pg not resolvable: ${err?.message ?? err}`);
  }
  if (typeof paths.vaultPgDir !== "function") {
    throw unavailable(
      "incompatible @vkmikc/vkm-memory-pg/paths: vaultPgDir(vaultAbs, env) missing"
    );
  }
  let dir;
  try {
    dir = paths.vaultPgDir(vault, env);
  } catch (err) {
    // The sibling package signals "no service possible here" with its own error
    // class; match by name (no hard link) and re-shape to the uniform message.
    if (isPgServiceUnavailableError(err)) throw unavailable(err.message);
    throw err;
  }
  let svc;
  try {
    svc = JSON.parse(readFileSync(join(dir, "service.json"), "utf8"));
  } catch {
    throw unavailable("pg-service not running for this vault (no readable service.json)");
  }
  const port = Number(svc.port);
  if (!Number.isInteger(port) || port <= 0) {
    throw unavailable("service.json carries no valid port");
  }
  if (svc.pid != null && !pidAlive(Number(svc.pid))) {
    throw unavailable(`pg-service is not running (stale service.json, pid ${svc.pid} gone)`);
  }
  let token;
  try {
    token = readFileSync(join(dir, "service.token"), "utf8").trim();
  } catch {
    throw unavailable("missing service.token");
  }
  if (!token) throw unavailable("empty service.token");
  return { port, token };
}

/** Read timeout for MCP → pg-service GETs (status / graph / timeline). */
export const API_GET_TIMEOUT_MS = 8000;

/**
 * Authenticated GET against the local pg-service. Connection-level failures
 * become the uniform unavailable error; HTTP-level failures keep their status
 * so a real server bug is not misreported as "service off".
 * @param {{ info: { port: number, token: string }, apiPath: string, fetchImpl: typeof fetch,
 *           timeoutMs?: number }} deps
 * @returns {Promise<any>}
 */
async function apiGet({ info, apiPath, fetchImpl, timeoutMs = API_GET_TIMEOUT_MS }) {
  let res;
  try {
    res = await fetchImpl(`http://127.0.0.1:${info.port}${apiPath}`, {
      headers: { "x-vkm-pg-token": info.token },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    throw unavailable(`pg-service unreachable on port ${info.port}: ${err?.message ?? err}`);
  }
  if (res.status === 401) {
    throw new Error(
      "pg-service rejected the token (401) — stale service.token? Restart the service."
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `pg-service GET ${apiPath} failed: HTTP ${res.status}${body ? ` — ${body.slice(0, 300)}` : ""}`
    );
  }
  return res.json();
}

/**
 * vault_pg_status: disabled → the how-to-enable message (a normal result, not
 * an error — status is the tool you ask when unsure); enabled → best-effort
 * ensureServiceRunning, then GET /api/health shaped by {@link formatStatus}.
 * @param {{ vault: string, env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch,
 *           loadClient?: () => Promise<any>, loadPaths?: () => Promise<any> }} deps
 * @returns {Promise<string | Record<string, any>>}
 */
export async function pgStatus({
  vault,
  env = process.env,
  fetchImpl = globalThis.fetch,
  loadClient = defaultLoadClient,
  loadPaths = defaultLoadPaths
}) {
  if (!pgEnabled(env)) return disabledMessage();
  let client;
  try {
    client = await loadClient();
  } catch (err) {
    throw unavailable(`@vkmikc/vkm-memory-pg not resolvable: ${err?.message ?? err}`);
  }
  if (typeof client.ensureServiceRunning === "function") {
    try {
      await client.ensureServiceRunning({ vaultAbs: vault, env });
    } catch {
      // Best-effort by contract: a failed start must not mask a service that is
      // already running (e.g. started manually) — discovery below decides.
    }
  }
  const info = await serviceInfo({ vault, env, loadPaths });
  return formatStatus(await apiGet({ info, apiPath: "/api/health", fetchImpl }));
}

/**
 * vault_graph_hops: GET /api/graph. Never starts the service (read tools stay
 * side-effect-free); disabled or not-running → uniform actionable error.
 * @param {{ vault: string, from: string, depth?: number, direction?: string,
 *           types?: string, limit?: number, scope?: string,
 *           env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch,
 *           loadPaths?: () => Promise<any> }} args
 * @returns {Promise<{ nodes: any[], edges: any[] }>}
 */
export async function pgGraph({
  vault,
  from,
  depth,
  direction,
  types,
  limit,
  scope,
  env = process.env,
  fetchImpl = globalThis.fetch,
  loadPaths = defaultLoadPaths
}) {
  if (!pgEnabled(env)) throw new Error(disabledMessage());
  const params = buildGraphParams({ from, depth, direction, types, limit, scope });
  const info = await serviceInfo({ vault, env, loadPaths });
  return apiGet({ info, apiPath: `/api/graph?${params.toString()}`, fetchImpl });
}

/**
 * Validate a scoped-memory `scope` value (frozen contract): a posix-style
 * RELATIVE path prefix, matched at segment boundary by the server. Rejects
 * '..', a leading '/', a drive letter and backslashes — the server errors on
 * these too, but the pure module stays independently safe regardless of caller.
 * `null`/`undefined`/'' mean "no scope" and return undefined.
 * @param {unknown} scope
 * @returns {string | undefined}
 */
export function validateScope(scope) {
  if (scope == null || scope === "") return undefined;
  const s = String(scope);
  if (s.includes("..") || s.startsWith("/") || /^[A-Za-z]:/.test(s) || s.includes("\\")) {
    throw new Error(
      "scope must be a posix-relative path prefix (no '..', leading '/', drive letter or backslashes)"
    );
  }
  return s;
}

/**
 * vault_timeline: GET /api/timeline. Never starts the service; disabled or
 * not-running → uniform actionable error.
 * @param {{ vault: string, limit?: number, sinceId?: number, scope?: string,
 *           env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch,
 *           loadPaths?: () => Promise<any> }} args
 * @returns {Promise<{ events: any[] }>}
 */
export async function pgTimeline({
  vault,
  limit = 20,
  sinceId,
  scope,
  env = process.env,
  fetchImpl = globalThis.fetch,
  loadPaths = defaultLoadPaths
}) {
  if (!pgEnabled(env)) throw new Error(disabledMessage());
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("limit must be an integer between 1 and 100");
  }
  if (sinceId != null && (!Number.isInteger(sinceId) || sinceId < 0)) {
    throw new Error("sinceId must be a non-negative integer");
  }
  const scopeValue = validateScope(scope);
  const params = new URLSearchParams({ limit: String(limit) });
  if (sinceId != null) params.set("sinceId", String(sinceId));
  if (scopeValue != null) params.set("scope", scopeValue);
  const info = await serviceInfo({ vault, env, loadPaths });
  return apiGet({ info, apiPath: `/api/timeline?${params.toString()}`, fetchImpl });
}
