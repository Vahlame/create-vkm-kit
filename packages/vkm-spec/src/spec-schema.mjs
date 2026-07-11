/**
 * The contract for the LLM-draftable fields ONLY — the subset of the compiled prompt an
 * Ollama draft pass is allowed to fill in (system role, sharpened intent, requirements,
 * constraints, distilled current-state). Everything else in the <orchestration_package>
 * (tech stack, historical decisions, active patterns) comes verbatim from the vault
 * retrieval buckets and is NOT model-authored, so it stays out of this schema.
 *
 * Two representations, kept deliberately in lockstep by a round-trip test:
 *  - `SpecSchema` — the zod schema, used to VALIDATE whatever the model returns before it's
 *    ever trusted (a model that hallucinates a wrong shape is rejected → deterministic
 *    fallback).
 *  - `SPEC_JSON_SCHEMA` — the equivalent plain JSON-Schema object literal. Ollama's
 *    structured-output `format` param takes raw JSON Schema, not a zod object, so this is
 *    hand-written (no zod-to-json-schema dependency — ADR-0047 keeps the dep surface thin).
 */
import { z } from "zod";

/**
 * The model-authored slice of the spec. Field notes:
 *  - `userIntent` is a SHARPENED restatement of the raw idea, not a verbatim copy.
 *  - `functionalRequirements` are concrete + testable, 3-7 of them (fewer is usually
 *    under-specified; more belongs in a real design doc, not a prompt preamble).
 *  - `currentStateSummary` is distilled from the provided vault context, capped so it can't
 *    balloon into a note dump.
 */
export const SpecSchema = z.object({
  systemRole: z.string().min(1),
  userIntent: z.string().min(1),
  functionalRequirements: z.array(z.string().min(1)).min(3).max(7),
  constraints: z.array(z.string().min(1)),
  currentStateSummary: z.string().max(600)
});

/**
 * Plain JSON-Schema mirror of {@link SpecSchema}, passed straight to Ollama's `format`
 * param. Kept structurally equivalent to the zod schema by `spec-schema.test.mjs` (which
 * builds a sample this schema describes and asserts the zod schema accepts it).
 */
export const SPEC_JSON_SCHEMA = {
  type: "object",
  properties: {
    systemRole: { type: "string" },
    userIntent: { type: "string" },
    functionalRequirements: {
      type: "array",
      items: { type: "string" },
      minItems: 3,
      maxItems: 7
    },
    constraints: {
      type: "array",
      items: { type: "string" }
    },
    currentStateSummary: { type: "string", maxLength: 600 }
  },
  required: [
    "systemRole",
    "userIntent",
    "functionalRequirements",
    "constraints",
    "currentStateSummary"
  ]
};
