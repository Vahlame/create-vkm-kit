/**
 * No background process the kit starts may put a console window on screen.
 *
 * This is a product requirement, not a preference: the agent works while the user is in
 * another application — often a full-screen game — and a console that appears, takes the
 * FOREGROUND and vanishes is the screen being taken away from them. During a research run
 * that happens once per fetched page.
 *
 * The counter-intuitive part, recorded in ADR-0078, is that the obvious protection CAUSES
 * the problem. `windowsHide: true` is CREATE_NO_WINDOW: the child gets no console at all,
 * and a console-subsystem GRANDCHILD whose parent has none is given a brand new VISIBLE
 * one by Windows. So the flag is safe on a LEAF process and actively harmful on a parent.
 *
 * The rule this file enforces:
 *
 *   a spawn that can have console-subsystem descendants goes through
 *   `throughHiddenConsole`, which owns ONE hidden console the whole tree inherits.
 *
 * Every remaining literal `windowsHide: true` must be listed below with the reason it is
 * a leaf or runs in a terminal the user is already looking at. A new one fails this test,
 * which is the point: the next person to add a spawn has to make that call deliberately.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Files allowed to pass a literal `windowsHide: true`, and why.
 * A leaf spawns nothing, so giving it no console cannot push a window down a level.
 */
const LEAF_OR_FOREGROUND = new Map([
  [
    "create-vkm-kit/src/file-perms.mjs",
    "icacls: a leaf, and it runs during an install the user is watching"
  ],
  [
    "create-vkm-kit/src/hooks/ensure-otel-sink.mjs",
    "the OTLP sink is a leaf node process that spawns nothing"
  ],
  [
    "create-vkm-kit/src/obscura-setup.mjs",
    "tar -xf and `obscura --version`: leaves, install-time only"
  ]
]);

/** Every shipped .mjs/.js under packages/<pkg>/src, as repo-relative posix paths. */
function shippedSources() {
  /** @type {string[]} */
  const out = [];
  for (const pkg of readdirSync(PACKAGES)) {
    const srcDir = path.join(PACKAGES, pkg, "src");
    let stat;
    try {
      stat = statSync(srcDir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const fp = path.join(dir, e.name);
        if (e.isDirectory()) walk(fp);
        else if (/\.(mjs|js)$/.test(e.name)) {
          out.push(path.relative(PACKAGES, fp).split(path.sep).join("/"));
        }
      }
    };
    walk(srcDir);
  }
  return out;
}

test("every literal `windowsHide: true` is a declared leaf or foreground spawn", () => {
  /** @type {string[]} */
  const offenders = [];
  for (const rel of shippedSources()) {
    if (rel.endsWith("vkm-core/src/hidden-console.mjs")) continue; // the module that defines the rule
    const src = readFileSync(path.join(PACKAGES, rel), "utf8");
    // Only a real option, not a mention in prose: `windowsHide: true` as a property.
    const hasLiteral = /(^|[^/*\s])\s*windowsHide:\s*true/m.test(
      src.replace(/^\s*(\/\/|\*).*$/gm, "")
    );
    if (hasLiteral && !LEAF_OR_FOREGROUND.has(rel)) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    "these files pass CREATE_NO_WINDOW to a spawn that may have console-subsystem " +
      "descendants, which is what MAKES a window appear (ADR-0078). Route them through " +
      "`throughHiddenConsole`, or add them to LEAF_OR_FOREGROUND with the reason they are safe"
  );
});

test("the allowlist has no stale entries", () => {
  const shipped = new Set(shippedSources());
  for (const rel of LEAF_OR_FOREGROUND.keys()) {
    assert.ok(shipped.has(rel), `${rel} is allowlisted but no longer exists — drop the entry`);
    const src = readFileSync(path.join(PACKAGES, rel), "utf8");
    assert.match(
      src,
      /windowsHide:\s*true/,
      `${rel} no longer passes windowsHide: true — drop its allowlist entry`
    );
  }
});

test("the research and search hot paths route through the launcher", () => {
  // Named explicitly because these are the two the user actually feels: one obscura
  // process per fetched page during a research run, and one Python process per vault
  // search. A regression here is invisible in CI on Linux and very visible on a desktop.
  for (const rel of [
    "obscura-web/src/obscura-cli.mjs",
    "obsidian-memory-mcp/src/rag-client.mjs",
    "obscura-web/src/ollama-client.mjs",
    "vkm-spec/src/ollama-client.mjs",
    "obscura-web/src/ensure-searxng.mjs",
    "obsidian-memory-mcp/src/vault-git.mjs"
  ]) {
    const src = readFileSync(path.join(PACKAGES, rel), "utf8");
    assert.match(src, /throughHiddenConsole\(/, `${rel} must route its spawn through the launcher`);
    assert.match(
      src,
      /windowsHide:\s*launch\.windowsHide/,
      `${rel} must pass the launcher's own windowsHide, never a literal`
    );
  }
});
