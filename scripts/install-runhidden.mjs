/**
 * Installs the windowless hook launcher into ~/.claude/bin and repoints every existing hook at it.
 *
 * Why a launcher at all: every vkm hook is a Node script, the agent host starts one process per
 * matching event, and two of them fire on EVERY Bash and EVERY MCP call — hundreds per research
 * run. node.exe is a CONSOLE-subsystem binary, so each of those spawns can allocate a console: a
 * real window that appears, takes the foreground, and vanishes milliseconds later. The kit cannot
 * pass CREATE_NO_WINDOW itself because the host does the spawning, so instead it changes WHAT is
 * spawned. See cmd/vkm-runhidden.
 *
 * Idempotent, and a no-op off Windows (nothing to suppress there).
 *
 *   node scripts/install-hookw.mjs [--settings <path>]
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const built = path.join(here, "..", "bin", "vkm-runhidden.exe");
const claudeDir = path.join(os.homedir(), ".claude");
const destDir = path.join(claudeDir, "bin");
const dest = path.join(destDir, "vkm-runhidden.exe");

if (process.platform !== "win32") {
  console.log("not Windows — nothing to install (no console windows to suppress)");
  process.exit(0);
}

if (!existsSync(built)) {
  console.error(`missing ${built}\nBuild it first:  npm run build:runhidden   (needs Go)`);
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(built, dest);
console.log(`installed ${dest}`);

// Repoint hooks that are still invoking node directly.
const settingsArg = process.argv.indexOf("--settings");
const settingsPath = settingsArg > -1 ? process.argv[settingsArg + 1] : path.join(claudeDir, "settings.json");
if (!existsSync(settingsPath)) {
  console.log(`no settings at ${settingsPath} — launcher installed, hooks unchanged`);
  process.exit(0);
}

// Back up before touching it: a malformed settings.json costs the user their whole session.
const raw = readFileSync(settingsPath, "utf8");
writeFileSync(`${settingsPath}.bak-runhidden`, raw);

const settings = JSON.parse(raw);
let changed = 0;
for (const groups of Object.values(settings.hooks ?? {})) {
  for (const group of groups) {
    for (const hook of group.hooks ?? []) {
      // Only the exec form (command + args). A hook whose `command` is a full shell string is
      // somebody's own customisation and is left exactly as it is.
      if (hook.command === "node" && Array.isArray(hook.args) && hook.args.length > 0) {
        hook.command = dest;
        changed++;
      }
    }
  }
}

writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
console.log(`repointed ${changed} hook(s); backup at ${settingsPath}.bak-runhidden`);
console.log("Hooks are read at session start — restart Claude Code for this to take effect.");
