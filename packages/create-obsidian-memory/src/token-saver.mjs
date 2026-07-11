// vkm-kit token-saver installer (ADR-0043): wires the pieces that cut Claude Code's token
// spend with zero quality loss — two PostToolUse compaction hooks (noisy Bash output; MCP
// JSON whitespace), permissions.deny rules that stop Claude from reading token-hungry
// build artifacts, and the `vkm-terse` output style (default ON under `--full`).
//
// Same contract as `claude-native-memory.mjs`: symmetric reconcile (every call merges what
// is wanted and actively strips what is not, so `--no-token-saver` on a re-run reverses a
// prior install), true no-op when nothing is wanted and nothing of ours is present,
// best-effort and non-fatal, all settings writes via the shared crash-safe primitives in
// `settings-io.mjs`, and template files tracked by content hash (`asset-install.mjs`) so
// uninstall never deletes a user-modified file.
import path from "node:path";
import { fileURLToPath } from "node:url";
import fse from "fs-extra";
import pc from "picocolors";
import {
  atomicWriteJson,
  backupRestricted,
  isKitOwnedFile,
  mergeManagedHook,
  readSettingsSafe,
  removeManagedHook,
  setOrDeleteHooks
} from "./settings-io.mjs";
import {
  mergeManagedPermissions,
  removeManagedPermissions,
  setManagedOutputStyle,
  clearManagedOutputStyle
} from "./settings-writers.mjs";
import {
  ASSETS_SIDECAR_BASENAME,
  installManagedAssets,
  removeManagedAssets
} from "./asset-install.mjs";

/** Filename stems of the managed PostToolUse hooks (dedup + uninstall detection). */
export const COMPACT_BASH_HOOK_STEM = "compact-tool-output";
export const COMPACT_BASH_HOOK_BASENAME = `${COMPACT_BASH_HOOK_STEM}.mjs`;
export const COMPACT_MCP_HOOK_STEM = "compact-mcp-output";
export const COMPACT_MCP_HOOK_BASENAME = `${COMPACT_MCP_HOOK_STEM}.mjs`;

/** The shipped output style (templates/output-styles/) + the settings value it activates. */
export const TERSE_STYLE_NAME = "vkm-terse";
export const TERSE_STYLE_BASENAME = `${TERSE_STYLE_NAME}.md`;

/** Read-deny rules for artifacts that burn input tokens without informing the model
 * (generated/vendored content; lockfiles are machine-written and huge). Kept deliberately
 * short — a deny rule is a hard block, so only unambiguous noise qualifies. */
export const TOKEN_SAVER_DENY_RULES = [
  "Read(node_modules/**)",
  "Read(**/dist/**)",
  "Read(**/*.lock)",
  "Read(**/package-lock.json)"
];

const TOKEN_SAVER_STEMS = [COMPACT_BASH_HOOK_STEM, COMPACT_MCP_HOOK_STEM];

function packagedPath(...segments) {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), ...segments);
}

/** Exec-form hook entry (same rationale as `hookCommand` in claude-native-memory.mjs). */
export function compactHookCommand(hookPath) {
  return { command: "node", args: [hookPath] };
}

/**
 * Install / reconcile / remove the token-saver pieces in `~/.claude/`.
 * @param {string} home
 * @param {boolean} dryRun
 * @param {{ lang?: "es"|"en", hooks?: boolean, terseStyle?: boolean, denyRules?: boolean }} [opts]
 *   Each piece is independently toggleable; all default ON (callers pass the resolved
 *   `--token-saver` / `--terse-style` flags).
 */
export async function configureTokenSaver(
  home,
  dryRun,
  { hooks = true, terseStyle = true, denyRules = true } = {}
) {
  const claudeDir = path.join(home, ".claude");
  const hooksDir = path.join(claudeDir, "hooks");
  const settingsFp = path.join(claudeDir, "settings.json");
  const sidecarFp = path.join(claudeDir, ASSETS_SIDECAR_BASENAME);
  const bashHookDest = path.join(hooksDir, COMPACT_BASH_HOOK_BASENAME);
  const mcpHookDest = path.join(hooksDir, COMPACT_MCP_HOOK_BASENAME);
  const styleDest = path.join(claudeDir, "output-styles", TERSE_STYLE_BASENAME);

  try {
    let { existing, priorBytes, invalidJson, rawText } = await readSettingsSafe(settingsFp);
    const oursPresent =
      TOKEN_SAVER_STEMS.some((stem) => rawText.includes(stem)) ||
      rawText.includes(TERSE_STYLE_NAME) ||
      TOKEN_SAVER_DENY_RULES.some((rule) => rawText.includes(rule)) ||
      (await fse.pathExists(styleDest));
    const wantAnything = hooks || terseStyle || denyRules;

    // True no-op: nothing wanted, nothing of ours anywhere — never conjure settings.json.
    if (!wantAnything && !oursPresent) return;

    if (dryRun) {
      if (hooks) {
        console.log(pc.cyan("[dry-run] would install PostToolUse compaction hooks"));
      } else if (TOKEN_SAVER_STEMS.some((stem) => rawText.includes(stem))) {
        console.log(pc.cyan("[dry-run] would remove PostToolUse compaction hooks"));
      }
      if (terseStyle) {
        console.log(pc.cyan("[dry-run] would install + activate output style"), TERSE_STYLE_NAME);
      } else if (rawText.includes(TERSE_STYLE_NAME)) {
        console.log(pc.cyan("[dry-run] would deactivate output style"), TERSE_STYLE_NAME);
      }
      if (denyRules) {
        console.log(
          pc.cyan("[dry-run] would add permissions.deny rules:"),
          TOKEN_SAVER_DENY_RULES.join(", ")
        );
      } else if (TOKEN_SAVER_DENY_RULES.some((rule) => rawText.includes(rule))) {
        console.log(pc.cyan("[dry-run] would remove the token-saver permissions.deny rules"));
      }
      return;
    }

    // 1. Files first (settings only reference what exists). Hook scripts are copied like the
    // native-memory hooks; the output style goes through the hash-tracked asset installer.
    if (hooks) {
      await fse.ensureDir(hooksDir);
      await fse.copy(packagedPath("hooks", COMPACT_BASH_HOOK_BASENAME), bashHookDest, {
        overwrite: true
      });
      await fse.copy(packagedPath("hooks", COMPACT_MCP_HOOK_BASENAME), mcpHookDest, {
        overwrite: true
      });
    }
    if (terseStyle) {
      await installManagedAssets({
        files: [
          {
            src: packagedPath("..", "templates", "output-styles", TERSE_STYLE_BASENAME),
            dest: styleDest
          }
        ],
        sidecarFp
      });
    } else {
      const { skipped } = await removeManagedAssets({ sidecarFp, dests: [styleDest] });
      for (const fp of skipped) {
        console.warn(pc.yellow("Kept (modified by user):"), fp);
      }
    }

    if (invalidJson) {
      const bak = await backupRestricted(settingsFp, priorBytes);
      console.warn(pc.yellow("Invalid JSON in ~/.claude/settings.json; backed up to"), bak);
      existing = {};
    }

    // 2. Reconcile settings.json — merge wanted pieces, strip unwanted ones.
    let merged =
      existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing } : {};
    const hadHooks =
      merged.hooks && typeof merged.hooks === "object" && !Array.isArray(merged.hooks);
    let hookMap = hadHooks ? merged.hooks : {};
    if (hooks) {
      hookMap = mergeManagedHook(
        hookMap,
        "PostToolUse",
        "Bash",
        compactHookCommand(bashHookDest),
        COMPACT_BASH_HOOK_STEM
      );
      hookMap = mergeManagedHook(
        hookMap,
        "PostToolUse",
        "mcp__.*",
        compactHookCommand(mcpHookDest),
        COMPACT_MCP_HOOK_STEM
      );
    } else {
      hookMap = removeManagedHook(hookMap, "PostToolUse", COMPACT_BASH_HOOK_STEM);
      hookMap = removeManagedHook(hookMap, "PostToolUse", COMPACT_MCP_HOOK_STEM);
    }
    merged = setOrDeleteHooks(merged, Boolean(hadHooks), hookMap);
    merged = denyRules
      ? mergeManagedPermissions(merged, { deny: TOKEN_SAVER_DENY_RULES })
      : removeManagedPermissions(merged, { deny: TOKEN_SAVER_DENY_RULES });
    merged = terseStyle
      ? setManagedOutputStyle(merged, TERSE_STYLE_NAME)
      : clearManagedOutputStyle(merged, TERSE_STYLE_NAME);

    if (priorBytes && !invalidJson) {
      const bak = await backupRestricted(settingsFp, priorBytes);
      console.log(pc.dim("Backed up previous settings.json to"), bak);
    }
    await atomicWriteJson(settingsFp, merged);

    if (hooks) {
      console.log(pc.green("Token-saver hooks:"), pc.dim(`${bashHookDest}, ${mcpHookDest}`));
    }
    if (terseStyle) {
      console.log(pc.green("Output style installed + active:"), pc.dim(styleDest));
    }
    if (denyRules) {
      console.log(
        pc.green("permissions.deny noise rules:"),
        pc.dim(TOKEN_SAVER_DENY_RULES.join(", "))
      );
    }
  } catch (e) {
    console.warn(pc.yellow("Could not configure the token-saver (skipped):"), e?.message || e);
  }
}

/**
 * Fully reverse the token-saver: settings entries via the reconcile-with-everything-off
 * path, then the hook script files (marker-checked) and the output-style asset
 * (hash-checked). Mirrors `uninstallClaudeNativeMemory`.
 * @param {string} home
 * @param {boolean} dryRun
 */
export async function uninstallTokenSaver(home, dryRun) {
  await configureTokenSaver(home, dryRun, { hooks: false, terseStyle: false, denyRules: false });

  const hooksDir = path.join(home, ".claude", "hooks");
  for (const basename of [COMPACT_BASH_HOOK_BASENAME, COMPACT_MCP_HOOK_BASENAME]) {
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
