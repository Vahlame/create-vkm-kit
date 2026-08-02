/**
 * Is the daemon we are about to use one WE started?
 *
 * The launcher can only protect a process tree it owns. Ollama and SearXNG are both "start it if it
 * is not already up" — and when something else already started them (the Ollama desktop app at
 * login, a leftover from a previous session, a terminal), the kit attaches to a daemon whose
 * console it does not control. Every model runner and every worker that daemon spawns is then free
 * to put a window on screen, and nothing in the kit can stop it.
 *
 * This does not guess: it resolves the PID listening on the port, walks its parent chain, and looks
 * for `vkm-runhidden.exe`. The answer is a fact about the running machine, reported as a warning on
 * the research result. Restarting someone else's daemon is destructive, so it happens only when
 * `VKM_ADOPT_DAEMONS=1` says it may.
 *
 * Windows-only by nature; everywhere else there is no console to steal and every check is a no-op.
 *
 * @module
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { throughHiddenConsole } from "@vkmikc/vkm-core/hidden-console";

const execFileAsync = promisify(execFile);

/**
 * One PowerShell round-trip: port -> listening PID -> parent chain -> images.
 *
 * The port is interpolated, not passed as a parameter: `powershell -Command "param(...)" -Port N`
 * silently ignores the argument and the probe then reports every daemon as absent — a check that
 * always says "nothing to see" is worse than no check. `Number.isInteger` is what makes that safe;
 * nothing else from the caller reaches the script.
 */
const probeScript = (
  port
) => `$conn = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1
if (-not $conn) { '{"listening":false}'; exit 0 }
$chain = @()
$pid_ = [int]$conn.OwningProcess
for ($i = 0; $i -lt 12 -and $pid_ -gt 0; $i++) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$pid_" -ErrorAction SilentlyContinue
  if (-not $p) { break }
  $chain += [pscustomobject]@{ pid = [int]$p.ProcessId; image = $p.Name }
  $pid_ = [int]$p.ParentProcessId
}
[pscustomobject]@{ listening = $true; chain = $chain } | ConvertTo-Json -Depth 4 -Compress`;

/** Exported for the test that pins the interpolation, since a silent probe is the failure mode. */
export { probeScript };

/**
 * Probe one port. Never throws: a daemon check that can fail the run it was protecting is worse
 * than no check at all.
 *
 * @param {number} port
 * @param {{ run?: (script: string, port: number) => Promise<string>, platform?: string }} [deps]
 * @returns {Promise<{listening: boolean, chain: {pid: number, image: string}[]}>}
 */
export async function probePort(port, deps = {}) {
  const { platform = process.platform } = deps;
  if (platform !== "win32" || !Number.isInteger(port) || port <= 0) {
    return { listening: false, chain: [] };
  }
  const run =
    deps.run ??
    (async (script) => {
      // PowerShell is console-subsystem and spawns its own helpers, so this goes through the
      // launcher for the same reason every other spawn in the kit does (ADR-0078). A probe that
      // flashed a console would be reporting on a problem it was adding to.
      const launch = throughHiddenConsole("powershell", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        script
      ]);
      const { stdout } = await execFileAsync(launch.command, launch.args, {
        windowsHide: launch.windowsHide,
        timeout: 10_000
      });
      return stdout;
    });
  try {
    const parsed = JSON.parse((await run(probeScript(port), port)).trim() || "{}");
    const chain = Array.isArray(parsed.chain) ? parsed.chain : parsed.chain ? [parsed.chain] : [];
    return { listening: Boolean(parsed.listening), chain };
  } catch {
    return { listening: false, chain: [] };
  }
}

/**
 * The verdict, kept pure so the whole decision table is tested without a machine.
 *
 * A chain containing the launcher means the daemon is inside a tree that owns a hidden console —
 * ours, whoever typed the command. An empty chain means we could not tell, which is reported as
 * "unknown" rather than "foreign": accusing a correctly-started daemon would send the user chasing
 * a process that was never the problem.
 *
 * @param {{listening: boolean, chain: {pid: number, image: string}[]}} probe
 * @returns {{status: "absent"|"ours"|"foreign"|"unknown", pid: number|null, image: string|null}}
 */
export function verdict(probe) {
  if (!probe.listening) return { status: "absent", pid: null, image: null };
  if (!probe.chain.length) return { status: "unknown", pid: null, image: null };
  const [own] = probe.chain;
  const ours = probe.chain.some((p) => /vkm-runhidden\.exe$/i.test(p.image ?? ""));
  return {
    status: ours ? "ours" : "foreign",
    pid: own?.pid ?? null,
    image: own?.image ?? null
  };
}

/**
 * Ports the kit's own daemons listen on, with the label used in the warning. Both follow the same
 * env overrides the modules that START them use, so a relocated daemon is not reported as absent.
 */
export function watchedDaemons(env = process.env) {
  const ollama = Number(new URL(env.OLLAMA_HOST || "http://127.0.0.1:11434").port || 11434);
  return [
    { label: "ollama", port: ollama },
    { label: "searxng", port: Number(env.OBSCURA_SEARXNG_PORT) || 8888 }
  ];
}

/**
 * Check every watched daemon and return one warning per foreign one.
 *
 * @param {{ probe?: typeof probePort, daemons?: {label: string, port: number}[], env?: NodeJS.ProcessEnv }} [deps]
 * @returns {Promise<{reason: "foreign-daemon", label: string, image: string|null, pid: number|null, hint: string}[]>}
 */
export async function foreignDaemons(deps = {}) {
  const probe = deps.probe ?? probePort;
  const daemons = deps.daemons ?? watchedDaemons(deps.env);
  const out = [];
  for (const { label, port } of daemons) {
    const v = verdict(await probe(port));
    if (v.status !== "foreign") continue;
    out.push({
      reason: /** @type {const} */ ("foreign-daemon"),
      label,
      image: v.image,
      pid: v.pid,
      hint:
        `${label} is running outside the windowless launcher (${v.image} pid ${v.pid}), so the ` +
        `consoles ITS children create cannot be suppressed. Set VKM_ADOPT_DAEMONS=1 to have the ` +
        `kit stop and restart it under the launcher.`
    });
  }
  return out;
}

/** Is the destructive path enabled? Explicit opt-in: this kills a process the user may own. */
export function adoptionEnabled(env = process.env) {
  return env.VKM_ADOPT_DAEMONS === "1";
}

/**
 * Stop a foreign daemon so the caller's own `ensure…` can start it again under the launcher.
 *
 * Deliberately narrow: it takes a PID that a probe just identified, and it never searches for
 * processes by name. Killing by image name is how a script takes down a user's unrelated work.
 *
 * @param {number} pid
 * @param {{ run?: (pid: number) => Promise<void>, platform?: string }} [deps]
 * @returns {Promise<boolean>} whether the stop was issued
 */
export async function stopDaemon(pid, deps = {}) {
  const { platform = process.platform } = deps;
  if (platform !== "win32" || !Number.isInteger(pid) || pid <= 0) return false;
  const run =
    deps.run ??
    (async (target) => {
      // `/T` takes the daemon's whole tree — a model runner left behind by a killed parent would
      // keep the port bound and the next `ensure…` would attach to it all over again.
      const launch = throughHiddenConsole("taskkill", ["/PID", String(target), "/T", "/F"]);
      await execFileAsync(launch.command, launch.args, {
        windowsHide: launch.windowsHide,
        timeout: 10_000
      });
    });
  try {
    await run(pid);
    return true;
  } catch {
    return false;
  }
}
