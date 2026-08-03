import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  configureCursorNative,
  mergeCursorHook,
  removeCursorHook,
  CURSOR_HOOK_STEMS
} from "../src/cursor-native.mjs";
import { shouldNudge } from "../src/hooks/cursor-stop-reminder.mjs";
import {
  emptyState,
  noteFileEdit,
  noteMcpTool,
  readState,
  resetState
} from "../src/hooks/cursor-session-state.mjs";

test("mergeCursorHook replaces same stem and keeps foreign entries", () => {
  let hooks = {
    sessionStart: [{ command: "node ./hooks/mine.mjs" }]
  };
  hooks = mergeCursorHook(
    hooks,
    "sessionStart",
    { command: `node "./hooks/${CURSOR_HOOK_STEMS.context}.mjs"` },
    CURSOR_HOOK_STEMS.context
  );
  hooks = mergeCursorHook(
    hooks,
    "sessionStart",
    { command: `node "./hooks/${CURSOR_HOOK_STEMS.context}.mjs" --v2` },
    CURSOR_HOOK_STEMS.context
  );
  assert.equal(hooks.sessionStart.length, 2);
  assert.ok(hooks.sessionStart.some((h) => h.command.includes("mine.mjs")));
  assert.equal(
    hooks.sessionStart.filter((h) => h.command.includes(CURSOR_HOOK_STEMS.context)).length,
    1
  );
});

test("removeCursorHook drops only the managed stem", () => {
  let hooks = {
    stop: [
      { command: "node ./hooks/mine.mjs" },
      { command: `node "./hooks/${CURSOR_HOOK_STEMS.stop}.mjs"` }
    ]
  };
  hooks = removeCursorHook(hooks, "stop", CURSOR_HOOK_STEMS.stop);
  assert.deepEqual(hooks.stop, [{ command: "node ./hooks/mine.mjs" }]);
});

test("shouldNudge matches the close-ritual thresholds", () => {
  assert.equal(shouldNudge(emptyState()), false);
  assert.equal(shouldNudge({ substantive: 1, vaultTouches: 0, nudged: false }), false);
  assert.equal(shouldNudge({ substantive: 2, vaultTouches: 0, nudged: false }), true);
  assert.equal(shouldNudge({ substantive: 5, vaultTouches: 1, nudged: false }), false);
  assert.equal(shouldNudge({ substantive: 5, vaultTouches: 0, nudged: true }), false);
});

test("cursor-session-state tracks edits and vault MCP writes", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-state-"));
  try {
    resetState(home);
    noteFileEdit(home);
    noteFileEdit(home);
    assert.equal(readState(home).substantive, 2);
    noteMcpTool("vault_append_file", home);
    assert.equal(readState(home).vaultTouches, 1);
    noteMcpTool("Read", home);
    assert.equal(readState(home).vaultTouches, 1, "non-vault tools do not count");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("configureCursorNative writes version-1 hooks.json and scripts", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-native-"));
  const vault = path.join(home, "vault");
  fs.mkdirSync(vault);
  try {
    await configureCursorNative(home, vault, false, {
      lang: "es",
      hooks: true,
      context: true,
      closeReminder: true,
      tokenSaver: true
    });
    const hooksFp = path.join(home, ".cursor", "hooks.json");
    const cfg = JSON.parse(fs.readFileSync(hooksFp, "utf8"));
    assert.equal(cfg.version, 1);
    assert.ok(cfg.hooks.sessionStart?.some((h) => h.command.includes("cursor-session-start")));
    assert.ok(cfg.hooks.afterFileEdit?.some((h) => h.command.includes("cursor-track-edit")));
    assert.ok(cfg.hooks.afterMCPExecution?.some((h) => h.command.includes("cursor-track-mcp")));
    assert.ok(cfg.hooks.afterMCPExecution?.some((h) => h.command.includes("cursor-compact-mcp")));
    assert.ok(cfg.hooks.stop?.some((h) => h.command.includes("cursor-stop-reminder")));
    assert.ok(fs.existsSync(path.join(home, ".cursor", "hooks", "cursor-session-start.mjs")));
    // Re-run must not duplicate.
    await configureCursorNative(home, vault, false, {
      lang: "es",
      hooks: true,
      context: true,
      closeReminder: true,
      tokenSaver: true
    });
    const again = JSON.parse(fs.readFileSync(hooksFp, "utf8"));
    assert.equal(again.hooks.sessionStart.length, 1);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
