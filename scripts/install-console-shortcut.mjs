#!/usr/bin/env node
/**
 * Creates a Desktop shortcut that launches vkm-console with --open against the
 * user's vault. PowerShell + WScript.Shell — Windows only (no-op elsewhere).
 *
 * Usage:
 *   node scripts/install-console-shortcut.mjs
 *   node scripts/install-console-shortcut.mjs --vault "<path>" --exe "<path>"
 */
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};

if (process.platform !== "win32") {
  console.log("install-console-shortcut: Windows only — skipped");
  process.exit(0);
}

const home = process.env.USERPROFILE || os.homedir();
const vault =
  val("--vault") ||
  process.env.VKM_VAULT ||
  process.env.BASIC_MEMORY_HOME ||
  process.env.OBSIDIAN_MEMORY_VAULT ||
  path.join(home, "Documents", "obsidian-memory-vault");
const exe = val("--exe") || path.join(ROOT, "bin", "vkm-console.exe");
const desktop = path.join(home, "Desktop");
const lnk = path.join(desktop, "vkm-console.lnk");

if (!existsSync(exe)) {
  console.error(`install-console-shortcut: missing binary: ${exe}`);
  console.error("Build it first: go build -o bin/vkm-console.exe ./cmd/vkm-console");
  process.exit(1);
}

const args = `--vault "${vault}" --open`;
/** PowerShell single-quoted literal ('' escapes '). */
const psQuote = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const ps1 = path.join(os.tmpdir(), `vkm-console-shortcut-${process.pid}.ps1`);
const script = [
  `$W = New-Object -ComObject WScript.Shell`,
  `$S = $W.CreateShortcut(${psQuote(lnk)})`,
  `$S.TargetPath = ${psQuote(exe)}`,
  `$S.Arguments = ${psQuote(args)}`,
  `$S.WorkingDirectory = ${psQuote(path.dirname(exe))}`,
  `$S.Description = ${psQuote("vkm-console - kit dashboard (local)")}`,
  `$S.Save()`,
  `Write-Output ${psQuote(lnk)}`
].join("\n");

writeFileSync(ps1, script, "utf8");
const r = spawnSync("powershell.exe", ["-NoProfile", "-File", ps1], {
  encoding: "utf8"
});
try {
  unlinkSync(ps1);
} catch {
  /* best-effort */
}
if (r.status !== 0) {
  console.error(r.stdout || "");
  console.error(r.stderr || "");
  process.exit(r.status ?? 1);
}
console.log("Desktop shortcut:", (r.stdout || "").trim() || lnk);
console.log("Target:", exe);
console.log("Vault:", vault);
