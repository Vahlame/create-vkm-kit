/**
 * Self-test of the vkm-spec validator (the spec-bench grader): a grader that can't
 * tell a good spec from a bad one grades nothing. Pins both directions — a reference
 * good spec passes clean, and each seeded defect is caught by name (mutation-style).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { validateSpec } from "../templates/skills/vkm-spec/scripts/validate_spec.mjs";

const GOOD = `# Spec: example

## system_role

Node maintainer extending the installer CLI; no new dependencies.

## user_intent

Users can preview every file the installer would write, so trust comes before writes.

## functional_requirements

1. A --dry-run flag prints each target path with a would-write/would-skip verdict.
2. Dry-run performs zero writes: the tree hash before and after is identical.
3. Exit code is 0 on a clean plan and 2 on a plan containing conflicts.

## constraints

- Managed blocks stay marker-delimited (source: docs/adr/0036-rules-block-diet-and-drift-gate.md)
- Assume POSIX and Windows paths both occur (assumption)

## current_state

The installer writes IDE configs and rules directly; --dry-run exists only for the
skills asset group, not for the whole plan.

## acceptance_criteria

- [ ] Running with --dry-run twice produces byte-identical output and no file changes.
- [ ] A conflicting plan exits 2 and names each conflicting path.
`;

test("reference good spec passes with zero errors", () => {
  const r = validateSpec(GOOD);
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
  assert.equal(r.counts.requirements, 3);
});

const MUTATIONS = [
  {
    name: "missing section",
    mutate: (s) =>
      s.replace(/## current_state[\s\S]*?## acceptance_criteria/, "## acceptance_criteria"),
    expect: /missing or empty section "current_state"/
  },
  {
    name: "multi-line system_role",
    mutate: (s) => s.replace("no new dependencies.", "no new dependencies.\nAlso a second line."),
    expect: /system_role must be ONE line/
  },
  {
    name: "too few requirements",
    mutate: (s) =>
      s.replace(/2\. Dry-run[\s\S]*?identical\.\n/, "").replace(/3\. Exit code.*\n/, ""),
    expect: /found 1 numbered items, need 3–7/
  },
  {
    name: "uncited constraint",
    mutate: (s) =>
      s.replace(
        "- Assume POSIX and Windows paths both occur (assumption)",
        "- Must be fast and clean"
      ),
    expect: /no "\(source: …\)" and no "\(assumption\)"/
  },
  {
    name: "oversized current_state",
    mutate: (s) =>
      s.replace("not for the whole plan.", "not for the whole plan. " + "padding ".repeat(120)),
    expect: /current_state is \d+ chars, max 600/
  },
  {
    name: "vague acceptance criterion",
    mutate: (s) =>
      s.replace(
        "- [ ] A conflicting plan exits 2 and names each conflicting path.",
        "- [ ] The feature works correctly."
      ),
    expect: /replace with a runnable\/observable check/
  }
];

for (const { name, mutate, expect } of MUTATIONS) {
  test(`mutation caught: ${name}`, () => {
    const r = validateSpec(mutate(GOOD));
    assert.equal(r.ok, false, `mutant "${name}" was not rejected`);
    assert.ok(
      r.errors.some((e) => expect.test(e)),
      `no error matched ${expect} — got:\n${r.errors.join("\n")}`
    );
  });
}

test("XML orchestration_package envelope is validated too", () => {
  const xml = `<orchestration_package>
  <system_role>Go maintainer of the daemon</system_role>
  <user_intent>Doctor should alarm on stale heartbeats so silent death is visible.</user_intent>
  <functional_requirements>
    <req id="1">doctor exits non-zero when the heartbeat is older than 5 minutes.</req>
    <req id="2">The threshold is configurable via env, clamped to 1-60 minutes.</req>
    <req id="3">Output names the state file path it read.</req>
  </functional_requirements>
  <constraints>
    <constraint source="docs/adr/0012-go-daemon-cross-platform.md">No new runtime deps.</constraint>
  </constraints>
  <current_state>doctor prints heartbeat age but always exits 0.</current_state>
  <acceptance_criteria>
    <criterion>With a 10-minute-old heartbeat, doctor exits 1.</criterion>
    <criterion>With a fresh heartbeat, doctor exits 0.</criterion>
  </acceptance_criteria>
</orchestration_package>`;
  const r = validateSpec(xml);
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
});
