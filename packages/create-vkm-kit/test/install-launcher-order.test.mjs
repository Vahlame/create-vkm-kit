/**
 * A FIRST install must register its MCP servers through the windowless launcher.
 *
 * `mcp-launcher.test.mjs` pins what a server object looks like WHEN a launcher is passed.
 * That left the only thing a user actually experiences untested: whether the installer has
 * one to pass by the time it writes their config. It did not. `installRunHidden` ran AFTER
 * `writeCursorMcp`/`registerClaudeCodeMcp`, and both resolved the launcher by probing
 * `~/.claude/bin` — empty on a machine installing for the first time. So every fresh
 * install wrote `command: "node"` / `command: "uvx"`, the exact flashing-console config
 * ADR-0078 exists to prevent, and only a SECOND run of the installer fixed it. Every unit
 * test passed the whole time, because none of them ran the installer.
 *
 * This one runs the real CLI into a throwaway HOME and reads the file it produced.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installedRunHidden, packagedRunHidden } from "../src/runhidden-setup.mjs";

const PKG = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(PKG, "src", "index.js");

test("a first install wires MCP servers through the launcher it installs in the same run", (t) => {
  // Off Windows there is no console to suppress and no launcher to install, so there is
  // nothing to assert. A checkout that never ran `npm run build:runhidden` has no packaged
  // binary either — CI's Windows leg builds it first (ci.yml), so a skip here is a local
  // toolchain gap, never a silent hole in coverage.
  if (process.platform !== "win32") return t.skip("no launcher off Windows (no console to hide)");
  if (!existsSync(packagedRunHidden())) {
    return t.skip(`no packaged launcher at ${packagedRunHidden()} (npm run build:runhidden)`);
  }

  // A HOME with no `.claude/bin` — the state of every machine installing for the first time.
  const home = mkdtempSync(path.join(tmpdir(), "vkm-first-install-"));
  const launcher = installedRunHidden(home);
  assert.ok(!existsSync(launcher), "fixture is not a first install: a launcher was already there");

  const run = spawnSync(
    process.execPath,
    [CLI, path.join(home, "vault"), "-y", "--minimal", "--ide", "cursor", "--no-git-init"],
    {
      encoding: "utf8",
      // HOME is what the CLI reads; USERPROFILE is what `os.homedir()` reads on Windows.
      // Setting only one leaves the two disagreeing and the install writing into the real
      // user's profile — the thing this test must never do.
      env: { ...process.env, HOME: home, USERPROFILE: home },
      timeout: 180_000
    }
  );

  assert.equal(run.status, 0, `installer failed:\n${run.stdout}\n${run.stderr}`);

  const fp = path.join(home, ".cursor", "mcp.json");
  assert.ok(existsSync(fp), `installer wrote no mcp.json into the temp home (${fp})`);
  const server = JSON.parse(readFileSync(fp, "utf8")).mcpServers["basic-memory"];

  assert.equal(
    server.command,
    launcher,
    "a first install registered basic-memory to start directly — every session it starts " +
      "will flash a console window until the installer is run a second time"
  );
  assert.equal(server.args[0], "uvx", "the real command must survive as the first argument");
  assert.ok(
    server.args.some((a) => /^basic-memory==\d+\.\d+\.\d+$/.test(a)),
    `the pinned --from argument must survive the rewrite: ${JSON.stringify(server.args)}`
  );
  assert.ok(existsSync(launcher), "registered a launcher path that is not on disk");
});
