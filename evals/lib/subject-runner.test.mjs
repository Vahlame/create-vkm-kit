/**
 * Tests for the cost accounting added in ADR-0065.
 *
 * The property under test is not arithmetic — it is the distinction between
 * **zero** and **unknown**. Every one of these helpers has an obvious wrong
 * implementation that returns 0 for a cost nobody reported, and that wrong
 * implementation would quietly average into a cost claim as "this run was free".
 * A cost that isn't known must stay `null` all the way to the report.
 *
 * `runSubject` itself spawns an agent CLI, so it is exercised here through a real
 * subprocess that impersonates one, not a mock — that also pins the JSON contract
 * the benches actually depend on.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  runSubject,
  aggregateCost,
  costEfficiency,
  formatCost,
  toTelemetryTotals
} from "./subject-runner.mjs";

// A fake agent CLI on disk rather than `node -e`: `runSubject` splits `agentCmd` on
// whitespace, so no argument may contain a space. That is a real constraint of the
// runner (the benches only ever pass `--model <id>`, which is why it never bit), and
// a test that worked around it with an inline script would be testing a path the
// benches don't use.
const AGENT_SRC = `#!/usr/bin/env node
const payload = process.env.FAKE_AGENT_PAYLOAD;
if (payload) console.log(payload);
else console.log("plain text answer");
`;

/** @type {string} */
let agentDir;
/** @type {string} */
let agentCmd;

test.before(() => {
  agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-fake-agent-"));
  const fp = path.join(agentDir, "agent.mjs");
  fs.writeFileSync(fp, AGENT_SRC);
  agentCmd = `node ${fp}`;
});
test.after(() => fs.rmSync(agentDir, { recursive: true, force: true }));

test("runSubject extracts answer, usage and normalized cost from agent JSON", async () => {
  process.env.FAKE_AGENT_PAYLOAD = JSON.stringify({
    result: "the answer",
    num_turns: 4,
    total_cost_usd: 0.0123,
    usage: {
      input_tokens: 1200,
      output_tokens: 300,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 100
    }
  });
  const { answer, usage, cost } = await runSubject({ prompt: "ignored", agentCmd });
  delete process.env.FAKE_AGENT_PAYLOAD;
  assert.equal(answer, "the answer");
  assert.equal(usage.input_tokens, 1200);
  assert.equal(cost.inputTokens, 1200);
  assert.equal(cost.outputTokens, 300);
  assert.equal(cost.cacheReadTokens, 900);
  assert.equal(
    cost.totalTokens,
    1500,
    "cache tokens are billed differently and must not be folded into the total"
  );
  assert.equal(cost.turns, 4);
  assert.equal(cost.costUsd, 0.0123);
  assert.ok(cost.wallClockMs >= 0);
});

test("a CLI that reports no usage yields nulls, never zeros — but wall-clock still works", async () => {
  const { answer, usage, cost } = await runSubject({ prompt: "ignored", agentCmd });
  assert.match(answer, /plain text answer/);
  assert.equal(usage, null);
  assert.equal(cost.totalTokens, null, "unreported is not free");
  assert.equal(cost.inputTokens, null);
  assert.equal(cost.turns, null);
  assert.ok(cost.wallClockMs >= 0, "wall-clock is measured here, so it works for any CLI");
});

test("aggregateCost refuses to average a partially-reported cell", () => {
  const full = aggregateCost([
    { totalTokens: 100, outputTokens: 10, turns: 2, wallClockMs: 1000, costUsd: 0.01 },
    { totalTokens: 200, outputTokens: 20, turns: 4, wallClockMs: 3000, costUsd: 0.02 }
  ]);
  assert.equal(full.n, 2);
  assert.equal(full.meanTotalTokens, 150);
  assert.equal(full.meanTurns, 3);
  assert.equal(full.meanWallClockMs, 2000);
  assert.ok(Math.abs(full.totalCostUsd - 0.03) < 1e-9);

  // One run without tokens must poison the mean rather than halve it: averaging
  // 100 and "unknown" to 50 is a fabricated measurement.
  const partial = aggregateCost([
    { totalTokens: 100, outputTokens: 10, turns: 2, wallClockMs: 1000, costUsd: 0.01 },
    { totalTokens: null, outputTokens: null, turns: null, wallClockMs: 2000, costUsd: null }
  ]);
  assert.equal(partial.meanTotalTokens, null);
  assert.equal(partial.meanWallClockMs, 1500, "wall-clock is complete, so it still aggregates");
});

test("costEfficiency answers 'won, but at what price?'", () => {
  const better = costEfficiency(
    { quality: 90, cost: { meanTotalTokens: 3000 } },
    { quality: 70, cost: { meanTotalTokens: 1000 } }
  );
  assert.equal(better.qualityDelta, 20);
  assert.equal(better.tokenDelta, 2000);
  assert.equal(better.qualityPerKToken, 10, "+20 points bought with 2,000 extra tokens");

  // Same quality gain for free is a materially different result and must read as one.
  const free = costEfficiency(
    { quality: 90, cost: { meanTotalTokens: 1000 } },
    { quality: 70, cost: { meanTotalTokens: 1000 } }
  );
  assert.equal(free.tokenDelta, 0);
  assert.equal(free.qualityPerKToken, null, "no divide-by-zero, and no fake Infinity");

  const unknown = costEfficiency(
    { quality: 90, cost: { meanTotalTokens: null } },
    { quality: 70, cost: { meanTotalTokens: 1000 } }
  );
  assert.equal(unknown.qualityDelta, 20, "quality is still known");
  assert.equal(unknown.tokenDelta, null);
  assert.equal(unknown.qualityPerKToken, null);
});

test("toTelemetryTotals speaks vkm-doctor's exact vocabulary", () => {
  // The join that makes lab cost and real-session cost comparable: these key names
  // are the ones doctor.mjs aggregates OTLP into. If they drift, the comparison
  // silently stops being one.
  const totals = toTelemetryTotals([
    {
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: 900,
      cacheCreationTokens: 50,
      costUsd: 0.01
    },
    {
      inputTokens: 200,
      outputTokens: 20,
      cacheReadTokens: 100,
      cacheCreationTokens: 50,
      costUsd: 0.02
    }
  ]);
  assert.deepEqual(Object.keys(totals).sort(), [
    "cacheCreation",
    "cacheRead",
    "costUSD",
    "input",
    "output"
  ]);
  assert.equal(totals.input, 300);
  assert.equal(totals.cacheRead, 1000);
  assert.equal(totals.cacheCreation, 100);
  assert.ok(Math.abs(totals.costUSD - 0.03) < 1e-9);

  const partial = toTelemetryTotals([{ inputTokens: 100 }, { inputTokens: null }]);
  assert.equal(partial.input, null, "a partially-reported cell stays unknown here too");
});

test("formatCost distinguishes unreported from free", () => {
  assert.match(formatCost(aggregateCost([{ wallClockMs: 1200 }])), /cost=unreported wall=1\.2s/);
  assert.match(
    formatCost(
      aggregateCost([
        { totalTokens: 500, outputTokens: 50, turns: 3, wallClockMs: 2000, costUsd: 0 }
      ])
    ),
    /tok=500 out=50 turns=3\.0 wall=2\.0s/
  );
});
