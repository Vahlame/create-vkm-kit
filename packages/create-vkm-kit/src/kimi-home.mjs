/**
 * Kimi Code's per-user home directory (`~/.kimi-code` by default). The CLI relocates the
 * whole data root when `KIMI_CODE_HOME` is set — config.toml, mcp.json, skills/, agents/
 * and hooks/ all move with it — so every kimi path the kit writes resolves through here.
 *
 * @param {string} home the user's OS home (the `home` every sibling module already takes)
 * @returns {string} absolute path of the Kimi Code data root
 */
import path from "node:path";

export function kimiHome(home) {
  const override = process.env.KIMI_CODE_HOME;
  if (override && override.trim()) return override.trim();
  return path.join(home, ".kimi-code");
}
