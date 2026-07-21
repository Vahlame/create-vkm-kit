import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  mergeClaudeSettings,
  removeSessionStartHook,
  mergeEnforcementHooks,
  removeEnforcementHooks,
  mergeEffortGateHook,
  removeEffortGateHook,
  hookCommand,
  guardHookCommand,
  stopHookCommand,
  effortGateHookCommand,
  configureClaudeNativeMemory,
  uninstallClaudeNativeMemory,
  HOOK_BASENAME,
  HOOK_STEM,
  GUARD_HOOK_BASENAME,
  GUARD_HOOK_STEM,
  STOP_HOOK_BASENAME,
  STOP_HOOK_STEM,
  EFFORT_GATE_HOOK_BASENAME,
  EFFORT_GATE_HOOK_STEM,
  TRANSCRIPT_CACHE_BASENAME
} from "../src/claude-native-memory.mjs";
import { isNativeMemoryPath } from "../src/hooks/guard-native-memory-write.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "src", "index.js");
const hookSrc = path.join(root, "src", "hooks", HOOK_BASENAME);
const guardHookSrc = path.join(root, "src", "hooks", GUARD_HOOK_BASENAME);
const stopHookSrc = path.join(root, "src", "hooks", STOP_HOOK_BASENAME);
const effortGateHookSrc = path.join(root, "src", "hooks", EFFORT_GATE_HOOK_BASENAME);

/** Build a fake JSONL transcript with the given tool_use names, one assistant turn each. */
function writeFakeTranscript(filePath, toolNames) {
  const lines = toolNames.map((name) =>
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name, input: {} }] }
    })
  );
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

/**
 * Build a fake JSONL transcript for the effort-gate hook from richer entry shorthand.
 * `writeFakeTranscript` above only expresses tool_use blocks (one per line), not user
 * turns or text blocks, so this is a SEPARATE helper rather than a changed signature —
 * avoids touching writeFakeTranscript's existing callers. Each entry is one of:
 *   { tool: "Edit" }         -> an assistant tool_use block
 *   { marker: true }         -> an assistant text block with the effort-gate marker
 *   { userReply: "text" }    -> a real user turn (carries its own text)
 *   { userToolResult: true } -> a user turn that's only a tool_result (NOT a real reply)
 */
function writeFakeEffortGateTranscript(filePath, entries) {
  const lines = entries.map((e) => {
    if (e.tool) {
      return JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: e.tool, input: {} }] }
      });
    }
    if (e.marker) {
      return JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "text",
              text: "[!] RECOMENDACIÓN DE ESFUERZO\n- Tarea: x\n- Nivel sugerido: /effort low\n- Razón: y"
            }
          ]
        }
      });
    }
    if (e.userReply !== undefined) {
      return JSON.stringify({ type: "user", message: { content: e.userReply } });
    }
    if (e.userToolResult) {
      return JSON.stringify({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }] }
      });
    }
    throw new Error(`unrecognized fake effort-gate transcript entry: ${JSON.stringify(e)}`);
  });
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

// ---- pure merge -----------------------------------------------------------

test("mergeClaudeSettings disables native auto-memory and adds the hook once", () => {
  const entry = hookCommand("/h/session-start-vault-context.mjs", "/v");
  const out = mergeClaudeSettings({}, entry);
  assert.equal(out.autoMemoryEnabled, false);
  assert.ok(Array.isArray(out.hooks.SessionStart));
  assert.equal(out.hooks.SessionStart.length, 1);
  assert.deepEqual(out.hooks.SessionStart[0].hooks[0], { type: "command", ...entry });
  assert.equal(out.hooks.SessionStart[0].matcher, "*");
});

test("mergeClaudeSettings preserves unrelated keys, hook events and SessionStart entries", () => {
  const existing = {
    theme: "dark",
    permissions: { allow: ["x"] },
    hooks: {
      Stop: [{ matcher: "*", hooks: [{ type: "command", command: "echo stop" }] }],
      SessionStart: [{ matcher: "*", hooks: [{ type: "command", command: "echo unrelated" }] }]
    }
  };
  const entry = hookCommand("/h/session-start-vault-context.mjs", "/v");
  const out = mergeClaudeSettings(existing, entry);
  assert.equal(out.theme, "dark");
  assert.deepEqual(out.permissions, { allow: ["x"] });
  assert.equal(out.hooks.Stop[0].hooks[0].command, "echo stop");
  // unrelated SessionStart entry kept + ours appended
  const inner = out.hooks.SessionStart.flatMap((e) => e.hooks);
  assert.ok(
    inner.some((h) => h.command === "echo unrelated"),
    "unrelated SessionStart entry preserved"
  );
  assert.ok(
    inner.some((h) => h.command === entry.command && h.args?.[0] === entry.args[0]),
    "managed entry added"
  );
  assert.equal(out.hooks.SessionStart.length, 2);
});

test("mergeClaudeSettings is idempotent (re-apply keeps exactly one managed entry)", () => {
  const entry = hookCommand("/h/session-start-vault-context.mjs", "/v");
  const once = mergeClaudeSettings({}, entry);
  const twice = mergeClaudeSettings(once, entry);
  const managed = twice.hooks.SessionStart.filter((e) =>
    e.hooks.some((h) => Array.isArray(h.args) && h.args.some((a) => a.includes(HOOK_STEM)))
  );
  assert.equal(managed.length, 1, "no duplicate managed entry after re-apply");
});

test("mergeClaudeSettings replaces a legacy .ps1 hook (same filename stem, legacy string form)", () => {
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
  const entry = hookCommand(
    "C:\\Users\\x\\.claude\\hooks\\session-start-vault-context.mjs",
    "C:\\v"
  );
  const out = mergeClaudeSettings(legacy, entry);
  const inner = out.hooks.SessionStart.flatMap((e) => e.hooks);
  assert.ok(
    !inner.some((h) => typeof h.command === "string" && h.command.includes(".ps1")),
    "legacy ps1 entry dropped"
  );
  assert.ok(
    inner.some((h) => Array.isArray(h.args) && h.args[0] === entry.args[0]),
    "managed mjs entry present"
  );
  assert.equal(out.hooks.SessionStart.length, 1, "no duplicate after replacing legacy");
});

test("removeSessionStartHook strips the managed entry and reverts autoMemoryEnabled:false", () => {
  const entry = hookCommand("/h/session-start-vault-context.mjs", "/v");
  const installed = mergeClaudeSettings({ theme: "dark" }, entry);
  const out = removeSessionStartHook(installed);
  assert.equal(out.theme, "dark", "unrelated key preserved");
  assert.equal(out.autoMemoryEnabled, undefined, "override key removed, not just flipped");
  assert.equal(out.hooks.SessionStart, undefined, "event key removed once empty");
});

test("removeSessionStartHook never flips autoMemoryEnabled:true — only reverses its OWN false", () => {
  const out = removeSessionStartHook({ autoMemoryEnabled: true });
  assert.equal(out.autoMemoryEnabled, true, "a true value is never touched by removal");
});

test("removeSessionStartHook preserves unrelated SessionStart entries", () => {
  const existing = {
    hooks: { SessionStart: [{ matcher: "*", hooks: [{ type: "command", command: "echo x" }] }] }
  };
  const out = removeSessionStartHook(existing);
  assert.equal(out.hooks.SessionStart.length, 1, "unrelated entry kept");
  assert.equal(out.hooks.SessionStart[0].hooks[0].command, "echo x");
});

test("removeSessionStartHook is a no-op on settings with nothing of ours", () => {
  const existing = { theme: "dark" };
  const out = removeSessionStartHook(existing);
  assert.deepEqual(out, { theme: "dark" });
});

test("hookCommand carries the vault path and language as argv, exec form (no shell string)", () => {
  assert.deepEqual(hookCommand("/h/x.mjs", "/v"), {
    command: "node",
    args: ["/h/x.mjs", "/v", "es"]
  });
  assert.deepEqual(hookCommand("/h/x.mjs", "/v", "en"), {
    command: "node",
    args: ["/h/x.mjs", "/v", "en"]
  });
});

// ---- item 2: exec-form argv means no shell-escaping bug class -------------

test("hookCommand round-trips a vault path containing a double quote, verbatim (no escaping)", () => {
  const tricky = 'C:\\Users\\a "b" c';
  const entry = hookCommand("/h/x.mjs", tricky);
  assert.equal(
    entry.args[1],
    tricky,
    "the quote-containing path is stored as ONE literal argv element"
  );
});

test("hookCommand round-trips a vault path containing a backtick, verbatim", () => {
  const tricky = "/home/user/vault`rm -rf`";
  const entry = hookCommand("/h/x.mjs", tricky);
  assert.equal(entry.args[1], tricky);
});

test("hookCommand round-trips a Windows path with a trailing backslash before where a closing quote would go", () => {
  // The exact repro from the audit: a naive `"${vaultAbs}"` interpolation of `C:\\` turns
  // into `"C:\"` — the trailing backslash escapes the closing quote in shell-string form.
  // Exec form has no quoting step at all, so this can't happen: the value is one argv
  // element, verified against the literal string with a single trailing backslash.
  const tricky = "C:\\";
  const entry = hookCommand("/h/x.mjs", tricky);
  assert.equal(entry.args[1], tricky);
  assert.equal(entry.args[1].length, 3, "backslash preserved, not swallowed");
});

test("guardHookCommand round-trips a claudeDir with quotes/backslashes verbatim", () => {
  const tricky = 'C:\\Users\\"weird"\\.claude\\';
  const entry = guardHookCommand("/h/guard.mjs", tricky);
  assert.equal(entry.args[1], tricky);
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
  const h = j.hooks.SessionStart[0].hooks[0];
  assert.equal(h.command, "node");
  assert.match(h.args[0], new RegExp(HOOK_STEM));
  assert.ok(
    h.args[0].includes(hookFp) || h.args[0] === hookFp,
    "hook entry points at the copied hook"
  );
  assert.equal(h.args[1], vault, "hook command points at the vault");
  assert.equal(h.args[2], "en", "language passed to the hook");

  // idempotent: second run keeps exactly one managed entry
  await configureClaudeNativeMemory(home, vault, false, { lang: "en" });
  const j2 = JSON.parse(fs.readFileSync(settingsFp, "utf8"));
  const managed = j2.hooks.SessionStart.filter((e) =>
    e.hooks.some((h2) => Array.isArray(h2.args) && h2.args.some((a) => a.includes(HOOK_STEM)))
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

// ---- item 1: symmetric install/remove (--no-X actually reverses a prior --X) ----

test("configureClaudeNativeMemory({ enable: false }) on a machine with nothing installed is a TRUE no-op", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-noop-"));
  await configureClaudeNativeMemory(home, path.join(home, "vault"), false, { enable: false });
  assert.ok(
    !fs.existsSync(path.join(home, ".claude")),
    "nothing created at all — not even the dir"
  );
});

test("configureClaudeNativeMemory({ enable: false }) after a prior install REMOVES the override", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-revert-"));
  const vault = path.join(home, "vault");
  await configureClaudeNativeMemory(home, vault, false, { lang: "en" });
  const settingsFp = path.join(home, ".claude", "settings.json");
  let j = JSON.parse(fs.readFileSync(settingsFp, "utf8"));
  assert.equal(j.autoMemoryEnabled, false, "sanity: override installed first");

  await configureClaudeNativeMemory(home, vault, false, { lang: "en", enable: false });
  j = JSON.parse(fs.readFileSync(settingsFp, "utf8"));
  assert.equal(j.autoMemoryEnabled, undefined, "override reverted");
  assert.equal(j.hooks?.SessionStart, undefined, "SessionStart hook entry removed");
  assert.equal(
    j.hooks?.PreToolUse,
    undefined,
    "enforcement + effort-gate also removed (enable implies both)"
  );
  assert.equal(j.hooks?.Stop, undefined);
});

test("re-run with enforce:false REMOVES a previously-installed guard+stop pair, keeps SessionStart + effort-gate", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-noenf-revert-"));
  const vault = path.join(home, "vault");
  await configureClaudeNativeMemory(home, vault, false, { lang: "en" }); // enforce:true, effortGate:true by default
  const settingsFp = path.join(home, ".claude", "settings.json");
  let j = JSON.parse(fs.readFileSync(settingsFp, "utf8"));
  assert.ok(
    j.hooks.PreToolUse.some((e) =>
      e.hooks.some((h) => h.args?.some((a) => a.includes(GUARD_HOOK_STEM)))
    )
  );

  await configureClaudeNativeMemory(home, vault, false, { lang: "en", enforce: false });
  j = JSON.parse(fs.readFileSync(settingsFp, "utf8"));
  assert.equal(j.autoMemoryEnabled, false, "native-memory override untouched");
  assert.ok(j.hooks.SessionStart, "SessionStart untouched");
  const preCmds = (j.hooks.PreToolUse || []).flatMap((e) => e.hooks);
  assert.ok(
    !preCmds.some((h) => h.args?.some((a) => a.includes(GUARD_HOOK_STEM))),
    "guard entry removed"
  );
  assert.ok(
    preCmds.some((h) => h.args?.some((a) => a.includes(EFFORT_GATE_HOOK_STEM))),
    "effort-gate entry untouched by enforce:false"
  );
  assert.equal(j.hooks.Stop, undefined, "stop entry removed");
});

test("re-run with effortGate:false REMOVES a previously-installed effort-gate hook only", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-noeg-revert-"));
  const vault = path.join(home, "vault");
  await configureClaudeNativeMemory(home, vault, false, { lang: "en" });
  const settingsFp = path.join(home, ".claude", "settings.json");

  await configureClaudeNativeMemory(home, vault, false, { lang: "en", effortGate: false });
  const j = JSON.parse(fs.readFileSync(settingsFp, "utf8"));
  const preCmds = j.hooks.PreToolUse.flatMap((e) => e.hooks);
  assert.ok(
    !preCmds.some((h) => h.args?.some((a) => a.includes(EFFORT_GATE_HOOK_STEM))),
    "effort-gate entry removed"
  );
  assert.ok(
    preCmds.some((h) => h.args?.some((a) => a.includes(GUARD_HOOK_STEM))),
    "guard entry untouched by effortGate:false"
  );
  assert.ok(j.hooks.Stop, "stop entry untouched");
});

test("a settings.json with unrelated user-authored hooks is never touched by install OR removal", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-userhooks-"));
  const claudeDir = path.join(home, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  const settingsFp = path.join(claudeDir, "settings.json");
  const userSettings = {
    theme: "dark",
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo my-own-hook" }] }],
      Stop: [{ matcher: "*", hooks: [{ type: "command", command: "echo my-stop" }] }],
      SessionStart: [{ matcher: "*", hooks: [{ type: "command", command: "echo my-start" }] }]
    }
  };
  fs.writeFileSync(settingsFp, JSON.stringify(userSettings, null, 2), "utf8");

  // Install then fully remove — the user's own entries must survive both operations.
  await configureClaudeNativeMemory(home, path.join(home, "vault"), false, { lang: "en" });
  await configureClaudeNativeMemory(home, path.join(home, "vault"), false, {
    lang: "en",
    enable: false
  });

  const j = JSON.parse(fs.readFileSync(settingsFp, "utf8"));
  assert.equal(j.theme, "dark");
  assert.equal(j.hooks.PreToolUse.length, 1, "user's own PreToolUse hook survives");
  assert.equal(j.hooks.PreToolUse[0].hooks[0].command, "echo my-own-hook");
  assert.equal(j.hooks.Stop.length, 1, "user's own Stop hook survives");
  assert.equal(j.hooks.Stop[0].hooks[0].command, "echo my-stop");
  assert.equal(j.hooks.SessionStart.length, 1, "user's own SessionStart hook survives");
  assert.equal(j.hooks.SessionStart[0].hooks[0].command, "echo my-start");
});

// ---- uninstallClaudeNativeMemory (item 1: --uninstall) ---------------------

test("uninstallClaudeNativeMemory removes all 4 managed hook entries + autoMemoryEnabled, deletes kit-owned files", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-uninstall-"));
  const vault = path.join(home, "vault");
  await configureClaudeNativeMemory(home, vault, false, { lang: "en" });

  const settingsFp = path.join(home, ".claude", "settings.json");
  const hooksDir = path.join(home, ".claude", "hooks");
  const allBasenames = [
    HOOK_BASENAME,
    GUARD_HOOK_BASENAME,
    STOP_HOOK_BASENAME,
    EFFORT_GATE_HOOK_BASENAME,
    TRANSCRIPT_CACHE_BASENAME
  ];
  for (const basename of allBasenames) {
    assert.ok(fs.existsSync(path.join(hooksDir, basename)), `${basename} exists before uninstall`);
  }

  await uninstallClaudeNativeMemory(home, false);

  const j = JSON.parse(fs.readFileSync(settingsFp, "utf8"));
  assert.equal(j.autoMemoryEnabled, undefined, "override removed");
  assert.equal(j.hooks?.SessionStart, undefined);
  assert.equal(j.hooks?.PreToolUse, undefined);
  assert.equal(j.hooks?.Stop, undefined);

  for (const basename of allBasenames) {
    assert.ok(!fs.existsSync(path.join(hooksDir, basename)), `${basename} deleted (kit-owned)`);
  }
});

test("uninstallClaudeNativeMemory never deletes a same-named file that isn't this kit's (no marker)", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-uninstall-nomark-"));
  const hooksDir = path.join(home, ".claude", "hooks");
  fs.mkdirSync(hooksDir, { recursive: true });
  const impostor = path.join(hooksDir, HOOK_BASENAME);
  fs.writeFileSync(
    impostor,
    "// a user's own unrelated script, not ours\nconsole.log('hi');\n",
    "utf8"
  );

  await uninstallClaudeNativeMemory(home, false);

  assert.ok(fs.existsSync(impostor), "same-named-but-foreign file survives uninstall");
});

test("uninstallClaudeNativeMemory --dry-run deletes nothing", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-uninstall-dry-"));
  const vault = path.join(home, "vault");
  await configureClaudeNativeMemory(home, vault, false, { lang: "en" });

  await uninstallClaudeNativeMemory(home, true);

  const settingsFp = path.join(home, ".claude", "settings.json");
  const j = JSON.parse(fs.readFileSync(settingsFp, "utf8"));
  assert.equal(j.autoMemoryEnabled, false, "dry-run: settings.json untouched");
  const hooksDir = path.join(home, ".claude", "hooks");
  for (const basename of [
    HOOK_BASENAME,
    GUARD_HOOK_BASENAME,
    STOP_HOOK_BASENAME,
    EFFORT_GATE_HOOK_BASENAME
  ]) {
    assert.ok(
      fs.existsSync(path.join(hooksDir, basename)),
      `${basename}: dry-run leaves it in place`
    );
  }
});

test("CLI: --uninstall dry-run reports without writing (fresh machine, nothing installed)", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-cli-uninstall-"));
  const env = { ...process.env, USERPROFILE: home, HOME: home, NO_COLOR: "1" };
  const r = spawnSync(process.execPath, [bin, "--uninstall", "--dry-run"], {
    encoding: "utf8",
    env
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(!fs.existsSync(path.join(home, ".claude", "settings.json")), "nothing created");
});

test("CLI: --uninstall removes a real prior install end-to-end", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-cli-uninstall2-"));
  const vault = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-cli-uninstall2-v-")),
    "vault"
  );
  const env = { ...process.env, USERPROFILE: home, HOME: home, NO_COLOR: "1" };
  const install = spawnSync(
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
      "--no-git-init"
    ],
    { encoding: "utf8", env }
  );
  assert.equal(install.status, 0, install.stderr + install.stdout);
  const settingsFp = path.join(home, ".claude", "settings.json");
  assert.ok(fs.existsSync(settingsFp), "sanity: install actually wrote settings.json");

  const uninstall = spawnSync(process.execPath, [bin, "--uninstall"], { encoding: "utf8", env });
  assert.equal(uninstall.status, 0, uninstall.stderr + uninstall.stdout);

  const j = JSON.parse(fs.readFileSync(settingsFp, "utf8"));
  assert.equal(j.autoMemoryEnabled, undefined, "override removed by --uninstall");
  assert.equal(j.hooks?.SessionStart, undefined);
  assert.equal(j.hooks?.PreToolUse, undefined);
  assert.equal(j.hooks?.Stop, undefined);
});

test("CLI: --help documents --uninstall", () => {
  const r = spawnSync(process.execPath, [bin, "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--uninstall/);
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
  assert.match(
    r.stdout,
    /would set.*autoMemoryEnabled:false/s,
    "announces disabling native memory"
  );
  assert.match(r.stdout, /would install SessionStart hook/, "announces the hook install");
});

test("CLI: --no-native-memory-override leaves Claude's native memory untouched (dry-run, fresh machine)", () => {
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

test("CLI: re-run with --no-native-memory-override REMOVES a prior override (dry-run announces it)", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-cli-revert-"));
  const vault = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-cli-revert-v-")), "vault");
  const env = { ...process.env, USERPROFILE: home, HOME: home, NO_COLOR: "1" };
  const baseArgs = [
    vault,
    "-y",
    "--ide",
    "claude",
    "--no-hybrid",
    "--no-rules",
    "--no-build-index",
    "--no-install-backend",
    "--no-git-init"
  ];
  const install = spawnSync(process.execPath, [bin, ...baseArgs], { encoding: "utf8", env });
  assert.equal(install.status, 0, install.stderr + install.stdout);

  const r = spawnSync(
    process.execPath,
    [bin, ...baseArgs, "--no-native-memory-override", "--dry-run"],
    { encoding: "utf8", env }
  );
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /would remove autoMemoryEnabled override/, "removal announced in dry-run");

  // Now for real: actually removes it.
  spawnSync(process.execPath, [bin, ...baseArgs, "--no-native-memory-override"], {
    encoding: "utf8",
    env
  });
  const settingsFp = path.join(home, ".claude", "settings.json");
  const j = JSON.parse(fs.readFileSync(settingsFp, "utf8"));
  assert.equal(j.autoMemoryEnabled, undefined, "override actually removed");
});

// ---- ADR-0030: deterministic enforcement hooks ----------------------------

test("mergeEnforcementHooks adds PreToolUse guard + Stop nudge once, dedup by stem", () => {
  const guardCmd = guardHookCommand("/h/guard-native-memory-write.mjs", "/h/.claude", "en");
  const stopCmd = stopHookCommand("/h/stop-vault-close-reminder.mjs", "en");
  const out = mergeEnforcementHooks({}, { guardCommand: guardCmd, stopCommand: stopCmd });
  assert.equal(out.hooks.PreToolUse.length, 1);
  assert.equal(out.hooks.PreToolUse[0].matcher, "Write|Edit|MultiEdit|NotebookEdit");
  assert.deepEqual(out.hooks.PreToolUse[0].hooks[0], { type: "command", ...guardCmd });
  assert.equal(out.hooks.Stop.length, 1);
  assert.equal(out.hooks.Stop[0].matcher, "*");
  assert.deepEqual(out.hooks.Stop[0].hooks[0], { type: "command", ...stopCmd });

  // idempotent re-apply
  const twice = mergeEnforcementHooks(out, { guardCommand: guardCmd, stopCommand: stopCmd });
  assert.equal(twice.hooks.PreToolUse.length, 1, "no duplicate PreToolUse entry");
  assert.equal(twice.hooks.Stop.length, 1, "no duplicate Stop entry");
});

test("mergeEnforcementHooks preserves unrelated hook entries and settings keys", () => {
  const existing = {
    theme: "dark",
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo unrelated" }] }],
      Stop: [{ matcher: "*", hooks: [{ type: "command", command: "echo other-stop" }] }]
    }
  };
  const out = mergeEnforcementHooks(existing, {
    guardCommand: { command: "node", args: ["guard.mjs"] },
    stopCommand: { command: "node", args: ["stop.mjs"] }
  });
  assert.equal(out.theme, "dark");
  const preInner = out.hooks.PreToolUse.flatMap((e) => e.hooks);
  assert.ok(
    preInner.some((h) => h.command === "echo unrelated"),
    "unrelated PreToolUse entry kept"
  );
  assert.ok(
    preInner.some((h) => Array.isArray(h.args) && h.args[0] === "guard.mjs"),
    "guard entry added"
  );
  const stopInner = out.hooks.Stop.flatMap((e) => e.hooks);
  assert.ok(
    stopInner.some((h) => h.command === "echo other-stop"),
    "unrelated Stop entry kept"
  );
  assert.ok(
    stopInner.some((h) => Array.isArray(h.args) && h.args[0] === "stop.mjs"),
    "stop entry added"
  );
});

test("mergeEnforcementHooks installs just one hook when the other command is omitted", () => {
  const out = mergeEnforcementHooks(
    {},
    { guardCommand: { command: "node", args: ["guard.mjs"] }, stopCommand: null }
  );
  assert.ok(Array.isArray(out.hooks.PreToolUse));
  assert.equal(out.hooks.Stop, undefined);
});

test("removeEnforcementHooks strips both guard and stop, leaves unrelated entries", () => {
  const guardCmd = guardHookCommand("/h/guard-native-memory-write.mjs", "/h/.claude", "en");
  const stopCmd = stopHookCommand("/h/stop-vault-close-reminder.mjs", "en");
  const existing = {
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo unrelated" }] }]
    }
  };
  const installed = mergeEnforcementHooks(existing, {
    guardCommand: guardCmd,
    stopCommand: stopCmd
  });
  const out = removeEnforcementHooks(installed);
  const preInner = (out.hooks.PreToolUse || []).flatMap((e) => e.hooks);
  assert.ok(
    !preInner.some((h) => Array.isArray(h.args) && h.args.some((a) => a.includes(GUARD_HOOK_STEM))),
    "guard removed"
  );
  assert.ok(
    preInner.some((h) => h.command === "echo unrelated"),
    "unrelated PreToolUse entry survives"
  );
  assert.equal(out.hooks.Stop, undefined, "Stop event key removed once empty");
});

test("removeEnforcementHooks is a no-op when neither hook is present", () => {
  const existing = { theme: "dark" };
  assert.deepEqual(removeEnforcementHooks(existing), { theme: "dark" });
});

test("guardHookCommand / stopHookCommand carry the expected argv", () => {
  assert.deepEqual(guardHookCommand("/h/guard.mjs", "/h/.claude"), {
    command: "node",
    args: ["/h/guard.mjs", "/h/.claude", "es"]
  });
  assert.deepEqual(guardHookCommand("/h/guard.mjs", "/h/.claude", "en"), {
    command: "node",
    args: ["/h/guard.mjs", "/h/.claude", "en"]
  });
  assert.deepEqual(stopHookCommand("/h/stop.mjs"), {
    command: "node",
    args: ["/h/stop.mjs", "es"]
  });
  assert.deepEqual(stopHookCommand("/h/stop.mjs", "en"), {
    command: "node",
    args: ["/h/stop.mjs", "en"]
  });
});

test("configureClaudeNativeMemory installs the enforcement hooks by default", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-enforce-"));
  await configureClaudeNativeMemory(home, path.join(home, "vault"), false, { lang: "en" });

  const guardFp = path.join(home, ".claude", "hooks", GUARD_HOOK_BASENAME);
  const stopFp = path.join(home, ".claude", "hooks", STOP_HOOK_BASENAME);
  assert.ok(fs.existsSync(guardFp), "guard hook copied");
  assert.ok(fs.existsSync(stopFp), "stop hook copied");
  assert.ok(
    fs.existsSync(path.join(home, ".claude", "hooks", TRANSCRIPT_CACHE_BASENAME)),
    "shared transcript-cache module copied alongside the Stop hook"
  );

  const j = JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));
  assert.equal(j.hooks.PreToolUse[0].matcher, "Write|Edit|MultiEdit|NotebookEdit");
  assert.ok(j.hooks.PreToolUse[0].hooks[0].args.some((a) => a.includes(GUARD_HOOK_STEM)));
  assert.ok(j.hooks.Stop[0].hooks[0].args.some((a) => a.includes(STOP_HOOK_STEM)));
});

test("configureClaudeNativeMemory({ enforce: false }) skips the enforcement hooks", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-noenforce-"));
  await configureClaudeNativeMemory(home, path.join(home, "vault"), false, {
    lang: "en",
    enforce: false
  });

  assert.ok(!fs.existsSync(path.join(home, ".claude", "hooks", GUARD_HOOK_BASENAME)));
  assert.ok(!fs.existsSync(path.join(home, ".claude", "hooks", STOP_HOOK_BASENAME)));
  const j = JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));
  assert.equal(j.autoMemoryEnabled, false, "native memory still disabled");
  assert.ok(j.hooks.SessionStart, "SessionStart hook still installed");
  // `enforce: false` only controls the ADR-0030 guard/stop pair — the ADR-0031 effort-gate
  // hook is independently toggleable and defaults to true, so it's still expected here.
  const preInner = (j.hooks.PreToolUse || []).flatMap((e) => e.hooks);
  assert.ok(
    !preInner.some((h) => Array.isArray(h.args) && h.args.some((a) => a.includes(GUARD_HOOK_STEM))),
    "native-memory guard skipped"
  );
  assert.ok(
    preInner.some(
      (h) => Array.isArray(h.args) && h.args.some((a) => a.includes(EFFORT_GATE_HOOK_STEM))
    ),
    "effort-gate hook unaffected by enforce:false"
  );
  assert.equal(j.hooks.Stop, undefined);
});

// ---- the guard hook script itself -----------------------------------------

test("guard hook denies a Write into the native auto-memory directory", () => {
  const claudeDir = path.join(os.tmpdir(), "fake-claude-dir");
  const filePath = path.join(claudeDir, "projects", "enc", "memory", "MEMORY.md");
  const r = spawnSync(process.execPath, [guardHookSrc, claudeDir, "en"], {
    input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: filePath } }),
    encoding: "utf8"
  });
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, "deny");
  assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /NATIVE auto-memory/);
});

test("guard hook denies a NotebookEdit via notebook_path", () => {
  const claudeDir = path.join(os.tmpdir(), "fake-claude-dir-2");
  const notebookPath = path.join(claudeDir, "projects", "enc", "memory", "x.ipynb");
  const r = spawnSync(process.execPath, [guardHookSrc, claudeDir, "es"], {
    input: JSON.stringify({
      tool_name: "NotebookEdit",
      tool_input: { notebook_path: notebookPath }
    }),
    encoding: "utf8"
  });
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, "deny");
});

test("guard hook stays quiet for a non-mutating tool", () => {
  const claudeDir = path.join(os.tmpdir(), "fake-claude-dir-3");
  const r = spawnSync(process.execPath, [guardHookSrc, claudeDir, "en"], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } }),
    encoding: "utf8"
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "", "no output -> defers to the normal permission flow");
});

test("guard hook stays quiet for a mutating tool outside the native-memory directory", () => {
  const claudeDir = path.join(os.tmpdir(), "fake-claude-dir-4");
  const r = spawnSync(process.execPath, [guardHookSrc, claudeDir, "en"], {
    input: JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: path.join(os.tmpdir(), "some-project", "foo.md") }
    }),
    encoding: "utf8"
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "");
});

test("guard hook never crashes on a malformed stdin payload", () => {
  const r = spawnSync(process.execPath, [guardHookSrc, "/h/.claude", "en"], {
    input: "not json",
    encoding: "utf8"
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "");
});

// ---- item 5: isNativeMemoryPath case-folding is platform-conditional ------

test("isNativeMemoryPath matches a differently-cased path on win32 (case-insensitive)", () => {
  const claudeDir = "/h/.claude";
  const filePath = "/h/.CLAUDE/PROJECTS/enc/MEMORY/MEMORY.md";
  assert.equal(isNativeMemoryPath(filePath, claudeDir, "win32"), true);
});

test("isNativeMemoryPath does NOT match a differently-cased path on a simulated non-Windows platform", () => {
  // The exact scenario the audit flagged: on a case-SENSITIVE filesystem, a directory that
  // merely collides case-insensitively with the native-memory path is a DIFFERENT directory
  // and must not be denied. Simulating "linux" here (without needing to actually run on one)
  // is why isNativeMemoryPath takes an explicit, overridable platform parameter.
  const claudeDir = "/h/.claude";
  const filePath = "/h/.CLAUDE/PROJECTS/enc/MEMORY/MEMORY.md";
  assert.equal(isNativeMemoryPath(filePath, claudeDir, "linux"), false);
  assert.equal(isNativeMemoryPath(filePath, claudeDir, "darwin"), false);
});

test("isNativeMemoryPath still matches an EXACT-case path on a simulated non-Windows platform", () => {
  const claudeDir = "/h/.claude";
  const filePath = "/h/.claude/projects/enc/memory/MEMORY.md";
  assert.equal(isNativeMemoryPath(filePath, claudeDir, "linux"), true);
});

test("isNativeMemoryPath defaults to process.platform when no override is given", () => {
  const claudeDir = "/h/.claude";
  const filePath = "/h/.claude/projects/enc/memory/MEMORY.md";
  assert.equal(isNativeMemoryPath(filePath, claudeDir), true, "exact-case always matches");
});

// ---- the Stop hook script itself -------------------------------------------

test("stop hook blocks once when substantive edits happened with no vault touch", () => {
  const transcript = path.join(os.tmpdir(), `fake-transcript-${Date.now()}-a.jsonl`);
  writeFakeTranscript(transcript, ["Edit", "Write"]);
  const r = spawnSync(process.execPath, [stopHookSrc, "en"], {
    input: JSON.stringify({ transcript_path: transcript, stop_hook_active: false }),
    encoding: "utf8"
  });
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.decision, "block");
  assert.match(parsed.reason, /Obsidian/);
});

test("stop hook stays quiet when the session already touched the vault", () => {
  const transcript = path.join(os.tmpdir(), `fake-transcript-${Date.now()}-b.jsonl`);
  writeFakeTranscript(transcript, ["Edit", "mcp__obsidian-memory-hybrid__vault_write_file"]);
  const r = spawnSync(process.execPath, [stopHookSrc, "en"], {
    input: JSON.stringify({ transcript_path: transcript, stop_hook_active: false }),
    encoding: "utf8"
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "");
});

test("stop hook stays quiet below the substantive-edit threshold", () => {
  const transcript = path.join(os.tmpdir(), `fake-transcript-${Date.now()}-c.jsonl`);
  writeFakeTranscript(transcript, ["Edit"]);
  const r = spawnSync(process.execPath, [stopHookSrc, "en"], {
    input: JSON.stringify({ transcript_path: transcript, stop_hook_active: false }),
    encoding: "utf8"
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "");
});

test("stop hook stands down when stop_hook_active is true (loop guard)", () => {
  const transcript = path.join(os.tmpdir(), `fake-transcript-${Date.now()}-d.jsonl`);
  writeFakeTranscript(transcript, ["Edit", "Write", "MultiEdit"]);
  const r = spawnSync(process.execPath, [stopHookSrc, "en"], {
    input: JSON.stringify({ transcript_path: transcript, stop_hook_active: true }),
    encoding: "utf8"
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "");
});

test("stop hook never crashes when the transcript is missing", () => {
  const r = spawnSync(process.execPath, [stopHookSrc, "en"], {
    input: JSON.stringify({
      transcript_path: path.join(os.tmpdir(), "does-not-exist-xyz.jsonl"),
      stop_hook_active: false
    }),
    encoding: "utf8"
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "");
});

test("stop hook never crashes on a malformed stdin payload", () => {
  const r = spawnSync(process.execPath, [stopHookSrc, "en"], {
    input: "not json",
    encoding: "utf8"
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "");
});

// ---- CLI wiring: --no-memory-enforcement -----------------------------------

test("CLI: --no-memory-enforcement skips the enforcement hooks but keeps the override (dry-run)", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-cli-noenf-"));
  const vault = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-cli-noenf-v-")), "vault");
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
      "--no-memory-enforcement",
      "--dry-run",
      "--no-git-init"
    ],
    { encoding: "utf8", env }
  );
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /would set.*autoMemoryEnabled:false/s, "override still announced");
  assert.match(r.stdout, /would install SessionStart hook/, "SessionStart still announced");
  assert.doesNotMatch(
    r.stdout,
    /would install PreToolUse native-memory guard/,
    "guard hook skipped"
  );
  assert.doesNotMatch(r.stdout, /would install Stop close-ritual reminder/, "stop hook skipped");
});

test("CLI: native-memory override on by default also enables enforcement hooks (dry-run)", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-cli-enf-"));
  const vault = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-cli-enf-v-")), "vault");
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
  assert.match(r.stdout, /would install PreToolUse native-memory guard/, "guard hook announced");
  assert.match(r.stdout, /would install Stop close-ritual reminder/, "stop hook announced");
});

// ---- ADR-0031: effort-gate hook --------------------------------------------

test("mergeEffortGateHook adds a PreToolUse entry once, dedup by stem", () => {
  const entry = effortGateHookCommand("/h/guard-effort-gate.mjs", "en");
  const out = mergeEffortGateHook({}, { effortGateCommand: entry });
  assert.equal(out.hooks.PreToolUse.length, 1);
  assert.equal(out.hooks.PreToolUse[0].matcher, "Write|Edit|MultiEdit|NotebookEdit");
  assert.deepEqual(out.hooks.PreToolUse[0].hooks[0], { type: "command", ...entry });

  // idempotent re-apply
  const twice = mergeEffortGateHook(out, { effortGateCommand: entry });
  assert.equal(twice.hooks.PreToolUse.length, 1, "no duplicate PreToolUse entry after re-apply");
});

test("mergeEffortGateHook preserves unrelated keys and hook entries", () => {
  const existing = {
    theme: "dark",
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo unrelated" }] }]
    }
  };
  const out = mergeEffortGateHook(existing, {
    effortGateCommand: { command: "node", args: ["effort-gate.mjs"] }
  });
  assert.equal(out.theme, "dark");
  const inner = out.hooks.PreToolUse.flatMap((e) => e.hooks);
  assert.ok(
    inner.some((h) => h.command === "echo unrelated"),
    "unrelated PreToolUse entry kept"
  );
  assert.ok(
    inner.some((h) => Array.isArray(h.args) && h.args[0] === "effort-gate.mjs"),
    "effort-gate entry added"
  );
});

test("mergeEffortGateHook coexists with the native-memory guard as a separate PreToolUse entry", () => {
  const guardCmd = guardHookCommand("/h/guard-native-memory-write.mjs", "/h/.claude", "en");
  const withGuard = mergeEnforcementHooks({}, { guardCommand: guardCmd, stopCommand: null });
  const out = mergeEffortGateHook(withGuard, {
    effortGateCommand: effortGateHookCommand("/h/guard-effort-gate.mjs", "en")
  });
  assert.equal(out.hooks.PreToolUse.length, 2, "guard + effort-gate are separate entries");
  const inner = out.hooks.PreToolUse.flatMap((e) => e.hooks);
  assert.ok(
    inner.some((h) => Array.isArray(h.args) && h.args.some((a) => a.includes(GUARD_HOOK_STEM))),
    "guard entry present"
  );
  assert.ok(
    inner.some(
      (h) => Array.isArray(h.args) && h.args.some((a) => a.includes(EFFORT_GATE_HOOK_STEM))
    ),
    "effort-gate entry present"
  );
});

test("removeEffortGateHook strips the entry, leaves the guard entry alone", () => {
  const guardCmd = guardHookCommand("/h/guard-native-memory-write.mjs", "/h/.claude", "en");
  const withGuard = mergeEnforcementHooks({}, { guardCommand: guardCmd, stopCommand: null });
  const withBoth = mergeEffortGateHook(withGuard, {
    effortGateCommand: effortGateHookCommand("/h/guard-effort-gate.mjs", "en")
  });
  const out = removeEffortGateHook(withBoth);
  const inner = out.hooks.PreToolUse.flatMap((e) => e.hooks);
  assert.ok(
    !inner.some(
      (h) => Array.isArray(h.args) && h.args.some((a) => a.includes(EFFORT_GATE_HOOK_STEM))
    ),
    "effort-gate removed"
  );
  assert.ok(
    inner.some((h) => Array.isArray(h.args) && h.args.some((a) => a.includes(GUARD_HOOK_STEM))),
    "guard entry survives"
  );
});

test("effortGateHookCommand carries the expected argv", () => {
  assert.deepEqual(effortGateHookCommand("/h/guard-effort-gate.mjs"), {
    command: "node",
    args: ["/h/guard-effort-gate.mjs", "es"]
  });
  assert.deepEqual(effortGateHookCommand("/h/guard-effort-gate.mjs", "en"), {
    command: "node",
    args: ["/h/guard-effort-gate.mjs", "en"]
  });
});

test("configureClaudeNativeMemory installs the effort-gate hook by default", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-effort-"));
  await configureClaudeNativeMemory(home, path.join(home, "vault"), false, { lang: "en" });

  const effortGateFp = path.join(home, ".claude", "hooks", EFFORT_GATE_HOOK_BASENAME);
  assert.ok(fs.existsSync(effortGateFp), "effort-gate hook copied");

  const j = JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));
  const inner = j.hooks.PreToolUse.flatMap((e) => e.hooks);
  assert.ok(
    inner.some(
      (h) => Array.isArray(h.args) && h.args.some((a) => a.includes(EFFORT_GATE_HOOK_STEM))
    ),
    "effort-gate registered in PreToolUse"
  );
  // coexists with the ADR-0030 guard, which is also on by default
  assert.ok(
    inner.some((h) => Array.isArray(h.args) && h.args.some((a) => a.includes(GUARD_HOOK_STEM))),
    "native-memory guard still present alongside it"
  );
});

test("configureClaudeNativeMemory({ effortGate: false }) skips the effort-gate hook", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-noeffort-"));
  await configureClaudeNativeMemory(home, path.join(home, "vault"), false, {
    lang: "en",
    effortGate: false
  });

  assert.ok(!fs.existsSync(path.join(home, ".claude", "hooks", EFFORT_GATE_HOOK_BASENAME)));
  const j = JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));
  const inner = (j.hooks.PreToolUse || []).flatMap((e) => e.hooks);
  assert.ok(
    !inner.some(
      (h) => Array.isArray(h.args) && h.args.some((a) => a.includes(EFFORT_GATE_HOOK_STEM))
    ),
    "effort-gate not registered"
  );
  // unrelated to enforce: the native-memory guard (also default-on) is unaffected
  assert.ok(
    inner.some((h) => Array.isArray(h.args) && h.args.some((a) => a.includes(GUARD_HOOK_STEM))),
    "native-memory guard unaffected"
  );
});

test("configureClaudeNativeMemory --dry-run writes nothing for the effort-gate hook either", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-effort-dry-"));
  await configureClaudeNativeMemory(home, path.join(home, "vault"), true, { lang: "en" });
  assert.ok(!fs.existsSync(path.join(home, ".claude", "settings.json")), "no settings written");
  assert.ok(!fs.existsSync(path.join(home, ".claude", "hooks")), "no hook written");
});

// ---- the effort-gate hook script itself ------------------------------------

test("effort-gate hook allows the first substantive edit of a session", () => {
  const transcript = path.join(os.tmpdir(), `fake-eg-transcript-${Date.now()}-1.jsonl`);
  writeFakeEffortGateTranscript(transcript, []); // nothing prior -> this call is the 1st
  const r = spawnSync(process.execPath, [effortGateHookSrc, "en"], {
    input: JSON.stringify({ tool_name: "Edit", transcript_path: transcript }),
    encoding: "utf8"
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "", "first substantive edit is always free");
});

test("effort-gate hook denies the 2nd substantive edit when no level was ever proposed", () => {
  const transcript = path.join(os.tmpdir(), `fake-eg-transcript-${Date.now()}-2.jsonl`);
  writeFakeEffortGateTranscript(transcript, [{ tool: "Edit" }]);
  const r = spawnSync(process.execPath, [effortGateHookSrc, "en"], {
    input: JSON.stringify({ tool_name: "Edit", transcript_path: transcript }),
    encoding: "utf8"
  });
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, "deny");
  assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /EFFORT RECOMMENDATION/);
});

test("effort-gate hook defers immediately when agent_id is present (sub-agent call) — same state that would otherwise deny", () => {
  const transcript = path.join(os.tmpdir(), `fake-eg-transcript-${Date.now()}-2b.jsonl`);
  writeFakeEffortGateTranscript(transcript, [{ tool: "Edit" }]); // identical to the denying case above
  const r = spawnSync(process.execPath, [effortGateHookSrc, "en"], {
    input: JSON.stringify({
      tool_name: "Edit",
      transcript_path: transcript,
      agent_id: "agent-123"
    }),
    encoding: "utf8"
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "", "a sub-agent call is never gated, even mid-session");
});

test("effort-gate hook denies when a level was proposed but not yet confirmed", () => {
  const transcript = path.join(os.tmpdir(), `fake-eg-transcript-${Date.now()}-3.jsonl`);
  writeFakeEffortGateTranscript(transcript, [{ tool: "Edit" }, { marker: true }]);
  const r = spawnSync(process.execPath, [effortGateHookSrc, "en"], {
    input: JSON.stringify({ tool_name: "Edit", transcript_path: transcript }),
    encoding: "utf8"
  });
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, "deny");
  assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /proposed an effort level/);
});

test("effort-gate hook allows once a level was proposed AND the user replied", () => {
  const transcript = path.join(os.tmpdir(), `fake-eg-transcript-${Date.now()}-4.jsonl`);
  writeFakeEffortGateTranscript(transcript, [
    { tool: "Edit" },
    { marker: true },
    { userReply: "listo" }
  ]);
  const r = spawnSync(process.execPath, [effortGateHookSrc, "en"], {
    input: JSON.stringify({ tool_name: "Edit", transcript_path: transcript }),
    encoding: "utf8"
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "", "confirmed proposal allows the call");
});

test("effort-gate hook does NOT treat a tool_result-only user entry as confirmation", () => {
  const transcript = path.join(os.tmpdir(), `fake-eg-transcript-${Date.now()}-5.jsonl`);
  writeFakeEffortGateTranscript(transcript, [
    { tool: "Edit" },
    { marker: true },
    { userToolResult: true }
  ]);
  const r = spawnSync(process.execPath, [effortGateHookSrc, "en"], {
    input: JSON.stringify({ tool_name: "Edit", transcript_path: transcript }),
    encoding: "utf8"
  });
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, "deny", "tool result isn't a reply");
});

test("effort-gate hook stays satisfied for later calls once gated once (sticky)", () => {
  const transcript = path.join(os.tmpdir(), `fake-eg-transcript-${Date.now()}-6.jsonl`);
  writeFakeEffortGateTranscript(transcript, [
    { tool: "Edit" },
    { marker: true },
    { userReply: "listo" },
    { tool: "Edit" } // a 3rd substantive call already happened, gate stays open
  ]);
  const r = spawnSync(process.execPath, [effortGateHookSrc, "en"], {
    input: JSON.stringify({ tool_name: "Write", transcript_path: transcript }),
    encoding: "utf8"
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "", "gate satisfied earlier in the session -> stays allowed");
});

test("effort-gate hook stays quiet for a non-mutating tool regardless of state", () => {
  const transcript = path.join(os.tmpdir(), `fake-eg-transcript-${Date.now()}-7.jsonl`);
  writeFakeEffortGateTranscript(transcript, [{ tool: "Edit" }]); // would deny a 2nd Edit
  const r = spawnSync(process.execPath, [effortGateHookSrc, "en"], {
    input: JSON.stringify({ tool_name: "Read", transcript_path: transcript }),
    encoding: "utf8"
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "", "Read is never gated");
});

test("effort-gate hook fails open when the transcript is missing", () => {
  const r = spawnSync(process.execPath, [effortGateHookSrc, "en"], {
    input: JSON.stringify({
      tool_name: "Edit",
      transcript_path: path.join(os.tmpdir(), "does-not-exist-eg.jsonl")
    }),
    encoding: "utf8"
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "", "missing transcript -> substantiveBefore=0 -> allow");
});

test("effort-gate hook never crashes on a malformed stdin payload", () => {
  const r = spawnSync(process.execPath, [effortGateHookSrc, "en"], {
    input: "not json",
    encoding: "utf8"
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "");
});

// ---- CLI wiring: --no-effort-gate ------------------------------------------

test("CLI: --no-effort-gate skips the effort-gate hook but keeps the rest of the override (dry-run)", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-cli-noeg-"));
  const vault = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-cli-noeg-v-")), "vault");
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
      "--no-effort-gate",
      "--dry-run",
      "--no-git-init"
    ],
    { encoding: "utf8", env }
  );
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /would set.*autoMemoryEnabled:false/s, "override still announced");
  assert.match(
    r.stdout,
    /would install PreToolUse native-memory guard/,
    "enforcement guard still announced"
  );
  assert.doesNotMatch(r.stdout, /would install PreToolUse effort-gate hook/, "effort-gate skipped");
});

test("CLI: native-memory override on by default also enables the effort-gate hook (dry-run)", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-cli-eg-"));
  const vault = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "com-nm-cli-eg-v-")), "vault");
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
  assert.match(r.stdout, /would install PreToolUse effort-gate hook/, "effort-gate hook announced");
});
