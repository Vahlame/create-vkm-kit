/**
 * The audit exists because the launcher fallback is SILENT: with no `vkm-runhidden.exe` on disk,
 * every spawn quietly reverts to plain `node` and the machine flashes exactly like it did before
 * ADR-0078, with nothing in any log saying so. These tests pin the decision table that turns that
 * silence into an exit code.
 *
 * They run on every platform: the decisions are ordinary logic over parsed config objects, and the
 * only Windows-specific part (the foreground sampler) is checked as generated text, not executed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  auditClaudeHooks,
  auditCodexToml,
  auditMcpServers,
  fixClaudeHooks,
  fixMcpServers,
  isLauncher,
  watchScript
} from "../src/windows-audit.mjs";

const LAUNCHER = "C:\\Users\\u\\.claude\\bin\\vkm-runhidden.exe";
const HOOK = "C:\\Users\\u\\.claude\\hooks\\guard-effort-gate.mjs";

test("a server started through the launcher is ok, one started directly is not", () => {
  const config = {
    mcpServers: {
      "obscura-web": { command: LAUNCHER, args: ["node", "obscura-mcp.mjs"] },
      "vkm-downloads": { command: "node", args: ["downloads-mcp.mjs"] }
    }
  };
  const findings = auditMcpServers(config, { launcher: LAUNCHER, surface: "claude/mcp" });
  assert.equal(findings.length, 2);
  assert.equal(findings.find((f) => f.name === "obscura-web").ok, true);
  assert.equal(findings.find((f) => f.name === "vkm-downloads").ok, false);
});

test("a user's own server is never audited and never rewritten", () => {
  const config = { mcpServers: { "my-server": { command: "node", args: ["mine.mjs"] } } };
  assert.deepEqual(auditMcpServers(config, { launcher: LAUNCHER, surface: "s" }), []);
  const { config: next, changed } = fixMcpServers(config, LAUNCHER);
  assert.deepEqual(changed, []);
  assert.deepEqual(next.mcpServers["my-server"], { command: "node", args: ["mine.mjs"] });
});

test("the fix puts the launcher in front and keeps the original argv intact", () => {
  const config = {
    mcpServers: { "basic-memory": { command: "uvx", args: ["--from", "basic-memory==0.21.4"] } }
  };
  const { config: next, changed } = fixMcpServers(config, LAUNCHER);
  assert.deepEqual(changed, ["basic-memory"]);
  assert.deepEqual(next.mcpServers["basic-memory"], {
    command: LAUNCHER,
    args: ["uvx", "--from", "basic-memory==0.21.4"]
  });
  // The pin is a supply-chain control: a rewrite that dropped it would be worse than the flash.
  assert.ok(next.mcpServers["basic-memory"].args.includes("basic-memory==0.21.4"));
});

test("fixing is idempotent — a second pass changes nothing", () => {
  const config = { mcpServers: { "obscura-web": { command: "node", args: ["a.mjs"] } } };
  const once = fixMcpServers(config, LAUNCHER);
  const twice = fixMcpServers(once.config, LAUNCHER);
  assert.deepEqual(twice.changed, []);
  assert.deepEqual(twice.config.mcpServers["obscura-web"], once.config.mcpServers["obscura-web"]);
});

test("kit hooks are audited by their script path, user hooks are left out of it", () => {
  const settings = {
    hooks: {
      PreToolUse: [
        { matcher: "Write", hooks: [{ type: "command", command: LAUNCHER, args: [HOOK] }] },
        { matcher: "Edit", hooks: [{ type: "command", command: "node", args: [HOOK] }] },
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "node", args: ["C:\\mine\\x.mjs"] }]
        }
      ]
    }
  };
  const findings = auditClaudeHooks(settings, { launcher: LAUNCHER, surface: "claude/hooks" });
  assert.equal(findings.length, 2, "the user's own hook must not appear");
  assert.equal(findings.filter((f) => f.ok).length, 1);
});

test("fixing a hook preserves its script and arguments in order", () => {
  const settings = {
    hooks: {
      PreToolUse: [
        { matcher: "Write", hooks: [{ type: "command", command: "node", args: [HOOK, "es"] }] }
      ]
    }
  };
  const { settings: next, changed } = fixClaudeHooks(settings, LAUNCHER);
  assert.deepEqual(changed, ["PreToolUse:guard-effort-gate.mjs"]);
  assert.deepEqual(next.hooks.PreToolUse[0].hooks[0], {
    type: "command",
    command: LAUNCHER,
    args: ["node", HOOK, "es"]
  });
});

test("a user hook survives a fix byte-identically", () => {
  const mine = { type: "command", command: "node", args: ["C:\\mine\\x.mjs"] };
  const settings = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [mine] }] } };
  const { settings: next, changed } = fixClaudeHooks(settings, LAUNCHER);
  assert.deepEqual(changed, []);
  assert.deepEqual(next.hooks.PreToolUse[0].hooks[0], mine);
});

test("codex config.toml is audited by line, in both shapes the kit writes", () => {
  const toml = [
    "[hooks.pre_tool_use]",
    `command = ["${LAUNCHER.replace(/\\/g, "\\\\")}", "node", "hook.mjs"]`,
    "[mcp_servers.obscura-web]",
    'command = "node"',
    "[mcp_servers.someone-else]",
    'command = "deno"'
  ].join("\n");
  const findings = auditCodexToml(toml, { launcher: LAUNCHER, surface: "codex/config.toml" });
  assert.equal(findings.length, 2, "the unrelated `deno` entry is not ours to judge");
  assert.equal(findings.find((f) => f.name === "hooks.pre_tool_use").ok, true);
  assert.equal(findings.find((f) => f.name === "mcp_servers.obscura-web").ok, false);
});

test("isLauncher compares by basename, case-insensitively, as Windows paths do", () => {
  assert.ok(isLauncher("C:\\other\\path\\VKM-RunHidden.EXE", LAUNCHER));
  assert.ok(!isLauncher("node", LAUNCHER));
  assert.ok(!isLauncher("", LAUNCHER));
});

test("the sampler counts BOTH console window classes", () => {
  const script = watchScript(5);
  // Windows 11 hosts consoles in CASCADIA_HOSTING_WINDOW_CLASS; a sampler that only knows the
  // classic class reports a clean zero on the very machines that still flash.
  assert.match(script, /ConsoleWindowClass\|CASCADIA_HOSTING_WINDOW_CLASS/);
  assert.match(script, /console_steals: \$steals/);
  assert.match(watchScript(0), /TotalSeconds -lt 1\b/, "a zero budget must not loop forever");
});

test("the sampler excludes its own terminal and the window already in front", () => {
  // Caught by running the negative control: four of five reported steals were WindowsTerminal —
  // the terminal the command was typed into — inside the first 220ms. A measuring tool that
  // reports the observer as the event turns every honest zero into noise, and would have made
  // "console_steals: 0" unfalsifiable in the other direction too.
  const script = watchScript(5);
  assert.match(script, /GetConsoleWindow/, "it must know which console is its own");
  assert.match(script, /\$hwnd -eq \$self -or \$hwnd -eq \$initial/);
  // HWND alone is not enough: under Windows Terminal (ConPTY) GetConsoleWindow returns a HIDDEN
  // pseudo-console, never the visible window, so the terminal was still counted. The ancestor walk
  // is what actually excludes it — and only it, since a console created by another process is
  // hosted by a terminal process that is not in this chain.
  assert.match(script, /\$mine\.ContainsKey\(\[int\]\$p\[2\]\)/);
  assert.match(script, /\$walk = \[int\]\$proc\.ParentProcessId/);
  assert.ok(
    script.indexOf("$initial = ") < script.indexOf("while ("),
    "the initial foreground must be captured before sampling, not during"
  );
});
