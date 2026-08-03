/**
 * Filesystem layout for the per-vault Postgres projection home. Pure path/crypto/fs
 * primitives only — NO heavy imports (no PGlite, no pg, no execa): this module is imported
 * by the MCP sidecar's hot path just to answer "is a service running for this vault?",
 * so it must cost nothing to load.
 *
 * Layout: `<PG_DATA_ROOT>/<slug>/` where PG_DATA_ROOT defaults to `~/.vkm/pg`
 * (override: VKM_PG_DATA_ROOT). Files inside:
 * - `data/`          — the PGlite datadir (disposable projection, rebuildable)
 * - `service.json`   — `{port,pid,vault,version,startedAt}` written by the live service
 * - `service.token`  — random 32-byte hex; localhost auth shared secret (0o600 on POSIX)
 * - `service.lock`   — `{pid,port}`; stale when `process.kill(pid,0)` throws
 * - `migration-report.md` — last vkm-pg-migrate report
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Deterministic, human-readable, collision-safe directory slug for a vault:
 * `<basename-kebab>-<sha256(resolved abs path).hex[0..8]>`. The path is lowercased before
 * hashing on win32 (case-insensitive filesystem — `C:\Vault` and `c:\vault` are the SAME
 * vault and must map to the same projection dir).
 * @param {string} vaultAbs
 * @returns {string}
 */
export function vaultSlug(vaultAbs) {
  const resolved = path.resolve(vaultAbs);
  const hashInput = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  const hash = crypto.createHash("sha256").update(hashInput).digest("hex").slice(0, 8);
  const base = path
    .basename(resolved)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base}-${hash}`;
}

/**
 * Root under which every vault's projection dir lives.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function pgHome(env = process.env) {
  return env.VKM_PG_DATA_ROOT || path.join(os.homedir(), ".vkm", "pg");
}

/**
 * The per-vault projection directory.
 * @param {string} vaultAbs
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function vaultPgDir(vaultAbs, env = process.env) {
  return path.join(pgHome(env), vaultSlug(vaultAbs));
}

/** @param {string} dir @returns {string} */
export function serviceInfoPath(dir) {
  return path.join(dir, "service.json");
}

/** @param {string} dir @returns {string} */
export function tokenPath(dir) {
  return path.join(dir, "service.token");
}

/** @param {string} dir @returns {string} */
export function lockPath(dir) {
  return path.join(dir, "service.lock");
}

/** @param {string} dir @returns {string} the PGlite datadir inside a projection dir */
export function dataDirPath(dir) {
  return path.join(dir, "data");
}

/**
 * Parse `service.json` and verify the recorded pid is still alive (`process.kill(pid, 0)`
 * throws for a dead process — same liveness idiom as vkm-doctor's otel-sink lock).
 * @param {string} dir - a vault projection dir
 * @returns {{ port: number, pid: number, vault?: string, version?: string, startedAt?: string } | null}
 *   the parsed info when a live service holds it, otherwise null (missing/corrupt/stale).
 */
export function readServiceInfo(dir) {
  try {
    const info = JSON.parse(fs.readFileSync(serviceInfoPath(dir), "utf8"));
    if (!Number.isInteger(info.pid) || !Number.isInteger(info.port)) return null;
    process.kill(info.pid, 0); // throws if the process is gone
    return info;
  } catch {
    return null;
  }
}

/**
 * Read the shared-secret token for a projection dir.
 * @param {string} dir
 * @returns {string | null} trimmed token, or null when absent/unreadable.
 */
export function readToken(dir) {
  try {
    const raw = fs.readFileSync(tokenPath(dir), "utf8").trim();
    return raw || null;
  } catch {
    return null;
  }
}

/**
 * True when `service.lock` names a live pid. Stale locks (crashed service) read as false.
 * @param {string} dir
 * @returns {boolean}
 */
export function lockAlive(dir) {
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath(dir), "utf8"));
    process.kill(lock.pid, 0);
    return true;
  } catch {
    return false;
  }
}
