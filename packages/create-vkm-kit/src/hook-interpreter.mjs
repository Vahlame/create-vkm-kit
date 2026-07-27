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
 * What the kit controls is WHAT gets spawned. `vkm-runhidden.exe` is built with `-H windowsgui`, so
 * the loader never allocates a console for it however it was started; it then allocates one itself
 * and HIDES it, and starts node without CREATE_NO_WINDOW so the whole tree inherits that hidden
 * console.
 *
 * Inheriting rather than suppressing is the load-bearing detail, and it is the opposite of the
 * obvious approach. CREATE_NO_WINDOW leaves the child with NO console, and a console-subsystem
 * grandchild whose parent has none does not inherit one — Windows allocates it a brand new, VISIBLE
 * console. That is not hypothetical here: `ensure-otel-sink` is a hook that spawns a second node,
 * and the same mechanism was measured against ollama, whose model runner allocated a visible console
 * on every load.
 *
 * It proxies stdin, stdout and the exit code verbatim — the exit code especially, since that is how
 * a `PreToolUse` guard blocks a call, and a launcher that swallowed it would silently disarm every
 * guard.
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

  const launcher = path.join(claudeDir, "bin", "vkm-runhidden.exe");
  return existsSync(launcher) ? launcher : "node";
}
