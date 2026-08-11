// Kimi Code-native installer: hash-tracked hook scripts under `~/.kimi-code/hooks/` plus
// a managed `[[hooks]]` block in `~/.kimi-code/config.toml`. Kimi's hook config is TOML
// (not Claude's settings.json or Cursor's hooks.json), so the merge is a sentinel-block
// text merge — `# vkm-kit:start` / `# vkm-kit:end` are TOML comments, valid anywhere in
// the file — and only the four documented fields (event/matcher/command/timeout) are
// written: an extra field makes Kimi reject the WHOLE config.toml.
import path from "node:path";
import { fileURLToPath } from "node:url";
import fse from "fs-extra";
import pc from "picocolors";
import {
  ASSETS_SIDECAR_BASENAME,
  installManagedAssets,
  removeManagedAssets
} from "./asset-install.mjs";
import { restrictFileToOwner } from "./file-perms.mjs";
import { kimiHome } from "./kimi-home.mjs";

export const KIMI_TOML_START = "# vkm-kit:start";
export const KIMI_TOML_END = "# vkm-kit:end";

export const KIMI_HOOK_STEMS = {
  context: "kimi-session-start-vault-context",
  close: "kimi-stop-vault-close-reminder"
};

// The wrappers import their Claude siblings as plain libraries (shared logic, different
// output contract), so those ship alongside; stop-vault-close-reminder.mjs in turn
// imports _transcript-cache.mjs at module load.
const HOOK_ASSET_BASENAMES = {
  context: ["kimi-session-start-vault-context.mjs", "session-start-vault-context.mjs"],
  close: [
    "kimi-stop-vault-close-reminder.mjs",
    "stop-vault-close-reminder.mjs",
    "_transcript-cache.mjs"
  ]
};

function sourceHooksDir() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "hooks");
}

export function kimiHookAssetFiles(home, options = {}) {
  const destDir = path.join(kimiHome(home), "hooks");
  const all = options.all === true;
  const basenames = all
    ? Object.values(HOOK_ASSET_BASENAMES).flat()
    : [
        ...(options.context === false ? [] : HOOK_ASSET_BASENAMES.context),
        ...(options.closeReminder === false ? [] : HOOK_ASSET_BASENAMES.close)
      ];
  return [...new Set(basenames)].map((basename) => ({
    src: path.join(sourceHooksDir(), basename),
    dest: path.join(destDir, basename)
  }));
}

/**
 * TOML literal string (single quotes, no escapes — Windows backslash paths stay readable).
 * A path containing a single quote cannot be represented; those are vanishingly rare on
 * real systems and the command would simply fail to parse, failing the hook open.
 */
function tomlLiteral(s) {
  return `'${String(s)}'`;
}

/** Quoted for the SHELL Kimi runs the command through; the TOML quoting is tomlLiteral's job. */
function shellQuote(s) {
  return `"${String(s).replaceAll('"', '\\"')}"`;
}

/**
 * The managed `[[hooks]]` block for config.toml. `enabled` gates each entry separately so
 * `--no-kimi-hooks`-style removals leave the other entry (and every user line) untouched.
 */
export function kimiHooksTomlBlock(
  home,
  vault,
  lang,
  { context = true, closeReminder = true } = {}
) {
  const hooksDir = path.join(kimiHome(home), "hooks");
  const entries = [];
  if (context) {
    entries.push(
      [
        "[[hooks]]",
        // UserPromptSubmit, not SessionStart: SessionStart is observation-only in Kimi
        // (its stdout never reaches the context — verified live), while a
        // UserPromptSubmit hook's stdout IS appended. The script self-limits to the
        // first prompt of each session via a sidecar marker.
        'event = "UserPromptSubmit"',
        `command = ${tomlLiteral(`node ${shellQuote(path.join(hooksDir, "kimi-session-start-vault-context.mjs"))} ${shellQuote(vault)} ${lang}`)}`,
        "timeout = 10"
      ].join("\n")
    );
  }
  if (closeReminder) {
    entries.push(
      [
        "[[hooks]]",
        'event = "Stop"',
        `command = ${tomlLiteral(`node ${shellQuote(path.join(hooksDir, "kimi-stop-vault-close-reminder.mjs"))} ${lang}`)}`,
        "timeout = 10"
      ].join("\n")
    );
  }
  if (!entries.length) return "";
  return [KIMI_TOML_START, ...entries, KIMI_TOML_END].join("\n");
}

/**
 * Upsert (`block` non-empty) or remove (`block` "") the managed block in config.toml
 * text. User content outside the sentinels is preserved verbatim; without sentinels the
 * block is appended (or, for removal, the text is returned unchanged).
 */
export function mergeKimiToml(existing, block) {
  const text = (existing || "").replace(/\s+$/, "");
  const s = text.indexOf(KIMI_TOML_START);
  const e = text.indexOf(KIMI_TOML_END);
  if (s !== -1 && e !== -1 && e > s) {
    const before = text.slice(0, s).replace(/\s+$/, "");
    const after = text.slice(e + KIMI_TOML_END.length).replace(/^\s+/, "");
    return (
      [before, block.trim(), after]
        .filter(Boolean)
        .join("\n\n")
        .replace(/\n{3,}/g, "\n\n") + "\n"
    );
  }
  if (!block.trim()) return text ? text + "\n" : "";
  return (text ? text + "\n\n" : "") + block.trim() + "\n";
}

/**
 * Install or remove the Kimi Code hooks (scripts + config.toml block) without touching
 * any user-managed `[[hooks]]` entry or other config.toml content.
 */
export async function configureKimiNative(
  home,
  vault,
  dryRun,
  { lang = "es", hooks = true, context = true, closeReminder = true } = {}
) {
  const enabled = { context: hooks && context, closeReminder: hooks && closeReminder };
  const wanted = kimiHookAssetFiles(home, enabled);
  const all = kimiHookAssetFiles(home, { all: true });
  const wantedDests = new Set(wanted.map((file) => file.dest));
  const unwanted = all.filter((file) => !wantedDests.has(file.dest));
  const sidecarFp = path.join(kimiHome(home), ASSETS_SIDECAR_BASENAME);
  const configFp = path.join(kimiHome(home), "config.toml");
  const block = kimiHooksTomlBlock(home, vault, lang, enabled);

  if (dryRun) {
    for (const { dest } of wanted) console.log(pc.cyan("[dry-run] would install"), pc.dim(dest));
    for (const { dest } of unwanted) {
      console.log(pc.cyan("[dry-run] would remove (if unmodified)"), pc.dim(dest));
    }
    console.log(
      pc.cyan(`[dry-run] would ${block ? "merge hooks block into" : "strip hooks block from"}`),
      pc.dim(configFp)
    );
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

  const exists = await fse.pathExists(configFp);
  const priorBytes = exists ? await fse.readFile(configFp) : null;
  const existingText = exists ? priorBytes.toString("utf8") : "";
  const hadOurs = existingText.includes(KIMI_TOML_START);
  if (!block && !hadOurs) return; // nothing to remove, nothing to add
  const merged = mergeKimiToml(existingText, block);
  if (merged === (existingText ? existingText.replace(/\s+$/, "") + "\n" : "") && exists) return;
  if (!merged.trim() && !exists) return;
  await fse.ensureDir(path.dirname(configFp));
  // config.toml holds the user's providers and credentials — back it up before every
  // managed write so a bad merge is one `mv` away from recovery.
  if (priorBytes) {
    const bak = `${configFp}.bak.${Date.now()}`;
    await fse.writeFile(bak, priorBytes);
    await restrictFileToOwner(bak);
    console.log(pc.dim("Backed up previous config.toml to"), bak);
  }
  await fse.writeFile(configFp, merged, "utf8");
  console.log(
    pc.green(block ? "Kimi hooks reconciled:" : "Kimi hooks removed from:"),
    pc.dim(configFp)
  );
}

export async function uninstallKimiNative(home, dryRun) {
  await configureKimiNative(home, "", dryRun, { hooks: false });
}
