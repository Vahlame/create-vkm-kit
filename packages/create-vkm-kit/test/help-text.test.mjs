/**
 * The `--help` page must not contradict the code.
 *
 * It lived as a 190-line template literal inside `main()` and drifted: it advertised
 * "all 4 managed hook entries" when there are seven, and never mentioned that
 * `--uninstall` also removes the output style, the OTLP env block, the installed skills
 * and the Windows hook launcher. Prose cannot be type-checked, but the countable claims
 * in it CAN be, and those are the ones that go stale.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { HELP } from "../src/cli/help.mjs";
import {
  EFFORT_GATE_HOOK_STEM,
  GUARD_HOOK_STEM,
  HOOK_STEM,
  STOP_HOOK_STEM
} from "../src/claude-native-memory.mjs";
import { COMPACT_BASH_HOOK_STEM, COMPACT_MCP_HOOK_STEM } from "../src/token-saver.mjs";
import { ENSURE_SINK_HOOK_STEM } from "../src/telemetry.mjs";
import { ENSURE_PG_HOOK_STEM } from "../src/pg-setup.mjs";

/** Every hook stem `--uninstall` is responsible for, from the modules that own them. */
const MANAGED_HOOK_STEMS = [
  HOOK_STEM,
  GUARD_HOOK_STEM,
  STOP_HOOK_STEM,
  EFFORT_GATE_HOOK_STEM,
  COMPACT_BASH_HOOK_STEM,
  COMPACT_MCP_HOOK_STEM,
  ENSURE_SINK_HOOK_STEM,
  ENSURE_PG_HOOK_STEM
];

test("the hook count in --help matches the number of managed hooks", () => {
  const n = MANAGED_HOOK_STEMS.length;
  assert.match(
    HELP,
    new RegExp(`all ${n} managed hook entries`),
    `--help must say "all ${n} managed hook entries"; the modules declare ${n} stems ` +
      `(${MANAGED_HOOK_STEMS.join(", ")})`
  );
  assert.match(HELP, new RegExp(`the ${n} hooks`), "the file-deletion sentence counts them too");
});

test("every flag --help documents is one the installer actually reads", async () => {
  // Long flags as they head a help line: "  --flag   description".
  const documented = [...HELP.matchAll(/^ {2}(--[a-z][a-z0-9-]*)/gm)].map((m) => m[1]);
  assert.ok(documented.length > 20, `expected a real flag list, parsed ${documented.length}`);

  // Every flag the installer tests for, however it tests: argv.includes("--x"),
  // flagValue(argv, "--x"), or a VALUE_FLAGS entry. Scans all of src/ rather than just
  // the entry point: since 5.0 the decision lives in cli/options.mjs and the subcommands
  // in index.js, so pinning one file would let a flag go dead in the other.
  const srcDir = new URL("../src/", import.meta.url);
  const read = new Set();
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const child = new URL(`${e.name}${e.isDirectory() ? "/" : ""}`, dir);
      if (e.isDirectory()) await walk(child);
      else if (/\.(mjs|js)$/.test(e.name)) {
        for (const m of (await readFile(child, "utf8")).matchAll(/"(--[a-z][a-z0-9-]*)"/g)) {
          read.add(m[1]);
        }
      }
    }
  };
  await walk(srcDir);

  const undocumented = documented.filter((f) => !read.has(f));
  assert.deepEqual(
    undocumented,
    [],
    "these flags are documented in --help but the installer never looks for them; a flag " +
      "that does nothing is worse than one that does not exist"
  );
});

test("--help names the current package, never the retired one", () => {
  assert.match(HELP, /create-vkm-kit/);
  assert.doesNotMatch(
    HELP,
    /create-obsidian-memory/,
    "the pre-4.0 npm name is frozen and unpublished; help must not send anyone there"
  );
});

test("--uninstall's scope sentence lists what it actually removes", () => {
  const section = HELP.slice(HELP.indexOf("--uninstall"));
  for (const claim of ["outputStyle", "skills", "launcher", "autoMemoryEnabled"]) {
    assert.ok(section.includes(claim), `--uninstall removes the ${claim} but does not say so`);
  }
  assert.match(
    section,
    /NOT touch MCP server\s+registrations/,
    "the boundary matters: uninstall is not a de-registration"
  );
});
