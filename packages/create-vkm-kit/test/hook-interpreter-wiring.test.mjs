import { strict as assert } from "node:assert";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  configureClaudeNativeMemory,
  hookCommand,
  guardHookCommand,
  stopHookCommand,
  effortGateHookCommand
} from "../src/claude-native-memory.mjs";
import { compactHookCommand, configureTokenSaver } from "../src/token-saver.mjs";
import { configureTelemetry } from "../src/telemetry.mjs";
import {
  packagedRunHidden,
  installedRunHidden,
  installRunHidden
} from "../src/runhidden-setup.mjs";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

function tempHome() {
  return mkdtempSync(path.join(tmpdir(), "vkm-interp-"));
}

/** Every `command` string across every event in a settings.json hook map. */
function hookCommands(settings) {
  return Object.values(settings.hooks ?? {})
    .flat()
    .flatMap((group) => group.hooks ?? [])
    .map((h) => h.command);
}

// ── the factories are pure ─────────────────────────────────────────────────────────────────────
//
// The bug this pins: a factory that resolves its own interpreter produces a DIFFERENT settings.json
// depending on whether a file happens to exist in the current user's ~/.claude — including when the
// caller is installing into an entirely different home. One of the four was left calling the probe
// internally and another was left never being passed the answer at all, so the PreToolUse effort
// gate — the hottest guard there is — kept being wired to bare `node`.

test("every hook factory emits the interpreter it is given, none resolves its own", () => {
  const interpreter = String.raw`D:\claude\bin\vkm-runhidden.exe`;

  const entries = [
    hookCommand("/h/session.mjs", "/vault", "es", interpreter),
    guardHookCommand("/h/guard.mjs", "/claude", "es", interpreter),
    stopHookCommand("/h/stop.mjs", "es", interpreter),
    effortGateHookCommand("/h/effort.mjs", "es", interpreter),
    compactHookCommand("/h/compact.mjs", interpreter)
  ];

  for (const entry of entries) {
    assert.equal(entry.command, interpreter, `factory ignored its interpreter: ${entry.args?.[0]}`);
  }
});

test("the factories default to plain node rather than probing the filesystem", () => {
  assert.equal(hookCommand("/h/session.mjs", "/vault").command, "node");
  assert.equal(guardHookCommand("/h/guard.mjs", "/claude").command, "node");
  assert.equal(stopHookCommand("/h/stop.mjs").command, "node");
  assert.equal(effortGateHookCommand("/h/effort.mjs").command, "node");
  assert.equal(compactHookCommand("/h/compact.mjs").command, "node");
});

test("hookInterpreter() is called only at the composition roots, never inside a factory", () => {
  // A source scan, deliberately: the property is "no module in src/ probes the filesystem while
  // building a hook entry", and no behavioural test can observe the absence of a call.
  const callers = [];
  for (const file of ["claude-native-memory.mjs", "token-saver.mjs", "telemetry.mjs"]) {
    const src = readFileSync(path.join(SRC, file), "utf8");
    for (const line of src.split("\n")) {
      // Skip prose: these modules document the rule in their own comments.
      if (/^\s*(\*|\/\/)/.test(line)) continue;
      if (/\bhookInterpreter\s*\(/.test(line)) callers.push({ file, line: line.trim() });
    }
  }

  assert.equal(callers.length, 3, `expected one probe per module, got ${JSON.stringify(callers)}`);
  for (const { file, line } of callers) {
    assert.match(
      line,
      /^const interpreter = hookInterpreter\(claudeDir\);$/,
      `${file}: the probe must be the composition root's single call, resolved with the caller's claudeDir`
    );
  }
});

// ── the installed config points at something that exists ───────────────────────────────────────

test("every hook entry the installer writes names an interpreter that is on disk", async () => {
  const home = tempHome();
  const launcher = installedRunHidden(home);
  if (process.platform === "win32") {
    // Stand-in for the packaged binary: this test is about the WIRING, and must run on a machine
    // that has never built Go. The end-to-end test below is the one that needs a real launcher.
    mkdirSync(path.dirname(launcher), { recursive: true });
    writeFileSync(launcher, "not really an exe");
  }

  await configureClaudeNativeMemory(home, path.join(home, "vault"), false, { lang: "en" });
  await configureTokenSaver(home, false);

  const settings = JSON.parse(readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));
  const commands = hookCommands(settings);
  assert.ok(commands.length >= 5, `expected the managed hooks, got ${JSON.stringify(commands)}`);

  for (const command of commands) {
    if (command === "node") {
      assert.notEqual(
        process.platform,
        "win32",
        "a Windows install with the launcher present still wired a hook to bare `node`"
      );
      continue;
    }
    assert.ok(existsSync(command), `hook interpreter does not exist: ${command}`);
    assert.equal(command, launcher);
  }
});

test("telemetry writes its sink hook with the same interpreter as the rest", async () => {
  const home = tempHome();
  const launcher = installedRunHidden(home);
  if (process.platform === "win32") {
    mkdirSync(path.dirname(launcher), { recursive: true });
    writeFileSync(launcher, "not really an exe");
  }
  const kitRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

  await configureTelemetry(home, false, { enable: true, kitRoot });

  const settings = JSON.parse(readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));
  const expected = process.platform === "win32" ? launcher : "node";
  for (const command of hookCommands(settings)) assert.equal(command, expected);
});

test("installRunHidden is a no-op off Windows and idempotent on it", async () => {
  const home = tempHome();

  const first = await installRunHidden(home, false);
  const second = await installRunHidden(home, false);

  assert.equal(first, second, "a second install disagreed with the first");
  if (process.platform !== "win32") {
    assert.equal(first, null, "installed a Windows launcher on a platform that has no consoles");
  } else if (existsSync(packagedRunHidden())) {
    assert.equal(first, installedRunHidden(home));
    assert.ok(existsSync(first), "reported an install that produced no file");
  }
});

// ── the launcher end to end ────────────────────────────────────────────────────────────────────

test("a hook's exit code survives the trip through the real launcher", (t) => {
  const launcher = packagedRunHidden();
  if (process.platform !== "win32" || !existsSync(launcher)) {
    // Never silently green: CI's Windows leg builds the binary first (ci.yml), so a skip here is
    // a local checkout without Go, not a gap in coverage.
    t.skip(`no launcher at ${launcher} (build it with: npm run build:runhidden)`);
    return;
  }

  const home = tempHome();
  const hook = path.join(home, "blocking-hook.mjs");
  // The shape a PreToolUse guard has: read the event on stdin, refuse, exit non-zero.
  writeFileSync(hook, 'process.stdout.write("denied");\nprocess.exit(2);\n');

  const direct = spawnSync(process.execPath, [hook], { input: "{}", encoding: "utf8" });
  const viaLauncher = spawnSync(launcher, [hook], { input: "{}", encoding: "utf8" });

  assert.equal(direct.status, 2, "the fixture hook itself did not exit 2");
  assert.equal(
    viaLauncher.status,
    2,
    `the launcher swallowed the guard's verdict (stderr: ${viaLauncher.stderr})`
  );
  assert.equal(viaLauncher.stdout, "denied", "stdout was not proxied verbatim");
});
