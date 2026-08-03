// vkm-kit Postgres projection installer (vkm-memory-pg): starts the local pg-service
// (embedded PGlite by default, an external server via --pg-dsn), waits for it to come up,
// and runs the ONE initial full sync so the projection is populated before the summary
// prints. BEST-EFFORT by contract, like every optional piece: a failed/skipped setup
// degrades the projection off but NEVER breaks the install, and nothing here throws.
//
// Two managed pieces, reconciled symmetrically like the sibling modules:
//   (1) the spawn-and-forget service start + initial sync (maybeSetupPostgres),
//   (2) a SessionStart hook that respawns the service when it isn't running
//       (configurePgHook — the exact ensure-otel-sink wiring, ADR-0044 shape).
// The pg-service script lives in the kit checkout (`packages/vkm-memory-pg/`), the same
// wire-by-absolute-path model as the hybrid MCP server — so the projection needs a kit
// clone (callers degrade the option off without one).
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import fse from "fs-extra";
import pc from "picocolors";
import { hookInterpreter } from "./hook-interpreter.mjs";
import { fileURLToPath } from "node:url";
import {
  atomicWriteJson,
  backupRestricted,
  isKitOwnedFile,
  mergeManagedHook,
  readSettingsSafe,
  removeManagedHook,
  setOrDeleteHooks
} from "./settings-io.mjs";
import { hookDsnPath, pgServiceDir } from "./hooks/ensure-pg-service.mjs";

export const ENSURE_PG_HOOK_STEM = "ensure-pg-service";
export const ENSURE_PG_HOOK_BASENAME = `${ENSURE_PG_HOOK_STEM}.mjs`;

/** Default process-signal implementation; injectable so tests never signal real pids. */
const defaultKill = (pid, signal) => process.kill(pid, signal);

/**
 * @typedef {{ status: "ready"|"skipped"|"manual"|"failed",
 *   backend: string|null,
 *   counts: { notes: number, chunks: number, relations: number, observations: number }|null,
 *   detail: string }} PgSetupResult
 */

function packagedHookPath(basename) {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "hooks", basename);
}

/** `<kitRoot>/packages/vkm-memory-pg/src/pg-service.mjs` (the script both pieces spawn). */
export function pgServiceScriptFromKitRoot(kitRoot) {
  return path.join(kitRoot, "packages", "vkm-memory-pg", "src", "pg-service.mjs");
}

/**
 * Start the pg-service and run the initial full sync. Never throws; returns a status the
 * summary prints. Dependency-injected so it is unit-testable without spawning anything.
 *
 * Order of operations is the contract: preflight (script + @electric-sql/pglite on disk)
 * → spawn-and-forget through the windowless launcher → poll ≤6s for service.json + a
 * passing /api/health → reconcile the backend (a service left running by a previous
 * session keeps its OLD backend; when it differs from what this run configured, SIGTERM
 * the recorded pid, respawn with the new env and re-poll — else warn explicitly) → ONE
 * POST /api/sync {mode:"full"} (the initial migration), best-effort with a 120s budget —
 * a huge vault's first sync failing to finish in time must not turn a running service
 * into a reported failure.
 *
 * @param {{ enable: boolean, dryRun: boolean, vaultAbs: string, kitRoot: string|null,
 *   launcher?: string|null, dsn?: string|null }} opts
 * @param {{ pathExists?: (p: string) => Promise<boolean>,
 *   readFile?: (p: string) => Promise<string>,
 *   spawnImpl?: typeof spawn, fetchImpl?: typeof fetch,
 *   killImpl?: (pid: number, signal: NodeJS.Signals | number) => void,
 *   delay?: (ms: number) => Promise<void>,
 *   pollTimeoutMs?: number, pollIntervalMs?: number, syncTimeoutMs?: number }} [deps]
 * @returns {Promise<PgSetupResult>}
 */
export async function maybeSetupPostgres(opts, deps = {}) {
  const { enable, dryRun, vaultAbs, kitRoot, launcher = null, dsn = null } = opts;
  const {
    pathExists = (p) => fse.pathExists(p),
    readFile = (p) => fse.readFile(p, "utf8"),
    spawnImpl = spawn,
    fetchImpl = fetch,
    killImpl = defaultKill,
    delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    pollTimeoutMs = 6000,
    pollIntervalMs = 250,
    syncTimeoutMs = 120_000
  } = deps;
  /** @type {(status: PgSetupResult["status"], detail: string) => PgSetupResult} */
  const result = (status, detail) => ({ status, backend: null, counts: null, detail });

  try {
    if (!enable) return result("skipped", "off");
    if (!kitRoot) return result("skipped", "no kit clone");
    if (dryRun) {
      console.log(pc.cyan("[dry-run] would start pg-service + initial sync"));
      return result("skipped", "dry-run");
    }

    const serviceScript = pgServiceScriptFromKitRoot(kitRoot);
    if (!(await pathExists(serviceScript))) {
      console.warn(
        pc.yellow("Postgres projection: pg-service not found in the kit clone — start it later.")
      );
      console.log(pc.dim(`  expected ${serviceScript}`));
      return result("manual", "pg-service script missing from the kit clone");
    }
    // PGlite is the embedded backend; an external DSN uses the `pg` driver instead, so the
    // check only gates the default path. "manual" not "failed": one `npm install` fixes it.
    if (
      !dsn &&
      !(await pathExists(path.join(kitRoot, "node_modules", "@electric-sql", "pglite")))
    ) {
      console.warn(
        pc.yellow("Postgres projection: @electric-sql/pglite is not installed — set it up later:")
      );
      console.log(`  npm install   ${pc.dim(`(in ${kitRoot})`)}`);
      return result("manual", "run `npm install` in the kit clone (@electric-sql/pglite missing)");
    }

    // Spawn-and-forget through the windowless launcher (ADR-0078): detached, no stdio, an
    // error listener so a bad spawn surfaces as a poll timeout instead of an unhandled event.
    //
    // NOT `windowsHide: true`: the service is a parent, not a leaf — it shells out to
    // Python for every dump. CREATE_NO_WINDOW on a parent is what MAKES a window appear,
    // because Windows hands each console-subsystem grandchild a brand new visible one.
    // The launcher owns a single hidden console the whole tree inherits; without a
    // launcher the child inherits the installer's own console, which the user is looking at.
    const [command, args] = launcher
      ? [launcher, [process.execPath, serviceScript, "--vault", vaultAbs]]
      : [process.execPath, [serviceScript, "--vault", vaultAbs]];
    const spawnService = () => {
      const child = spawnImpl(command, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
        env: { ...process.env, VKM_PG: "1", ...(dsn ? { VKM_PG_DSN: dsn } : {}) }
      });
      child.on("error", () => {
        // best-effort: the poll below reports the outcome
      });
      child.unref();
    };
    spawnService();

    // Poll for service.json + a passing /api/health. The service may also have been left
    // running by a previous session — then the first probe already answers.
    const serviceJsonFp = path.join(pgServiceDir(vaultAbs), "service.json");
    const attempts = Math.max(1, Math.ceil(pollTimeoutMs / pollIntervalMs));
    /** @returns {Promise<{ port: number, pid: number|null, backend: string|null }|null>} */
    const pollHealth = async () => {
      for (let i = 0; i < attempts; i++) {
        try {
          const info = JSON.parse(await readFile(serviceJsonFp));
          if (info && Number.isInteger(info.port)) {
            const res = await fetchImpl(`http://127.0.0.1:${info.port}/api/health`, {
              signal: AbortSignal.timeout(2000)
            });
            if (res.ok) {
              const health = await res.json();
              return {
                port: info.port,
                pid: Number.isInteger(info.pid) ? info.pid : null,
                backend: typeof health?.backend === "string" ? health.backend : null
              };
            }
          }
        } catch {
          // not up yet — keep polling
        }
        await delay(pollIntervalMs);
      }
      return null;
    };
    let up = await pollHealth();
    if (!up) {
      console.warn(
        pc.yellow(
          `Postgres projection: pg-service did not come up within ${Math.round(pollTimeoutMs / 1000)}s — check it later.`
        )
      );
      console.log(pc.dim(`  service dir: ${path.dirname(serviceJsonFp)}`));
      return result("failed", "pg-service did not come up in time");
    }

    // Reconcile a backend change: a service left running by a previous session keeps its
    // OLD backend (the spawn above bounced off its service.lock), so a re-run that adds
    // or drops --pg-dsn would otherwise report "ready" while the requested backend never
    // takes effect. Stop the recorded pid, respawn with this run's env, and re-poll; when
    // the stop cannot happen, say so explicitly instead of pretending the switch worked.
    const wantBackend = dsn ? "dsn" : "pglite";
    if (up.backend && up.backend !== wantBackend) {
      if (up.pid === null) {
        console.warn(
          pc.yellow(
            `Postgres projection: running service uses backend "${up.backend}" (this install configured "${wantBackend}") and records no pid — restart it manually.`
          )
        );
      } else {
        console.log(
          pc.yellow(
            `Postgres projection: running service uses backend "${up.backend}", this install configured "${wantBackend}" — restarting it.`
          )
        );
        try {
          killImpl(up.pid, "SIGTERM");
        } catch {
          // ESRCH = already gone (the liveness poll below confirms); EPERM = cannot stop.
        }
        // Bounded wait for the old process to exit: the respawn is refused for as long as
        // the previous service.json still names a live pid.
        let stopped = false;
        for (let i = 0; i < attempts; i++) {
          try {
            killImpl(up.pid, 0);
          } catch {
            stopped = true;
            break;
          }
          await delay(pollIntervalMs);
        }
        if (!stopped) {
          console.warn(
            pc.yellow(
              `Postgres projection: could not stop the running service (pid ${up.pid}) — it still uses backend "${up.backend}". Stop it manually for the new backend to take effect.`
            )
          );
        } else {
          spawnService();
          const fresh = await pollHealth();
          if (!fresh) {
            console.warn(
              pc.yellow(
                "Postgres projection: pg-service did not come back after the backend change — start it later."
              )
            );
            return result("failed", "pg-service did not come back after the backend change");
          }
          up = fresh;
          if (up.backend && up.backend !== wantBackend) {
            console.warn(
              pc.yellow(
                `Postgres projection: restarted service still reports backend "${up.backend}" (wanted "${wantBackend}").`
              )
            );
          }
        }
      }
    }
    const port = up.port;
    const backend = up.backend;

    // Initial full sync (the one-time migration). Best-effort: a sync that fails or
    // overruns its 120s budget leaves a READY service whose watcher catches up later.
    let counts = null;
    try {
      const token = (await readFile(path.join(pgServiceDir(vaultAbs), "service.token"))).trim();
      const res = await fetchImpl(`http://127.0.0.1:${port}/api/sync`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-vkm-pg-token": token },
        body: JSON.stringify({ mode: "full" }),
        signal: AbortSignal.timeout(syncTimeoutMs)
      });
      const body = await res.json();
      if (res.ok && body && typeof body === "object" && body.synced) counts = body.synced;
    } catch {
      console.warn(
        pc.yellow("Postgres projection: initial sync did not finish — it will catch up on its own.")
      );
    }
    const resolvedBackend = backend ?? (dsn ? "dsn" : "pglite");
    console.log(
      pc.green("Postgres projection ready:"),
      pc.dim(
        `${resolvedBackend} on 127.0.0.1:${port}` +
          (counts
            ? ` — notes ${counts.notes}, chunks ${counts.chunks}, relations ${counts.relations}, observations ${counts.observations}`
            : "")
      )
    );
    return { status: "ready", backend: resolvedBackend, counts, detail: `127.0.0.1:${port}` };
  } catch (e) {
    console.warn(pc.yellow("Postgres projection setup skipped:"), e?.message || e);
    return result("failed", String(e?.message || e));
  }
}

/**
 * Best-effort stop of the pg-service that owns `serviceDir` (`<root>/<slug>/`): read
 * service.json and, when the recorded pid is alive, SIGTERM it and log what was stopped.
 * SIGTERM because the service's own handler closes the adapter and unlinks
 * service.json/service.lock; where signals are emulated by plain termination (win32) the
 * stale files are harmless — every liveness check re-probes the pid. Never throws.
 * @param {string} serviceDir
 * @param {boolean} dryRun
 * @param {(pid: number, signal: NodeJS.Signals | number) => void} killImpl
 * @returns {Promise<boolean>} true when a live service was (or, under dryRun, would be) stopped
 */
async function stopServiceInDir(serviceDir, dryRun, killImpl) {
  try {
    const info = JSON.parse(await fse.readFile(path.join(serviceDir, "service.json"), "utf8"));
    if (!info || !Number.isInteger(info.pid)) return false;
    killImpl(info.pid, 0); // liveness probe — throws when the pid is gone
    if (dryRun) {
      console.log(
        pc.cyan("[dry-run] would stop pg-service"),
        pc.dim(`pid ${info.pid} (${serviceDir})`)
      );
      return true;
    }
    killImpl(info.pid, "SIGTERM");
    console.log(pc.green("Stopped pg-service:"), pc.dim(`pid ${info.pid} (${serviceDir})`));
    return true;
  } catch {
    return false; // no service.json, corrupt JSON, or a dead/unsignalable pid — nothing to stop
  }
}

/**
 * Stop the pg-service of ONE vault (best-effort, never throws). Used by the
 * `--no-postgres` reconcile path, which knows exactly which vault it is disabling.
 * @param {string} vaultAbs
 * @param {boolean} dryRun
 * @param {{ env?: NodeJS.ProcessEnv,
 *   killImpl?: (pid: number, signal: NodeJS.Signals | number) => void }} [deps]
 */
export async function stopPgService(
  vaultAbs,
  dryRun,
  { env = process.env, killImpl = defaultKill } = {}
) {
  return stopServiceInDir(pgServiceDir(vaultAbs, env), dryRun, killImpl);
}

/**
 * Stop EVERY live pg-service under the data root (`VKM_PG_DATA_ROOT` or `~/.vkm/pg`).
 * `--uninstall` takes no vault argument, so it sweeps the per-vault slug dirs instead of
 * resolving one. Best-effort and never throws — a dir without a live service is skipped.
 * @param {boolean} dryRun
 * @param {{ env?: NodeJS.ProcessEnv,
 *   killImpl?: (pid: number, signal: NodeJS.Signals | number) => void }} [deps]
 */
export async function stopAllPgServices(
  dryRun,
  { env = process.env, killImpl = defaultKill } = {}
) {
  const root = env.VKM_PG_DATA_ROOT || path.join(os.homedir(), ".vkm", "pg");
  let entries;
  try {
    entries = await fse.readdir(root, { withFileTypes: true });
  } catch {
    return; // no data root — no service was ever started on this machine
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await stopServiceInDir(path.join(root, entry.name), dryRun, killImpl);
    }
  }
}

/**
 * Install / reconcile / remove the SessionStart keep-alive hook. Same symmetric contract
 * as configureTelemetry (the module this mirrors): `enable:false` strips a prior install —
 * and, when the vault is known, also stops that vault's RUNNING pg-service (nothing else
 * ever would; a `--no-postgres` re-run must not leave a daemon behind).
 * Hooks do NOT inherit MCP env, so the hook is only INSTALLED when the postgres option is
 * on — its argv carries everything it needs (script path + vault + optional DSN).
 * @param {string} home
 * @param {boolean} dryRun
 * @param {{ enable?: boolean, kitRoot?: string | null, vaultAbs?: string | null,
 *   dsn?: string | null, env?: NodeJS.ProcessEnv,
 *   killImpl?: (pid: number, signal: NodeJS.Signals | number) => void }} [opts]
 */
export async function configurePgHook(
  home,
  dryRun,
  {
    enable = true,
    kitRoot = null,
    vaultAbs = null,
    dsn = null,
    env = process.env,
    killImpl = defaultKill
  } = {}
) {
  const claudeDir = path.join(home, ".claude");
  const hooksDir = path.join(claudeDir, "hooks");
  const settingsFp = path.join(claudeDir, "settings.json");
  const hookDest = path.join(hooksDir, ENSURE_PG_HOOK_BASENAME);
  // Composition root: resolved ONCE against the claudeDir being installed into, not against
  // the current user's `~/.claude` — `home` is a parameter here, every test passes a temp one.
  const interpreter = hookInterpreter(claudeDir);

  try {
    if (enable && (!kitRoot || !vaultAbs)) {
      console.log(
        pc.dim("Postgres keep-alive hook skipped: needs a kit clone to host the pg-service.")
      );
      return;
    }
    // Symmetric teardown covers the RUNNING daemon, not just the settings entry — and it
    // must run BEFORE the hook-presence early-return: a service can be alive with the
    // hook long gone (or never installed), and disabling postgres has to stop it either way.
    if (!enable && vaultAbs) await stopPgService(vaultAbs, dryRun, { env, killImpl });
    let { existing, priorBytes, invalidJson, rawText } = await readSettingsSafe(settingsFp);
    const oursPresent = rawText.includes(ENSURE_PG_HOOK_STEM);
    if (!enable && !oursPresent) return;

    if (dryRun) {
      console.log(
        pc.cyan(
          enable
            ? "[dry-run] would install SessionStart pg-service keep-alive hook"
            : "[dry-run] would remove the pg-service keep-alive hook"
        )
      );
      return;
    }

    if (enable) {
      await fse.ensureDir(hooksDir);
      await fse.copy(packagedHookPath(ENSURE_PG_HOOK_BASENAME), hookDest, { overwrite: true });
    }

    // External DSN lives in a 0o600 file under the vault's pg dir — never inline in
    // settings.json (that file is world-readable to every process as the user). argv[4]
    // carries the PATH; the hook reads the secret at respawn time.
    /** @type {string | null} */
    let dsnArg = null;
    if (enable && dsn && vaultAbs) {
      const dsnFile = hookDsnPath(vaultAbs, env);
      await fse.ensureDir(path.dirname(dsnFile));
      await fse.writeFile(dsnFile, `${dsn}\n`, { encoding: "utf8", mode: 0o600 });
      dsnArg = dsnFile;
      console.log(
        pc.dim(`Postgres DSN stored in ${dsnFile} (0o600) — not written into settings.json`)
      );
    }

    if (invalidJson) {
      const bak = await backupRestricted(settingsFp, priorBytes);
      console.warn(pc.yellow("Invalid JSON in ~/.claude/settings.json; backed up to"), bak);
      existing = {};
    }

    let merged = { ...existing };
    const hadHooks =
      merged.hooks && typeof merged.hooks === "object" && !Array.isArray(merged.hooks);
    let hookMap = hadHooks ? { .../** @type {Record<string, unknown>} */ (merged.hooks) } : {};
    hookMap = enable
      ? mergeManagedHook(
          hookMap,
          "SessionStart",
          "*",
          {
            command: interpreter,
            // argv[4] (optional) is the path to hook-dsn (or was historically the raw DSN).
            // Hooks inherit no MCP env; without this every respawn flips back to PGlite.
            args: [
              hookDest,
              pgServiceScriptFromKitRoot(/** @type {string} */ (kitRoot)),
              vaultAbs,
              ...(dsnArg ? [dsnArg] : [])
            ]
          },
          ENSURE_PG_HOOK_STEM
        )
      : removeManagedHook(hookMap, "SessionStart", ENSURE_PG_HOOK_STEM);
    merged = setOrDeleteHooks(merged, Boolean(hadHooks), hookMap);

    if (priorBytes && !invalidJson) {
      const bak = await backupRestricted(settingsFp, priorBytes);
      console.log(pc.dim("Backed up previous settings.json to"), bak);
    }
    await atomicWriteJson(settingsFp, merged);

    if (enable) {
      console.log(
        pc.green("Postgres keep-alive:"),
        pc.dim("SessionStart hook respawns the pg-service when it is not running")
      );
    } else if (oursPresent) {
      console.log(pc.green("Postgres keep-alive hook removed:"), settingsFp);
    }
  } catch (e) {
    console.warn(pc.yellow("Could not configure the pg-service hook (skipped):"), e?.message || e);
  }
}

/**
 * Full teardown: the settings entry + the hook script file (marker-checked) + every live
 * pg-service under the data root — `--uninstall` has no vault argument, so it sweeps the
 * slug dirs (see {@link stopAllPgServices}) instead of stopping one vault's service.
 * @param {string} home
 * @param {boolean} dryRun
 * @param {{ env?: NodeJS.ProcessEnv,
 *   killImpl?: (pid: number, signal: NodeJS.Signals | number) => void }} [deps]
 */
export async function uninstallPgHook(
  home,
  dryRun,
  { env = process.env, killImpl = defaultKill } = {}
) {
  await configurePgHook(home, dryRun, { enable: false });
  await stopAllPgServices(dryRun, { env, killImpl });
  const fp = path.join(home, ".claude", "hooks", ENSURE_PG_HOOK_BASENAME);
  if (!(await fse.pathExists(fp))) return;
  const owned = await isKitOwnedFile(fp);
  if (dryRun) {
    console.log(
      owned
        ? pc.cyan("[dry-run] would remove")
        : pc.yellow("[dry-run] would SKIP (not recognized as this kit's file)"),
      pc.dim(fp)
    );
    return;
  }
  if (!owned) {
    console.warn(pc.yellow("Skipped (not recognized as this kit's file):"), fp);
    return;
  }
  try {
    await fse.remove(fp);
    console.log(pc.green("Removed"), pc.dim(fp));
  } catch (e) {
    console.warn(pc.yellow("Could not remove"), fp, e?.message || e);
  }
}
