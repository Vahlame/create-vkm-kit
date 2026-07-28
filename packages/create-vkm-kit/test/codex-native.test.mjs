import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SKILL_NAMES, skillAssetFiles } from "../src/skills-install.mjs";
import {
  CODEX_HOOK_STEMS,
  codexAssetRoots,
  codexAssetsSidecar,
  codexHookAssetFiles
} from "../src/codex-native.mjs";
import { shouldBlock } from "../src/hooks/codex-guard-native-memory-write.mjs";
import { buildUpdatePlan } from "../src/update-plan.mjs";

const require = createRequire(import.meta.url);
const TOML = require("@iarna/toml");
const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const bin = path.join(packageRoot, "src", "index.js");

function fakeCodex(home) {
  const fakeBin = path.join(home, "bin");
  fs.mkdirSync(fakeBin, { recursive: true });
  if (process.platform === "win32") {
    fs.writeFileSync(path.join(fakeBin, "codex.cmd"), "@echo off\r\nexit /b 0\r\n");
  } else {
    const executable = path.join(fakeBin, "codex");
    fs.writeFileSync(executable, "#!/bin/sh\nexit 0\n");
    fs.chmodSync(executable, 0o755);
  }
  return fakeBin;
}

function runInstaller(home, vault, args = []) {
  const fakeBin = fakeCodex(home);
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    NO_COLOR: "1"
  };
  const result = spawnSync(
    process.execPath,
    [
      bin,
      "--non-interactive",
      "--ide",
      "codex",
      "--vault",
      vault,
      "--repo-root",
      repoRoot,
      "--minimal",
      "--skills",
      "--agents",
      "--codex-hooks",
      "--vault-context-hook",
      "--memory-enforcement",
      "--effort-gate",
      "--token-saver",
      "--no-rules",
      "--no-git-init",
      ...args
    ],
    { encoding: "utf8", env }
  );
  assert.equal(result.status, 0, result.stderr + result.stdout);
}

function managedEntryCount(hooks, stem) {
  return Object.values(hooks.hooks || {})
    .flat()
    .flatMap((group) => group.hooks || [])
    .filter((hook) => typeof hook?.command === "string" && hook.command.includes(stem)).length;
}

test("Codex install copies skills byte-identically, parses its agent TOML, and merges hooks idempotently", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-codex-home-"));
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-codex-vault-"));
  fs.mkdirSync(path.join(vault, ".obsidian"));
  runInstaller(home, vault);

  for (const name of SKILL_NAMES) {
    const source = path.join(packageRoot, "templates", "skills", name, "SKILL.md");
    const installed = path.join(home, ".agents", "skills", name, "SKILL.md");
    assert.deepEqual(
      fs.readFileSync(installed),
      fs.readFileSync(source),
      `${name} must be byte-identical`
    );
  }

  const agent = TOML.parse(
    fs.readFileSync(path.join(home, ".codex", "agents", "vkm-implementer.toml"), "utf8")
  );
  for (const key of ["name", "description", "developer_instructions"]) {
    assert.equal(typeof agent[key], "string", `${key} must be a TOML string`);
    assert.ok(agent[key].trim(), `${key} must be non-empty`);
  }
  assert.deepEqual(Object.keys(agent).sort(), ["description", "developer_instructions", "name"]);
  for (const rule of ["smallest diff", "Never cut input validation", "Verify before reporting"]) {
    assert.match(agent.developer_instructions, new RegExp(rule, "i"), `agent preserves: ${rule}`);
  }

  const hooksFp = path.join(home, ".codex", "hooks.json");
  const first = JSON.parse(fs.readFileSync(hooksFp, "utf8"));
  assert.ok(first.hooks.SessionStart?.length, "SessionStart hook installed");
  assert.ok(first.hooks.PreToolUse?.length, "PreToolUse hooks installed");
  assert.ok(first.hooks.PostToolUse?.length, "PostToolUse hook installed");
  assert.ok(managedEntryCount(first, CODEX_HOOK_STEMS.context), "vault context hook installed");
  assert.ok(managedEntryCount(first, CODEX_HOOK_STEMS.memoryGuard), "memory guard installed");
  assert.ok(managedEntryCount(first, CODEX_HOOK_STEMS.effortGate), "effort gate installed");
  assert.ok(managedEntryCount(first, CODEX_HOOK_STEMS.tokenSaver), "token saver installed");
  first.hooks.PreToolUse.push({
    matcher: "user-tool",
    hooks: [{ type: "command", command: "echo user" }]
  });
  fs.writeFileSync(hooksFp, JSON.stringify(first, null, 2));

  runInstaller(home, vault);
  const second = JSON.parse(fs.readFileSync(hooksFp, "utf8"));
  for (const stem of Object.values(CODEX_HOOK_STEMS)) {
    assert.equal(managedEntryCount(second, stem), 1, `${stem} must not duplicate`);
  }
  assert.ok(
    second.hooks.PreToolUse.some((group) =>
      group.hooks?.some((hook) => hook.command === "echo user")
    ),
    "user hook entry survives a re-run"
  );
});

test("Codex uninstall removes only hash-tracked assets and preserves user hooks", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-codex-uninstall-home-"));
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-codex-uninstall-vault-"));
  fs.mkdirSync(path.join(vault, ".obsidian"));
  runInstaller(home, vault);
  const skill = path.join(home, ".agents", "skills", "vkm-discipline", "SKILL.md");
  fs.appendFileSync(skill, "\nuser customization\n");
  const hooksFp = path.join(home, ".codex", "hooks.json");
  const hooks = JSON.parse(fs.readFileSync(hooksFp, "utf8"));
  hooks.hooks.PostToolUse.push({
    matcher: "user-tool",
    hooks: [{ type: "command", command: "echo user" }]
  });
  fs.writeFileSync(hooksFp, JSON.stringify(hooks, null, 2));

  const env = { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: "1" };
  const result = spawnSync(process.execPath, [bin, "--uninstall"], { encoding: "utf8", env });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.ok(fs.existsSync(skill), "modified Codex skill survives uninstall");
  const after = JSON.parse(fs.readFileSync(hooksFp, "utf8"));
  assert.ok(
    after.hooks.PostToolUse.some((group) =>
      group.hooks?.some((hook) => hook.command === "echo user")
    ),
    "user-authored hook survives uninstall"
  );
  for (const stem of Object.values(CODEX_HOOK_STEMS)) {
    assert.equal(managedEntryCount(after, stem), 0, `${stem} removed on uninstall`);
  }
});

test("Codex memory guard blocks writes but permits reads", () => {
  const codexDir = path.join(os.tmpdir(), "vkm-codex-memory-guard");
  assert.equal(
    shouldBlock(
      {
        tool_name: "apply_patch",
        tool_input: { command: `*** Update File: ${path.join(codexDir, "memories", "x.md")}` }
      },
      codexDir
    ),
    true
  );
  assert.equal(
    shouldBlock(
      {
        tool_name: "Bash",
        tool_input: { command: `Get-Content ${path.join(codexDir, "memories", "x.md")}` }
      },
      codexDir
    ),
    false
  );
  assert.equal(
    shouldBlock(
      {
        tool_name: "Bash",
        tool_input: { command: `Set-Content ${path.join(codexDir, "memories", "x.md")} blocked` }
      },
      codexDir
    ),
    true
  );
});

test("Codex token-saver returns PostToolUse feedback instead of unsupported replacement output", () => {
  const noisy = `${"building\n".repeat(800)}build completed\n`;
  const adapter = path.join(packageRoot, "src", "hooks", "codex-compact-tool-output.mjs");
  const result = spawnSync(process.execPath, [adapter], {
    encoding: "utf8",
    input: JSON.stringify({ tool_name: "Bash", tool_response: noisy })
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.continue, false);
  assert.match(output.systemMessage, /compacted/i);
  assert.equal(output.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.equal(typeof output.hookSpecificOutput.additionalContext, "string");
  assert.equal("updatedMCPToolOutput" in output, false);
});

test("Codex update plan includes hooks and preserves locally modified assets", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-codex-update-home-"));
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-codex-update-vault-"));
  fs.mkdirSync(path.join(vault, ".obsidian"));
  runInstaller(home, vault);
  const modifiedSkill = path.join(home, ".agents", "skills", "vkm-spec", "SKILL.md");
  fs.appendFileSync(modifiedSkill, "\nuser customization\n");

  const plan = await buildUpdatePlan({
    home,
    files: [
      ...skillAssetFiles(home, { ide: "codex" }),
      ...codexHookAssetFiles(home, { all: true })
    ],
    sidecarFp: codexAssetsSidecar(home),
    managedRoots: codexAssetRoots(home)
  });
  const modified = plan.entries.find((entry) => entry.dest === modifiedSkill);
  assert.equal(modified?.state, "local-only");
  assert.ok(
    plan.entries.some((entry) =>
      entry.dest.endsWith(path.join(".codex", "hooks", "codex-compact-tool-output.mjs"))
    ),
    "hook scripts are included in the Codex update scope"
  );
});
