/**
 * Pure fetch client for the pg-service HTTP API — the MCP sidecar (and the migrate CLI)
 * talk to a running service through this instead of opening the datadir themselves:
 * PGlite is single-writer, so the service is the ONE process that holds the database and
 * everyone else goes over localhost HTTP.
 *
 * No heavy imports here either — this module rides along wherever pg-paths does.
 */
import { spawn } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { throughHiddenConsole } from "@vkmikc/vkm-core/hidden-console";
import { vaultPgDir, serviceInfoPath, readServiceInfo, readToken } from "./pg-paths.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Typed "the service is not there" error — one thing for callers to catch and degrade on. */
export class PgServiceUnavailableError extends Error {
  /** @param {string} message @param {string} [reason] */
  constructor(message, reason = "unavailable") {
    super(message);
    this.name = "PgServiceUnavailableError";
    this.reason = reason;
  }
}

/**
 * Base URL of the live service for a vault, or null when none is running.
 * @param {string} vaultAbs
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | null}
 */
export function serviceUrlFor(vaultAbs, env = process.env) {
  const info = readServiceInfo(vaultPgDir(vaultAbs, env));
  return info ? `http://127.0.0.1:${info.port}` : null;
}

/**
 * Call a pg-service route for a vault, attaching the token header.
 * @param {string} vaultAbs
 * @param {string} route - e.g. "/api/health", "/api/graph?depth=2"
 * @param {{ method?: string, body?: unknown, env?: NodeJS.ProcessEnv, timeoutMs?: number }} [opts]
 * @returns {Promise<any>} parsed JSON response body
 * @throws {PgServiceUnavailableError} not running / timeout / network / non-2xx
 */
export async function pgFetch(
  vaultAbs,
  route,
  { method = "GET", body, env = process.env, timeoutMs = 4000 } = {}
) {
  const dir = vaultPgDir(vaultAbs, env);
  const base = serviceUrlFor(vaultAbs, env);
  if (!base) {
    throw new PgServiceUnavailableError(`no live pg-service for vault ${vaultAbs}`, "not_running");
  }
  const token = readToken(dir);
  /** @type {Response} */
  let res;
  try {
    res = await fetch(`${base}${route}`, {
      method,
      headers: {
        ...(token ? { "x-vkm-pg-token": token } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {})
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (e) {
    const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError";
    throw new PgServiceUnavailableError(
      `pg-service unreachable at ${base}: ${e?.message || e}`,
      timedOut ? "timeout" : "network"
    );
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      // body read failure — status alone is enough
    }
    throw new PgServiceUnavailableError(
      `pg-service ${route} returned HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
      `http_${res.status}`
    );
  }
  return res.json();
}

/**
 * Make sure a service is running for the vault, spawning one detached when needed.
 * Never throws — a false return means "no service, degrade" (the caller falls back to
 * whatever it does without the projection).
 * @param {{ vaultAbs?: string, vault?: string, env?: NodeJS.ProcessEnv, kitRootHint?: string,
 *   deps?: { spawn?: typeof spawn, deadlineMs?: number, pollMs?: number } }} opts -
 *   `vaultAbs` is canonical; `vault` is an accepted alias (frozen seam — the MCP sidecar's
 *   pg-tools passes either). `kitRootHint`: repo root fallback for resolving pg-service.mjs
 *   when this module runs from an unexpected location (e.g. a bundler moved it). `deps` is
 *   test-only injection (spawn + timing).
 * @returns {Promise<boolean>} true when /api/health answers before the ~6s deadline
 */
export async function ensureServiceRunning({
  vaultAbs,
  vault,
  env = process.env,
  kitRootHint,
  deps = {}
} = {}) {
  const target = vaultAbs ?? vault;
  const doSpawn = deps.spawn ?? spawn;
  const deadlineMs = deps.deadlineMs ?? 6000;
  const pollMs = deps.pollMs ?? 300;
  try {
    if (!target) return false;
    if (await healthOk(target, env)) return true;

    // Health failed, but service.json may still exist: the recorded pid died (stale file),
    // or — worse — an unrelated process recycled it, making the file read as "live"
    // forever (pid-liveness is necessary but not sufficient). Either way the file lies;
    // unlink it so the child spawned below is not vetoed by its own sibling check.
    const infoPath = serviceInfoPath(vaultPgDir(target, env));
    if (existsSync(infoPath)) {
      try {
        unlinkSync(infoPath);
      } catch {
        // best-effort — the child's own health probe decides anyway
      }
    }

    let script = path.join(__dirname, "pg-service.mjs");
    if (!existsSync(script) && kitRootHint) {
      script = path.join(kitRootHint, "packages", "vkm-memory-pg", "src", "pg-service.mjs");
    }
    if (!existsSync(script)) return false;

    const launch = throughHiddenConsole(process.execPath, [
      script,
      "--vault",
      path.resolve(target)
    ]);
    const child = doSpawn(launch.command, launch.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: launch.windowsHide,
      env: { ...env }
    });
    let spawnFailed = false;
    // Without a listener, an async ENOENT 'error' event would crash the caller.
    child.on("error", () => {
      spawnFailed = true;
    });
    child.unref();

    const deadline = Date.now() + deadlineMs;
    while (Date.now() < deadline && !spawnFailed) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      if (await healthOk(target, env)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function healthOk(vaultAbs, env) {
  const base = serviceUrlFor(vaultAbs, env);
  if (!base) return false;
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}
