// vkm-kit local telemetry installer (ADR-0044): wires Claude Code's OTLP metrics export to
// the local vkm-otel-sink so `vkm-doctor` has real usage data. LOCAL ONLY by construction —
// the endpoint is 127.0.0.1 and the sink persists to `~/.vkm/telemetry/`; nothing leaves
// the machine. Two managed pieces, reconciled symmetrically like every other module:
// (1) the four OTEL env vars in settings.json (`env` block, removal only reverts values
// still exactly ours), (2) a SessionStart hook that spawns the sink when it isn't running.
// The sink script itself lives in the kit checkout (`packages/vkm-doctor/`), same
// wire-by-absolute-path model as the hybrid MCP server — so telemetry needs a kit clone
// (callers pass `kitRoot`; without one this module is skipped with a hint).
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
import { mergeManagedEnv, removeManagedEnv } from "./settings-writers.mjs";

export const ENSURE_SINK_HOOK_STEM = "ensure-otel-sink";
export const ENSURE_SINK_HOOK_BASENAME = `${ENSURE_SINK_HOOK_STEM}.mjs`;

/** The managed env block (values must stay in sync with vkm-doctor's DEFAULT_PORT). */
export const TELEMETRY_ENV = {
  CLAUDE_CODE_ENABLE_TELEMETRY: "1",
  OTEL_METRICS_EXPORTER: "otlp",
  OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
  OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4319"
};

function packagedHookPath(basename) {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "hooks", basename);
}

/** `<kitRoot>/packages/vkm-doctor/src/otel-sink.mjs` (the script the hook spawns). */
export function sinkScriptFromKitRoot(kitRoot) {
  return path.join(kitRoot, "packages", "vkm-doctor", "src", "otel-sink.mjs");
}

/**
 * Install / reconcile / remove local telemetry. Same symmetric contract as the sibling
 * modules; `enable:false` strips a prior install. Needs `kitRoot` only when enabling.
 * @param {string} home
 * @param {boolean} dryRun
 * @param {{ enable?: boolean, kitRoot?: string | null }} [opts]
 */
export async function configureTelemetry(home, dryRun, { enable = true, kitRoot = null } = {}) {
  const claudeDir = path.join(home, ".claude");
  const hooksDir = path.join(claudeDir, "hooks");
  const settingsFp = path.join(claudeDir, "settings.json");
  const hookDest = path.join(hooksDir, ENSURE_SINK_HOOK_BASENAME);

  try {
    if (enable && !kitRoot) {
      console.log(
        pc.dim("Telemetry skipped: needs a kit clone (--repo-root) to host the OTLP sink.")
      );
      return;
    }
    let { existing, priorBytes, invalidJson, rawText } = await readSettingsSafe(settingsFp);
    const oursPresent =
      rawText.includes(ENSURE_SINK_HOOK_STEM) || rawText.includes("CLAUDE_CODE_ENABLE_TELEMETRY");
    if (!enable && !oursPresent) return;

    if (dryRun) {
      console.log(
        pc.cyan(
          enable
            ? "[dry-run] would enable LOCAL telemetry (OTEL env → 127.0.0.1:4319 + SessionStart sink hook)"
            : "[dry-run] would remove the telemetry env block + sink hook"
        )
      );
      return;
    }

    const sinkScript = enable ? sinkScriptFromKitRoot(kitRoot) : null;
    if (enable) {
      await fse.ensureDir(hooksDir);
      await fse.copy(packagedHookPath(ENSURE_SINK_HOOK_BASENAME), hookDest, { overwrite: true });
    }

    if (invalidJson) {
      const bak = await backupRestricted(settingsFp, priorBytes);
      console.warn(pc.yellow("Invalid JSON in ~/.claude/settings.json; backed up to"), bak);
      existing = {};
    }

    let merged = enable
      ? mergeManagedEnv(existing, TELEMETRY_ENV)
      : removeManagedEnv(existing, TELEMETRY_ENV);
    const hadHooks =
      merged.hooks && typeof merged.hooks === "object" && !Array.isArray(merged.hooks);
    let hookMap = hadHooks ? /** @type {Record<string, unknown>} */ (merged.hooks) : {};
    hookMap = enable
      ? mergeManagedHook(
          hookMap,
          "SessionStart",
          "*",
          { command: "node", args: [hookDest, sinkScript] },
          ENSURE_SINK_HOOK_STEM
        )
      : removeManagedHook(hookMap, "SessionStart", ENSURE_SINK_HOOK_STEM);
    merged = setOrDeleteHooks(merged, Boolean(hadHooks), hookMap);

    if (priorBytes && !invalidJson) {
      const bak = await backupRestricted(settingsFp, priorBytes);
      console.log(pc.dim("Backed up previous settings.json to"), bak);
    }
    await atomicWriteJson(settingsFp, merged);

    if (enable) {
      console.log(
        pc.green("Local telemetry:"),
        pc.dim("OTEL → 127.0.0.1:4319 → ~/.vkm/telemetry/ (run `vkm-doctor` for the report)")
      );
    } else if (oursPresent) {
      console.log(pc.green("Local telemetry removed:"), settingsFp);
    }
  } catch (e) {
    console.warn(pc.yellow("Could not configure telemetry (skipped):"), e?.message || e);
  }
}

/** Full teardown: settings pieces + the hook script file (marker-checked). */
export async function uninstallTelemetry(home, dryRun) {
  await configureTelemetry(home, dryRun, { enable: false });
  const fp = path.join(home, ".claude", "hooks", ENSURE_SINK_HOOK_BASENAME);
  if (!(await fse.pathExists(fp))) return;
  const owned = await isKitOwnedFile(fp);
  if (dryRun) {
    console.log(
      owned
        ? pc.cyan("[dry-run] would remove")
        : pc.yellow("[dry-run] would SKIP (not recognized as this kit's file)"),
      pc.dim(fp)
    );
    return;
  }
  if (!owned) {
    console.warn(pc.yellow("Skipped (not recognized as this kit's file):"), fp);
    return;
  }
  try {
    await fse.remove(fp);
    console.log(pc.green("Removed"), pc.dim(fp));
  } catch (e) {
    console.warn(pc.yellow("Could not remove"), fp, e?.message || e);
  }
}
