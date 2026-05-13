import test from "node:test";
import assert from "node:assert/strict";
import { logMcpTurn } from "../src/telemetry.mjs";

test("logMcpTurn does not throw", () => {
  assert.doesNotThrow(() => logMcpTurn({}, { "memory.scope": "vault", "vault.file": "MEMORY.md" }));
});
