#!/usr/bin/env node
/**
 * Single source of truth for the kit version across every marker.
 *
 * The kit's version lives in five places that historically drifted (README
 * badge said 3.6.0 while the packages said 3.5.0 and no git tag existed). This
 * script makes drift impossible to ship:
 *
 *   - `node scripts/version.mjs check`        assert all markers agree with the
 *                                             latest released CHANGELOG version;
 *                                             exits 1 (with a diff) on any drift.
 *   - `node scripts/version.mjs set 3.6.0`    rewrite every marker to <version>.
 *   - `node scripts/version.mjs print`        print the canonical version.
 *
 * The CHANGELOG's most recent `## [X.Y.Z]` heading is the canonical version for
 * `check`; `set` writes that exact string everywhere (it does NOT touch the
 * CHANGELOG — release notes stay hand-curated).
 *
 * Pure Node built-ins (no deps) so it runs in CI before `npm ci`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** A version marker: where it lives, how to read it, how to rewrite it. */
const MARKERS = [
  {
    name: "create-obsidian-memory/package.json",
    file: "packages/create-obsidian-memory/package.json",
    read: (s) => JSON.parse(s).version,
    write: (s, v) => s.replace(/("version":\s*")[^"]+(")/, `$1${v}$2`)
  },
  {
    name: "obsidian-memory-mcp/package.json",
    file: "packages/obsidian-memory-mcp/package.json",
    read: (s) => JSON.parse(s).version,
    write: (s, v) => s.replace(/("version":\s*")[^"]+(")/, `$1${v}$2`)
  },
  {
    name: "obsidian-memory-rag/pyproject.toml",
    file: "packages/obsidian-memory-rag/pyproject.toml",
    read: (s) => (s.match(/^version\s*=\s*"([^"]+)"/m) || [])[1],
    write: (s, v) => s.replace(/^(version\s*=\s*")[^"]+(")/m, `$1${v}$2`)
  },
  {
    name: "README.md (release badge)",
    file: "README.md",
    read: (s) => (s.match(/release-v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)-orange/) || [])[1],
    write: (s, v) => s.replace(/(release-v)\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(-orange)/, `$1${v}$2`)
  },
  {
    name: "agent.toml",
    file: "agent.toml",
    read: (s) => (s.match(/^version\s*=\s*"([^"]+)"/m) || [])[1],
    write: (s, v) => s.replace(/^(version\s*=\s*")[^"]+(")/m, `$1${v}$2`)
  },
  {
    // Go daemon kit version: the authoritative `var version` plus the example
    // -ldflags in the build comment, kept in lockstep.
    name: "cmd/obsidian-memoryd/main.go",
    file: "cmd/obsidian-memoryd/main.go",
    read: (s) => (s.match(/var version = "([^"]+)"/) || [])[1],
    write: (s, v) =>
      s
        .replace(/(var version = ")[^"]+(")/, `$1${v}$2`)
        .replace(/(main\.version=)\d+\.\d+\.\d+/, `$1${v}`)
  }
];

function read(file) {
  return readFileSync(path.join(ROOT, file), "utf8");
}

/** Canonical version = the newest released section in CHANGELOG.md. */
function changelogVersion() {
  const s = read("CHANGELOG.md");
  const m = s.match(/^##\s*\[(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]/m);
  if (!m) {
    throw new Error("CHANGELOG.md: no released `## [X.Y.Z]` section found");
  }
  return m[1];
}

function survey() {
  return MARKERS.map((mk) => {
    let value = null;
    let error = null;
    try {
      value = mk.read(read(mk.file)) ?? null;
    } catch (e) {
      error = e.message;
    }
    return { ...mk, value, error };
  });
}

function cmdCheck() {
  const canonical = changelogVersion();
  const rows = survey();
  let drift = false;
  console.log(`canonical (CHANGELOG.md latest): ${canonical}\n`);
  for (const r of rows) {
    const ok = !r.error && r.value === canonical;
    drift = drift || !ok;
    const status = ok ? "ok  " : "DRIFT";
    console.log(`  [${status}] ${r.name}: ${r.error ? `<error: ${r.error}>` : r.value}`);
  }
  if (drift) {
    console.error(
      `\n✖ version drift detected. Run \`node scripts/version.mjs set ${canonical}\` ` +
        `to align every marker (then commit + tag v${canonical}).`
    );
    process.exit(1);
  }
  console.log("\n✓ all version markers agree.");
}

function cmdSet(version) {
  if (!version || !SEMVER.test(version)) {
    console.error(`usage: node scripts/version.mjs set <semver>  (got: ${version ?? "<none>"})`);
    process.exit(2);
  }
  for (const mk of MARKERS) {
    const before = read(mk.file);
    const current = (() => {
      try {
        return mk.read(before) ?? null;
      } catch {
        return null;
      }
    })();
    if (current === version) {
      console.log(`  ok  ${mk.name} already ${version}`);
      continue;
    }
    const after = mk.write(before, version);
    if (after === before) {
      console.error(`✖ ${mk.name}: version marker not found — refusing partial write`);
      process.exit(1);
    }
    writeFileSync(path.join(ROOT, mk.file), after);
    console.log(`  set ${mk.name} -> ${version}`);
  }
  console.log(`\n✓ all markers set to ${version}. Remember to update CHANGELOG.md and tag v${version}.`);
}

const [, , cmd, arg] = process.argv;
switch (cmd) {
  case "check":
    cmdCheck();
    break;
  case "set":
    cmdSet(arg);
    break;
  case "print":
    console.log(changelogVersion());
    break;
  default:
    console.error("usage: node scripts/version.mjs <check|set <semver>|print>");
    process.exit(2);
}
