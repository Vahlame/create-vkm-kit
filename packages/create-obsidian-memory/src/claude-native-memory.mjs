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
//
// Install/remove is SYMMETRIC (audit finding, 2026-07): every call to
// `configureClaudeNativeMemory` fully reconciles the desired state — pieces that are wanted
// get merged in, pieces that are NOT wanted get actively stripped out (not just skipped),
// so a `--no-effort-gate` re-run after a prior install with the effort gate on actually
// removes that hook entry instead of leaving it orphaned. `uninstallClaudeNativeMemory`
// builds on the same removal path plus deletes the hook script files themselves, but only
// when a marker check proves this kit wrote them (never a user's own same-named file).
import path from "node:path";
import { fileURLToPath } from "node:url";
import fse from "fs-extra";
import pc from "picocolors";
import { restrictFileToOwner } from "./file-perms.mjs";

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

/** Shared sidecar-cache engine (item 3 / perf fix) the Stop nudge and effort-gate hooks both
 * import as a sibling module — not a hook Claude Code invokes itself, but installed and
 * removed alongside whichever of the two needs it (see `configureClaudeNativeMemory`). */
export const TRANSCRIPT_CACHE_BASENAME = "_transcript-cache.mjs";

/** All filename stems this kit manages in `~/.claude/settings.json` hooks. Used both to
 * detect "is there anything of ours to remove" and by `--uninstall`'s file-marker check. */
const ALL_HOOK_STEMS = [HOOK_STEM, GUARD_HOOK_STEM, STOP_HOOK_STEM, EFFORT_GATE_HOOK_STEM];

/** Literal string every hook file this kit ships carries in its header comment. Used as a
 * cheap-but-reliable ownership marker before `--uninstall` deletes a file by that name —
 * a user's own unrelated same-named script is exceedingly unlikely to contain this exact
 * npm package name in its source. */
const KIT_FILE_MARKER = "create-obsidian-memory";

/** Source hook shipped inside the published package (`src/hooks/`). */
function packagedHookPath(basename = HOOK_BASENAME) {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "hooks", basename);
}

/**
 * The `SessionStart` hook entry: exec form (`command` + `args`, no shell involved), so a
 * vault path containing a quote, a backtick, or a trailing backslash is passed through as
 * one literal argv element — nothing to escape, nothing to get wrong. (Prior versions built
 * a single interpolated command STRING here — `node "<hook>" "<vault>" <lang>` — which broke
 * on exactly those inputs, e.g. a trailing backslash before the closing quote swallowed it.
 * Claude Code's hook schema supports this exec form for any `command` that resolves to a
 * real executable, which `node` always does, cross-platform.)
 * @param {string} hookPath
 * @param {string} vaultAbs
 * @param {string} [lang]
 * @returns {{ command: string, args: string[] }}
 */
export function hookCommand(hookPath, vaultAbs, lang = "es") {
  return { command: "node", args: [hookPath, vaultAbs, lang === "en" ? "en" : "es"] };
}

/** The `PreToolUse` guard hook entry: `node "<hook>" "<claudeDir>" <lang>` (exec form). */
export function guardHookCommand(hookPath, claudeDir, lang = "es") {
  return { command: "node", args: [hookPath, claudeDir, lang === "en" ? "en" : "es"] };
}

/** The `Stop` nudge hook entry (exec form; no path arg — it reads the transcript path
 * Claude Code passes on stdin). */
export function stopHookCommand(hookPath, lang = "es") {
  return { command: "node", args: [hookPath, lang === "en" ? "en" : "es"] };
}

/** The effort-gate hook entry (exec form; same shape as the Stop nudge — it also reads
 * `transcript_path` from stdin, not argv). */
export function effortGateHookCommand(hookPath, lang = "es") {
  return { command: "node", args: [hookPath, lang === "en" ? "en" : "es"] };
}

function stripBom(text) {
  return typeof text === "string" && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * True if a raw `hooks[event][].hooks[]` entry belongs to this kit's `stem`. Recognizes
 * BOTH the current exec form (`args` array — the stem shows up in an arg, since args[0] is
 * always the hook's own file path) AND the legacy single-string shell form a prior version
 * of this kit (or the even older `.ps1` variant) may have written — the stem is a substring
 * of that command string too. Never matches an unrelated hook the user added themselves,
 * since it requires the EXACT filename stem, not just the event/matcher.
 * @param {unknown} h
 * @param {string} stem
 */
function hookEntryMatchesStem(h, stem) {
  if (!h || typeof h !== "object") return false;
  if (typeof h.command === "string" && h.command.includes(stem)) return true;
  if (Array.isArray(h.args) && h.args.some((a) => typeof a === "string" && a.includes(stem))) {
    return true;
  }
  return false;
}

/**
 * Merge ONE managed hook entry into `hooks[eventName]`, replacing any entry whose command
 * matches `stem` (so re-runs, and a legacy variant of the same hook, never duplicate) and
 * preserving every unrelated entry for that event.
 * @param {Record<string, unknown>} hooks - the settings' `hooks` object (not mutated)
 * @param {string} eventName - e.g. "SessionStart", "PreToolUse", "Stop"
 * @param {string} matcher - hook matcher (e.g. "*" or a tool-name regex)
 * @param {{ command: string, args: string[] }} hookEntry - from e.g. {@link hookCommand}
 * @param {string} stem - filename stem identifying our managed entry, for dedup
 * @returns {Record<string, unknown>} a NEW hooks object
 */
function mergeManagedHook(hooks, eventName, matcher, hookEntry, stem) {
  const prior = Array.isArray(hooks[eventName]) ? hooks[eventName] : [];
  const kept = prior.filter((entry) => {
    const inner = entry && Array.isArray(entry.hooks) ? entry.hooks : [];
    return !inner.some((h) => hookEntryMatchesStem(h, stem));
  });
  kept.push({ matcher, hooks: [{ type: "command", ...hookEntry }] });
  return { ...hooks, [eventName]: kept };
}

/**
 * The removal counterpart to {@link mergeManagedHook}: strip any entry matching `stem` from
 * `hooks[eventName]`, leaving every unrelated entry (ours or the user's own) untouched. If
 * removal empties the array, the event key is deleted entirely rather than left as `[]`, so
 * an uninstalled kit leaves no trace. A no-op (returns `hooks` structurally unchanged, modulo
 * a shallow copy) when nothing matches — safe to call unconditionally.
 * @param {Record<string, unknown>} hooks
 * @param {string} eventName
 * @param {string} stem
 * @returns {Record<string, unknown>}
 */
function removeManagedHook(hooks, eventName, stem) {
  const prior = Array.isArray(hooks[eventName]) ? hooks[eventName] : [];
  const kept = prior.filter((entry) => {
    const inner = entry && Array.isArray(entry.hooks) ? entry.hooks : [];
    return !inner.some((h) => hookEntryMatchesStem(h, stem));
  });
  const next = { ...hooks };
  if (kept.length) next[eventName] = kept;
  else delete next[eventName];
  return next;
}

/** Assign `settings.hooks = next`, unless `next` is empty AND `settings` never had a
 * `hooks` key to begin with — avoids a removal function introducing a gratuitous
 * `"hooks": {}` into settings that had no hooks at all before. */
function setOrDeleteHooks(settings, hadHooksBefore, next) {
  if (Object.keys(next).length || hadHooksBefore) {
    settings.hooks = next;
  }
  return settings;
}

/** True if `hooks[eventName]` currently contains a managed entry for `stem`. Used to decide
 * whether a removal is a real action worth announcing (dry-run) or a pure no-op. */
function hasManagedHook(hooks, eventName, stem) {
  const prior = hooks && Array.isArray(hooks[eventName]) ? hooks[eventName] : [];
  return prior.some((entry) => {
    const inner = entry && Array.isArray(entry.hooks) ? entry.hooks : [];
    return inner.some((h) => hookEntryMatchesStem(h, stem));
  });
}

/**
 * Pure merge: return a NEW settings object with the native auto-memory disabled and our
 * managed `SessionStart` hook present exactly once. Preserves every other key, every other
 * hook event, and every unrelated `SessionStart` entry.
 * @param {unknown} existing - parsed `settings.json` (or anything; non-objects are ignored)
 * @param {{ command: string, args: string[] }} hookEntry - from {@link hookCommand}
 * @returns {Record<string, unknown>}
 */
export function mergeClaudeSettings(existing, hookEntry) {
  const settings =
    existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing } : {};
  // The whole point of the override: force it off (documented key; default is true).
  settings.autoMemoryEnabled = false;

  const hooks =
    settings.hooks && typeof settings.hooks === "object" && !Array.isArray(settings.hooks)
      ? settings.hooks
      : {};
  settings.hooks = mergeManagedHook(hooks, "SessionStart", "*", hookEntry, HOOK_STEM);
  return settings;
}

/**
 * The removal counterpart to {@link mergeClaudeSettings}: drop the managed `SessionStart`
 * entry, and drop the `autoMemoryEnabled` override too — but ONLY when it's still exactly
 * `false`, i.e. the value this kit itself would have set. If the user (or something else)
 * has since set it to `true`, that's left alone rather than silently re-toggled; we only
 * ever reverse a value we can prove is ours.
 * @param {unknown} existing
 * @returns {Record<string, unknown>}
 */
export function removeSessionStartHook(existing) {
  const settings =
    existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing } : {};
  if (settings.autoMemoryEnabled === false) {
    delete settings.autoMemoryEnabled;
  }
  const hadHooks =
    settings.hooks && typeof settings.hooks === "object" && !Array.isArray(settings.hooks);
  const hooks = hadHooks ? settings.hooks : {};
  return setOrDeleteHooks(
    settings,
    Boolean(hadHooks),
    removeManagedHook(hooks, "SessionStart", HOOK_STEM)
  );
}

/**
 * Pure merge (ADR-0030): add the deterministic enforcement hooks — a `PreToolUse` guard
 * that denies writes into the native auto-memory directory, and a `Stop` nudge that
 * reminds the close ritual once per turn. Either command may be omitted to install just
 * one. Idempotent and dedup'd the same way as {@link mergeClaudeSettings}.
 * @param {unknown} existing - parsed `settings.json` (or anything; non-objects are ignored)
 * @param {{ guardCommand?: {command:string,args:string[]}|null, stopCommand?: {command:string,args:string[]}|null }} commands
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
 * The removal counterpart to {@link mergeEnforcementHooks}: strip both the guard and stop
 * entries unconditionally (a no-op for whichever, or both, aren't present).
 * @param {unknown} existing
 * @returns {Record<string, unknown>}
 */
export function removeEnforcementHooks(existing) {
  const settings =
    existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing } : {};
  const hadHooks =
    settings.hooks && typeof settings.hooks === "object" && !Array.isArray(settings.hooks);
  let hooks = hadHooks ? settings.hooks : {};
  hooks = removeManagedHook(hooks, "PreToolUse", GUARD_HOOK_STEM);
  hooks = removeManagedHook(hooks, "Stop", STOP_HOOK_STEM);
  return setOrDeleteHooks(settings, Boolean(hadHooks), hooks);
}

/**
 * Pure merge (ADR-0031): add the effort-gate `PreToolUse` hook. Kept as its OWN function
 * (not folded into {@link mergeEnforcementHooks}) so it's independently toggleable — same
 * reasoning ADR-0030 already used to keep the native-memory override separate from its own
 * hooks. Registers under the same matcher as the native-memory guard; the two coexist as
 * separate `hooks.PreToolUse` entries (deduped by stem, not by matcher) and either may deny
 * independently. Idempotent and dedup'd the same way as {@link mergeClaudeSettings}.
 * @param {unknown} existing - parsed `settings.json` (or anything; non-objects are ignored)
 * @param {{ effortGateCommand?: {command:string,args:string[]}|null }} commands
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
 * The removal counterpart to {@link mergeEffortGateHook}: strip the effort-gate entry (a
 * no-op if it isn't present).
 * @param {unknown} existing
 * @returns {Record<string, unknown>}
 */
export function removeEffortGateHook(existing) {
  const settings =
    existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing } : {};
  const hadHooks =
    settings.hooks && typeof settings.hooks === "object" && !Array.isArray(settings.hooks);
  const hooks = hadHooks ? settings.hooks : {};
  return setOrDeleteHooks(
    settings,
    Boolean(hadHooks),
    removeManagedHook(hooks, "PreToolUse", EFFORT_GATE_HOOK_STEM)
  );
}

/**
 * Install (or, when a piece isn't wanted, actively REMOVE) the Claude Code native-memory
 * override: copy the hook(s) into `~/.claude/hooks/`, then reconcile `autoMemoryEnabled` +
 * the hook registrations in `~/.claude/settings.json` to match exactly what's wanted.
 *
 * Symmetric by design: every call fully reconciles state, in both directions. `enable:false`
 * doesn't just skip installing the SessionStart hook — if it was installed by a PRIOR call
 * (e.g. a previous run without `--no-native-memory-override`), this strips it out, same for
 * `enforce:false` / `effortGate:false` against their own pieces. That's what makes `--no-X`
 * flags actually reverse a prior `--X` install instead of only affecting fresh ones.
 *
 * As a side effect of being symmetric, a call that wants nothing installed AND finds nothing
 * of ours already present is a true no-op — it never touches `~/.claude/settings.json` at
 * all (not even to create it), so running with Claude Code off/unwanted never surprises a
 * machine that never had this override.
 *
 * Best-effort and non-fatal; never throws out (a failure here must not abort the install).
 * @param {string} home
 * @param {string} vaultAbs
 * @param {boolean} dryRun
 * @param {{ lang?: "es"|"en", enable?: boolean, enforce?: boolean, effortGate?: boolean }} [opts] -
 *   `enable` (default true) is the top-level on/off for the whole override (SessionStart
 *   hook + `autoMemoryEnabled:false`); `enforce` (default true, only meaningful when
 *   `enable`) also installs the ADR-0030 deterministic hooks: a `PreToolUse` guard that
 *   denies writes into the native auto-memory directory, and a `Stop` nudge for the close
 *   ritual. `effortGate` (default true, only meaningful when `enable`) installs the
 *   ADR-0031 effort-gate hook, independently of `enforce`.
 */
export async function configureClaudeNativeMemory(
  home,
  vaultAbs,
  dryRun,
  { lang = "es", enable = true, enforce = true, effortGate = true } = {}
) {
  const claudeDir = path.join(home, ".claude");
  const hooksDir = path.join(claudeDir, "hooks");
  const hookDest = path.join(hooksDir, HOOK_BASENAME);
  const guardDest = path.join(hooksDir, GUARD_HOOK_BASENAME);
  const stopDest = path.join(hooksDir, STOP_HOOK_BASENAME);
  const effortGateDest = path.join(hooksDir, EFFORT_GATE_HOOK_BASENAME);
  const transcriptCacheDest = path.join(hooksDir, TRANSCRIPT_CACHE_BASENAME);
  const settingsFp = path.join(claudeDir, "settings.json");

  const wantEnforce = enable && enforce;
  const wantEffortGate = enable && effortGate;

  const hookEntry = enable ? hookCommand(hookDest, vaultAbs, lang) : null;
  const guardCommand = wantEnforce ? guardHookCommand(guardDest, claudeDir, lang) : null;
  const stopCommand = wantEnforce ? stopHookCommand(stopDest, lang) : null;
  const effortGateCommand = wantEffortGate ? effortGateHookCommand(effortGateDest, lang) : null;

  try {
    // Read existing settings up front — needed to reconcile installs AND removals, and to
    // cheaply detect (via our filename stems, on the raw text) whether there's anything of
    // ours to remove at all, without depending on the JSON being valid.
    let existing = {};
    let priorBytes = null;
    let invalidJson = false;
    if (await fse.pathExists(settingsFp)) {
      priorBytes = await fse.readFile(settingsFp);
      const raw = stripBom(priorBytes.toString("utf8")).trim();
      if (raw) {
        try {
          existing = JSON.parse(raw);
        } catch {
          invalidJson = true;
        }
      }
    }
    const rawText = priorBytes ? priorBytes.toString("utf8") : "";
    const oursPresent = ALL_HOOK_STEMS.some((stem) => rawText.includes(stem));

    // True no-op: nothing wanted, nothing of ours present — leave the file (even a
    // nonexistent one) completely untouched. Prevents a bare `--ide claude
    // --no-native-memory-override` from conjuring a settings.json out of thin air.
    if (!enable && !oursPresent) {
      return;
    }

    if (dryRun) {
      if (enable) {
        console.log(
          pc.cyan("[dry-run] would set"),
          "autoMemoryEnabled:false",
          pc.dim(`in ${settingsFp}`)
        );
        console.log(pc.cyan("[dry-run] would install SessionStart hook"), pc.dim(hookDest));
      } else if (
        hasManagedHook(existing.hooks, "SessionStart", HOOK_STEM) ||
        existing.autoMemoryEnabled === false
      ) {
        console.log(
          pc.cyan("[dry-run] would remove autoMemoryEnabled override + SessionStart hook"),
          pc.dim(`from ${settingsFp}`)
        );
      }
      if (wantEnforce) {
        console.log(
          pc.cyan("[dry-run] would install PreToolUse native-memory guard hook"),
          pc.dim(guardDest)
        );
        console.log(
          pc.cyan("[dry-run] would install Stop close-ritual reminder hook"),
          pc.dim(stopDest)
        );
      } else if (
        hasManagedHook(existing.hooks, "PreToolUse", GUARD_HOOK_STEM) ||
        hasManagedHook(existing.hooks, "Stop", STOP_HOOK_STEM)
      ) {
        console.log(
          pc.cyan(
            "[dry-run] would remove PreToolUse native-memory guard + Stop close-ritual reminder hooks"
          )
        );
      }
      if (wantEffortGate) {
        console.log(
          pc.cyan("[dry-run] would install PreToolUse effort-gate hook"),
          pc.dim(effortGateDest)
        );
      } else if (hasManagedHook(existing.hooks, "PreToolUse", EFFORT_GATE_HOOK_STEM)) {
        console.log(pc.cyan("[dry-run] would remove PreToolUse effort-gate hook"));
      }
      return;
    }

    // 1. Copy (only the pieces being installed) / never delete script files here — that's
    // `--uninstall`'s job, guarded by a marker check. A per-run `--no-X` only touches the
    // settings.json registration; an orphaned-but-uncalled script file is harmless.
    await fse.ensureDir(hooksDir);
    if (enable) {
      await fse.copy(packagedHookPath(), hookDest, { overwrite: true });
    }
    if (wantEnforce) {
      await fse.copy(packagedHookPath(GUARD_HOOK_BASENAME), guardDest, { overwrite: true });
      await fse.copy(packagedHookPath(STOP_HOOK_BASENAME), stopDest, { overwrite: true });
    }
    if (wantEffortGate) {
      await fse.copy(packagedHookPath(EFFORT_GATE_HOOK_BASENAME), effortGateDest, {
        overwrite: true
      });
    }
    if (wantEnforce || wantEffortGate) {
      // The Stop nudge and the effort-gate hook both import this sidecar-cache module as a
      // sibling file (item 3 perf fix) — copy it whenever either consumer is installed.
      await fse.copy(packagedHookPath(TRANSCRIPT_CACHE_BASENAME), transcriptCacheDest, {
        overwrite: true
      });
    }

    if (invalidJson) {
      const bak = `${settingsFp}.bak.${Date.now()}`;
      await fse.writeFile(bak, priorBytes);
      await restrictFileToOwner(bak);
      console.warn(pc.yellow("Invalid JSON in ~/.claude/settings.json; backed up to"), bak);
      existing = {};
    }

    // 2. Reconcile: merge what's wanted, remove what's not — same code path handles a
    // fresh install, a no-op re-run, and a partial/full removal.
    let merged = enable
      ? mergeClaudeSettings(existing, hookEntry)
      : removeSessionStartHook(existing);
    merged = wantEnforce
      ? mergeEnforcementHooks(merged, { guardCommand, stopCommand })
      : removeEnforcementHooks(merged);
    merged = wantEffortGate
      ? mergeEffortGateHook(merged, { effortGateCommand })
      : removeEffortGateHook(merged);
    const out = `${JSON.stringify(merged, null, 2)}\n`;
    JSON.parse(out); // sanity: never write something that won't parse back

    // Keep a one-`mv`-away backup of the prior valid settings, like mcp.json does. Restricted
    // to the current user, same as the final file below — settings.json can carry secrets in
    // keys this kit doesn't own (e.g. a user's own `env` block), on either platform.
    if (priorBytes && !invalidJson) {
      const bak = `${settingsFp}.bak.${Date.now()}`;
      await fse.writeFile(bak, priorBytes);
      await restrictFileToOwner(bak);
      console.log(pc.dim("Backed up previous settings.json to"), bak);
    }

    await fse.ensureDir(claudeDir);
    const tmp = `${settingsFp}.tmp.${process.pid}.${Date.now()}`;
    await fse.writeFile(tmp, out, "utf8");
    await restrictFileToOwner(tmp);
    await fse.rename(tmp, settingsFp);

    if (enable) {
      console.log(pc.green("Claude Code native-memory override:"), settingsFp);
      console.log(pc.dim("  autoMemoryEnabled:false + SessionStart hook ->"), pc.dim(hookDest));
    } else if (oursPresent) {
      console.log(pc.green("Claude Code native-memory override removed:"), settingsFp);
    }
    if (wantEnforce) {
      console.log(pc.dim("  + PreToolUse native-memory guard ->"), pc.dim(guardDest));
      console.log(pc.dim("  + Stop close-ritual reminder ->"), pc.dim(stopDest));
    } else if (oursPresent && enable) {
      console.log(pc.dim("  (enforcement hooks removed or not installed)"));
    }
    if (wantEffortGate) {
      console.log(pc.dim("  + PreToolUse effort-gate ->"), pc.dim(effortGateDest));
    }
  } catch (e) {
    console.warn(
      pc.yellow("Could not configure the Claude Code native-memory override (skipped):"),
      e?.message || e
    );
  }
}

/** True if `fp` contains this kit's marker, meaning it's safe to assume WE wrote it (as
 * opposed to a user's own unrelated same-named file). Read failures (missing file, etc.)
 * are treated as "not ours" — never delete on doubt. */
async function isKitOwnedFile(fp) {
  try {
    const text = await fse.readFile(fp, "utf8");
    return text.includes(KIT_FILE_MARKER);
  } catch {
    return false;
  }
}

/**
 * Fully reverse everything this kit's Claude Code integration installed: all 4 managed
 * hook entries in `~/.claude/settings.json`, the `autoMemoryEnabled` override (iff it's
 * still exactly the value this kit would have set — see {@link removeSessionStartHook}),
 * and — only for files a marker check proves this kit wrote — the hook script files
 * themselves under `~/.claude/hooks/`. Never touches MCP server registrations, the vault,
 * or rules blocks; those have their own manual/CLI removal paths (see docs/en/faq.md).
 * Best-effort and non-fatal, matching {@link configureClaudeNativeMemory}.
 * @param {string} home
 * @param {boolean} dryRun
 */
export async function uninstallClaudeNativeMemory(home, dryRun) {
  // Reuses the same reconcile path as a `--no-X` removal, just with every piece off.
  await configureClaudeNativeMemory(home, "", dryRun, {
    enable: false,
    enforce: false,
    effortGate: false
  });

  const hooksDir = path.join(home, ".claude", "hooks");
  const basenames = [
    HOOK_BASENAME,
    GUARD_HOOK_BASENAME,
    STOP_HOOK_BASENAME,
    EFFORT_GATE_HOOK_BASENAME,
    TRANSCRIPT_CACHE_BASENAME
  ];
  for (const basename of basenames) {
    const fp = path.join(hooksDir, basename);
    if (!(await fse.pathExists(fp))) continue;
    const owned = await isKitOwnedFile(fp);
    if (dryRun) {
      console.log(
        owned
          ? pc.cyan("[dry-run] would remove")
          : pc.yellow("[dry-run] would SKIP (not recognized as this kit's file)"),
        pc.dim(fp)
      );
      continue;
    }
    if (!owned) {
      console.warn(pc.yellow("Skipped (not recognized as this kit's file):"), fp);
      continue;
    }
    try {
      await fse.remove(fp);
      console.log(pc.green("Removed"), pc.dim(fp));
    } catch (e) {
      console.warn(pc.yellow("Could not remove"), fp, e?.message || e);
    }
  }
}
