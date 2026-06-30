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
//
// ADR-0030 adds two more managed hooks (on by default, `enforce` opt-out) so the doctrine
// holds even when the driving model doesn't reliably honor a prose rule: a `PreToolUse`
// guard that DENIES Write/Edit/MultiEdit/NotebookEdit into the native auto-memory directory,
// and a `Stop` nudge that reminds the close ritual once per turn when the session did
// substantive file work but never touched the vault.
//
// ADR-0031 adds a third, independently-toggleable managed hook (on by default, `effortGate`
// opt-out): a `PreToolUse` gate that DENIES a session's 2nd+ substantive edit until the model
// proposed an effort level and got a real reply from the user — same "deterministic beats a
// prose rule" reasoning, aimed at a different failure mode (the model announcing a pause and
// not actually taking one).
import path from "node:path";
import { fileURLToPath } from "node:url";
import fse from "fs-extra";
import pc from "picocolors";

/** Shared stem so re-runs (and a legacy `.ps1` install) match our managed entry. */
export const HOOK_STEM = "session-start-vault-context";
export const HOOK_BASENAME = `${HOOK_STEM}.mjs`;

/** PreToolUse guard (ADR-0030): denies Write/Edit/MultiEdit/NotebookEdit into the native
 * auto-memory directory, independent of whether the model honored the CLAUDE.md rule. */
export const GUARD_HOOK_STEM = "guard-native-memory-write";
export const GUARD_HOOK_BASENAME = `${GUARD_HOOK_STEM}.mjs`;

/** Stop nudge (ADR-0030): reminds the close ritual once per turn when the session did
 * substantive file work but never touched the vault. */
export const STOP_HOOK_STEM = "stop-vault-close-reminder";
export const STOP_HOOK_BASENAME = `${STOP_HOOK_STEM}.mjs`;

/** Effort gate (ADR-0031): denies a session's 2nd+ substantive edit until the model
 * proposed an effort level and got a real reply from the user. Independently toggleable
 * from the `enforce` pair above — a user may want one without the other. */
export const EFFORT_GATE_HOOK_STEM = "guard-effort-gate";
export const EFFORT_GATE_HOOK_BASENAME = `${EFFORT_GATE_HOOK_STEM}.mjs`;

/** Source hook shipped inside the published package (`src/hooks/`). */
function packagedHookPath(basename = HOOK_BASENAME) {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "hooks", basename);
}

/** The `SessionStart` command we register: cross-platform `node "<hook>" "<vault>" <lang>`. */
export function hookCommand(hookPath, vaultAbs, lang = "es") {
  return `node "${hookPath}" "${vaultAbs}" ${lang === "en" ? "en" : "es"}`;
}

/** The `PreToolUse` guard command: `node "<hook>" "<claudeDir>" <lang>`. */
export function guardHookCommand(hookPath, claudeDir, lang = "es") {
  return `node "${hookPath}" "${claudeDir}" ${lang === "en" ? "en" : "es"}`;
}

/** The `Stop` nudge command: `node "<hook>" <lang>` (no path arg — it reads the transcript
 * path Claude Code passes on stdin). */
export function stopHookCommand(hookPath, lang = "es") {
  return `node "${hookPath}" ${lang === "en" ? "en" : "es"}`;
}

/** The effort-gate command: `node "<hook>" <lang>` (same shape as the Stop nudge — it also
 * reads `transcript_path` from stdin, not argv; there's no file path to check here). */
export function effortGateHookCommand(hookPath, lang = "es") {
  return `node "${hookPath}" ${lang === "en" ? "en" : "es"}`;
}

function stripBom(text) {
  return typeof text === "string" && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Merge ONE managed hook entry into `hooks[eventName]`, replacing any entry whose command
 * contains `stem` (so re-runs, and a legacy variant of the same hook, never duplicate) and
 * preserving every unrelated entry for that event.
 * @param {Record<string, unknown>} hooks - the settings' `hooks` object (not mutated)
 * @param {string} eventName - e.g. "SessionStart", "PreToolUse", "Stop"
 * @param {string} matcher - hook matcher (e.g. "*" or a tool-name regex)
 * @param {string} command - the command string to register
 * @param {string} stem - filename stem identifying our managed entry, for dedup
 * @returns {Record<string, unknown>} a NEW hooks object
 */
function mergeManagedHook(hooks, eventName, matcher, command, stem) {
  const prior = Array.isArray(hooks[eventName]) ? hooks[eventName] : [];
  const kept = prior.filter((entry) => {
    const inner = entry && Array.isArray(entry.hooks) ? entry.hooks : [];
    return !inner.some((h) => h && typeof h.command === "string" && h.command.includes(stem));
  });
  kept.push({ matcher, hooks: [{ type: "command", command }] });
  return { ...hooks, [eventName]: kept };
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
      ? settings.hooks
      : {};
  settings.hooks = mergeManagedHook(hooks, "SessionStart", "*", command, HOOK_STEM);
  return settings;
}

/**
 * Pure merge (ADR-0030): add the deterministic enforcement hooks — a `PreToolUse` guard
 * that denies writes into the native auto-memory directory, and a `Stop` nudge that
 * reminds the close ritual once per turn. Either command may be omitted to install just
 * one. Idempotent and dedup'd the same way as {@link mergeClaudeSettings}.
 * @param {unknown} existing - parsed `settings.json` (or anything; non-objects are ignored)
 * @param {{ guardCommand?: string|null, stopCommand?: string|null }} commands
 * @returns {Record<string, unknown>}
 */
export function mergeEnforcementHooks(existing, { guardCommand, stopCommand } = {}) {
  const settings =
    existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing } : {};
  let hooks =
    settings.hooks && typeof settings.hooks === "object" && !Array.isArray(settings.hooks)
      ? settings.hooks
      : {};
  if (guardCommand) {
    hooks = mergeManagedHook(
      hooks,
      "PreToolUse",
      "Write|Edit|MultiEdit|NotebookEdit",
      guardCommand,
      GUARD_HOOK_STEM
    );
  }
  if (stopCommand) {
    hooks = mergeManagedHook(hooks, "Stop", "*", stopCommand, STOP_HOOK_STEM);
  }
  settings.hooks = hooks;
  return settings;
}

/**
 * Pure merge (ADR-0031): add the effort-gate `PreToolUse` hook. Kept as its OWN function
 * (not folded into {@link mergeEnforcementHooks}) so it's independently toggleable — same
 * reasoning ADR-0030 already used to keep the native-memory override separate from its own
 * hooks. Registers under the same matcher as the native-memory guard; the two coexist as
 * separate `hooks.PreToolUse` entries (deduped by stem, not by matcher) and either may deny
 * independently. Idempotent and dedup'd the same way as {@link mergeClaudeSettings}.
 * @param {unknown} existing - parsed `settings.json` (or anything; non-objects are ignored)
 * @param {{ effortGateCommand?: string|null }} commands
 * @returns {Record<string, unknown>}
 */
export function mergeEffortGateHook(existing, { effortGateCommand } = {}) {
  const settings =
    existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing } : {};
  let hooks =
    settings.hooks && typeof settings.hooks === "object" && !Array.isArray(settings.hooks)
      ? settings.hooks
      : {};
  if (effortGateCommand) {
    hooks = mergeManagedHook(
      hooks,
      "PreToolUse",
      "Write|Edit|MultiEdit|NotebookEdit",
      effortGateCommand,
      EFFORT_GATE_HOOK_STEM
    );
  }
  settings.hooks = hooks;
  return settings;
}

/**
 * Install the override for Claude Code: copy the hook(s) into `~/.claude/hooks/`, then merge
 * `autoMemoryEnabled:false` + the hook registrations into `~/.claude/settings.json`.
 * Best-effort and non-fatal; never throws out (a failure here must not abort the install).
 * @param {string} home
 * @param {string} vaultAbs
 * @param {boolean} dryRun
 * @param {{ lang?: "es"|"en", enforce?: boolean, effortGate?: boolean }} [opts] - `enforce`
 *   (default true) also installs the ADR-0030 deterministic hooks: a `PreToolUse` guard
 *   that denies writes into the native auto-memory directory, and a `Stop` nudge for the
 *   close ritual. `effortGate` (default true) installs the ADR-0031 effort-gate hook,
 *   independently of `enforce` — a user may want one without the other.
 */
export async function configureClaudeNativeMemory(
  home,
  vaultAbs,
  dryRun,
  { lang = "es", enforce = true, effortGate = true } = {}
) {
  const claudeDir = path.join(home, ".claude");
  const hooksDir = path.join(claudeDir, "hooks");
  const hookDest = path.join(hooksDir, HOOK_BASENAME);
  const guardDest = path.join(hooksDir, GUARD_HOOK_BASENAME);
  const stopDest = path.join(hooksDir, STOP_HOOK_BASENAME);
  const effortGateDest = path.join(hooksDir, EFFORT_GATE_HOOK_BASENAME);
  const settingsFp = path.join(claudeDir, "settings.json");
  const command = hookCommand(hookDest, vaultAbs, lang);
  const guardCommand = enforce ? guardHookCommand(guardDest, claudeDir, lang) : null;
  const stopCommand = enforce ? stopHookCommand(stopDest, lang) : null;
  const effortGateCommand = effortGate ? effortGateHookCommand(effortGateDest, lang) : null;

  if (dryRun) {
    console.log(
      pc.cyan("[dry-run] would set"),
      "autoMemoryEnabled:false",
      pc.dim(`in ${settingsFp}`)
    );
    console.log(pc.cyan("[dry-run] would install SessionStart hook"), pc.dim(hookDest));
    if (enforce) {
      console.log(
        pc.cyan("[dry-run] would install PreToolUse native-memory guard hook"),
        pc.dim(guardDest)
      );
      console.log(
        pc.cyan("[dry-run] would install Stop close-ritual reminder hook"),
        pc.dim(stopDest)
      );
    }
    if (effortGate) {
      console.log(
        pc.cyan("[dry-run] would install PreToolUse effort-gate hook"),
        pc.dim(effortGateDest)
      );
    }
    return;
  }

  try {
    // 1. Copy the hook scripts next to the user's other Claude hooks (survives npx temp dirs).
    await fse.ensureDir(hooksDir);
    await fse.copy(packagedHookPath(), hookDest, { overwrite: true });
    if (enforce) {
      await fse.copy(packagedHookPath(GUARD_HOOK_BASENAME), guardDest, { overwrite: true });
      await fse.copy(packagedHookPath(STOP_HOOK_BASENAME), stopDest, { overwrite: true });
    }
    if (effortGate) {
      await fse.copy(packagedHookPath(EFFORT_GATE_HOOK_BASENAME), effortGateDest, {
        overwrite: true
      });
    }

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

    let merged = mergeClaudeSettings(existing, command);
    if (enforce) merged = mergeEnforcementHooks(merged, { guardCommand, stopCommand });
    if (effortGate) merged = mergeEffortGateHook(merged, { effortGateCommand });
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
    if (enforce) {
      console.log(pc.dim("  + PreToolUse native-memory guard ->"), pc.dim(guardDest));
      console.log(pc.dim("  + Stop close-ritual reminder ->"), pc.dim(stopDest));
    }
    if (effortGate) {
      console.log(pc.dim("  + PreToolUse effort-gate ->"), pc.dim(effortGateDest));
    }
  } catch (e) {
    console.warn(
      pc.yellow("Could not configure the Claude Code native-memory override (skipped):"),
      e?.message || e
    );
  }
}
