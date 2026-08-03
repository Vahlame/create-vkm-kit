/**
 * The Postgres projection setup (vkm-memory-pg) — everything through injected fakes,
 * because the real thing spawns a detached service and opens HTTP sockets, which a unit
 * test must never do. What these pin:
 *
 *   - dry-run announces and does nothing (no spawn, no fetch);
 *   - a missing @electric-sql/pglite is a "manual" outcome with an `npm install` hint,
 *     never a spawn of a service that would crash on import;
 *   - the happy path runs in the contract's order: spawn → health poll → ONE full sync
 *     with the token header — and reports the row counts the sync returned;
 *   - the launcher wraps the spawn (ADR-0078) without disturbing the argv;
 *   - both option threads survive the installer's double destructure: buildServerList
 *     AND writeCursorMcp carry postgres/pgDsn into the hybrid entry (the exact trap the
 *     obscura options fell into once).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  maybeSetupPostgres,
  configurePgHook,
  uninstallPgHook,
  pickInstallSyncMode
} from "../src/pg-setup.mjs";
import { pgServiceDir } from "../src/hooks/ensure-pg-service.mjs";
import { buildServerList, writeCursorMcp } from "../src/mcp-register.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const KIT = "/kit";
const VAULT = "/vault";

/** A child_process stub that records the spawn and supports on/unref. */
function fakeChild() {
  return { on() {}, unref() {} };
}

/** Deps where everything exists, the service is healthy and the sync returns counts. */
function happyDeps(log, { backend = "pglite", notes = 0, lastSyncAt = null } = {}) {
  const dir = pgServiceDir(VAULT);
  return {
    pathExists: async (p) => {
      log.push(["exists", p]);
      return true;
    },
    readFile: async (p) => {
      log.push(["read", p]);
      if (p === path.join(dir, "service.json")) {
        return JSON.stringify({ port: 45678, pid: 4242, vault: VAULT });
      }
      if (p === path.join(dir, "service.token")) return "aabbcc\n";
      throw new Error(`unexpected read: ${p}`);
    },
    spawnImpl: (command, args, opts) => {
      log.push(["spawn", command, args, opts]);
      return fakeChild();
    },
    fetchImpl: async (url, init = {}) => {
      log.push(["fetch", url, init]);
      if (String(url).endsWith("/api/health")) {
        return {
          ok: true,
          json: async () => ({ ok: true, backend, notes, lastSyncAt })
        };
      }
      if (String(url).endsWith("/api/sync")) {
        return {
          ok: true,
          json: async () => ({
            synced: { notes: 12, chunks: 88, relations: 30, observations: 41, removed: 0 }
          })
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
    // Records only, never throws: a signaled pid reads as "still alive", which is the
    // safe direction for tests — a real process.kill here could hit a real process.
    killImpl: (pid, signal) => {
      log.push(["kill", pid, signal]);
    },
    delay: async () => {}
  };
}

test("disabled / no kit clone → skipped without touching anything", async () => {
  const log = [];
  const off = await maybeSetupPostgres(
    { enable: false, dryRun: false, vaultAbs: VAULT, kitRoot: KIT },
    happyDeps(log)
  );
  assert.equal(off.status, "skipped");
  const noKit = await maybeSetupPostgres(
    { enable: true, dryRun: false, vaultAbs: VAULT, kitRoot: null },
    happyDeps(log)
  );
  assert.equal(noKit.status, "skipped");
  assert.deepEqual(log, [], "neither case may check, spawn or fetch anything");
});

test("dry-run announces the plan and spawns nothing", async () => {
  const log = [];
  const r = await maybeSetupPostgres(
    { enable: true, dryRun: true, vaultAbs: VAULT, kitRoot: KIT },
    happyDeps(log)
  );
  assert.equal(r.status, "skipped");
  assert.equal(r.detail, "dry-run");
  assert.deepEqual(log, [], "dry-run must not even probe the filesystem");
});

test("missing @electric-sql/pglite → manual with the npm install hint, and NO spawn", async () => {
  const log = [];
  const deps = happyDeps(log);
  deps.pathExists = async (p) => {
    log.push(["exists", p]);
    // The service script exists; the PGlite dependency does not.
    return !p.includes(path.join("node_modules", "@electric-sql", "pglite"));
  };
  const r = await maybeSetupPostgres(
    { enable: true, dryRun: false, vaultAbs: VAULT, kitRoot: KIT },
    deps
  );
  assert.equal(r.status, "manual");
  assert.match(r.detail, /npm install/);
  assert.ok(!log.some(([kind]) => kind === "spawn"), "must not spawn a service that cannot boot");
});

test("an external DSN skips the PGlite check (the pg driver fronts that server)", async () => {
  const log = [];
  const deps = happyDeps(log, { backend: "dsn" });
  deps.pathExists = async (p) => {
    log.push(["exists", p]);
    assert.ok(
      !p.includes("@electric-sql"),
      "with a DSN the embedded backend is unused — its dependency must not gate setup"
    );
    return true;
  };
  const r = await maybeSetupPostgres(
    { enable: true, dryRun: false, vaultAbs: VAULT, kitRoot: KIT, dsn: "postgres://x" },
    deps
  );
  assert.equal(r.status, "ready");
  const spawnEntry = log.find(([kind]) => kind === "spawn");
  assert.equal(spawnEntry[3].env.VKM_PG_DSN, "postgres://x", "the DSN reaches the service env");
  assert.ok(
    !log.some(([kind]) => kind === "kill"),
    "a service already on the requested backend is never signaled"
  );
});

test("pickInstallSyncMode: empty → full; notes or lastSyncAt → incremental", () => {
  assert.equal(pickInstallSyncMode(null), "full");
  assert.equal(pickInstallSyncMode({ notes: 0, lastSyncAt: null }), "full");
  assert.equal(pickInstallSyncMode({ notes: 0 }), "full");
  assert.equal(pickInstallSyncMode({ notes: 12, lastSyncAt: null }), "incremental");
  assert.equal(
    pickInstallSyncMode({ notes: 0, lastSyncAt: "2026-08-03T00:00:00.000Z" }),
    "incremental"
  );
});

test("happy path: spawn → health → one full sync with the token header, counts reported", async () => {
  const log = [];
  const r = await maybeSetupPostgres(
    { enable: true, dryRun: false, vaultAbs: VAULT, kitRoot: KIT, launcher: null },
    happyDeps(log)
  );
  assert.equal(r.status, "ready");
  assert.equal(r.backend, "pglite");
  assert.deepEqual(r.counts, {
    notes: 12,
    chunks: 88,
    relations: 30,
    observations: 41,
    removed: 0
  });

  const kinds = log.map(([kind]) => kind);
  const spawnAt = kinds.indexOf("spawn");
  const fetches = log.filter(([kind]) => kind === "fetch");
  assert.ok(spawnAt >= 0, "the service must be spawned");
  assert.ok(
    spawnAt < log.findIndex(([kind, u]) => kind === "fetch" && String(u).endsWith("/api/health")),
    "spawn must precede the health poll"
  );
  assert.equal(fetches.length, 2, "exactly one health probe and ONE sync");
  assert.match(String(fetches[0][1]), /\/api\/health$/);
  assert.match(String(fetches[1][1]), /\/api\/sync$/);
  const syncInit = fetches[1][2];
  assert.equal(syncInit.method, "POST");
  assert.equal(syncInit.headers["x-vkm-pg-token"], "aabbcc", "token read from service.token");
  assert.deepEqual(JSON.parse(syncInit.body), { mode: "full" }, "empty projection → FULL sync");

  const [, command, args, spawnOpts] = log[spawnAt];
  assert.equal(command, process.execPath, "no launcher → node runs the service directly");
  assert.equal(args[0], path.join(KIT, "packages", "vkm-memory-pg", "src", "pg-service.mjs"));
  assert.deepEqual(args.slice(1), ["--vault", VAULT]);
  assert.equal(spawnOpts.detached, true);
  assert.equal(spawnOpts.stdio, "ignore");
  assert.equal(spawnOpts.env.VKM_PG, "1");
});

test("reinstall/update: populated health → incremental sync (no full re-dump)", async () => {
  const log = [];
  const r = await maybeSetupPostgres(
    { enable: true, dryRun: false, vaultAbs: VAULT, kitRoot: KIT },
    happyDeps(log, { notes: 42, lastSyncAt: "2026-08-01T12:00:00.000Z" })
  );
  assert.equal(r.status, "ready");
  const sync = log.find(([kind, u]) => kind === "fetch" && String(u).endsWith("/api/sync"));
  assert.ok(sync, "sync must still run so updates catch vault changes");
  assert.deepEqual(JSON.parse(sync[2].body), { mode: "incremental" });
});

test("the launcher wraps the spawn without disturbing the service argv (ADR-0078)", async () => {
  const log = [];
  const LAUNCHER = "C:\\Users\\u\\.claude\\bin\\vkm-runhidden.exe";
  const r = await maybeSetupPostgres(
    { enable: true, dryRun: false, vaultAbs: VAULT, kitRoot: KIT, launcher: LAUNCHER },
    happyDeps(log)
  );
  assert.equal(r.status, "ready");
  const [, command, args] = log.find(([kind]) => kind === "spawn");
  assert.equal(command, LAUNCHER);
  assert.equal(args[0], process.execPath, "the real interpreter becomes the first argument");
  assert.match(args[1], /pg-service\.mjs$/);
  assert.deepEqual(args.slice(2), ["--vault", VAULT]);
});

test("a service that never comes up is a bounded failure, not a hang", async () => {
  const log = [];
  const deps = happyDeps(log);
  deps.readFile = async () => {
    throw new Error("ENOENT");
  };
  const r = await maybeSetupPostgres(
    { enable: true, dryRun: false, vaultAbs: VAULT, kitRoot: KIT },
    { ...deps, pollTimeoutMs: 1000, pollIntervalMs: 100 }
  );
  assert.equal(r.status, "failed");
  assert.match(r.detail, /did not come up/);
});

test("a failed initial sync leaves a READY service (best-effort contract)", async () => {
  const log = [];
  const deps = happyDeps(log);
  const inner = deps.fetchImpl;
  deps.fetchImpl = async (url, init) => {
    if (String(url).endsWith("/api/sync")) throw new Error("timeout");
    return inner(url, init);
  };
  const r = await maybeSetupPostgres(
    { enable: true, dryRun: false, vaultAbs: VAULT, kitRoot: KIT },
    deps
  );
  assert.equal(r.status, "ready", "the watcher catches up later; the service IS running");
  assert.equal(r.counts, null);
});

// ── backend reconcile: a leftover service on the WRONG backend (re-run adding --pg-dsn) ──

test("a running service on the wrong backend is SIGTERMed and respawned with the new env", async () => {
  const log = [];
  const DSN = "postgres://app:s3cret@db.example:5432/vkm";
  let oldAlive = true;
  const deps = happyDeps(log);
  deps.fetchImpl = async (url, init = {}) => {
    log.push(["fetch", url, init]);
    if (String(url).endsWith("/api/health")) {
      // The stale service answers "pglite" until it is killed; the respawn answers "dsn".
      return { ok: true, json: async () => ({ ok: true, backend: oldAlive ? "pglite" : "dsn" }) };
    }
    if (String(url).endsWith("/api/sync")) {
      return {
        ok: true,
        json: async () => ({
          synced: { notes: 1, chunks: 2, relations: 3, observations: 4, removed: 0 }
        })
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  deps.killImpl = (pid, signal) => {
    log.push(["kill", pid, signal]);
    if (signal === "SIGTERM") {
      oldAlive = false;
      return;
    }
    if (signal === 0 && !oldAlive) throw new Error("ESRCH");
  };
  const r = await maybeSetupPostgres(
    { enable: true, dryRun: false, vaultAbs: VAULT, kitRoot: KIT, launcher: null, dsn: DSN },
    deps
  );
  assert.equal(r.status, "ready");
  assert.equal(r.backend, "dsn", "the report is the RESTARTED service's backend");

  const kills = log.filter(([kind]) => kind === "kill");
  assert.deepEqual(kills[0], ["kill", 4242, "SIGTERM"], "the recorded pid is SIGTERMed first");
  const spawns = log.filter(([kind]) => kind === "spawn");
  assert.equal(spawns.length, 2, "initial spawn-and-forget + the respawn after the stop");
  for (const [, , , spawnOpts] of spawns) {
    assert.equal(spawnOpts.env.VKM_PG_DSN, DSN, "both spawns carry the new env");
  }
});

test("a wrong-backend service that cannot be stopped is warned about, never silently accepted", async () => {
  const log = [];
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...a) => warnings.push(a.join(" "));
  try {
    // happyDeps' killImpl records and never throws → the pid stays "alive" forever.
    const r = await maybeSetupPostgres(
      { enable: true, dryRun: false, vaultAbs: VAULT, kitRoot: KIT, dsn: "postgres://x" },
      { ...happyDeps(log), pollTimeoutMs: 500, pollIntervalMs: 100 }
    );
    assert.equal(r.status, "ready");
    assert.equal(
      r.backend,
      "pglite",
      "reports the backend ACTUALLY running, not the requested one"
    );
    assert.equal(
      log.filter(([kind]) => kind === "spawn").length,
      1,
      "no respawn while the old service is still alive"
    );
    assert.ok(
      warnings.some((w) => /still uses backend/.test(w)),
      `an explicit warning names the stale backend; got: ${JSON.stringify(warnings)}`
    );
  } finally {
    console.warn = origWarn;
  }
});

// ── the SessionStart keep-alive hook wiring (mirrors the telemetry sink hook) ────────────

test("configurePgHook installs the SessionStart entry with script + vault argv, and enable:false strips it", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-pg-hook-"));
  const vault = path.join(home, "vault");
  await configurePgHook(home, false, { enable: true, kitRoot: repoRoot, vaultAbs: vault });

  const settingsFp = path.join(home, ".claude", "settings.json");
  const settings = JSON.parse(fs.readFileSync(settingsFp, "utf8"));
  const entries = settings.hooks.SessionStart.flatMap((m) => m.hooks);
  assert.equal(entries.length, 1);
  const [entry] = entries;
  assert.match(entry.args[0], /ensure-pg-service\.mjs$/, "args[0] is the installed hook copy");
  assert.equal(
    entry.args[1],
    path.join(repoRoot, "packages", "vkm-memory-pg", "src", "pg-service.mjs"),
    "args[1] is the pg-service script in the kit clone"
  );
  assert.equal(entry.args[2], vault, "args[2] is the vault the service watches");
  assert.equal(entry.args.length, 3, "no DSN configured → no argv[4]");
  assert.ok(
    fs.existsSync(path.join(home, ".claude", "hooks", "ensure-pg-service.mjs")),
    "the hook script is copied into ~/.claude/hooks/"
  );

  // Symmetric removal: a re-run with the option off strips exactly our entry.
  await configurePgHook(home, false, { enable: false });
  const after = JSON.parse(fs.readFileSync(settingsFp, "utf8"));
  assert.equal(after.hooks?.SessionStart, undefined, "no empty husk left behind");
});

test("configurePgHook stores the DSN in a 0o600 file; settings.json only gets the path", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-pg-hook-dsn-"));
  const vault = path.join(home, "vault");
  const env = { VKM_PG_DATA_ROOT: path.join(home, "pgroot") };
  const DSN = "postgres://app:s3cret@db.example:5432/vkm";
  await configurePgHook(home, false, {
    enable: true,
    kitRoot: repoRoot,
    vaultAbs: vault,
    dsn: DSN,
    env
  });

  const settings = JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));
  const settingsText = fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8");
  assert.ok(!settingsText.includes(DSN), "the secret must not appear in settings.json");
  assert.ok(!settingsText.includes("s3cret"), "password fragment must not appear in settings.json");

  const [entry] = settings.hooks.SessionStart.flatMap((m) => m.hooks);
  const dsnFile = entry.args[3];
  assert.ok(typeof dsnFile === "string" && fs.existsSync(dsnFile), "argv[4] is a path that exists");
  assert.equal(fs.readFileSync(dsnFile, "utf8").trim(), DSN, "hook-dsn file holds the DSN");
});

test("configurePgHook enable:false stops the vault's LIVE pg-service (SIGTERM the recorded pid)", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-pg-stop-"));
  const vault = path.join(home, "vault");
  const env = { VKM_PG_DATA_ROOT: path.join(home, "pgroot") };
  const dir = pgServiceDir(vault, env);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "service.json"), JSON.stringify({ port: 1, pid: 4242, vault }));

  const kills = [];
  await configurePgHook(home, false, {
    enable: false,
    vaultAbs: vault,
    env,
    killImpl: (pid, signal) => kills.push([pid, signal])
  });
  assert.deepEqual(
    kills,
    [
      [4242, 0],
      [4242, "SIGTERM"]
    ],
    "liveness probe, then SIGTERM — even with no hook entry present in settings"
  );
});

test("configurePgHook enable:false under dry-run announces the stop without signaling", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-pg-stop-dry-"));
  const vault = path.join(home, "vault");
  const env = { VKM_PG_DATA_ROOT: path.join(home, "pgroot") };
  const dir = pgServiceDir(vault, env);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "service.json"), JSON.stringify({ port: 1, pid: 4242, vault }));

  const kills = [];
  await configurePgHook(home, true, {
    enable: false,
    vaultAbs: vault,
    env,
    killImpl: (pid, signal) => kills.push([pid, signal])
  });
  assert.deepEqual(kills, [[4242, 0]], "dry-run probes liveness but never sends SIGTERM");
});

test("uninstallPgHook removes the settings entry AND the marker-checked hook file", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-pg-unhook-"));
  const vault = path.join(home, "vault");
  await configurePgHook(home, false, { enable: true, kitRoot: repoRoot, vaultAbs: vault });
  const hookFp = path.join(home, ".claude", "hooks", "ensure-pg-service.mjs");
  assert.ok(fs.existsSync(hookFp));

  // env is injected so the service sweep looks at an empty temp root, never at the real
  // ~/.vkm/pg of whoever runs this suite (which may host LIVE services).
  await uninstallPgHook(home, false, { env: { VKM_PG_DATA_ROOT: path.join(home, "pgroot") } });
  assert.ok(!fs.existsSync(hookFp), "the kit-owned hook file is deleted");
  const settings = JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));
  assert.equal(settings.hooks?.SessionStart, undefined);
});

test("uninstallPgHook sweeps the data root: SIGTERMs live services, skips dead/empty dirs", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-pg-sweep-"));
  const root = path.join(home, "pgroot");
  const mkService = (slug, info) => {
    const dir = path.join(root, slug);
    fs.mkdirSync(dir, { recursive: true });
    if (info) fs.writeFileSync(path.join(dir, "service.json"), JSON.stringify(info));
  };
  mkService("vault-a-11111111", { port: 1, pid: 4242 });
  mkService("vault-b-22222222", { port: 2, pid: 999 }); // dead pid: the probe throws
  mkService("vault-c-33333333", null); // no service.json at all

  const kills = [];
  const killImpl = (pid, signal) => {
    kills.push([pid, signal]);
    if (pid === 999) throw new Error("ESRCH");
  };
  await uninstallPgHook(home, false, { env: { VKM_PG_DATA_ROOT: root }, killImpl });

  assert.ok(
    kills.some(([pid, signal]) => pid === 4242 && signal === "SIGTERM"),
    "the live service is SIGTERMed"
  );
  assert.ok(
    !kills.some(([pid, signal]) => pid === 999 && signal === "SIGTERM"),
    "a dead pid is probed but never signaled"
  );
});

// ── the double-destructure trap: BOTH register paths must carry the new options ──────────

test("buildServerList threads postgres/pgDsn into the hybrid entry", () => {
  const servers = buildServerList(VAULT, {
    withHybrid: true,
    repoRoot,
    postgres: true,
    pgDsn: "postgres://x",
    launcher: null
  });
  const hybrid = Object.fromEntries(servers)["obsidian-memory-hybrid"];
  assert.equal(hybrid.env.VKM_PG, "1");
  assert.equal(hybrid.env.VKM_PG_DSN, "postgres://x");

  const off = Object.fromEntries(
    buildServerList(VAULT, { withHybrid: true, repoRoot, launcher: null })
  )["obsidian-memory-hybrid"];
  assert.ok(!("VKM_PG" in off.env), "defaults must not write the key");
});

test("writeCursorMcp threads postgres/pgDsn into ~/.cursor/mcp.json", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-pg-cursor-"));
  await writeCursorMcp(home, VAULT, false, {
    withHybrid: true,
    repoRoot,
    postgres: true,
    pgDsn: "postgres://x",
    launcher: null
  });
  const merged = JSON.parse(fs.readFileSync(path.join(home, ".cursor", "mcp.json"), "utf8"));
  const env = merged.mcpServers["obsidian-memory-hybrid"].env;
  assert.equal(env.VKM_PG, "1");
  assert.equal(env.VKM_PG_DSN, "postgres://x");
});
