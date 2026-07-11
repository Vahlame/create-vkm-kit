import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeManagedEnv,
  removeManagedEnv,
  mergeManagedPermissions,
  removeManagedPermissions,
  setManagedOutputStyle,
  clearManagedOutputStyle
} from "../src/settings-writers.mjs";

const OTEL_ENV = {
  CLAUDE_CODE_ENABLE_TELEMETRY: "1",
  OTEL_METRICS_EXPORTER: "otlp"
};

test("mergeManagedEnv sets keys, preserves unrelated env vars, never mutates input", () => {
  const existing = { env: { MY_TOKEN: "secret" }, model: "opus" };
  const merged = mergeManagedEnv(existing, OTEL_ENV);
  assert.equal(merged.env.MY_TOKEN, "secret");
  assert.equal(merged.env.CLAUDE_CODE_ENABLE_TELEMETRY, "1");
  assert.equal(merged.env.OTEL_METRICS_EXPORTER, "otlp");
  assert.equal(merged.model, "opus");
  assert.deepEqual(existing.env, { MY_TOKEN: "secret" }); // input untouched
});

test("mergeManagedEnv is idempotent and coerces values to strings", () => {
  const once = mergeManagedEnv({}, { A: 1, B: true });
  const twice = mergeManagedEnv(once, { A: 1, B: true });
  assert.deepEqual(twice.env, { A: "1", B: "true" });
  assert.deepEqual(once, twice);
});

test("mergeManagedEnv tolerates non-object settings and non-object env", () => {
  assert.deepEqual(mergeManagedEnv(null, { A: "1" }).env, { A: "1" });
  assert.deepEqual(mergeManagedEnv({ env: "bogus" }, { A: "1" }).env, { A: "1" });
});

test("removeManagedEnv removes only values still exactly ours (prove-ours principle)", () => {
  const installed = mergeManagedEnv({ env: { MY_TOKEN: "secret" } }, OTEL_ENV);
  // User re-points the exporter afterwards; that key must survive removal.
  installed.env.OTEL_METRICS_EXPORTER = "prometheus";
  const removed = removeManagedEnv(installed, OTEL_ENV);
  assert.equal(removed.env.CLAUDE_CODE_ENABLE_TELEMETRY, undefined);
  assert.equal(removed.env.OTEL_METRICS_EXPORTER, "prometheus");
  assert.equal(removed.env.MY_TOKEN, "secret");
});

test("removeManagedEnv deletes an emptied env section entirely (no trace)", () => {
  const installed = mergeManagedEnv({}, OTEL_ENV);
  const removed = removeManagedEnv(installed, OTEL_ENV);
  assert.equal("env" in removed, false);
});

test("removeManagedEnv is a safe no-op without an env section", () => {
  assert.deepEqual(removeManagedEnv({ model: "opus" }, OTEL_ENV), { model: "opus" });
});

const DENY_RULES = ["Read(node_modules/**)", "Read(**/dist/**)"];

test("mergeManagedPermissions appends deduped rules after the user's own", () => {
  const existing = { permissions: { deny: ["Read(/secrets/**)"], allow: ["Bash(git *)"] } };
  const merged = mergeManagedPermissions(existing, { deny: DENY_RULES });
  assert.deepEqual(merged.permissions.deny, ["Read(/secrets/**)", ...DENY_RULES]);
  assert.deepEqual(merged.permissions.allow, ["Bash(git *)"]); // untouched
  const twice = mergeManagedPermissions(merged, { deny: DENY_RULES });
  assert.deepEqual(twice.permissions.deny, merged.permissions.deny); // idempotent
});

test("mergeManagedPermissions creates the section from scratch", () => {
  const merged = mergeManagedPermissions({}, { deny: DENY_RULES, allow: ["Bash(ls *)"] });
  assert.deepEqual(merged.permissions.deny, DENY_RULES);
  assert.deepEqual(merged.permissions.allow, ["Bash(ls *)"]);
});

test("removeManagedPermissions strips exactly our rules and keeps the user's", () => {
  const merged = mergeManagedPermissions(
    { permissions: { deny: ["Read(/secrets/**)"] } },
    { deny: DENY_RULES }
  );
  const removed = removeManagedPermissions(merged, { deny: DENY_RULES });
  assert.deepEqual(removed.permissions.deny, ["Read(/secrets/**)"]);
});

test("removeManagedPermissions deletes emptied arrays and an emptied section", () => {
  const merged = mergeManagedPermissions({}, { deny: DENY_RULES });
  const removed = removeManagedPermissions(merged, { deny: DENY_RULES });
  assert.equal("permissions" in removed, false);
});

test("removeManagedPermissions is a safe no-op without a permissions section", () => {
  assert.deepEqual(removeManagedPermissions({ model: "opus" }, { deny: DENY_RULES }), {
    model: "opus"
  });
});

test("setManagedOutputStyle sets the style; clear removes only when still ours", () => {
  const set = setManagedOutputStyle({ model: "opus" }, "vkm-terse");
  assert.equal(set.outputStyle, "vkm-terse");
  assert.equal("outputStyle" in clearManagedOutputStyle(set, "vkm-terse"), false);
  // User switched styles afterwards: their choice survives our removal.
  const switched = { ...set, outputStyle: "explanatory" };
  assert.equal(clearManagedOutputStyle(switched, "vkm-terse").outputStyle, "explanatory");
});
