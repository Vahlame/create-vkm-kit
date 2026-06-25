import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  mergeClaudeSettings,
  hookCommand,
  configureClaudeNativeMemory,
  HOOK_BASENAME,
  HOOK_STEM
} from "../src/claude-native-memory.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "src", "index.js");
const hookSrc = path.join(root, "src", "hooks", HOOK_BASENAME);

// ---- pure merge -----------------------------------------------------------

test("mergeClaudeSettings disables native auto-memory and adds the hook once", () => {
  const cmd = hookCommand("/h/session-start-vault-context.mjs", "/v");
  const out = mergeClaudeSettings({}, cmd);
  assert.equal(out.autoMemoryEnabled, false);
  assert.ok(Array.isArray(out.hooks.SessionStart));
  assert.equal(out.hooks.SessionStart.length, 1);
  assert.equal(out.hooks.SessionStart[0].hooks[0].command, cmd);
  assert.equal(out.hooks.SessionStart[0].matcher, "*");
});

test("mergeClaudeSettings preserves unrelated keys, hook events and SessionStart entries", () => {
  const existing = {
    theme: "dark",
    permissions: { allow: ["x"] },
    hooks: {
      Stop: [{ matcher: "*", hooks: [{ type: "command", command: "echo stop" }] }],
      SessionStart: [
        { matcher: "*", hooks: [{ type: "command", command: "echo unrelated" }] }
      ]
    }
  };
  const cmd = hookCommand("/h/session-start-vault-context.mjs", "/v");
  const out = mergeClaudeSettings(existing, cmd);
  assert.equal(out.theme, "dark");
  assert.deepEqual(out.permissions, { allow: ["x"] });
  assert.equal(out.hooks.Stop[0].hooks[0].command, "echo stop");
  // unrelated SessionStart entry kept + ours appended
  const cmds = out.hooks.SessionStart.flatMap((e) => e.hooks.map((h) => h.command));
  assert.ok(cmds.includes("echo unrelated"), "unrelated SessionStart entry preserved");
  assert.ok(cmds.includes(cmd), "managed entry added");
  assert.equal(out.hooks.SessionStart.length, 2);
});

test("mergeClaudeSettings is idempotent (re-apply keeps exactly one managed entry)", () => {
  const cmd = hookCommand("/h/session-start-vault-context.mjs", "/v");
  const once = mergeClaudeSettings({}, cmd);
  const twice = mergeClaudeSettings(once, cmd);
  const managed = twice.hooks.SessionStart.filter((e) =>
    e.hooks.some((h) => h.command.includes(HOOK_STEM))
  );
  assert.equal(managed.length, 1, "no duplicate managed entry after re-apply");
});

test("mergeClaudeSettings replaces a legacy .ps1 hook (same filename stem)", () => {
  const legacy = {
    hooks: {
      SessionStart: [
        {
          matcher: "*",
          hooks: [
            {
              type: "command",
              command:
                'powershell -NoProfile -File "C:\\Users\\x\\.claude\\hooks\\session-start-vault-context.ps1"'
            }
          ]
        }
      ]
    }
  };
  const cmd = hookCommand("C:\\Users\\x\\.claude\\hooks\\session-start-vault-context.mjs", "C:\\v");
  const out = mergeClaudeSettings(legacy, cmd);
  const cmds = out.hooks.SessionStart.flatMap((e) => e.hooks.map((h) => h.command));
  assert.ok(!cmds.some((c) => c.includes(".ps1")), "legacy ps1 entry dropped");
  assert.ok(cmds.includes(cmd), "managed mjs entry present");
  assert.equal(out.hooks.SessionStart.length, 1, "no duplicate after replacing legacy");
});

test("hookCommand carries the vault path and language", () => {
  assert.equal(hookCommand("/h/x.mjs", "/v"), 'node "/h/x.mjs" "/v" es');
  assert.equal(hookCommand("/h/x.mjs", "/v", "en"), 'node "/h/x.mjs" "/v" en');
});

// ---- functional install ---------------------------------------------------

test("configureClaudeNativeMemory writes settings + hook, idempotently", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-"));
  const vault = path.join(home, "vault");
  await configureClaudeNativeMemory(home, vault, false, { lang: "en" });

  const settingsFp = path.join(home, ".claude", "settings.json");
  const hookFp = path.join(home, ".claude", "hooks", HOOK_BASENAME);
  assert.ok(fs.existsSync(settingsFp), "settings.json written");
  assert.ok(fs.existsSync(hookFp), "hook script copied into ~/.claude/hooks");

  const j = JSON.parse(fs.readFileSync(settingsFp, "utf8"));
  assert.equal(j.autoMemoryEnabled, false);
  const cmd = j.hooks.SessionStart[0].hooks[0].command;
  assert.match(cmd, new RegExp(HOOK_STEM));
  assert.ok(cmd.includes(vault), "hook command points at the vault");
  assert.ok(cmd.includes(" en"), "language passed to the hook");

  // idempotent: second run keeps exactly one managed entry
  await configureClaudeNativeMemory(home, vault, false, { lang: "en" });
  const j2 = JSON.parse(fs.readFileSync(settingsFp, "utf8"));
  const managed = j2.hooks.SessionStart.filter((e) =>
    e.hooks.some((h) => h.command.includes(HOOK_STEM))
  );
  assert.equal(managed.length, 1, "exactly one managed SessionStart entry after re-run");
});

test("configureClaudeNativeMemory preserves an existing settings.json (and backs it up)", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-keep-"));
  const claudeDir = path.join(home, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  const settingsFp = path.join(claudeDir, "settings.json");
  fs.writeFileSync(
    settingsFp,
    JSON.stringify({ theme: "dark", autoMemoryEnabled: true }, null, 2),
    "utf8"
  );
  await configureClaudeNativeMemory(home, path.join(home, "vault"), false, { lang: "es" });
  const j = JSON.parse(fs.readFileSync(settingsFp, "utf8"));
  assert.equal(j.theme, "dark", "unrelated key preserved");
  assert.equal(j.autoMemoryEnabled, false, "auto-memory forced off");
  const baks = fs.readdirSync(claudeDir).filter((n) => n.startsWith("settings.json.bak."));
  assert.equal(baks.length, 1, "prior settings backed up once");
});

test("configureClaudeNativeMemory --dry-run writes nothing", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-dry-"));
  await configureClaudeNativeMemory(home, path.join(home, "vault"), true, { lang: "es" });
  assert.ok(!fs.existsSync(path.join(home, ".claude", "settings.json")), "no settings written");
  assert.ok(!fs.existsSync(path.join(home, ".claude", "hooks")), "no hook written");
});

// ---- the hook script itself ----------------------------------------------

test("the SessionStart hook emits valid JSON with reinforced reminders", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-hook-v-"));
  fs.mkdirSync(path.join(vault, "_meta"), { recursive: true });
  fs.writeFileSync(path.join(vault, "_meta", "index.md"), "# Vault index\n\n- MEMORY.md\n", "utf8");
  fs.mkdirSync(path.join(vault, "PROJECTS"));
  const r = spawnSync(process.execPath, [hookSrc, vault, "en"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout); // must be valid JSON
  assert.equal(parsed.hookSpecificOutput.hookEventName, "SessionStart");
  const ctx = parsed.hookSpecificOutput.additionalContext;
  assert.match(ctx, /ONLY source of truth/, "precedence reminder present");
  assert.match(ctx, /autoMemoryEnabled:false/, "mentions the disabled native memory");
  assert.match(ctx, /ToolSearch/, "first-step ToolSearch reminder present");
  assert.match(ctx, /# Vault index/, "curated index injected");
  assert.match(ctx, /- PROJECTS\//, "top-level folders listed");
});

test("the hook never crashes the session on a missing vault (still emits reminders)", () => {
  const r = spawnSync(process.execPath, [hookSrc, path.join(os.tmpdir(), "does-not-exist-xyz")], {
    encoding: "utf8"
  });
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.match(parsed.hookSpecificOutput.additionalContext, /UNICA fuente de verdad/);
});

// ---- CLI wiring (hermetic, dry-run) --------------------------------------

test("CLI: --ide claude wires the native-memory override by default (dry-run)", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-cli-"));
  const vault = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-cli-v-")), "vault");
  const env = { ...process.env, USERPROFILE: home, HOME: home, NO_COLOR: "1" };
  const r = spawnSync(
    process.execPath,
    [
      bin,
      vault,
      "-y",
      "--ide",
      "claude",
      "--no-hybrid",
      "--no-rules",
      "--no-build-index",
      "--no-install-backend",
      "--dry-run",
      "--no-git-init"
    ],
    { encoding: "utf8", env }
  );
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /would set.*autoMemoryEnabled:false/s, "announces disabling native memory");
  assert.match(r.stdout, /would install SessionStart hook/, "announces the hook install");
});

test("CLI: --no-native-memory-override leaves Claude's native memory untouched (dry-run)", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-cli-off-"));
  const vault = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-cli-off-v-")), "vault");
  const env = { ...process.env, USERPROFILE: home, HOME: home, NO_COLOR: "1" };
  const r = spawnSync(
    process.execPath,
    [
      bin,
      vault,
      "-y",
      "--ide",
      "claude",
      "--no-hybrid",
      "--no-rules",
      "--no-build-index",
      "--no-install-backend",
      "--no-native-memory-override",
      "--dry-run",
      "--no-git-init"
    ],
    { encoding: "utf8", env }
  );
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.doesNotMatch(r.stdout, /autoMemoryEnabled:false/, "override skipped");
});
