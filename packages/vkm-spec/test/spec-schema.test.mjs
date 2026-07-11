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

test("functionalRequirements bounds mirror the JSON schema (min 3, max 7)", () => {
  assert.equal(SPEC_JSON_SCHEMA.properties.functionalRequirements.minItems, 3);
  assert.equal(SPEC_JSON_SCHEMA.properties.functionalRequirements.maxItems, 7);
  assert.throws(
    () => SpecSchema.parse({ ...sample, functionalRequirements: ["only", "two"] }),
    "fewer than 3 requirements must be rejected"
  );
  assert.throws(
    () =>
      SpecSchema.parse({
        ...sample,
        functionalRequirements: ["1", "2", "3", "4", "5", "6", "7", "8"]
      }),
    "more than 7 requirements must be rejected"
  );
});

test("currentStateSummary max length mirrors the JSON schema (600)", () => {
  assert.equal(SPEC_JSON_SCHEMA.properties.currentStateSummary.maxLength, 600);
  assert.throws(
    () => SpecSchema.parse({ ...sample, currentStateSummary: "x".repeat(601) }),
    "over-length currentStateSummary must be rejected"
  );
  // exactly 600 is allowed
  assert.doesNotThrow(() => SpecSchema.parse({ ...sample, currentStateSummary: "x".repeat(600) }));
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
