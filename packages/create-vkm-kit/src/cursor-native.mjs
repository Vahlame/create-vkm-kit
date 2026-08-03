// Cursor-native installer: `~/.cursor/hooks.json` (schema version 1) plus hash-tracked
// hook scripts under `~/.cursor/hooks/`. Cursor's hook shape is a flat array of
// `{ command, matcher?, type? }` per event — not Claude/Codex's nested matcher groups —
// so merge/remove are local to this module. Skills go to `~/.cursor/skills/` via
// configureSkillAssets({ ide: "cursor" }).
import path from "node:path";
import { fileURLToPath } from "node:url";
import pc from "picocolors";
import {
  ASSETS_SIDECAR_BASENAME,
  installManagedAssets,
  removeManagedAssets
} from "./asset-install.mjs";
import {
  atomicWriteJson,
  backupRestricted,
  hookEntryMatchesStem,
  readSettingsSafe
} from "./settings-io.mjs";

export const CURSOR_HOOK_STEMS = {
  context: "cursor-session-start",
  trackEdit: "cursor-track-edit",
  trackMcp: "cursor-track-mcp",
  stop: "cursor-stop-reminder",
  tokenSaver: "cursor-compact-mcp"
};

const HOOK_ASSET_BASENAMES = {
  context: ["cursor-session-start.mjs", "session-start-vault-context.mjs"],
  trackEdit: ["cursor-track-edit.mjs", "cursor-session-state.mjs"],
  trackMcp: ["cursor-track-mcp.mjs", "cursor-session-state.mjs"],
  stop: ["cursor-stop-reminder.mjs", "cursor-session-state.mjs"],
  tokenSaver: ["cursor-compact-mcp.mjs", "compact-mcp-output.mjs"]
};

function sourceHooksDir() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "hooks");
}

function cursorDir(home) {
  return path.join(home, ".cursor");
}

/**
 * Cursor user hooks run with cwd = `~/.cursor/`, but absolute paths avoid Windows
 * quoting surprises when the vault path has spaces.
 * @param {string} script
 * @param {string[]} [args]
 */
function command(script, args = []) {
  return ["node", script, ...args]
    .map((part) => `"${String(part).replaceAll('"', '\\"')}"`)
    .join(" ");
}

function selectedAssetBasenames({ context, closeReminder, tokenSaver }) {
  return [
    ...(context ? HOOK_ASSET_BASENAMES.context : []),
    ...(closeReminder
      ? [
          ...HOOK_ASSET_BASENAMES.trackEdit,
          ...HOOK_ASSET_BASENAMES.trackMcp,
          ...HOOK_ASSET_BASENAMES.stop
        ]
      : []),
    ...(tokenSaver ? HOOK_ASSET_BASENAMES.tokenSaver : [])
  ];
}

export function cursorHookAssetFiles(home, options = {}) {
  const destDir = path.join(cursorDir(home), "hooks");
  const all = options.all === true;
  const basenames = all
    ? Object.values(HOOK_ASSET_BASENAMES).flat()
    : selectedAssetBasenames({
        context: true,
        closeReminder: true,
        tokenSaver: true,
        ...options
      });
  return [...new Set(basenames)].map((basename) => ({
    src: path.join(sourceHooksDir(), basename),
    dest: path.join(destDir, basename)
  }));
}

export function cursorAssetsSidecar(home) {
  return path.join(cursorDir(home), ASSETS_SIDECAR_BASENAME);
}

/** Cursor schema: hooks[event] = [{ command, matcher?, type? }, ...] */
export function mergeCursorHook(hooks, eventName, entry, stem) {
  const prior = Array.isArray(hooks[eventName]) ? hooks[eventName] : [];
  const kept = prior.filter((h) => !hookEntryMatchesStem(h, stem));
  kept.push(entry);
  return { ...hooks, [eventName]: kept };
}

export function removeCursorHook(hooks, eventName, stem) {
  const prior = Array.isArray(hooks[eventName]) ? hooks[eventName] : [];
  const kept = prior.filter((h) => !hookEntryMatchesStem(h, stem));
  const next = { ...hooks };
  if (kept.length) next[eventName] = kept;
  else delete next[eventName];
  return next;
}

function managedHookConfig(home, vault, lang, enabled) {
  const hooksDir = path.join(cursorDir(home), "hooks");
  return [
    {
      event: "sessionStart",
      stem: CURSOR_HOOK_STEMS.context,
      enabled: enabled.context,
      entry: {
        command: command(path.join(hooksDir, "cursor-session-start.mjs"), [vault, lang])
      }
    },
    {
      event: "afterFileEdit",
      stem: CURSOR_HOOK_STEMS.trackEdit,
      enabled: enabled.closeReminder,
      entry: {
        command: command(path.join(hooksDir, "cursor-track-edit.mjs"))
      }
    },
    {
      event: "afterMCPExecution",
      stem: CURSOR_HOOK_STEMS.trackMcp,
      enabled: enabled.closeReminder,
      entry: {
        command: command(path.join(hooksDir, "cursor-track-mcp.mjs"))
      }
    },
    {
      event: "stop",
      stem: CURSOR_HOOK_STEMS.stop,
      enabled: enabled.closeReminder,
      entry: {
        command: command(path.join(hooksDir, "cursor-stop-reminder.mjs"), [lang])
      }
    },
    {
      event: "afterMCPExecution",
      stem: CURSOR_HOOK_STEMS.tokenSaver,
      enabled: enabled.tokenSaver,
      entry: {
        command: command(path.join(hooksDir, "cursor-compact-mcp.mjs"))
      }
    }
  ];
}

/**
 * Install or remove Cursor hooks without replacing a user's own hook entries.
 */
export async function configureCursorNative(
  home,
  vault,
  dryRun,
  { lang = "es", hooks = true, context = true, closeReminder = true, tokenSaver = true } = {}
) {
  const enabled = {
    context: hooks && context,
    closeReminder: hooks && closeReminder,
    tokenSaver: hooks && tokenSaver
  };
  const wanted = cursorHookAssetFiles(home, enabled);
  const all = cursorHookAssetFiles(home, { all: true });
  const wantedDests = new Set(wanted.map((file) => file.dest));
  const unwanted = all.filter((file) => !wantedDests.has(file.dest));
  const hooksFp = path.join(cursorDir(home), "hooks.json");
  const sidecarFp = cursorAssetsSidecar(home);
  const managed = managedHookConfig(home, vault, lang, enabled);

  if (dryRun) {
    for (const entry of managed) {
      console.log(
        pc.cyan(`[dry-run] would ${entry.enabled ? "merge" : "remove"} Cursor ${entry.event} hook`),
        pc.dim(entry.stem)
      );
    }
    return;
  }

  if (wanted.length) {
    const { skipped } = await installManagedAssets({
      files: wanted,
      sidecarFp,
      preserveExisting: true
    });
    for (const fp of skipped) console.warn(pc.yellow("Kept (modified by user):"), fp);
  }
  if (unwanted.length) {
    const { skipped } = await removeManagedAssets({
      sidecarFp,
      dests: unwanted.map((file) => file.dest)
    });
    for (const fp of skipped) console.warn(pc.yellow("Kept (modified by user):"), fp);
  }

  let { existing, priorBytes, invalidJson, rawText } = await readSettingsSafe(hooksFp);
  const hadOurs = Object.values(CURSOR_HOOK_STEMS).some((stem) => rawText.includes(stem));
  if (!hooks && !hadOurs) return;
  if (invalidJson) {
    const backup = await backupRestricted(hooksFp, priorBytes || "");
    console.warn(pc.yellow("Invalid ~/.cursor/hooks.json backed up to"), backup);
    existing = {};
    priorBytes = null;
  }
  const document =
    existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing } : {};
  document.version = 1;
  let hookMap =
    document.hooks && typeof document.hooks === "object" && !Array.isArray(document.hooks)
      ? { ...document.hooks }
      : {};
  for (const entry of managed) {
    hookMap = entry.enabled
      ? mergeCursorHook(hookMap, entry.event, entry.entry, entry.stem)
      : removeCursorHook(hookMap, entry.event, entry.stem);
  }
  if (Object.keys(hookMap).length) document.hooks = hookMap;
  else delete document.hooks;
  if (!document.hooks && !hadOurs && !priorBytes) return;
  await atomicWriteJson(hooksFp, document);
  console.log(pc.green("Cursor hooks reconciled:"), pc.dim(hooksFp));
}

export async function uninstallCursorNative(home, dryRun) {
  await configureCursorNative(home, "", dryRun, { hooks: false });
}
