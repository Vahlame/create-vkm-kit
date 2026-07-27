/**
 * Starts a child process so that neither it nor anything IT spawns can put a console window on
 * screen.
 *
 * # The bug this exists for
 *
 * Measured live during a deep-research run: the only processes creating consoles were `conhost.exe`
 * children of `ollama.exe` — one per model load, each a real window that appears, takes the
 * foreground and vanishes milliseconds later. To someone playing a full-screen game while the agent
 * researches in the background, that is the screen being taken away from them, repeatedly.
 *
 * The cause is that the obvious protection CAUSES the problem. `windowsHide: true` is
 * CREATE_NO_WINDOW, which gives the child no console at all. The child then spawns its own
 * console-subsystem child — ollama's model runner, Python's helpers — and a console-subsystem
 * process whose parent has NO console does not inherit one: Windows allocates it a brand new,
 * visible console. The flag meant to hide a window is what forces one to appear a level down.
 *
 * The flag cannot be pushed down, because we do not control how ollama or Python spawn their
 * children. `vkm-runhidden.exe` fixes it from the other end: it is GUI-subsystem so the loader gives
 * it nothing, then allocates a console and hides it, then starts the target WITHOUT
 * CREATE_NO_WINDOW so the whole tree inherits that one hidden console. Nothing allocates a new one,
 * so nothing appears.
 *
 * @module
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Where the installer puts the launcher; VKM_RUNHIDDEN overrides for tests and odd layouts. */
export function runHiddenLauncher() {
  return process.env.VKM_RUNHIDDEN || join(homedir(), ".claude", "bin", "vkm-runhidden.exe");
}

/**
 * Rewrites a (command, args) pair to go through the launcher when it is available.
 *
 * Returns `windowsHide: false` when the launcher IS used — that is not an oversight. The launcher
 * owns a hidden console and the child must inherit it; asking for CREATE_NO_WINDOW on top would
 * re-create exactly the situation this module exists to remove.
 *
 * Falls back to the previous behaviour (direct spawn, `windowsHide: true`) when the launcher is
 * missing or off-Windows, so a source checkout that has not run `npm run build:runhidden` still
 * works — it just flashes like it used to.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ exists?: (p: string) => boolean, platform?: string }} [deps] injectable for tests
 * @returns {{ command: string, args: string[], windowsHide: boolean, viaLauncher: boolean }}
 */
export function throughHiddenConsole(command, args, deps = {}) {
  const { exists = existsSync, platform = process.platform } = deps;

  if (platform !== "win32") {
    return { command, args, windowsHide: true, viaLauncher: false };
  }

  const launcher = runHiddenLauncher();
  if (!exists(launcher)) {
    return { command, args, windowsHide: true, viaLauncher: false };
  }

  return { command: launcher, args: [command, ...args], windowsHide: false, viaLauncher: true };
}
