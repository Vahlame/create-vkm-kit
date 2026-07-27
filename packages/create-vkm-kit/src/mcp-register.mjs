/**
 * Wiring the kit's MCP servers into each supported client.
 *
 * # One server list, three clients
 *
 * `registerClaudeCodeMcp` and `registerCodexMcp` used to be 32 BYTE-IDENTICAL lines
 * apiece — the same fourteen-key destructure of the options object, then the same four
 * conditional `servers.push([...])` blocks — differing only in the CLI name, the argv
 * factory and one fallback message. `writeCursorMcp` destructured the same fourteen keys
 * a third time. Which servers a given install wants is one decision; it is now made once,
 * in {@link buildServerList}, and the two CLI-driven clients share one loop.
 *
 * # Why two shapes at all
 *
 * Cursor reads a JSON file, so the kit merges into `~/.cursor/mcp.json` directly. Claude
 * Code keeps no such file and Codex merges TOML itself, so both are driven through their
 * own CLI (`claude mcp add` / `codex mcp add`) rather than by editing their config behind
 * their back. That difference is real and stays.
 *
 * @module
 */
import path from "node:path";
import { execa } from "execa";
import fse from "fs-extra";
import pc from "picocolors";
import {
  basicMemoryServer,
  claudeAddArgv,
  claudeRemoveArgv,
  codexAddArgv,
  codexRemoveArgv,
  codexTomlBlock,
  downloadsServer,
  hybridServer,
  mergeBasicMemoryServer,
  mergeDownloadsServer,
  mergeObscuraWebServer,
  mergeObsidianHybridServer,
  obscuraWebServer,
  resolveLauncher
} from "./mcp-merge.mjs";
import { restrictFileToOwner } from "./file-perms.mjs";
import { atomicWriteJson, stripLeadingUtf8Bom } from "./settings-io.mjs";

/**
 * @typedef {{ withHybrid?: boolean, repoRoot?: string|null, semantic?: boolean, vec?: boolean,
 *   rerank?: boolean, pinFailures?: boolean, usage?: boolean, obscura?: boolean,
 *   obscuraBin?: string|null, searxngUrl?: string|null, researchDir?: string|null,
 *   downloads?: boolean, downloadDir?: string|null }} HybridOpts
 */

/**
 * The MCP servers this install should wire, as `[id, server]` pairs.
 *
 * `basic-memory` is unconditional — it is the one required piece. The other three need a
 * kit clone to run from (`repoRoot`), so each is gated on it: a user who asks for obscura
 * without a clone gets a warning from the caller, never a config entry pointing at a path
 * that does not exist.
 *
 * The ids are a FROZEN contract. They are written into users' `~/.cursor/mcp.json` and
 * their client config, and `mcp__obsidian-memory-hybrid__*` tool names are baked into
 * users' own CLAUDE.md files, outside this repo entirely. Renaming one orphans a config
 * the installer cannot detect or repair.
 *
 * @param {string} vaultAbs
 * @param {HybridOpts} [opts]
 * @returns {Array<[string, object]>}
 */
export function buildServerList(vaultAbs, opts = {}) {
  const {
    withHybrid = false,
    repoRoot = null,
    semantic = false,
    vec = false,
    rerank = false,
    pinFailures = false,
    usage = false,
    obscura = false,
    obscuraBin = null,
    searxngUrl = null,
    researchDir = null,
    downloads = false,
    downloadDir = null
  } = opts;
  const kit = repoRoot ? path.resolve(repoRoot) : null;
  // Probed ONCE per call and threaded into every builder, so the whole config file
  // agrees about how servers start. See viaRunHidden in mcp-merge.mjs.
  const launcher = resolveLauncher();

  /** @type {Array<[string, object]>} */
  const servers = [["basic-memory", basicMemoryServer(vaultAbs, { launcher })]];
  if (withHybrid && kit) {
    servers.push([
      "obsidian-memory-hybrid",
      hybridServer(vaultAbs, kit, { semantic, vec, rerank, pinFailures, usage, launcher })
    ]);
  }
  if (obscura && kit) {
    servers.push([
      "obscura-web",
      obscuraWebServer(kit, { binPath: obscuraBin, searxngUrl, researchDir, launcher })
    ]);
  }
  if (downloads && kit) {
    servers.push(["vkm-downloads", downloadsServer(kit, { downloadDir, launcher })]);
  }
  return servers;
}

/**
 * Merge the server list into `~/.cursor/mcp.json`, preserving every entry the user
 * already has and backing up the previous file first.
 * @param {string} home
 * @param {string} vaultAbs
 * @param {boolean} dryRun
 * @param {HybridOpts} [opts]
 */
export async function writeCursorMcp(home, vaultAbs, dryRun, opts = {}) {
  const dir = path.join(home, ".cursor");
  const fp = path.join(dir, "mcp.json");
  let parsed = {};
  /** @type {Buffer | null} */
  let priorBytes = null;
  if (await fse.pathExists(fp)) {
    priorBytes = await fse.readFile(fp);
    const text = stripLeadingUtf8Bom(priorBytes.toString("utf8"));
    try {
      parsed = JSON.parse(text);
    } catch {
      console.warn(
        pc.yellow("Invalid JSON in mcp.json; will back up the original before overwriting")
      );
    }
  }

  const {
    withHybrid = false,
    repoRoot = null,
    semantic = false,
    vec = false,
    rerank = false,
    pinFailures = false,
    usage = false,
    obscura = false,
    obscuraBin = null,
    searxngUrl = null,
    researchDir = null,
    downloads = false,
    downloadDir = null
  } = opts;
  const kit = repoRoot ? path.resolve(repoRoot) : null;
  const launcher = resolveLauncher();

  // Cursor takes the MERGE functions rather than buildServerList's plain objects: each
  // one preserves the user's other `mcpServers` entries, which a wholesale write would
  // destroy. Same decision table as buildServerList, applied to a file instead of a CLI.
  let merged = mergeBasicMemoryServer(parsed, vaultAbs, { launcher });
  if (withHybrid && kit) {
    merged = mergeObsidianHybridServer(merged, vaultAbs, kit, {
      semantic,
      vec,
      rerank,
      pinFailures,
      usage,
      launcher
    });
  }
  if (obscura && kit) {
    merged = mergeObscuraWebServer(merged, kit, {
      binPath: obscuraBin,
      searxngUrl,
      researchDir,
      launcher
    });
  }
  if (downloads && kit) {
    merged = mergeDownloadsServer(merged, kit, { downloadDir, launcher });
  }

  if (dryRun) {
    console.log(pc.cyan("[dry-run] would write"), fp);
    console.log(JSON.stringify(merged, null, 2));
    return;
  }
  await fse.ensureDir(dir);
  // Always preserve the previous mcp.json before overwriting — agent-driven
  // installs that go wrong should be 1 `mv` away from recovery, not a re-run
  // of the IDE wizard. Backups are kept indefinitely; clean up manually.
  if (priorBytes) {
    const bak = `${fp}.bak.${Date.now()}`;
    await fse.writeFile(bak, priorBytes);
    await restrictFileToOwner(bak);
    console.log(pc.dim("Backed up previous mcp.json to"), bak);
  }
  await atomicWriteJson(fp, merged);
  console.log(pc.green("Wrote"), fp);
}

/**
 * Register every server through a client's own CLI. Idempotent: each entry is removed
 * before it is added, so a re-run updates rather than duplicating.
 *
 * Never throws and never fails the install. A missing CLI, or a non-zero exit from it,
 * prints the exact command (and for Codex, a paste-ready TOML block) so the user can
 * finish by hand — an install that got everything else right must not abort because one
 * optional client is not on PATH.
 *
 * @param {object} client
 * @param {string} client.bin CLI name, e.g. "claude"
 * @param {string} client.label human name for logs, e.g. "Claude Code"
 * @param {(name: string, server: object) => string[]} client.addArgv
 * @param {(name: string) => string[]} client.removeArgv
 * @param {(name: string, server: object) => string} [client.manualBlock] extra paste-ready config
 * @param {Array<[string, object]>} servers
 * @param {boolean} dryRun
 */
export async function registerViaCli(client, servers, dryRun) {
  const { bin, label, addArgv: makeAdd, removeArgv: makeRemove, manualBlock } = client;
  for (const [name, server] of servers) {
    const addArgv = makeAdd(name, server);
    const manual = () => {
      console.log(`  ${bin} ` + addArgv.join(" "));
      if (manualBlock) {
        console.log(pc.dim(`  …or paste into ~/.codex/config.toml:\n` + manualBlock(name, server)));
      }
    };
    if (dryRun) {
      console.log(pc.cyan(`[dry-run] ${bin}`), addArgv.join(" "));
      continue;
    }
    try {
      await execa(bin, makeRemove(name), { reject: false }); // ignore "not found"
      const r = await execa(bin, addArgv, { reject: false });
      if (r.exitCode === 0) {
        console.log(pc.green(`${label} MCP added:`), name);
      } else {
        console.warn(pc.yellow(`${bin} mcp add ${name} exited ${r.exitCode}; run manually:`));
        manual();
      }
    } catch {
      console.warn(pc.yellow(`\`${bin}\` CLI not found; run manually:`));
      manual();
    }
  }
}

/**
 * Register the kit's servers in Claude Code (`claude mcp add -s user`) — it reads no
 * mcp.json, so its own CLI is the only supported path.
 * @param {string} vaultAbs
 * @param {boolean} dryRun
 * @param {HybridOpts} [opts]
 */
export async function registerClaudeCodeMcp(vaultAbs, dryRun, opts = {}) {
  await registerViaCli(
    {
      bin: "claude",
      label: "Claude Code",
      addArgv: claudeAddArgv,
      removeArgv: claudeRemoveArgv
    },
    buildServerList(vaultAbs, opts),
    dryRun
  );
}

/**
 * Register the kit's servers in Codex CLI (`codex mcp add`) — Codex stores them in
 * `~/.codex/config.toml` and merges the TOML itself, so the kit shells out rather than
 * editing that file behind it.
 * @param {string} vaultAbs
 * @param {boolean} dryRun
 * @param {HybridOpts} [opts]
 */
export async function registerCodexMcp(vaultAbs, dryRun, opts = {}) {
  await registerViaCli(
    {
      bin: "codex",
      label: "Codex CLI",
      addArgv: codexAddArgv,
      removeArgv: codexRemoveArgv,
      manualBlock: codexTomlBlock
    },
    buildServerList(vaultAbs, opts),
    dryRun
  );
}
