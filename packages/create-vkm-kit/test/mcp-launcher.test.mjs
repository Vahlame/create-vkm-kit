/**
 * MCP servers must start through `vkm-runhidden.exe` when one is installed.
 *
 * ADR-0078 routed HOOK entries through the launcher and stopped there — but an MCP server
 * is started the same way, from a `command` string in a config file, and all four of ours
 * are console-subsystem (`node` x3, `uvx` for basic-memory). That left two ways for the
 * user to lose their foreground, and the second is the one that cannot be fixed
 * downstream:
 *
 *   - the host starts the server WITHOUT CREATE_NO_WINDOW -> a console window per server,
 *     at session start;
 *   - the host starts it WITH CREATE_NO_WINDOW            -> the server has no console, so
 *     every child it spawns (Python on each vault search, one obscura per fetched page)
 *     is handed a brand new VISIBLE one by Windows. A child cannot inherit a console its
 *     parent does not have.
 *
 * These tests pin the wire shape both ways, because the whole fix lives in what gets
 * written into the user's config file.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  basicMemoryServer,
  claudeAddArgv,
  downloadsServer,
  hybridServer,
  mergeBasicMemoryServer,
  mergeObsidianHybridServer,
  obscuraWebServer
} from "../src/mcp-merge.mjs";

const LAUNCHER = "C:\\Users\\u\\.claude\\bin\\vkm-runhidden.exe";
const KIT = "C:\\kit";
const VAULT = "C:\\vault";

test("without a launcher every server keeps its direct command", () => {
  assert.equal(basicMemoryServer(VAULT).command, "uvx");
  assert.equal(hybridServer(VAULT, KIT).command, "node");
  assert.equal(obscuraWebServer(KIT).command, "node");
  assert.equal(downloadsServer(KIT).command, "node");
});

test("with a launcher the real command becomes its first argument", () => {
  const bm = basicMemoryServer(VAULT, { launcher: LAUNCHER });
  assert.equal(bm.command, LAUNCHER);
  assert.equal(bm.args[0], "uvx");
  // The pin is a supply-chain control and must survive the rewrite untouched.
  assert.ok(
    bm.args.some((a) => /^basic-memory==\d+\.\d+\.\d+$/.test(a)),
    `the pinned --from argument must survive: ${JSON.stringify(bm.args)}`
  );
  assert.deepEqual(bm.env, { BASIC_MEMORY_HOME: VAULT }, "env is untouched");

  const hybrid = hybridServer(VAULT, KIT, { launcher: LAUNCHER });
  assert.equal(hybrid.command, LAUNCHER);
  assert.equal(hybrid.args[0], "node");
  assert.match(hybrid.args[1], /hybrid-mcp\.mjs$/, "the bridge path stays the second argument");
});

test("the launcher does not disturb env wiring (semantic, obscura, downloads)", () => {
  const hybrid = hybridServer(VAULT, KIT, { launcher: LAUNCHER, semantic: true, vec: true });
  assert.match(hybrid.env.OBSIDIAN_MEMORY_EMBEDDER, /^fastembed:/);
  assert.equal(hybrid.env.OBSIDIAN_MEMORY_SQLITE_VEC, "1");

  const obscura = obscuraWebServer(KIT, { launcher: LAUNCHER, binPath: "C:\\o\\obscura.exe" });
  assert.equal(obscura.command, LAUNCHER);
  assert.equal(obscura.env.OBSCURA_BIN, "C:\\o\\obscura.exe");

  const downloads = downloadsServer(KIT, { launcher: LAUNCHER, downloadDir: "C:\\dl" });
  assert.equal(downloads.command, LAUNCHER);
  assert.equal(downloads.args[0], "node");
});

test("the merge helpers carry the launcher into the config object", () => {
  let merged = mergeBasicMemoryServer({}, VAULT, { launcher: LAUNCHER });
  merged = mergeObsidianHybridServer(merged, VAULT, KIT, { launcher: LAUNCHER });
  const servers = /** @type {Record<string, any>} */ (merged.mcpServers);
  assert.equal(servers["basic-memory"].command, LAUNCHER);
  assert.equal(servers["obsidian-memory-hybrid"].command, LAUNCHER);
});

test("a user's own unrelated servers survive the merge untouched", () => {
  const mine = { mcpServers: { "my-server": { command: "node", args: ["x.mjs"] } } };
  const merged = mergeBasicMemoryServer(mine, VAULT, { launcher: LAUNCHER });
  const servers = /** @type {Record<string, any>} */ (merged.mcpServers);
  assert.deepEqual(servers["my-server"], { command: "node", args: ["x.mjs"] });
  assert.notEqual(merged, mine, "the caller's object must not be mutated");
});

test("`claude mcp add` puts the launcher after the `--` separator", () => {
  const argv = claudeAddArgv("basic-memory", basicMemoryServer(VAULT, { launcher: LAUNCHER }));
  const sep = argv.indexOf("--");
  assert.ok(sep > 0, `expected a -- separator in ${JSON.stringify(argv)}`);
  assert.equal(
    argv[sep + 1],
    LAUNCHER,
    "the command after -- is what the host spawns; it must be the launcher"
  );
  assert.equal(argv[sep + 2], "uvx", "and the real command must follow it as an argument");
});
