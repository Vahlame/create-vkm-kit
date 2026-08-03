// Codex-native installer: hooks.json merge plus hash-tracked hook scripts. Codex's user
// hooks live independently from config.toml, so this module never rewrites that TOML file.
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
  mergeManagedHook,
  readSettingsSafe,
  removeManagedHook
} from "./settings-io.mjs";

export const CODEX_HOOK_STEMS = {
  context: "session-start-vault-context",
  memoryGuard: "codex-guard-native-memory-write",
  effortGate: "guard-effort-gate",
  tokenSaver: "codex-compact-tool-output",
  // Same Stop nudge Claude ships (ADR-0030) — Codex documents a Stop event with the same
  // decision/block JSON contract; without it, Codex sessions silently skip the close ritual.
  stop: "stop-vault-close-reminder"
};

const HOOK_ASSET_BASENAMES = {
  context: ["session-start-vault-context.mjs"],
  memoryGuard: ["codex-guard-native-memory-write.mjs"],
  // The gate spawns `apply-model-effort.mjs` by path (ADR-0080). It degrades to
  // notice-only when the file is absent, so omitting it here would not crash anything —
  // it would just make the Codex install quietly do less than the Claude one, which is
  // the drift this parity work exists to remove.
  effortGate: ["guard-effort-gate.mjs", "apply-model-effort.mjs", "_transcript-cache.mjs"],
  tokenSaver: ["codex-compact-tool-output.mjs", "compact-tool-output.mjs", "compact-mcp-output.mjs"],
  stop: ["stop-vault-close-reminder.mjs", "_transcript-cache.mjs"]
};

function sourceHooksDir() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "hooks");
}

function codexDir(home) {
  return path.join(home, ".codex");
}

/**
 * A Codex hook `command` is one shell STRING, so the launcher goes in front of `node` rather
 * than being the `command` with `node` as an arg (the shape Claude's settings.json uses).
 *
 * `launcher` is an INPUT, never probed here: a builder that asks the filesystem emits a
 * different config depending on install order, which is the bug mcp-merge.mjs already paid
 * for. Null (the default) reproduces the pre-fix wiring — plain `node`, and on Windows one
 * console flash per hook invocation, which is exactly the Claude-vs-Codex parity gap this
 * closes.
 *
 * @param {string} script
 * @param {string[]} [args]
 * @param {string|null} [launcher] absolute path to `vkm-runhidden.exe`, or null for bare node
 */
function command(script, args = [], launcher = null) {
  return [...(launcher ? [launcher] : []), "node", script, ...args]
    .map((part) => `"${String(part).replaceAll('"', '\\"')}"`)
    .join(" ");
}

function selectedAssetBasenames({ context, memoryGuard, effortGate, tokenSaver, stop }) {
  return [
    ...(context ? HOOK_ASSET_BASENAMES.context : []),
    ...(memoryGuard ? HOOK_ASSET_BASENAMES.memoryGuard : []),
    ...(effortGate ? HOOK_ASSET_BASENAMES.effortGate : []),
    ...(tokenSaver ? HOOK_ASSET_BASENAMES.tokenSaver : []),
    ...(stop ? HOOK_ASSET_BASENAMES.stop : [])
  ];
}

export function codexHookAssetFiles(home, options = {}) {
  const destDir = path.join(codexDir(home), "hooks");
  const all = options.all === true;
  const basenames = all
    ? Object.values(HOOK_ASSET_BASENAMES).flat()
    : selectedAssetBasenames({
        context: true,
        memoryGuard: true,
        effortGate: true,
        tokenSaver: true,
        stop: true,
        ...options
      });
  return [...new Set(basenames)].map((basename) => ({
    src: path.join(sourceHooksDir(), basename),
    dest: path.join(destDir, basename)
  }));
}

export function codexAssetsSidecar(home) {
  return path.join(codexDir(home), ASSETS_SIDECAR_BASENAME);
}

export function codexAssetRoots(home) {
  return [
    path.join(home, ".agents", "skills"),
    path.join(home, ".codex", "agents"),
    path.join(home, ".codex", "hooks")
  ];
}

function managedHookConfig(home, vault, lang, enabled, launcher = null) {
  const hooksDir = path.join(codexDir(home), "hooks");
  return [
    {
      event: "SessionStart",
      matcher: "startup|resume|clear|compact",
      stem: CODEX_HOOK_STEMS.context,
      enabled: enabled.context,
      handler: {
        command: command(
          path.join(hooksDir, "session-start-vault-context.mjs"),
          [vault, lang],
          launcher
        ),
        statusMessage: "Loading vkm vault context",
        additionalContextLimit: 5000
      }
    },
    {
      event: "PreToolUse",
      matcher: "Bash|apply_patch",
      stem: CODEX_HOOK_STEMS.memoryGuard,
      enabled: enabled.memoryGuard,
      handler: {
        command: command(
          path.join(hooksDir, "codex-guard-native-memory-write.mjs"),
          [codexDir(home), lang],
          launcher
        ),
        statusMessage: "Protecting generated Codex memories"
      }
    },
    {
      event: "PreToolUse",
      matcher: "apply_patch",
      stem: CODEX_HOOK_STEMS.effortGate,
      enabled: enabled.effortGate,
      handler: {
        command: command(path.join(hooksDir, "guard-effort-gate.mjs"), [lang], launcher),
        statusMessage: "Checking implementation effort"
      }
    },
    {
      event: "PostToolUse",
      matcher: "Bash|apply_patch|mcp__.*",
      stem: CODEX_HOOK_STEMS.tokenSaver,
      enabled: enabled.tokenSaver,
      handler: {
        command: command(path.join(hooksDir, "codex-compact-tool-output.mjs"), [], launcher),
        statusMessage: "Compacting tool output",
        additionalContextLimit: 6000
      }
    },
    {
      event: "Stop",
      matcher: "*",
      stem: CODEX_HOOK_STEMS.stop,
      enabled: enabled.stop,
      handler: {
        command: command(path.join(hooksDir, "stop-vault-close-reminder.mjs"), [lang], launcher),
        statusMessage: "Vault close reminder"
      }
    }
  ];
}

/** Install or remove Codex hooks without ever replacing a user's own hook entries. */
export async function configureCodexNative(
  home,
  vault,
  dryRun,
  {
    lang = "es",
    hooks = true,
    context = true,
    memoryGuard = true,
    effortGate = true,
    tokenSaver = true,
    stop = true,
    launcher = null
  } = {}
) {
  const enabled = {
    context: hooks && context,
    memoryGuard: hooks && memoryGuard,
    effortGate: hooks && effortGate,
    tokenSaver: hooks && tokenSaver,
    stop: hooks && stop
  };
  const wanted = codexHookAssetFiles(home, enabled);
  const all = codexHookAssetFiles(home, { all: true });
  const wantedDests = new Set(wanted.map((file) => file.dest));
  const unwanted = all.filter((file) => !wantedDests.has(file.dest));
  const hooksFp = path.join(codexDir(home), "hooks.json");
  const sidecarFp = codexAssetsSidecar(home);
  const managed = managedHookConfig(home, vault, lang, enabled, launcher);

  if (dryRun) {
    for (const entry of managed) {
      console.log(
        pc.cyan(`[dry-run] would ${entry.enabled ? "merge" : "remove"} Codex ${entry.event} hook`),
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
  const hadOurs = Object.values(CODEX_HOOK_STEMS).some((stem) => rawText.includes(stem));
  if (!hooks && !hadOurs) return;
  if (invalidJson) {
    const backup = await backupRestricted(hooksFp, priorBytes || "");
    console.warn(pc.yellow("Invalid ~/.codex/hooks.json backed up to"), backup);
    existing = {};
    priorBytes = null;
  }
  const document =
    existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing } : {};
  let hookMap =
    document.hooks && typeof document.hooks === "object" && !Array.isArray(document.hooks)
      ? { ...document.hooks }
      : {};
  for (const entry of managed) {
    hookMap = entry.enabled
      ? mergeManagedHook(hookMap, entry.event, entry.matcher, entry.handler, entry.stem)
      : removeManagedHook(hookMap, entry.event, entry.stem);
  }
  if (Object.keys(hookMap).length) document.hooks = hookMap;
  else delete document.hooks;
  if (!document.hooks && !hadOurs && !priorBytes) return;
  await atomicWriteJson(hooksFp, document);
  console.log(pc.green("Codex hooks reconciled:"), pc.dim(hooksFp));
}

export async function uninstallCodexNative(home, dryRun) {
  await configureCodexNative(home, "", dryRun, { hooks: false });
}
