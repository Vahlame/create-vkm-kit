/**
 * `--windows-audit`: does anything on THIS machine still put a console window on screen?
 *
 * Two questions, because they fail independently:
 *
 *  1. **Wiring** — is every hook and MCP server started through `vkm-runhidden.exe`? A config
 *     written before the launcher existed, or by a second harness, keeps starting `node` directly,
 *     and nothing in the kit notices: the fallback is silent by design (a source checkout with no
 *     Go must still work). Silent is right for the fallback and wrong for the diagnosis.
 *  2. **Behaviour** — `--watch` counts console windows that actually take the foreground while it
 *     runs. Everything else the kit has is a source grep in CI on Linux, where this defect cannot
 *     be observed at all. The number this prints is the only evidence that the fix holds on the
 *     machine the user is playing a game on.
 *
 * The pure functions here take parsed config objects, never paths, so the whole decision table is
 * unit-tested off Windows.
 *
 * @module
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pc from "picocolors";
import { atomicWriteJson, stripLeadingUtf8Bom } from "./settings-io.mjs";
import { resolveLauncher } from "./mcp-merge.mjs";

/** MCP servers the kit owns. Anything else in a user's config is theirs and is never touched. */
export const KIT_SERVERS = [
  "basic-memory",
  "obsidian-memory-hybrid",
  "obscura-web",
  "vkm-downloads"
];

/** @typedef {{surface: string, name: string, command: string, ok: boolean, reason: string}} Finding */

/** Is this `command` the windowless launcher? Case-insensitive: Windows paths are. */
export function isLauncher(command, launcher) {
  if (!command || !launcher) return false;
  return (
    path.win32.basename(String(command)).toLowerCase() ===
    path.win32.basename(launcher).toLowerCase()
  );
}

/**
 * Audit the `mcpServers` map of a config file (Claude's `~/.claude.json`, Cursor's `mcp.json`).
 * @param {any} config parsed config, or null when the file is absent
 * @param {{launcher: string, surface: string}} opts
 * @returns {Finding[]}
 */
export function auditMcpServers(config, { launcher, surface }) {
  const servers = config?.mcpServers;
  if (!servers) return [];
  /** @type {Finding[]} */
  const out = [];
  for (const name of KIT_SERVERS) {
    const server = servers[name];
    if (!server) continue;
    const ok = isLauncher(server.command, launcher);
    out.push({
      surface,
      name,
      command: String(server.command ?? ""),
      ok,
      reason: ok
        ? "starts through the launcher"
        : "starts directly: its children get visible consoles"
    });
  }
  return out;
}

/**
 * Audit Claude's hook entries. A hook the kit owns either IS the launcher or names a script under
 * `.claude/hooks/`; a user's own hooks are reported as neither ok nor broken — they are not ours.
 * @param {any} settings parsed settings.json, or null
 * @param {{launcher: string, surface: string}} opts
 * @returns {Finding[]}
 */
export function auditClaudeHooks(settings, { launcher, surface }) {
  /** @type {Finding[]} */
  const out = [];
  for (const [event, matchers] of Object.entries(settings?.hooks ?? {})) {
    for (const matcher of Array.isArray(matchers) ? matchers : []) {
      for (const hook of matcher?.hooks ?? []) {
        if (!isKitHook(hook, launcher)) continue;
        const ok = isLauncher(hook.command, launcher);
        out.push({
          surface,
          name: `${event}:${hookScript(hook)}`,
          command: String(hook.command ?? ""),
          ok,
          reason: ok
            ? "starts through the launcher"
            : "starts node directly: one console per tool call"
        });
      }
    }
  }
  return out;
}

/** A hook entry the kit installed: the launcher itself, or a script living in `.claude/hooks/`. */
function isKitHook(hook, launcher) {
  if (isLauncher(hook?.command, launcher)) return true;
  const parts = [hook?.command, ...(hook?.args ?? [])].map((p) =>
    String(p ?? "").replace(/\\/g, "/")
  );
  return parts.some((p) => p.includes("/.claude/hooks/"));
}

/** The script a hook entry runs, for display — the first argument that looks like a JS file. */
function hookScript(hook) {
  const parts = [hook?.command, ...(hook?.args ?? [])].map(String);
  const script = parts.find((p) => /\.(mjs|js|cjs)$/i.test(p));
  return script ? path.win32.basename(script) : (parts[0] ?? "?");
}

/**
 * Rewrite kit-owned MCP entries to start through the launcher. Returns a NEW object; the caller's
 * config is never mutated, so a dry run is just "do not write the result".
 * @param {any} config
 * @param {string} launcher
 * @returns {{config: any, changed: string[]}}
 */
export function fixMcpServers(config, launcher) {
  const servers = config?.mcpServers;
  if (!servers) return { config, changed: [] };
  /** @type {string[]} */
  const changed = [];
  const next = { ...servers };
  for (const name of KIT_SERVERS) {
    const server = servers[name];
    if (!server || isLauncher(server.command, launcher)) continue;
    next[name] = { ...server, command: launcher, args: [server.command, ...(server.args ?? [])] };
    changed.push(name);
  }
  return { config: { ...config, mcpServers: next }, changed };
}

/**
 * Rewrite kit-owned hook entries the same way. User hooks are left byte-identical.
 * @param {any} settings
 * @param {string} launcher
 * @returns {{settings: any, changed: string[]}}
 */
export function fixClaudeHooks(settings, launcher) {
  /** @type {string[]} */
  const changed = [];
  const hooks = {};
  for (const [event, matchers] of Object.entries(settings?.hooks ?? {})) {
    hooks[event] = (Array.isArray(matchers) ? matchers : []).map((matcher) => ({
      ...matcher,
      hooks: (matcher?.hooks ?? []).map((hook) => {
        if (!isKitHook(hook, launcher) || isLauncher(hook.command, launcher)) return hook;
        changed.push(`${event}:${hookScript(hook)}`);
        return { ...hook, command: launcher, args: [hook.command, ...(hook.args ?? [])] };
      })
    }));
  }
  if (!changed.length) return { settings, changed };
  return { settings: { ...settings, hooks }, changed };
}

/**
 * Audit a Codex `config.toml` by line, since the kit writes that file by hand and pulling in a TOML
 * parser to read four `command =` lines is not worth a dependency. Reports only: rewriting TOML
 * with a regex is how a config file gets corrupted, so the fix path is a re-run of the installer.
 * @param {string|null} toml raw file contents, or null when absent
 * @param {{launcher: string, surface: string}} opts
 * @returns {Finding[]}
 */
export function auditCodexToml(toml, { launcher, surface }) {
  if (!toml) return [];
  /** @type {Finding[]} */
  const out = [];
  let section = "(root)";
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[(.+?)\]$/.exec(line);
    if (header) {
      section = header[1];
      continue;
    }
    const m = /^command\s*=\s*(.+)$/.exec(line);
    if (!m) continue;
    const value = m[1].trim();
    // Both shapes the kit writes: a bare string, and an array whose first element is the program.
    const first = value.startsWith("[")
      ? (/"([^"]+)"/.exec(value)?.[1] ?? "")
      : value.replace(/^["']|["']$/g, "");
    if (!/vkm|\.claude|\.codex|node/i.test(first)) continue; // someone else's entry
    const ok = isLauncher(first, launcher) || first.toLowerCase().includes("runhidden");
    out.push({
      surface,
      name: section,
      command: first,
      ok,
      reason: ok ? "starts through the launcher" : "starts directly; re-run the installer to rewire"
    });
  }
  return out;
}

/**
 * Count console windows that take the foreground over `seconds`.
 *
 * Implemented with a tight `GetForegroundWindow` loop through PowerShell rather than a native
 * addon: the flash lasts milliseconds, polling has to be sub-millisecond, and every Windows box
 * already has PowerShell. Both console window classes are counted — Windows 11 hosts consoles in
 * `CASCADIA_HOSTING_WINDOW_CLASS`, and a detector that only knows `ConsoleWindowClass` misses them.
 *
 * @param {number} seconds
 * @param {{ run?: (file: string) => {stdout: string, status: number|null} }} [deps]
 * @returns {{steals: number, lines: string[]}}
 */
export function watchForeground(seconds, deps = {}) {
  const run =
    deps.run ??
    ((file) => {
      // Through the launcher, like everything else. Not pedantry: `Add-Type` in the sampler makes
      // PowerShell shell out to `csc.exe`, so this is a parent with console-subsystem descendants —
      // exactly the shape that gets handed a brand new VISIBLE console under CREATE_NO_WINDOW. A
      // measuring tool that causes the flash it measures would be worse than no measurement.
      const launcher = resolveLauncher();
      const argv = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file];
      const [bin, args] = launcher ? [launcher, ["powershell", ...argv]] : ["powershell", argv];
      const res = spawnSync(bin, args, { encoding: "utf8", windowsHide: !launcher });
      return { stdout: res.stdout ?? "", status: res.status };
    });

  const dir = mkdtempSync(path.join(tmpdir(), "vkm-audit-"));
  const file = path.join(dir, "watch.ps1");
  writeFileSync(file, watchScript(seconds), "utf8");
  try {
    const { stdout } = run(file);
    const lines = stdout.split(/\r?\n/).filter((l) => l.trim());
    const steals = lines.filter((l) => l.startsWith("STEAL")).length;
    return { steals, lines };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Read and parse a JSON config, tolerating absence and a BOM. Never throws on a missing file. */
function readJsonSafe(fp) {
  if (!existsSync(fp)) return null;
  try {
    return JSON.parse(stripLeadingUtf8Bom(readFileSync(fp, "utf8")));
  } catch {
    return null;
  }
}

/** The four config surfaces this audits, in the order a user would think of them. */
export function auditSurfaces(home) {
  return {
    claudeSettings: path.join(home, ".claude", "settings.json"),
    claudeMcp: path.join(home, ".claude.json"),
    codexToml: path.join(home, ".codex", "config.toml"),
    cursorMcp: path.join(home, ".cursor", "mcp.json")
  };
}

/**
 * `--windows-audit [--fix] [--watch <seconds>]`.
 *
 * Exit code is the contract: 0 means every kit-owned entry starts through the launcher, 1 means at
 * least one does not (or, with `--watch`, that a console took the foreground). That makes it usable
 * from CI and from a shell one-liner, not just readable by a human.
 *
 * @param {{home: string, fix?: boolean, watchSeconds?: number|null, dryRun?: boolean}} opts
 * @returns {Promise<number>} process exit code
 */
export async function runWindowsAudit({ home, fix = false, watchSeconds = null, dryRun = false }) {
  const launcher = resolveLauncher(path.join(home, ".claude"));
  const fps = auditSurfaces(home);

  if (process.platform !== "win32") {
    console.log(pc.dim("windows-audit: not Windows — there are no consoles to suppress here."));
    return 0;
  }
  if (!launcher) {
    console.log(
      pc.red("windows-audit: no vkm-runhidden.exe in ~/.claude/bin.") +
        "\n  Every hook and MCP server is starting node directly, so each one can put a console on" +
        "\n  screen. Build it with `npm run build:runhidden` or re-run the installer."
    );
    return 1;
  }

  /** @type {Finding[]} */
  const findings = [
    ...auditClaudeHooks(readJsonSafe(fps.claudeSettings), { launcher, surface: "claude/hooks" }),
    ...auditMcpServers(readJsonSafe(fps.claudeMcp), { launcher, surface: "claude/mcp" }),
    ...auditMcpServers(readJsonSafe(fps.cursorMcp), { launcher, surface: "cursor/mcp" }),
    ...auditCodexToml(existsSync(fps.codexToml) ? readFileSync(fps.codexToml, "utf8") : null, {
      launcher,
      surface: "codex/config.toml"
    })
  ];

  for (const f of findings) {
    const tag = f.ok ? pc.green("ok  ") : pc.red("FLASH");
    console.log(`${tag} ${pc.cyan(f.surface)} ${f.name}\n      ${pc.dim(f.command)} — ${f.reason}`);
  }
  if (!findings.length) console.log(pc.dim("windows-audit: no kit-owned entries found."));

  let broken = findings.filter((f) => !f.ok);

  if (fix && broken.length) {
    if (dryRun) {
      console.log(
        pc.dim(`[dry-run] would rewire ${broken.length} entr${broken.length === 1 ? "y" : "ies"}`)
      );
    } else {
      const rewired = await rewire(fps, launcher);
      for (const line of rewired) console.log(pc.green(`fixed ${line}`));
      // Codex TOML is reported, never rewritten: a regex edit of a hand-written config file is how
      // one gets corrupted. Re-running the installer regenerates it correctly.
      broken = broken.filter((f) => f.surface === "codex/config.toml");
      if (broken.length) {
        console.log(
          pc.yellow("codex/config.toml needs the installer: `npx create-vkm-kit --update`")
        );
      }
    }
  }

  if (watchSeconds) {
    console.log(pc.cyan(`watching the foreground for ${watchSeconds}s — start a research run now`));
    const { steals, lines } = watchForeground(watchSeconds);
    for (const l of lines) console.log(steals ? pc.red(l) : pc.dim(l));
    if (steals) return 1;
  }

  return broken.length ? 1 : 0;
}

/** Apply the fixes to the JSON surfaces; returns one line per rewired entry. */
async function rewire(fps, launcher) {
  /** @type {string[]} */
  const done = [];
  const settings = readJsonSafe(fps.claudeSettings);
  if (settings) {
    const { settings: next, changed } = fixClaudeHooks(settings, launcher);
    if (changed.length) {
      await atomicWriteJson(fps.claudeSettings, next);
      done.push(...changed.map((c) => `claude/hooks ${c}`));
    }
  }
  for (const [surface, fp] of [
    ["claude/mcp", fps.claudeMcp],
    ["cursor/mcp", fps.cursorMcp]
  ]) {
    const config = readJsonSafe(fp);
    if (!config) continue;
    const { config: next, changed } = fixMcpServers(config, launcher);
    if (changed.length) {
      await atomicWriteJson(fp, next);
      done.push(...changed.map((c) => `${surface} ${c}`));
    }
  }
  return done;
}

/** The sampler. Kept in one string so the whole thing is auditable in one place. */
export function watchScript(seconds) {
  const secs = Math.max(1, Math.floor(Number(seconds) || 0));
  return `Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class VkmFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
  public static long SelfConsole() { return GetConsoleWindow().ToInt64(); }
  public static string Snap() {
    IntPtr h = GetForegroundWindow();
    StringBuilder sb = new StringBuilder(256);
    GetClassName(h, sb, 256);
    uint pid = 0;
    GetWindowThreadProcessId(h, out pid);
    return h.ToInt64().ToString() + "|" + sb.ToString() + "|" + pid.ToString();
  }
}
"@
# Three things that are NOT evidence. The first version counted all three, and the negative
# control is what exposed it: five deliberately-created consoles were reported as nine, four of
# them the terminal the command was typed into.
#
#   $mine    — every process ANCESTOR of this sampler, i.e. the terminal hosting it and whatever
#              started that. Excluding by HWND is not enough: under Windows Terminal (ConPTY),
#              GetConsoleWindow() returns a HIDDEN pseudo-console handle, never the visible window,
#              so "my own console" and "the window I can see" are different HWNDs. A console that
#              a DIFFERENT process created is hosted by a different terminal process, so it is not
#              an ancestor and still counts — which is exactly the line we want to draw.
#   $self    — the pseudo-console handle anyway, for the classic conhost case where it does match.
#   $initial — whatever already held the foreground when sampling began. It was there first, so it
#              cannot have appeared.
$mine = @{}
$walk = $PID
for ($i = 0; $i -lt 12 -and $walk -gt 0; $i++) {
  $mine[[int]$walk] = $true
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$walk" -ErrorAction SilentlyContinue
  if (-not $proc) { break }
  $walk = [int]$proc.ParentProcessId
}
$self = [VkmFg]::SelfConsole()
$initial = [long]([VkmFg]::Snap().Split("|")[0])
$sw = [Diagnostics.Stopwatch]::StartNew()
$last = ""
$steals = 0
while ($sw.Elapsed.TotalSeconds -lt ${secs}) {
  $s = [VkmFg]::Snap()
  if ($s -ne $last) {
    $last = $s
    $p = $s.Split("|")
    $hwnd = [long]$p[0]
    if ($hwnd -eq $self -or $hwnd -eq $initial) { continue }
    if ($mine.ContainsKey([int]$p[2])) { continue }
    if ($p[1] -match "ConsoleWindowClass|CASCADIA_HOSTING_WINDOW_CLASS") {
      $steals++
      $img = "(exited)"
      try { $img = (Get-Process -Id ([int]$p[2]) -ErrorAction Stop).ProcessName } catch { }
      "STEAL {0:F3}s class={1} pid={2} image={3}" -f $sw.Elapsed.TotalSeconds, $p[1], $p[2], $img
    }
  }
}
"console_steals: $steals"
`;
}
