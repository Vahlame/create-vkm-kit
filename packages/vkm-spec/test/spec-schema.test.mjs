import test from "node:test";
import assert from "node:assert/strict";
import { SpecSchema, SPEC_JSON_SCHEMA } from "../src/spec-schema.mjs";

/** A sample that satisfies SPEC_JSON_SCHEMA by construction — the round-trip anchor. */
const sample = {
  systemRole: "You are a senior TypeScript engineer.",
  userIntent: "Add a rate limiter to the public API gateway.",
  functionalRequirements: [
    "Reject requests over 100/min per IP with HTTP 429",
    "Expose remaining quota in an X-RateLimit-Remaining header",
    "Persist counters in Redis so limits survive a restart"
  ],
  constraints: ["No new runtime dependencies beyond ioredis"],
  currentStateSummary: "Gateway is an Express app; Redis is already provisioned for sessions."
};

test("SpecSchema accepts a sample that SPEC_JSON_SCHEMA describes (round-trip)", () => {
  const parsed = SpecSchema.parse(sample);
  assert.deepEqual(parsed, sample);
});

test("SPEC_JSON_SCHEMA required list matches the zod object keys", () => {
  const zodKeys = Object.keys(SpecSchema.shape).sort();
  const jsonRequired = [...SPEC_JSON_SCHEMA.required].sort();
  const jsonProps = Object.keys(SPEC_JSON_SCHEMA.properties).sort();
  assert.deepEqual(jsonRequired, zodKeys, "required must list every field");
  assert.deepEqual(jsonProps, zodKeys, "properties must cover every field");
});

test("functionalRequirements: JSON schema ASKS 3-7; zod floor accepts 1-12 (no reject-to-fallback)", () => {
  assert.equal(SPEC_JSON_SCHEMA.properties.functionalRequirements.minItems, 3);
  assert.equal(SPEC_JSON_SCHEMA.properties.functionalRequirements.maxItems, 7);
  // Floor: one useful requirement beats a schema_reject -> deterministic fallback.
  assert.doesNotThrow(() => SpecSchema.parse({ ...sample, functionalRequirements: ["only one"] }));
  assert.throws(() => SpecSchema.parse({ ...sample, functionalRequirements: [] }));
  assert.throws(() =>
    SpecSchema.parse({
      ...sample,
      functionalRequirements: Array.from({ length: 13 }, (_, i) => String(i))
    })
  );
});

test("currentStateSummary: JSON schema caps 600; zod TRUNCATES instead of rejecting", () => {
  assert.equal(SPEC_JSON_SCHEMA.properties.currentStateSummary.maxLength, 600);
  const parsed = SpecSchema.parse({ ...sample, currentStateSummary: "x".repeat(700) });
  assert.equal(parsed.currentStateSummary.length, 600);
  // And a missing summary defaults to empty rather than rejecting the draft.
  const { currentStateSummary, ...rest } = sample;
  void currentStateSummary;
  assert.equal(SpecSchema.parse(rest).currentStateSummary, "");
});

test("constraints may be empty (no minItems), matching the JSON schema", () => {
  assert.equal(SPEC_JSON_SCHEMA.properties.constraints.minItems, undefined);
  assert.doesNotThrow(() => SpecSchema.parse({ ...sample, constraints: [] }));
});

test("a wrong shape (missing required field) is rejected", () => {
  const { systemRole, ...missing } = sample;
  void systemRole;
  assert.throws(() => SpecSchema.parse(missing));
});
