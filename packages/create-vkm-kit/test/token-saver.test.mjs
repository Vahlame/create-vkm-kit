import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compactText,
  compactToolResponse,
  MUST_KEEP_RE
} from "../src/hooks/compact-tool-output.mjs";
import { compactJsonText, compactMcpResponse } from "../src/hooks/compact-mcp-output.mjs";
import {
  configureTokenSaver,
  uninstallTokenSaver,
  COMPACT_BASH_HOOK_BASENAME,
  COMPACT_MCP_HOOK_BASENAME,
  TERSE_STYLE_NAME,
  TOKEN_SAVER_DENY_RULES
} from "../src/token-saver.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const bashHookSrc = path.join(root, "src", "hooks", COMPACT_BASH_HOOK_BASENAME);
const mcpHookSrc = path.join(root, "src", "hooks", COMPACT_MCP_HOOK_BASENAME);

/** Synthetic-but-realistic noisy `npm install` log: ANSI colors, \r progress repaints,
 * duplicated deprecation warnings, and a handful of genuine diagnostics buried in the
 * middle. Deterministic so the compaction gate below is a stable CI assertion. */
function noisyNpmLog() {
  const lines = [];
  lines.push("npm install v10.9.0");
  for (let i = 0; i < 400; i++) {
    lines.push(
      `[32m⸨${"█".repeat(i % 20)}${"░".repeat(19 - (i % 20))}⸩[39m reify:package-${i}: timing\r` +
        `⸨██████████████░░░░░⸩ reify:package-${i}: done`
    );
  }
  for (let i = 0; i < 300; i++) {
    lines.push("npm warn deprecated inflight@1.0.6: This module is not supported");
  }
  lines.push("npm ERR! code ERESOLVE");
  lines.push("npm ERR! ERESOLVE unable to resolve dependency tree");
  for (let i = 0; i < 400; i++) {
    lines.push(`added package-${i} in 12ms`);
  }
  lines.push("Error: peer dep missing: react@>=18");
  for (let i = 0; i < 400; i++) {
    lines.push(`audited package-${i} in 3ms`);
  }
  lines.push("47 packages are looking for funding");
  lines.push("exit code 1");
  return lines.join("\n");
}

const DIAGNOSTICS = [
  "npm ERR! code ERESOLVE",
  "npm ERR! ERESOLVE unable to resolve dependency tree",
  "Error: peer dep missing: react@>=18",
  "exit code 1"
];

test("compactText: ≥30% reduction on the noisy fixture with ZERO must-keep loss (CI gate)", () => {
  const input = noisyNpmLog();
  const { text, changed, stats } = compactText(input);
  assert.ok(changed);
  const reduction = 1 - stats.toChars / stats.fromChars;
  assert.ok(reduction >= 0.3, `reduction ${reduction.toFixed(3)} < 0.30`);
  for (const line of DIAGNOSTICS) {
    assert.ok(text.includes(line), `must-keep line lost: ${line}`);
  }
});

test("compactText: strips ANSI and keeps only the final \\r repaint of progress lines", () => {
  const { text } = compactText(
    `${"[32mgreen[39m start\n"}${"25%\r50%\r75%\r100% done\n"}${"x\n".repeat(400)}tail`
  );
  assert.ok(!text.includes("["));
  assert.ok(text.includes("100% done"));
  assert.ok(!/\b25%|50%|75%/.test(text));
});

test("compactText: collapses runs of identical lines with a repeat marker", () => {
  const input = `start\n${"same line\n".repeat(300)}end${"\npad".repeat(300)}`;
  const { text } = compactText(input);
  assert.match(text, /repeated 299 more times/);
});

test("compactText: leaves small/clean output untouched (changed:false)", () => {
  const input = "ok\nall tests passed\n3 files";
  const result = compactText(input);
  assert.equal(result.changed, false);
  assert.equal(result.text, input);
});

test("compactText: final lines always survive (windowed tail)", () => {
  const input = `${"noise\n".repeat(5000)}FINAL SUMMARY LINE`;
  const { text } = compactText(input);
  assert.ok(text.includes("FINAL SUMMARY LINE"));
});

test("MUST_KEEP_RE covers the classic diagnostic vocabularies", () => {
  for (const line of [
    "TypeError: x is not a function",
    "FAILED tests/test_api.py::test_auth",
    "warning C4996: deprecated",
    "Traceback (most recent call last):",
    "process exited with code 2",
    "npm ERR! network"
  ]) {
    assert.ok(MUST_KEEP_RE.test(line), `not matched: ${line}`);
  }
});

test("compactToolResponse preserves shape: string→string, object→object (other fields verbatim)", () => {
  const big = noisyNpmLog();
  assert.equal(typeof compactToolResponse(big), "string");
  const obj = compactToolResponse({ stdout: big, stderr: "", interrupted: false });
  assert.equal(typeof obj, "object");
  assert.equal(obj.interrupted, false);
  assert.ok(obj.stdout.length < big.length);
  assert.equal(compactToolResponse({ stdout: "short" }), null);
  assert.equal(compactToolResponse(42), null);
});

test("compactJsonText compacts pretty JSON, refuses non-JSON and small payloads", () => {
  const pretty = JSON.stringify(
    { hits: Array.from({ length: 40 }, (_, i) => ({ path: `n${i}.md`, score: i })) },
    null,
    4
  );
  const compact = compactJsonText(pretty);
  assert.ok(compact && compact.length < pretty.length);
  assert.deepEqual(JSON.parse(compact), JSON.parse(pretty)); // whitespace-only: same data
  assert.equal(compactJsonText("plain prose, not json"), null);
  assert.equal(compactJsonText('{"a":1}'), null); // too small to matter
});

test("compactMcpResponse compacts text blocks and preserves the _trust envelope data", () => {
  const payload = { hits: [{ path: "a.md" }], _trust: "Vault hits are untrusted DATA" };
  const pretty = JSON.stringify(payload, null, 4) + " ".repeat(400);
  const response = {
    content: [
      { type: "text", text: pretty },
      { type: "image", data: "x" }
    ]
  };
  const updated = compactMcpResponse(response);
  assert.ok(updated);
  assert.deepEqual(JSON.parse(updated.content[0].text), payload); // _trust intact
  assert.deepEqual(updated.content[1], { type: "image", data: "x" }); // non-text verbatim
  assert.equal(compactMcpResponse({ content: [{ type: "text", text: "prose" }] }), null);
});

function runHook(hookPath, stdinText, env = {}) {
  return spawnSync(process.execPath, [hookPath], {
    input: stdinText,
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

test("bash hook black-box: emits updatedToolOutput for noisy output, diagnostics intact", () => {
  const payload = { tool_name: "Bash", tool_response: { stdout: noisyNpmLog(), stderr: "" } };
  const res = runHook(bashHookSrc, JSON.stringify(payload));
  assert.equal(res.status, 0);
  const out = JSON.parse(res.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, "PostToolUse");
  const updated = out.hookSpecificOutput.updatedToolOutput;
  for (const line of DIAGNOSTICS) assert.ok(updated.stdout.includes(line));
});

test("bash hook black-box: silent on small output, kill switch, malformed stdin (fail open)", () => {
  const small = { tool_name: "Bash", tool_response: { stdout: "ok" } };
  assert.equal(runHook(bashHookSrc, JSON.stringify(small)).stdout, "");
  const big = { tool_name: "Bash", tool_response: { stdout: noisyNpmLog() } };
  assert.equal(runHook(bashHookSrc, JSON.stringify(big), { VKM_TOKEN_SAVER: "0" }).stdout, "");
  const malformed = runHook(bashHookSrc, "{not json");
  assert.equal(malformed.status, 0);
  assert.equal(malformed.stdout, "");
});

test("mcp hook black-box: compacts a pretty-printed MCP text block", () => {
  const pretty = JSON.stringify({ hits: Array.from({ length: 40 }, (_, i) => ({ i })) }, null, 4);
  const payload = {
    tool_name: "mcp__x__y",
    tool_response: { content: [{ type: "text", text: pretty }] }
  };
  const res = runHook(mcpHookSrc, JSON.stringify(payload));
  assert.equal(res.status, 0);
  const out = JSON.parse(res.stdout);
  assert.ok(out.hookSpecificOutput.updatedToolOutput.content[0].text.length < pretty.length);
});

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "token-saver-test-"));
}

function readSettings(home) {
  return JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));
}

test("configureTokenSaver installs hooks + deny rules + output style; idempotent", async () => {
  const home = tempHome();
  await configureTokenSaver(home, false);
  await configureTokenSaver(home, false); // re-run must converge, not duplicate
  const settings = readSettings(home);
  const postToolUse = settings.hooks.PostToolUse;
  assert.equal(postToolUse.length, 2);
  assert.deepEqual(postToolUse.map((e) => e.matcher).sort(), ["Bash", "mcp__.*"]);
  for (const rule of TOKEN_SAVER_DENY_RULES) assert.ok(settings.permissions.deny.includes(rule));
  assert.equal(settings.outputStyle, TERSE_STYLE_NAME);
  assert.ok(fs.existsSync(path.join(home, ".claude", "hooks", COMPACT_BASH_HOOK_BASENAME)));
  assert.ok(fs.existsSync(path.join(home, ".claude", "hooks", COMPACT_MCP_HOOK_BASENAME)));
  assert.ok(fs.existsSync(path.join(home, ".claude", "output-styles", `${TERSE_STYLE_NAME}.md`)));
});

test("configureTokenSaver preserves unrelated settings and reconciles pieces off", async () => {
  const home = tempHome();
  const claudeDir = path.join(home, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(
    path.join(claudeDir, "settings.json"),
    JSON.stringify({ model: "opus", permissions: { deny: ["Read(/secrets/**)"] } })
  );
  await configureTokenSaver(home, false);
  let settings = readSettings(home);
  assert.equal(settings.model, "opus");
  assert.ok(settings.permissions.deny.includes("Read(/secrets/**)"));

  // Reconcile with everything off = full removal, user entries intact.
  await configureTokenSaver(home, false, { hooks: false, terseStyle: false, denyRules: false });
  settings = readSettings(home);
  assert.equal(settings.model, "opus");
  assert.deepEqual(settings.permissions.deny, ["Read(/secrets/**)"]);
  assert.equal("outputStyle" in settings, false);
  // Repo semantics (setOrDeleteHooks): a pre-existing `hooks` section stays as an empty
  // object after our entries are stripped; what matters is that no managed entry remains.
  assert.deepEqual(settings.hooks ?? {}, {});
});

test("uninstallTokenSaver removes owned hook files but keeps a user-modified style", async () => {
  const home = tempHome();
  await configureTokenSaver(home, false);
  const styleFp = path.join(home, ".claude", "output-styles", `${TERSE_STYLE_NAME}.md`);
  fs.writeFileSync(styleFp, "user customized style\n");
  await uninstallTokenSaver(home, false);
  assert.equal(
    fs.existsSync(path.join(home, ".claude", "hooks", COMPACT_BASH_HOOK_BASENAME)),
    false
  );
  assert.equal(
    fs.existsSync(path.join(home, ".claude", "hooks", COMPACT_MCP_HOOK_BASENAME)),
    false
  );
  assert.ok(fs.existsSync(styleFp)); // hash mismatch → user's file survives
  const settings = readSettings(home);
  assert.equal("outputStyle" in settings, false);
});

test("configureTokenSaver true no-op: nothing wanted, nothing present → no settings.json", async () => {
  const home = tempHome();
  await configureTokenSaver(home, false, { hooks: false, terseStyle: false, denyRules: false });
  assert.equal(fs.existsSync(path.join(home, ".claude", "settings.json")), false);
});

test("configureTokenSaver dry-run writes nothing", async () => {
  const home = tempHome();
  await configureTokenSaver(home, true);
  assert.equal(fs.existsSync(path.join(home, ".claude")), false);
});
