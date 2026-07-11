#!/usr/bin/env node
/**
 * Mirrors the canonical root LICENSE.md into every packages/<pkg>/ dir.
 *
 * npm only auto-includes LICENSE* files found in the *package* root — the repo
 * root copy never reaches a published tarball. The published package
 * (@vkmikc/create-vkm-kit) therefore needs its own copy, and the other
 * packages carry one too so a single rule holds: every package dir mirrors the
 * canonical text, byte for byte, and `"license": "SEE LICENSE IN LICENSE.md"`
 * always points at a real file.
 *
 *   - `node scripts/license-sync.mjs`          rewrite every mirror from the root copy.
 *   - `node scripts/license-sync.mjs --check`  exit 1 if any mirror is missing or drifted.
 *
 * Pure Node built-ins (no deps) so it runs in CI before `npm ci`.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonical = readFileSync(path.join(ROOT, "LICENSE.md"), "utf8");

const packagesDir = path.join(ROOT, "packages");
const targets = readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(packagesDir, entry.name, "LICENSE.md"));

const check = process.argv.includes("--check");
let drift = false;

for (const target of targets) {
  const rel = path.relative(ROOT, target).replaceAll(path.sep, "/");
  const current = existsSync(target) ? readFileSync(target, "utf8") : null;
  if (current === canonical) {
    console.log(`  ok    ${rel}`);
    continue;
  }
  if (check) {
    drift = true;
    const reason = current === null ? "missing" : "differs from root LICENSE.md";
    console.log(`  DRIFT ${rel}: ${reason}`);
    continue;
  }
  writeFileSync(target, canonical);
  console.log(`  sync  ${rel}`);
}

if (drift) {
  console.error("\n✖ LICENSE.md mirrors out of sync. Run `npm run license:sync` and commit.");
  process.exit(1);
}
console.log(
  check ? "\n✓ all LICENSE.md mirrors match the root copy." : "\n✓ LICENSE.md mirrors synced."
);
