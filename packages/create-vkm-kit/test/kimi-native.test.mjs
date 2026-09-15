/**
 * Kimi Code-native hooks: the managed `[[hooks]]` block in `~/.kimi-code/config.toml`
 * (TOML comment sentinels, user content preserved) plus the hash-tracked hook scripts,
 * and the two kimi hook scripts themselves (wire.jsonl scan policy + plain-text
 * SessionStart output).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { parse as parseToml } from "smol-toml";
import {
  configureKimiNative,
  kimiHooksTomlBlock,
  mergeKimiToml,
  uninstallKimiNative,
  KIMI_TOML_START,
  KIMI_TOML_END
} from "../src/kimi-native.mjs";
import { foldWireLine, scanWire } from "../src/hooks/kimi-stop-vault-close-reminder.mjs";
import { kimiReminders } from "../src/hooks/session-start-vault-context.mjs";

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kimi-native-test-"));
}

/** Run `fn` with KIMI_CODE_HOME deleted, then restored. */
async function withoutKimiCodeHome(fn) {
  const prior = process.env.KIMI_CODE_HOME;
  delete process.env.KIMI_CODE_HOME;
  try {
    await fn();
  } finally {
    if (prior === undefined) delete process.env.KIMI_CODE_HOME;
    else process.env.KIMI_CODE_HOME = prior;
  }
}

async function quiet(fn) {
  const orig = [console.log, console.warn];
  console.log = () => {};
  console.warn = () => {};
  try {
    await fn();
  } finally {
    [console.log, console.warn] = orig;
  }
}

test("mergeKimiToml: empty config → just the block; idempotent; removable", () => {
  const block = `${KIMI_TOML_START}\n[[hooks]]\nevent = "SessionStart"\n${KIMI_TOML_END}`;
  const once = mergeKimiToml("", block);
  assert.ok(once.includes(KIMI_TOML_START) && once.includes(KIMI_TOML_END));
  assert.equal(mergeKimiToml(once, block), once, "upsert is idempotent");
  const removed = mergeKimiToml(once, "");
  assert.ok(!removed.includes(KIMI_TOML_START), "removal strips the block");
});

test("mergeKimiToml preserves the user's own TOML around the managed block", () => {
  const user =
    'default_model = "kimi-code/k3"\n\n[[hooks]]\nevent = "PreToolUse"\ncommand = "mine"\n';
  const block = `${KIMI_TOML_START}\n[[hooks]]\nevent = "Stop"\n${KIMI_TOML_END}`;
  const merged = mergeKimiToml(user, block);
  assert.ok(merged.includes('default_model = "kimi-code/k3"'), "user scalar survives");
  assert.ok(merged.includes('command = "mine"'), "user hook survives");
  const parsed = parseToml(merged);
  assert.equal(parsed.hooks.length, 2, "user hook + managed hook coexist");
});

test("kimiHooksTomlBlock emits only the four documented hook fields and parses as TOML", () => {
  const home = tempHome();
  const block = kimiHooksTomlBlock(home, "C:\\vault dir", "es");
  const parsed = parseToml(block.replace(KIMI_TOML_START, "").replace(KIMI_TOML_END, ""));
  assert.equal(parsed.hooks.length, 2);
  for (const hook of parsed.hooks) {
    assert.deepEqual(
      Object.keys(hook).sort(),
      ["command", "event", "timeout"],
      "an extra field would make Kimi reject the whole config.toml"
    );
  }
  const sessionStart = parsed.hooks.find((h) => h.event === "UserPromptSubmit");
  assert.ok(sessionStart.command.includes("kimi-session-start-vault-context.mjs"));
  assert.ok(sessionStart.command.includes('"C:\\vault dir"'), "vault path is shell-quoted");
  const stop = parsed.hooks.find((h) => h.event === "Stop");
  assert.ok(stop.command.includes("kimi-stop-vault-close-reminder.mjs"));
  // Toggles gate entries independently.
  const contextOnly = kimiHooksTomlBlock(home, "/vault", "es", { closeReminder: false });
  assert.ok(contextOnly.includes("UserPromptSubmit") && !contextOnly.includes('"Stop"'));
  assert.equal(
    kimiHooksTomlBlock(home, "/vault", "es", { context: false, closeReminder: false }),
    ""
  );
});

test("configureKimiNative installs scripts + config block; uninstall removes both", async () => {
  const home = tempHome();
  await withoutKimiCodeHome(async () => {
    const kimiDir = path.join(home, ".kimi-code");
    fs.mkdirSync(kimiDir, { recursive: true });
    fs.writeFileSync(path.join(kimiDir, "config.toml"), "telemetry = false\n", "utf8");

    await quiet(() => configureKimiNative(home, "/vault", false, { lang: "es" }));
    const configFp = path.join(kimiDir, "config.toml");
    const text = fs.readFileSync(configFp, "utf8");
    assert.ok(text.includes("telemetry = false"), "user config preserved");
    const parsed = parseToml(text);
    assert.equal(parsed.telemetry, false, "config still parses with the managed block in place");
    assert.equal(parsed.hooks.length, 2);
    for (const f of [
      "kimi-session-start-vault-context.mjs",
      "session-start-vault-context.mjs",
      "kimi-stop-vault-close-reminder.mjs",
      "stop-vault-close-reminder.mjs",
      "_transcript-cache.mjs"
    ]) {
      assert.ok(fs.existsSync(path.join(kimiDir, "hooks", f)), `hook asset installed: ${f}`);
    }
    const backups = fs.readdirSync(kimiDir).filter((n) => n.startsWith("config.toml.bak."));
    assert.equal(backups.length, 1, "config.toml backed up before the managed write");

    // Idempotent re-run.
    await quiet(() => configureKimiNative(home, "/vault", false, { lang: "es" }));
    assert.equal(
      fs.readFileSync(configFp, "utf8").split(KIMI_TOML_START).length - 1,
      1,
      "still exactly one managed block"
    );

    await quiet(() => uninstallKimiNative(home, false));
    const after = fs.readFileSync(configFp, "utf8");
    assert.ok(!after.includes(KIMI_TOML_START), "uninstall strips the block");
    assert.ok(after.includes("telemetry = false"), "user config survives uninstall");
    assert.equal(
      fs.existsSync(path.join(kimiDir, "hooks", "kimi-session-start-vault-context.mjs")),
      false,
      "uninstall removes unmodified hook scripts"
    );
  });
});

test("configureKimiNative dry-run writes nothing", async () => {
  const home = tempHome();
  await withoutKimiCodeHome(async () => {
    await quiet(() => configureKimiNative(home, "/vault", true, { lang: "es" }));
    assert.equal(fs.existsSync(path.join(home, ".kimi-code")), false);
  });
});

test("foldWireLine/scanWire count kimi wire.jsonl tool calls by policy", () => {
  const line = (name) =>
    JSON.stringify({
      type: "context.append_loop_event",
      event: { type: "tool.call", uuid: "x", name, args: {} }
    });
  const dir = tempHome();
  const fp = path.join(dir, "wire.jsonl");
  fs.writeFileSync(
    fp,
    [
      '{"type":"metadata","protocol_version":"1.5"}',
      line("Write"),
      line("Edit"),
      line("Read"),
      line("vault_append_file"),
      "not json at all"
    ].join("\n")
  );
  const { substantive, vaultTouches } = scanWire(fp);
  assert.equal(substantive, 2, "Write + Edit are substantive");
  assert.equal(vaultTouches, 1, "vault_append_file counts as a close-ritual touch");
  // Non-loop-event lines and unparseable lines are ignored.
  const state = foldWireLine({ substantive: 0, vaultTouches: 0 }, '{"type":"metadata"}');
  assert.deepEqual(state, { substantive: 0, vaultTouches: 0 });
});

test("kimi stop hook blocks (exit 2) on substantive work with no vault touch, once", async () => {
  const home = tempHome();
  const sessionId = "11111111-2222-3333-4444-555555555555";
  const wireDir = path.join(
    home,
    ".kimi-code",
    "sessions",
    "wd_proj_deadbeef",
    `session_${sessionId}`,
    "agents",
    "main"
  );
  fs.mkdirSync(wireDir, { recursive: true });
  const line = (name) =>
    JSON.stringify({ type: "context.append_loop_event", event: { type: "tool.call", name } });
  fs.writeFileSync(path.join(wireDir, "wire.jsonl"), [line("Write"), line("Edit")].join("\n"));

  const hook = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
    "hooks",
    "kimi-stop-vault-close-reminder.mjs"
  );
  const env = {
    ...process.env,
    KIMI_CODE_HOME: path.join(home, ".kimi-code"),
    VKM_VAULT_CLOSE_NUDGE: "1"
  };
  const payload = JSON.stringify({ hook_event_name: "Stop", session_id: sessionId });

  const first = await execa("node", [hook, "en"], {
    input: payload,
    env: { ...env, HOME: home, USERPROFILE: home },
    reject: false
  });
  assert.equal(first.exitCode, 2, "first stop with substantive edits is blocked");
  assert.match(first.stderr, /Optional|KNOWN_FAILURES/i, "the reason reaches stderr");

  const second = await execa("node", [hook, "en"], {
    input: payload,
    env: { ...env, HOME: home, USERPROFILE: home },
    reject: false
  });
  assert.equal(second.exitCode, 0, "the nudge fires at most once per session");
});

test("kimi context hook injects the vault map once per session, then stays silent", async () => {
  const home = tempHome();
  const vault = tempHome();
  const hook = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
    "hooks",
    "kimi-session-start-vault-context.mjs"
  );
  const env = { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: "1" };
  const payload = JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "sess-1" });

  const first = await execa("node", [hook, vault, "en"], { input: payload, env, reject: false });
  assert.equal(first.exitCode, 0);
  assert.match(first.stdout, /Obsidian vault available/, "first prompt gets the context");

  const second = await execa("node", [hook, vault, "en"], { input: payload, env, reject: false });
  assert.equal(second.exitCode, 0);
  assert.equal(second.stdout, "", "second prompt of the same session injects nothing");

  const noId = await execa("node", [hook, vault, "en"], { input: "{}", env, reject: false });
  assert.equal(noId.exitCode, 0);
  assert.equal(noId.stdout, "", "no session id → no injection (never every-prompt spam)");
});

test("kimiReminders drops the Claude-only lines", () => {
  for (const lang of ["es", "en"]) {
    const text = kimiReminders(lang);
    assert.ok(
      !text.includes("auto-memory") && !text.includes("auto-memoria"),
      "no native-memory line"
    );
    assert.ok(!text.includes("ToolSearch"), "no ToolSearch line");
    assert.ok(text.includes("vault_hybrid_search"), "recall rule stays");
    assert.ok(/guia|guidance/i.test(text), "optional guidance framing stays");
  }
});
