#!/usr/bin/env node
/**
 * Single source of truth for the kit version across every marker.
 *
 * The kit's version lives in several places that historically drifted (README
 * badge said 3.6.0 while the packages said 3.5.0 and no git tag existed; later
 * README.en.md fell behind to 3.8.1 while everything else was 3.9.1). This
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
    name: "create-vkm-kit/package.json",
    file: "packages/create-vkm-kit/package.json",
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
    // vkm-kit efficiency-suite packages are version-locked to the kit (ADR-0042 — the
    // opposite call to the old prompt-compiler precedent, per the 4.0.0 plan).
    name: "vkm-doctor/package.json",
    file: "packages/vkm-doctor/package.json",
    read: (s) => JSON.parse(s).version,
    write: (s, v) => s.replace(/("version":\s*")[^"]+(")/, `$1${v}$2`)
  },
  {
    name: "vkm-spec/package.json",
    file: "packages/vkm-spec/package.json",
    read: (s) => JSON.parse(s).version,
    write: (s, v) => s.replace(/("version":\s*")[^"]+(")/, `$1${v}$2`)
  },
  {
    // Efficiency-suite package, version-locked to the kit (ADR-0051, same call as ADR-0042).
    name: "obscura-web/package.json",
    file: "packages/obscura-web/package.json",
    read: (s) => JSON.parse(s).version,
    write: (s, v) => s.replace(/("version":\s*")[^"]+(")/, `$1${v}$2`)
  },
  {
    // Efficiency-suite package, version-locked to the kit (ADR-0058, same call as ADR-0042/0051).
    name: "vkm-downloads/package.json",
    file: "packages/vkm-downloads/package.json",
    read: (s) => JSON.parse(s).version,
    write: (s, v) => s.replace(/("version":\s*")[^"]+(")/, `$1${v}$2`)
  },
  {
    // The forwarding shim published on the pre-rename npm name (ADR-0041/0050).
    name: "create-obsidian-memory-shim/package.json",
    file: "packages/create-obsidian-memory-shim/package.json",
    read: (s) => JSON.parse(s).version,
    write: (s, v) => s.replace(/("version":\s*")[^"]+(")/, `$1${v}$2`)
  },
  {
    name: "obsidian-memory-rag/pyproject.toml",
    file: "packages/obsidian-memory-rag/pyproject.toml",
    read: (s) => (s.match(/^version\s*=\s*"([^"]+)"/m) || [])[1],
    write: (s, v) => s.replace(/^(version\s*=\s*")[^"]+(")/m, `$1${v}$2`)
  },
  // The READMEs no longer carry a literal version. Both release badges are now
  // dynamic (img.shields.io/github/v/release/…), reading straight from the latest
  // GitHub release — so there is nothing in the READMEs left to drift, and nothing
  // for `set` to rewrite. The git tag `set` reminds you to push remains the single
  // source those badges render.
  {
    name: "agent.toml",
    file: "agent.toml",
    read: (s) => (s.match(/^version\s*=\s*"([^"]+)"/m) || [])[1],
    write: (s, v) => s.replace(/^(version\s*=\s*")[^"]+(")/m, `$1${v}$2`)
  },
  // The Go daemon carries the kit version TWICE — the authoritative `var version`
  // and the example -ldflags in the build comment above it. They are two markers,
  // not one, on purpose: as a single entry (read = `var version`, write = both
  // replaces) the ldflags copy could drift silently and forever. `set` skips a file
  // whose `read` already matches, so once `var version` was right the second replace
  // never ran; the "refusing partial write" guard compares the whole file, so a
  // no-op second replace is invisible whenever the first one changed something; and
  // `check` only ever inspected what `read` returned. Split, each copy is
  // independently surveyed, checked and written — cmdSet/survey re-read the file per
  // marker, so the second sees the first's write.
  {
    name: "cmd/obsidian-memoryd/main.go (var version)",
    file: "cmd/obsidian-memoryd/main.go",
    read: (s) => (s.match(/var version = "([^"]+)"/) || [])[1],
    write: (s, v) => s.replace(/(var version = ")[^"]+(")/, `$1${v}$2`)
  },
  {
    name: "cmd/obsidian-memoryd/main.go (-ldflags example)",
    file: "cmd/obsidian-memoryd/main.go",
    read: (s) => (s.match(/main\.version=(\d+\.\d+\.\d+)/) || [])[1],
    write: (s, v) => s.replace(/(main\.version=)\d+\.\d+\.\d+/, `$1${v}`)
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
  console.log(
    `\n✓ all markers set to ${version}. Remember to update CHANGELOG.md and tag v${version}.`
  );
}

// Each marker's read/write pair is a pure string function, so exporting the table
// lets a test exercise the exact drift these markers exist to prevent without
// touching the real repo (ROOT is script-relative and deliberately not injectable —
// this script must keep working with zero deps, before `npm ci`, in CI).
export { MARKERS };

// Only dispatch when run as a CLI: importing this module for its MARKERS must not
// execute a command and exit the test process.
const invokedAsCli =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsCli) {
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
}
