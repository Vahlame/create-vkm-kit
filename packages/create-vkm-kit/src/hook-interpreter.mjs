import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Which executable should run a hook script.
 *
 * # Why this is not just "node"
 *
 * Every vkm hook is a Node script, and Claude Code starts one process per matching event. Two of
 * them sit on the hottest paths there are — `compact-tool-output` on every Bash call and
 * `compact-mcp-output` on every MCP call — so a single research run spawns hundreds.
 *
 * `node.exe` is a CONSOLE-subsystem binary. When Windows starts one and the spawn did not request
 * CREATE_NO_WINDOW, the loader allocates a console: a real window that appears, TAKES THE
 * FOREGROUND, and disappears milliseconds later. Hundreds of those is what a user sees as shells
 * flashing open and shut, and it pulls them out of a full-screen game while the agent works in the
 * background. The kit cannot pass that flag itself, because it is the agent host that spawns the
 * hook, not the kit.
 *
 * What the kit controls is WHAT gets spawned. `vkm-hookw.exe` is built with `-H windowsgui`, so the
 * loader can never allocate a console for it regardless of how it was started, and it launches node
 * with CREATE_NO_WINDOW so the grandchild has none either. It proxies stdin, stdout and the exit
 * code verbatim — the exit code especially, since that is how a `PreToolUse` guard blocks a call,
 * and a launcher that swallowed it would silently disarm every guard.
 *
 * Falls back to plain `node` when the launcher is absent (a source checkout that has not been
 * built, or any non-Windows host where there is no console to suppress in the first place). The
 * hooks behave identically either way; only the flashing differs.
 *
 * @param {string} [claudeDir] the `.claude` directory the launcher was installed into
 * @returns {string} executable for a hook entry's `command`
 */
export function hookInterpreter(claudeDir = path.join(os.homedir(), ".claude")) {
  if (process.platform !== "win32") return "node";

  const launcher = path.join(claudeDir, "bin", "vkm-hookw.exe");
  return existsSync(launcher) ? launcher : "node";
}
