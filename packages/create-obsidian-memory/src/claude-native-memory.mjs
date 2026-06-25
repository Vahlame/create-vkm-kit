// Make the Obsidian vault Claude Code's ONLY memory: turn OFF the native per-project
// auto-memory (`autoMemoryEnabled:false`) and install a `SessionStart` hook that injects
// the vault map + the "vault is the source of truth" reminders.
//
// Why: Claude Code ships a native auto-memory (`~/.claude/projects/<enc>/memory/MEMORY.md`)
// that the harness auto-loads and the base system prompt tells the model to WRITE with the
// `Write` tool. It competes with the vault and the native side wins by default (it's in the
// base prompt with `Write` always available, while the `vault_*` MCP tools are often
// deferred). Disabling it + a reinforced SessionStart reminder makes the vault win out of
// the box. See ADR-0029.
//
// Idempotent: merges `~/.claude/settings.json` without clobbering other keys or hooks, and
// REPLACES (never duplicates) our managed `SessionStart` entry — re-runs and an older
// PowerShell variant of the hook are both recognized by the shared filename stem.
import path from "node:path";
import { fileURLToPath } from "node:url";
import fse from "fs-extra";
import pc from "picocolors";

/** Shared stem so re-runs (and a legacy `.ps1` install) match our managed entry. */
export const HOOK_STEM = "session-start-vault-context";
export const HOOK_BASENAME = `${HOOK_STEM}.mjs`;

/** Source hook shipped inside the published package (`src/hooks/`). */
function packagedHookPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "hooks", HOOK_BASENAME);
}

/** The `SessionStart` command we register: cross-platform `node "<hook>" "<vault>" <lang>`. */
export function hookCommand(hookPath, vaultAbs, lang = "es") {
  return `node "${hookPath}" "${vaultAbs}" ${lang === "en" ? "en" : "es"}`;
}

function stripBom(text) {
  return typeof text === "string" && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Pure merge: return a NEW settings object with the native auto-memory disabled and our
 * managed `SessionStart` hook present exactly once. Preserves every other key, every other
 * hook event, and every unrelated `SessionStart` entry.
 * @param {unknown} existing - parsed `settings.json` (or anything; non-objects are ignored)
 * @param {string} command - the hook command string from {@link hookCommand}
 * @returns {Record<string, unknown>}
 */
export function mergeClaudeSettings(existing, command) {
  const settings =
    existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing } : {};
  // The whole point of the override: force it off (documented key; default is true).
  settings.autoMemoryEnabled = false;

  const hooks =
    settings.hooks && typeof settings.hooks === "object" && !Array.isArray(settings.hooks)
      ? { ...settings.hooks }
      : {};
  const prior = Array.isArray(hooks.SessionStart) ? hooks.SessionStart : [];
  // Drop any prior managed entry (by filename stem) so re-runs / a legacy `.ps1` install
  // don't pile up duplicates or leave a stale vault path behind.
  const kept = prior.filter((entry) => {
    const inner = entry && Array.isArray(entry.hooks) ? entry.hooks : [];
    return !inner.some((h) => h && typeof h.command === "string" && h.command.includes(HOOK_STEM));
  });
  kept.push({ matcher: "*", hooks: [{ type: "command", command }] });
  hooks.SessionStart = kept;
  settings.hooks = hooks;
  return settings;
}

/**
 * Install the override for Claude Code: copy the hook into `~/.claude/hooks/`, then merge
 * `autoMemoryEnabled:false` + the `SessionStart` registration into `~/.claude/settings.json`.
 * Best-effort and non-fatal; never throws out (a failure here must not abort the install).
 * @param {string} home
 * @param {string} vaultAbs
 * @param {boolean} dryRun
 * @param {{ lang?: "es"|"en" }} [opts]
 */
export async function configureClaudeNativeMemory(home, vaultAbs, dryRun, { lang = "es" } = {}) {
  const claudeDir = path.join(home, ".claude");
  const hooksDir = path.join(claudeDir, "hooks");
  const hookDest = path.join(hooksDir, HOOK_BASENAME);
  const settingsFp = path.join(claudeDir, "settings.json");
  const command = hookCommand(hookDest, vaultAbs, lang);

  if (dryRun) {
    console.log(
      pc.cyan("[dry-run] would set"),
      "autoMemoryEnabled:false",
      pc.dim(`in ${settingsFp}`)
    );
    console.log(pc.cyan("[dry-run] would install SessionStart hook"), pc.dim(hookDest));
    return;
  }

  try {
    // 1. Copy the hook script next to the user's other Claude hooks (survives npx temp dirs).
    await fse.ensureDir(hooksDir);
    await fse.copy(packagedHookPath(), hookDest, { overwrite: true });

    // 2. Read + parse existing settings (back up before touching anything invalid).
    let existing = {};
    let priorBytes = null;
    if (await fse.pathExists(settingsFp)) {
      priorBytes = await fse.readFile(settingsFp);
      const raw = stripBom(priorBytes.toString("utf8")).trim();
      if (raw) {
        try {
          existing = JSON.parse(raw);
        } catch {
          const bak = `${settingsFp}.bak.${Date.now()}`;
          await fse.writeFile(bak, priorBytes);
          console.warn(pc.yellow("Invalid JSON in ~/.claude/settings.json; backed up to"), bak);
          existing = {};
          priorBytes = null; // already preserved via the .bak above
        }
      }
    }

    const merged = mergeClaudeSettings(existing, command);
    const out = `${JSON.stringify(merged, null, 2)}\n`;
    JSON.parse(out); // sanity: never write something that won't parse back

    // Keep a one-`mv`-away backup of the prior valid settings, like mcp.json does.
    if (priorBytes) {
      const bak = `${settingsFp}.bak.${Date.now()}`;
      await fse.writeFile(bak, priorBytes);
      console.log(pc.dim("Backed up previous settings.json to"), bak);
    }

    await fse.ensureDir(claudeDir);
    const tmp = `${settingsFp}.tmp.${process.pid}.${Date.now()}`;
    await fse.writeFile(tmp, out, "utf8");
    await fse.rename(tmp, settingsFp);

    console.log(pc.green("Claude Code native-memory override:"), settingsFp);
    console.log(pc.dim("  autoMemoryEnabled:false + SessionStart hook ->"), pc.dim(hookDest));
  } catch (e) {
    console.warn(
      pc.yellow("Could not configure the Claude Code native-memory override (skipped):"),
      e?.message || e
    );
  }
}
