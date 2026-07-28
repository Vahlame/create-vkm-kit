#!/usr/bin/env node
/**
 * Applies `/model` and `/effort` to the RUNNING Claude Code session, by typing them.
 *
 * # Why this exists, and why it is opt-in
 *
 * There is no API for it. A hook can read the effort level and (on `SessionStart` only)
 * the model, and can change neither — verified against the hooks reference and measured:
 * writing `effortLevel` into `settings.json` left 35 consecutive tool calls reporting the
 * old level, because that key is persistence for the NEXT session, not a live control.
 * The mid-session control is the slash command, and the only thing that issues one is
 * whoever is at the keyboard.
 *
 * So this types it. `SendKeys` into the window that owns the session — the same input the
 * user would produce, from a process the user's own agent started.
 *
 * That is a loaded gun, so it is `VKM_EFFORT_APPLY=keys` opt-in, Windows-only, and it
 * refuses to fire unless the FOREGROUND window belongs to a `claude` process. Never
 * focus-stealing, never typing into whatever happens to be in front: if the user tabbed
 * away to their editor, this exits having done nothing, and the persisted decision plus
 * the one-line notice remain the fallback. Both arguments are checked against the closed
 * sets below before they get anywhere near a keystroke stream — an unvalidated string
 * typed into an agent's own prompt box is a command-injection surface, not a parameter.
 *
 * # Why it waits for the window instead of typing into it in the background
 *
 * Not a design preference — a measured limit of the target. The desktop app is Chromium
 * (`Chrome_WidgetWin_1`), and everything that could deliver input to it without focus was
 * tried on 2026-07-27:
 *
 *   - UIA exposes the prompt as a Group with TextPattern only (no ValuePattern), so there
 *     is nothing to `SetValue` on. Its 435-element tree appears only after a first query
 *     wakes Chromium's accessibility layer.
 *   - `PostMessage(WM_CHAR)` to the `Chrome_RenderWidgetHostHWND` child DOES type, verified
 *     by reading the text back through UIA — but only while the window is active. Repeated
 *     with the window minimized, not one character arrived.
 *
 * Chromium accepts keyboard input only when its window is active, so "type into it while
 * the user works in another app" and "never take the user's foreground" cannot both hold.
 * Given that choice, the user's foreground wins, and the effort gate retries on later
 * edits — the moment the user is back in the window, it applies itself.
 *
 * Installed into `~/.claude/hooks/` by the vkm-kit installer, next to the effort gate that
 * spawns it. (That name in this comment is also the ownership marker `--uninstall` checks
 * before deleting anything — a file without it is treated as the user's own and left.)
 *
 * Usage:
 *   node apply-model-effort.mjs --effort xhigh [--model opus] [--log <file>] [--sync]
 *
 * Exit code is always 0: a refusal is a normal outcome here, not a failure.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Closed sets. Anything else is a bug or an injection attempt; both are refused. */
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
const MODELS = new Set(["haiku", "sonnet", "opus"]); // never `fable`: excluded by design

/** Process name that must own the foreground window for typing to be safe. */
const TARGET_PROCESS = (process.env.VKM_EFFORT_APPLY_PROCESS || "claude").replace(
  /[^a-zA-Z0-9_.-]/g,
  ""
);

export function parseArgs(argv) {
  const out = { model: null, effort: null, log: null, sync: false };
  for (let i = 0; i < argv.length; i++) {
    const next = argv[i + 1];
    if (argv[i] === "--model" && next) out.model = next.toLowerCase().trim();
    else if (argv[i] === "--effort" && next) out.effort = next.toLowerCase().trim();
    else if (argv[i] === "--log" && next) out.log = next;
    else if (argv[i] === "--sync") out.sync = true;
  }
  return out;
}

/**
 * The commands to type, in order. Model first: `/effort` is validated against what the
 * model supports, so raising the model before the level is what lets a higher level stick.
 * @returns {string[]} e.g. ["/model opus", "/effort xhigh"]
 */
export function commandsFor({ model, effort }) {
  const cmds = [];
  if (model && MODELS.has(model)) cmds.push(`/model ${model}`);
  if (effort && EFFORTS.has(effort)) cmds.push(`/effort ${effort}`);
  return cmds;
}

/**
 * PowerShell that types `cmds` ONLY when the foreground window belongs to TARGET_PROCESS.
 *
 * The guard runs in the same process that does the typing, immediately before it — a
 * check performed anywhere else could be stale by the time the keys land.
 */
export function powershellScript(cmds) {
  const lines = cmds
    .map(
      (c) =>
        `  [System.Windows.Forms.SendKeys]::SendWait('${c}{ENTER}'); Start-Sleep -Milliseconds 250`
    )
    .join("\n");
  return `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;using System.Runtime.InteropServices;
public class VkmFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
}
"@
$h = [VkmFg]::GetForegroundWindow()
$target = 0
[void][VkmFg]::GetWindowThreadProcessId($h, [ref]$target)
$name = (Get-Process -Id $target -ErrorAction SilentlyContinue).ProcessName
if ($name -ne '${TARGET_PROCESS}') { Write-Output "skipped: foreground is '$name'"; exit 0 }
${lines}
Write-Output "typed: ${cmds.join(" ; ")}"
`;
}

function log(fp, message) {
  if (!fp) return;
  try {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.appendFileSync(fp, `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch {
    /* logging is never worth failing over */
  }
}

// ── the focus-free path: Chrome DevTools Protocol ─────────────────────────────────────
//
// The desktop app is Electron, so the renderer accepts input over CDP no matter which
// window the user is looking at — the one mechanism that satisfies "apply it while I work
// in another app" AND "never take my foreground", because it never touches the OS input
// queue at all. It costs an app relaunched with `--remote-debugging-port` (see
// `scripts/claude-desktop-debug.ps1`), and that port is a real trade-off: anything running
// as this user can then drive the app. Opt-in, off by default, documented as such.

/** Default port, matching the launcher script. */
export const CDP_PORT = Number(process.env.VKM_CDP_PORT || 9222);

/** The page target to drive, or null when the port is closed / has no page. */
export async function findCdpTarget(port = CDP_PORT, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(1500)
    });
    if (!res.ok) return null;
    const targets = await res.json();
    const page = (Array.isArray(targets) ? targets : []).find(
      (t) => t?.type === "page" && typeof t.webSocketDebuggerUrl === "string"
    );
    return page ?? null;
  } catch {
    return null; // closed port is the normal case, not an error
  }
}

/**
 * The CDP calls that put ONE command into the prompt and submit it.
 *
 * `Runtime.evaluate` focuses the prompt first: `Input.insertText` goes to whatever the
 * renderer considers focused, and a React contenteditable that was never focused would
 * swallow it. Then a real key event for Enter, because the app's send handler listens for
 * one — setting `.textContent` directly would update the DOM and leave React's state (and
 * therefore the send button) believing the box is empty.
 */
export function cdpCommandSequence(command, startId = 1) {
  const focus = `(() => {
    const el = document.querySelector('[contenteditable="true"], textarea');
    if (!el) return 'no-prompt';
    el.focus();
    return 'focused';
  })()`;
  const key = (type) => ({
    type,
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    key: "Enter",
    code: "Enter",
    text: "\r"
  });
  return [
    { id: startId, method: "Runtime.evaluate", params: { expression: focus, returnByValue: true } },
    { id: startId + 1, method: "Input.insertText", params: { text: command } },
    { id: startId + 2, method: "Input.dispatchKeyEvent", params: key("keyDown") },
    { id: startId + 3, method: "Input.dispatchKeyEvent", params: key("keyUp") }
  ];
}

/**
 * Send `cmds` through CDP. Resolves "typed" on success and null when CDP is unavailable,
 * so the caller can fall back to the keyboard path.
 */
export async function applyViaCdp(cmds, { port = CDP_PORT, WS = globalThis.WebSocket } = {}) {
  if (typeof WS !== "function") return null; // no built-in WebSocket on this runtime
  const target = await findCdpTarget(port);
  if (!target) return null;

  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      resolve(v);
    };
    const ws = new WS(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => done(null), 6000);
    ws.onerror = () => done(null);
    ws.onopen = async () => {
      let id = 1;
      for (const cmd of cmds) {
        for (const msg of cdpCommandSequence(cmd, id)) ws.send(JSON.stringify(msg));
        id += 10;
        await new Promise((r) => setTimeout(r, 350)); // let the app process one before the next
      }
      clearTimeout(timer);
      done("typed");
    };
  });
}

/** PowerShell invocation for `cmds` — one place, so sync and async agree. */
function psArgs(cmds) {
  return [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    powershellScript(cmds)
  ];
}

/**
 * How to start PowerShell without a console window appearing.
 *
 * Inheritance is NOT enough here, and that was learned the expensive way: a user in a
 * full-screen game was pulled out of it by windows that opened and closed in milliseconds.
 * `Add-Type` can compile through `csc.exe`, so this process is a PARENT, and per ADR-0078
 * `windowsHide` (CREATE_NO_WINDOW) on a parent is what hands its console-subsystem child a
 * brand new VISIBLE console. The launcher owns ONE hidden console that the whole tree
 * inherits, which is the only arrangement that stays quiet.
 *
 * With no launcher on disk (a source checkout that never ran `npm run build:runhidden`) it
 * spawns PowerShell plainly and INHERITS whatever console the caller has. Deliberately not
 * `windowsHide` there: that flag is the trap, not the fix — it would leave PowerShell with
 * no console to give its own children, and Windows would hand each of them a visible one.
 *
 * @returns {{cmd: string, args: string[], opts: object}}
 */
export function hiddenPowerShell(cmds, home = os.homedir()) {
  const launcher = path.join(home, ".claude", "bin", "vkm-runhidden.exe");
  const args = psArgs(cmds);
  if (fs.existsSync(launcher)) {
    return { cmd: launcher, args: ["powershell.exe", ...args], opts: {} };
  }
  return { cmd: "powershell.exe", args, opts: {} };
}

export async function main(argv = process.argv.slice(2)) {
  const { model, effort, log: logFp, sync } = parseArgs(argv);
  const cmds = commandsFor({ model, effort });
  if (!cmds.length) return log(logFp, "nothing to apply (no valid --model/--effort)");

  // Preferred path, and the only one that works while the user is in another window — and
  // the only one that spawns NOTHING, so it cannot put a window on screen at all.
  // Silently unavailable unless the app was started with the debugging port open.
  const viaCdp = await applyViaCdp(cmds);
  if (viaCdp === "typed") {
    log(logFp, `cdp typed: ${cmds.join(" ; ")}`);
    process.stdout.write(`typed: ${cmds.join(" ; ")}\n`);
    return;
  }

  if (process.platform !== "win32") {
    return log(logFp, `unsupported platform ${process.platform}: ${cmds.join(" ; ")}`);
  }

  // Through the windowless launcher, never a bare `powershell.exe` (see hiddenPowerShell).
  const { cmd: psCmd, args: psArgv, opts: psOpts } = hiddenPowerShell(cmds);

  if (sync) {
    // The caller (the effort gate) needs the verdict: "typed" clears the pending decision,
    // anything else leaves it queued for the next edit to retry.
    const r = spawnSync(psCmd, psArgv, { ...psOpts, encoding: "utf8", timeout: 7000 });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
    log(logFp, `sync exit ${r.status}: ${out || "(no output)"}`);
    if (out) process.stdout.write(out + "\n");
    return;
  }

  const child = spawn(psCmd, psArgv, { ...psOpts, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout?.on("data", (d) => (out += d));
  child.stderr?.on("data", (d) => (out += d));
  child.on("close", (code) => log(logFp, `exit ${code}: ${out.trim() || "(no output)"}`));
  child.on("error", (e) => log(logFp, `spawn failed: ${e?.message || e}`));
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  // `main` is async (the CDP attempt): a bare call would leave an unhandled rejection, and
  // a failure to type must never be louder than the thing it was helping with.
  main().catch(() => {});
}

export const DEFAULT_LOG = path.join(os.homedir(), ".vkm", "effort-gate", "apply.log");
