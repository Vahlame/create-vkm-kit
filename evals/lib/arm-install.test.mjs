import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { ARMS, ArmMismatchError, buildArm, diffLayers, probeArm } from "./arm-install.mjs";
import { levelBody, memoryRulesBlock } from "../../packages/create-vkm-kit/src/memory-rules.mjs";

/**
 * A fake installed HOME, so the probe is testable without a 10-second install.
 * @param {{profile?: "minimal"|"standard"|"full", skills?: string[], subagent?: boolean,
 *          hooks?: string[], outputStyle?: string, mcp?: string[]}} [opts]
 */
function fakeHome({
  profile,
  skills = [],
  subagent = false,
  hooks = [],
  outputStyle,
  mcp = []
} = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-armtest-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-armtest-cwd-"));
  const cd = path.join(home, ".claude");
  fs.mkdirSync(cd, { recursive: true });
  if (profile) fs.writeFileSync(path.join(cd, "CLAUDE.md"), memoryRulesBlock("es", profile));
  for (const s of skills) fs.mkdirSync(path.join(cd, "skills", s), { recursive: true });
  if (subagent) {
    fs.mkdirSync(path.join(cd, "agents"), { recursive: true });
    fs.writeFileSync(path.join(cd, "agents", "vkm-implementer.md"), "x");
  }
  fs.writeFileSync(
    path.join(cd, "settings.json"),
    JSON.stringify({
      outputStyle,
      hooks: hooks.length
        ? {
            PreToolUse: [
              {
                matcher: "*",
                hooks: hooks.map((h) => ({
                  type: "command",
                  command: "node",
                  args: [`${cd}/hooks/${h}`, "arg"]
                }))
              }
            ]
          }
        : undefined
    })
  );
  if (mcp.length)
    fs.writeFileSync(
      path.join(home, ".claude.json"),
      JSON.stringify({ mcpServers: Object.fromEntries(mcp.map((m) => [m, {}])) })
    );
  return {
    home,
    cwd,
    cleanup: () => [home, cwd].forEach((d) => fs.rmSync(d, { recursive: true, force: true }))
  };
}

test("probe reads rule levels from the block the installer actually ships", () => {
  /** @type {[("minimal"|"standard"|"full"), string[]][]} */
  const cases = [
    ["minimal", ["core"]],
    ["standard", ["core", "memory"]],
    ["full", ["core", "memory", "doctrine"]]
  ];
  for (const [profile, want] of cases) {
    const f = fakeHome({ profile });
    assert.deepEqual(probeArm(f.home, f.cwd).rules, want, profile);
    f.cleanup();
  }
});

test("level markers are derived from memory-rules, so a renamed heading cannot go unnoticed", () => {
  // The probe keys off levelBody's first line. If that stopped being a stable, unique
  // heading, every arm would silently report a smaller composition than it carries.
  const heads = /** @type {const} */ (["core", "memory", "doctrine"]).map((l) =>
    levelBody(l, "es").split("\n")[0].trim()
  );
  assert.equal(new Set(heads).size, 3, "level heads must be distinct");
  for (const h of heads) assert.match(h, /^### \S/, `not a heading: ${h}`);
});

test("hooks are read through `args`, not `command` — the kit spells them {command:'node', args:[script]}", () => {
  const f = fakeHome({ hooks: ["guard-effort-gate.mjs", "stop-vault-close-reminder.mjs"] });
  // Reading `command` alone yields "node" for every hook and an empty list after
  // filtering for script names; this asserts the real spelling is understood.
  assert.deepEqual(probeArm(f.home, f.cwd).hooks, [
    "guard-effort-gate.mjs",
    "stop-vault-close-reminder.mjs"
  ]);
  f.cleanup();
});

test("probe reports the remaining layers", () => {
  const f = fakeHome({
    profile: "full",
    skills: ["vkm-discipline", "vkm-spec"],
    subagent: true,
    outputStyle: "vkm-terse",
    mcp: ["basic-memory", "obsidian-memory-hybrid"]
  });
  const l = probeArm(f.home, f.cwd);
  assert.deepEqual(l.skills, ["vkm-discipline", "vkm-spec"]);
  assert.equal(l.subagent, true);
  assert.equal(l.outputStyle, "vkm-terse");
  assert.deepEqual(l.mcp, ["basic-memory", "obsidian-memory-hybrid"]);
  assert.ok(l.rulesChars > 0);
  f.cleanup();
});

test("an empty HOME probes as the control arm, with rulesChars 0 rather than absent", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-armtest-empty-"));
  const l = probeArm(home, home);
  assert.deepEqual(l, {
    rules: [],
    rulesChars: 0,
    skills: [],
    subagent: false,
    hooks: [],
    outputStyle: null,
    mcp: []
  });
  fs.rmSync(home, { recursive: true, force: true });
});

test("diffLayers: exact sets for arrays, `true` means non-empty, order does not matter", () => {
  const got = {
    rules: ["core", "memory"],
    skills: ["a"],
    hooks: [],
    subagent: false,
    outputStyle: null,
    mcp: [],
    rulesChars: 10
  };
  assert.deepEqual(diffLayers({ rules: ["memory", "core"] }, got), []);
  assert.deepEqual(diffLayers({ skills: true }, got), []);
  assert.equal(
    diffLayers({ rules: ["core"] }, got).length,
    1,
    "a subset must not satisfy an exact set"
  );
  assert.equal(diffLayers({ hooks: true }, got).length, 1, "empty must not satisfy non-empty");
  assert.equal(diffLayers({ outputStyle: "vkm-terse" }, got).length, 1);
});

test("undeclared layers are not checked — an arm asserts what it is about", () => {
  const got = {
    rules: ["core"],
    skills: ["a", "b"],
    hooks: ["x"],
    subagent: true,
    outputStyle: "z",
    mcp: [],
    rulesChars: 1
  };
  assert.deepEqual(diffLayers({ rules: ["core"] }, got), []);
});

test("every declared arm names layers the probe can actually return", () => {
  const known = new Set([
    "rules",
    "rulesChars",
    "skills",
    "subagent",
    "hooks",
    "outputStyle",
    "mcp"
  ]);
  for (const [name, spec] of Object.entries(ARMS))
    for (const k of Object.keys(spec.expect ?? {}))
      assert.ok(known.has(k), `arm ${name} declares unknown layer ${k}`);
});

test("the control arm declares every layer absent — otherwise it is not a control", () => {
  const e = ARMS.off.expect;
  assert.deepEqual(e.rules, []);
  assert.deepEqual(e.skills, []);
  assert.deepEqual(e.hooks, []);
  assert.deepEqual(e.mcp, []);
  assert.equal(e.subagent, false);
  assert.equal(e.outputStyle, null);
});

test(
  "THE TRAP: reusing the e2e-smoke flags as a 'kit installed' arm throws",
  { timeout: 300_000 },
  (t) => {
    // scripts/e2e-smoke.mjs:60 and scripts/harness-matrix.mjs:127 both install with
    // `--minimal --no-skills --no-agents`. Naively reused as the treatment arm of a
    // behavioural bench, that subject is missing the entire layer under test, and the
    // resulting null reads as "the kit changes nothing".
    //
    // This is the module's reason to exist, so it is executed, not asserted about.
    /** @type {import("./arm-install.mjs").ArmSpec} */
    const spec = {
      label: "e2e-smoke flags, mislabelled as a full install",
      args: ["--ide", "none", "--minimal", "--no-skills", "--no-agents"],
      expect: { rules: ["core", "memory", "doctrine"], skills: true }
    };
    let err;
    try {
      buildArm(spec).cleanup();
    } catch (e) {
      err = e;
    }
    if (!err) t.diagnostic("build unexpectedly succeeded");
    assert.ok(err instanceof ArmMismatchError, `expected ArmMismatchError, got ${err}`);
    assert.deepEqual(
      err.diffs.map((d) => d.layer).sort(),
      ["rules", "skills"],
      "both the rules block and the skills layer must be reported missing"
    );
  }
);
