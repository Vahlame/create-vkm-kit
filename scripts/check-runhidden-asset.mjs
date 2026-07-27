#!/usr/bin/env node
/**
 * `prepack` gate: refuse to build a tarball that would ship without the Windows hook launcher.
 *
 * The launcher is the entire console-flash fix, and its absence is SILENT — a package published
 * without it installs cleanly, writes hook entries pointing at plain `node`, and every user on
 * Windows gets the flashing back with nothing in any log to say why. The binary is also not in
 * git (it is a build output), so "it was there when I tested" is not evidence about what npm
 * actually packed.
 *
 * A comment asking the releaser to remember is not a gate. This is:
 *
 *   npm publish  ->  prepack  ->  this  ->  non-zero if bin/vkm-runhidden.exe is missing
 *
 * Produce it with (Go, cross-compiles from any host):
 *
 *   npm run build:runhidden
 *
 * `--allow-missing` exists for `npm pack` dry-runs that deliberately do not want the binary; it
 * prints the same explanation and exits 0. Nothing in the release path passes it.
 */
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ASSET = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "packages",
  "create-vkm-kit",
  "bin",
  "vkm-runhidden.exe"
);

// A GUI-subsystem Go binary with -s -w is ~1.2MB. Anything tiny is a truncated copy or a Git LFS
// pointer, both of which would pack "successfully" and fail on the user's machine instead.
const MIN_BYTES = 200_000;

const allowMissing = process.argv.includes("--allow-missing");

let size;
try {
  size = statSync(ASSET).size;
} catch {
  const message =
    `missing ${path.relative(process.cwd(), ASSET)}\n` +
    `Publishing without it ships the console-flash bug back to every Windows user, silently.\n` +
    `Build it first:  npm run build:runhidden   (needs Go; cross-compiles from any OS)`;
  if (allowMissing) {
    console.warn(`check-runhidden-asset: ${message}`);
    process.exit(0);
  }
  console.error(`check-runhidden-asset: ${message}`);
  process.exit(1);
}

if (size < MIN_BYTES) {
  console.error(
    `check-runhidden-asset: ${path.relative(process.cwd(), ASSET)} is ${size} bytes, ` +
      `expected at least ${MIN_BYTES} — that is a truncated or placeholder file, not the launcher.`
  );
  process.exit(1);
}

console.log(`check-runhidden-asset: ok (${size} bytes)`);
