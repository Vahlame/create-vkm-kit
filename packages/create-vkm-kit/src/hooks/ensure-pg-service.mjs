#!/usr/bin/env node
// SessionStart hook shipped by create-vkm-kit (vkm-kit): guarantees the vkm-memory-pg
// Postgres projection service is alive whenever a Claude Code session starts, with no OS
// service or scheduled task. Mirrors ensure-otel-sink.mjs: check liveness via the
// service.json pid (a single read + kill(0) — well under 100ms when alive) and, when
// absent/stale, spawn the pg-service detached and exit immediately. Fail-open: ANY error
// exits 0 silently — a projection hiccup must never block a session. The vault stays the
// source of truth; the projection is disposable, so a missed respawn costs nothing but
// freshness. argv: node <hook> <pg-service-script-path> <vaultAbs> [pgDsn].
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * The per-vault pg-service home: `<PG_DATA_ROOT>/<slug>/`, where PG_DATA_ROOT is
 * VKM_PG_DATA_ROOT or `<os home>/.vkm/pg`, and slug = folded vault basename + the first
 * 8 hex chars of sha256(resolved absolute vault path, lowercased on win32) — the exact
 * layout the pg-service contract fixes, duplicated here because this hook is copied
 * standalone into `~/.claude/hooks/` and can import nothing from the package.
 * @param {string} vaultAbs
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [platform]
 * @returns {string}
 */
export function pgServiceDir(vaultAbs, env = process.env, platform = process.platform) {
  const root = env.VKM_PG_DATA_ROOT || path.join(os.homedir(), ".vkm", "pg");
  const resolved = path.resolve(vaultAbs);
  const base = path
    .basename(resolved)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const hashed = platform === "win32" ? resolved.toLowerCase() : resolved;
  const hash = createHash("sha256").update(hashed).digest("hex").slice(0, 8);
  return path.join(root, `${base}-${hash}`);
}

/**
 * True if a live pg-service already owns this vault's projection (service.json names a
 * pid that answers `kill(0)`). Any read/parse/signal failure means "not alive" — the
 * safe direction, since respawning an already-running service is refused by its own
 * service.lock while a missed respawn only delays freshness.
 * @param {string} vaultAbs
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function pgServiceAlive(vaultAbs, env = process.env) {
  try {
    const fp = path.join(pgServiceDir(vaultAbs, env), "service.json");
    const info = JSON.parse(fs.readFileSync(fp, "utf8"));
    process.kill(info.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function main() {
  const serviceScript = process.argv[2];
  const vaultAbs = process.argv[3];
  // argv[4] (optional): the VKM_PG_DSN this install configured. Hooks inherit no MCP env
  // and the service persists the DSN nowhere, so without threading it through argv every
  // hook-driven respawn would silently fall back to the embedded PGlite backend
  // (pg-adapter selects the backend from env.VKM_PG_DSN alone).
  const dsn = process.argv[4];
  if (!serviceScript || !vaultAbs || pgServiceAlive(vaultAbs)) return;
  try {
    // windowsHide as the fallback of the ADR-0078 rule: this file runs standalone from
    // ~/.claude/hooks/ where @vkmikc/vkm-core is out of reach — and the hook itself is
    // already started through vkm-runhidden.exe, so the tree owns a hidden console.
    const child = spawn(process.execPath, [serviceScript, "--vault", vaultAbs], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env, VKM_PG: "1", ...(dsn ? { VKM_PG_DSN: dsn } : {}) }
    });
    child.on("error", () => {
      // fail open — a spawn error must never surface into the session
    });
    child.unref();
  } catch {
    // fail open
  }
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  try {
    main();
  } catch {
    // fail open — never block a session over the projection layer
  }
}
