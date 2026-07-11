// Shared primitives for safely reading, merging and writing `~/.claude/settings.json`
// (and any other user-owned JSON config this kit manages).
//
// Extracted from `claude-native-memory.mjs` (Phase 0 groundwork, ADR-0042 train) so new
// installer modules (token-saver, telemetry, assets) can reuse the exact same battle-tested
// idiom instead of copying it: read → BOM-strip → parse (backup invalid) → pure merge on a
// copy → JSON.parse sanity → backup prior → atomic tmp + restrict + rename → symmetric
// reconcile keyed on ownership markers/stems. Behavior is identical to the pre-extraction
// code; the existing test suite is the refactor guard.
//
// Everything here is either PURE (the merge/remove helpers — never mutate their input) or
// best-effort I/O with crash-safe semantics (the read/write helpers). Nothing in this module
// logs; user-facing messages stay in the orchestrators that own the flow.
import path from "node:path";
import fse from "fs-extra";
import { restrictFileToOwner } from "./file-perms.mjs";

/** Literal string every hook/asset file this kit ships carries in its header comment. Used
 * as a cheap-but-reliable ownership marker before `--uninstall` deletes a file by that name —
 * a user's own unrelated same-named script is exceedingly unlikely to contain this exact
 * npm package name in its source. */
export const KIT_FILE_MARKER = "vkm-kit";

/** Prior markers this kit shipped under other names. Ownership checks accept these too, so
 * files installed by an older release are still recognized as ours after a rename. Filled at
 * the 4.0.0 rename (ADR-0041); kept exported so reconcile paths can match both directions. */
export const LEGACY_FILE_MARKERS = ["create-obsidian-memory"];

/** Strip UTF-8 BOM so JSON.parse succeeds (common when a file was saved from PowerShell). */
export function stripLeadingUtf8Bom(text) {
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
export function hookEntryMatchesStem(h, stem) {
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
 * @param {{ command: string, args: string[] }} hookEntry - exec-form hook command
 * @param {string} stem - filename stem identifying our managed entry, for dedup
 * @returns {Record<string, unknown>} a NEW hooks object
 */
export function mergeManagedHook(hooks, eventName, matcher, hookEntry, stem) {
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
export function removeManagedHook(hooks, eventName, stem) {
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
export function setOrDeleteHooks(settings, hadHooksBefore, next) {
  if (Object.keys(next).length || hadHooksBefore) {
    settings.hooks = next;
  }
  return settings;
}

/** True if `hooks[eventName]` currently contains a managed entry for `stem`. Used to decide
 * whether a removal is a real action worth announcing (dry-run) or a pure no-op. */
export function hasManagedHook(hooks, eventName, stem) {
  const prior = hooks && Array.isArray(hooks[eventName]) ? hooks[eventName] : [];
  return prior.some((entry) => {
    const inner = entry && Array.isArray(entry.hooks) ? entry.hooks : [];
    return inner.some((h) => hookEntryMatchesStem(h, stem));
  });
}

/**
 * Read a user-owned JSON settings file without ever throwing: missing file, empty file and
 * invalid JSON are all first-class outcomes the caller reconciles against, not errors.
 * The raw prior bytes are returned so the caller can (a) back them up before overwriting and
 * (b) cheaply detect kit-owned entries by stem on the raw text even when the JSON is broken.
 * @param {string} settingsFp
 * @returns {Promise<{ existing: Record<string, unknown>, priorBytes: Buffer | null,
 *   invalidJson: boolean, rawText: string }>}
 */
export async function readSettingsSafe(settingsFp) {
  let existing = {};
  let priorBytes = null;
  let invalidJson = false;
  if (await fse.pathExists(settingsFp)) {
    priorBytes = await fse.readFile(settingsFp);
    const raw = stripLeadingUtf8Bom(priorBytes.toString("utf8")).trim();
    if (raw) {
      try {
        existing = JSON.parse(raw);
      } catch {
        invalidJson = true;
      }
    }
  }
  const rawText = priorBytes ? priorBytes.toString("utf8") : "";
  return { existing, priorBytes, invalidJson, rawText };
}

/**
 * Write `bytes` to a timestamped `<fp>.bak.<ts>` sibling, restricted to the current user
 * (settings files can carry secrets in keys this kit doesn't own, e.g. a user's own `env`
 * block). Returns the backup path so the caller can log it. Backups are kept indefinitely;
 * clean up manually — agent-driven installs that go wrong should be 1 `mv` away from
 * recovery.
 * @param {string} fp
 * @param {Buffer | string} bytes
 * @returns {Promise<string>}
 */
export async function backupRestricted(fp, bytes) {
  const bak = `${fp}.bak.${Date.now()}`;
  await fse.writeFile(bak, bytes);
  await restrictFileToOwner(bak);
  return bak;
}

/**
 * Write JSON to `fp` atomically: stage at `<fp>.tmp.<pid>.<ts>`, restrict to owner, rename.
 * Crash mid-write leaves the original `fp` intact rather than truncating it. The payload is
 * serialized with 2-space indent + trailing newline and parsed back once before the write —
 * never write something that won't parse.
 * @param {string} fp - target path
 * @param {unknown} data - JSON-serializable payload
 */
export async function atomicWriteJson(fp, data) {
  const out = `${JSON.stringify(data, null, 2)}\n`;
  JSON.parse(out); // sanity: never write something that won't parse back
  await fse.ensureDir(path.dirname(fp));
  const tmp = `${fp}.tmp.${process.pid}.${Date.now()}`;
  await fse.writeFile(tmp, out, "utf8");
  await restrictFileToOwner(tmp);
  await fse.rename(tmp, fp);
}

/** True if `fp` contains one of this kit's ownership markers, meaning it's safe to assume
 * WE wrote it (as opposed to a user's own unrelated same-named file). Read failures
 * (missing file, etc.) are treated as "not ours" — never delete on doubt.
 * @param {string} fp
 * @param {string[]} [markers]
 */
export async function isKitOwnedFile(fp, markers = [KIT_FILE_MARKER, ...LEGACY_FILE_MARKERS]) {
  try {
    const text = await fse.readFile(fp, "utf8");
    return markers.some((marker) => text.includes(marker));
  } catch {
    return false;
  }
}
