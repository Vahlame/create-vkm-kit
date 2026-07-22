/**
 * Resilience contract of the deep-research scheduler (the fix for the observed live failure:
 * job deep-mrvnd4nz-e30773d5 died `state:"failed"` at 3.7 min of a 30-min budget after three
 * consecutive search errors, with 4 of 6 seeds never researched and 7 pendingLeads dropped).
 *
 * Same harness as deep-research.test.mjs (fake clock, injected deps, zero real network —
 * copied, not imported: each test file owns its fixtures). What is proven here:
 *
 *   1. a thrown search error re-enqueues the item at the END of the frontier and the job
 *      recovers to "done" once the retry succeeds — no fatal-after-N-consecutive-errors;
 *   2. a streak of suspension-classified errors parks the job in a global exponential
 *      cooldown (visible as `cooldownUntil` in the snapshot, counted in totals.cooldowns),
 *      and a job whose every round failed ends "failed" with a background-appropriate error —
 *      never serp.mjs's interactive "Fall back to the native WebSearch tool" advice;
 *   3. useful rounds + a suspension the remaining budget can't wait out end "done-partial"
 *      with the leftovers resumable (pendingLeads + a Resume section in the run report);
 *   4. stopResearchJob during a cooldown is honored within one slice, not after the full wait.
 */
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import {
  startResearchJob,
  getResearchJob,
  stopResearchJob,
  clearResearchJobs
} from "../src/deep-research.mjs";

beforeEach(() => {
  clearResearchJobs();
});

/** Fake clock: `now` reads it, `sleepImpl` advances it and resolves immediately. */
function makeClock(start = 0) {
  let t = start;
  const sleeps = [];
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
    sleeps,
    sleepImpl: async (ms) => {
      sleeps.push(ms);
      t += ms;
    }
  };
}

/** Poll `getResearchJob` on a real macrotask tick until the job leaves "running". */
async function waitForDone(id, maxTicks = 2000) {
  for (let i = 0; i < maxTicks; i++) {
    const snap = getResearchJob(id);
    if (snap && snap.state !== "running") return snap;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`job ${id} did not finish within ${maxTicks} ticks`);
}

function makeReportCapture() {
  const calls = [];
  const reportImpl = async ({ topic, content, researchDir }) => {
    calls.push({ topic, content, researchDir });
    return { path: `/fake/RESEARCH/${topic}/runs/report.md`, filename: "report.md" };
  };
  return { calls, reportImpl };
}

const okEnsure = async () => "http://fake-searxng";
const okCovered = async () => new Set();
const okLeads = async () => ({ leads: [] });
const okPersist = async ({ results }) => ({
  written: (results ?? []).filter((r) => r && r.url).length,
  updated: 0
});

/** The exact round-error text of the observed live failure — classifies as suspension
 * (two signals: "every source failed", "0 results parsed"). */
const LIVE_SUSPENSION_ERROR =
  "obscura_research: obscura_search: every source failed or returned nothing " +
  "(duckduckgo: 0 results parsed). Fall back to the native WebSearch tool for this query.";

const healthyRound = (query) => ({
  source: "searxng",
  scanned: 3,
  fetched: 1,
  results: [{ title: query, url: `https://ok.example/${query}`, relevant: true, relevance: 7 }]
});

function deps(clock, reportImpl, researchImpl, extra = {}) {
  return {
    researchImpl,
    persistImpl: okPersist,
    coveredHashesImpl: okCovered,
    reportImpl,
    leadsImpl: okLeads,
    ensureImpl: okEnsure,
    now: clock.now,
    sleepImpl: clock.sleepImpl,
    ...extra
  };
}

test("a thrown search error re-enqueues the item at the END; the retry succeeds and the job ends done", async () => {
  const clock = makeClock();
  const { reportImpl } = makeReportCapture();
  let s1Calls = 0;
  const researchImpl = async (query) => {
    if (query === "s1" && ++s1Calls === 1) throw new Error("boom: transient search failure");
    return healthyRound(query);
  };

  const { id } = startResearchJob(
    { objective: "obj", topics: ["s1", "s2"], topic: "retry-topic", maxDepth: 0, paceMs: 0 },
    deps(clock, reportImpl, researchImpl)
  );

  const snap = await waitForDone(id);
  assert.equal(snap.state, "done");
  assert.equal(snap.stoppedReason, "frontier_empty");
  assert.deepEqual(
    snap.rounds.map((r) => r.query),
    ["s1", "s2", "s1"],
    "the failed s1 went to the END of the frontier, behind s2"
  );
  assert.match(snap.rounds[0].error, /boom/);
  assert.equal(snap.rounds[0].attempt, 1);
  assert.equal(snap.rounds[0].requeued, true);
  assert.equal(snap.totals.retries, 1);
  assert.equal(snap.totals.cooldowns, 0, "one generic error must not trigger a cooldown");
  assert.equal(snap.totals.usefulRounds, 2);
  assert.equal(snap.totals.abandoned, 0);
  assert.equal(snap.error, undefined);
});

test("persistent suspension: exponential cooldowns (visible cooldownUntil), bounded attempts, final state failed with a background-appropriate error", async () => {
  const clock = makeClock();
  const { calls: reportCalls, reportImpl } = makeReportCapture();
  const researchImpl = async () => {
    throw new Error(LIVE_SUSPENSION_ERROR);
  };

  const cooldownSnapshots = [];
  let id;
  const sleepImpl = async (ms) => {
    // Observe the job's own snapshot mid-sleep: during a cooldown slice `cooldownUntil` must
    // be a real timestamp, which is what a status poll would show the agent.
    const snap = id ? getResearchJob(id) : null;
    if (snap) cooldownSnapshots.push(snap.cooldownUntil);
    clock.sleeps.push(ms);
    clock.advance(ms);
  };

  ({ id } = startResearchJob(
    {
      objective: "obj",
      topics: ["s1", "s2"],
      topic: "all-fail-topic",
      maxDepth: 0,
      paceMs: 0,
      cooldownMs: 60_000
    },
    deps(clock, reportImpl, researchImpl, { sleepImpl })
  ));

  const snap = await waitForDone(id);
  assert.equal(snap.state, "failed");
  assert.equal(snap.stoppedReason, "frontier_empty", "the frontier drained through attempts");
  assert.equal(snap.totals.usefulRounds, 0);
  assert.equal(snap.roundsTotal, 6, "2 seeds x MAX_ITEM_ATTEMPTS(3) error rounds");
  assert.equal(snap.totals.retries, 4);
  assert.equal(snap.totals.abandoned, 2);
  assert.equal(snap.totals.cooldowns, 2);
  // Exponential: 60s then 120s, slept in <=5s stop-responsive slices, nothing else slept.
  assert.equal(clock.sleeps.reduce((a, b) => a + b, 0), 180_000);
  assert.ok(clock.sleeps.every((ms) => ms <= 5_000));
  assert.ok(
    cooldownSnapshots.some((c) => typeof c === "string"),
    "cooldownUntil was visible in the snapshot during the wait"
  );
  assert.equal(snap.cooldownUntil, null, "cleared once the job finished");

  // The job-level error is written for a BACKGROUND job: no interactive-tool advice.
  assert.match(snap.error, /engines suspended or rate-limited/);
  assert.match(snap.error, /every source failed/);
  assert.doesNotMatch(snap.error, /Fall back to the native WebSearch tool/);
  // The per-round evidence keeps the verbatim message.
  assert.match(snap.rounds[0].error, /Fall back to the native WebSearch tool/);

  assert.equal(snap.abandonedQueries.length, 2);
  assert.deepEqual(
    snap.abandonedQueries.map((a) => a.query).sort(),
    ["s1", "s2"]
  );

  const report = reportCalls[0].content;
  assert.match(report, /outcome: "failed"/);
  assert.match(report, /## Abandoned after retries/);
  assert.match(report, /Resume: pass the queries above as `topics`/);
});

test("useful rounds + a suspension the budget cannot wait out => done-partial with resumable leftovers", async () => {
  const clock = makeClock();
  const { calls: reportCalls, reportImpl } = makeReportCapture();
  const researchImpl = async (query) => {
    if (query === "s1") return healthyRound(query);
    throw new Error(LIVE_SUSPENSION_ERROR);
  };

  const { id } = startResearchJob(
    {
      objective: "obj",
      topics: ["s1", "s2", "s3"],
      topic: "partial-topic",
      maxDepth: 0,
      paceMs: 0,
      budgetMs: 60_000,
      cooldownMs: 60_000
    },
    deps(clock, reportImpl, researchImpl)
  );

  const snap = await waitForDone(id);
  // s1 banked a useful round; s2+s3 hit the suspension streak, and a 60s cooldown does not fit
  // inside what is left of the 60s budget — graceful end, never "failed".
  assert.equal(snap.state, "done-partial");
  assert.equal(snap.stoppedReason, "engines_suspended");
  assert.equal(snap.totals.usefulRounds, 1);
  assert.equal(snap.totals.cooldowns, 0, "the cooldown was refused, not slept");
  assert.equal(snap.error, undefined);
  assert.ok(snap.budgetUnusedMs > 0, "the honest gap: budget the job never got to use");
  assert.deepEqual(
    snap.pendingLeads.map((l) => l.query).sort(),
    ["s2", "s3"],
    "the unexplored seeds are reported as resumable pending leads"
  );

  const report = reportCalls[0].content;
  assert.match(report, /outcome: "done-partial"/);
  assert.match(report, /- \(seed\) s2/);
  assert.match(report, /Resume: pass the queries above as `topics`/);
});

test("stopResearchJob during a cooldown is honored within one slice, not after the full wait", async () => {
  const clock = makeClock();
  const { reportImpl } = makeReportCapture();
  const researchImpl = async () => {
    throw new Error(LIVE_SUSPENSION_ERROR);
  };

  let id;
  const sleepImpl = async (ms) => {
    clock.sleeps.push(ms);
    clock.advance(ms);
    // First sleep of the run IS the first cooldown slice (paceMs 0 never sleeps): stop here.
    if (clock.sleeps.length === 1) stopResearchJob(id);
  };

  ({ id } = startResearchJob(
    {
      objective: "obj",
      topics: ["s1", "s2"],
      topic: "stop-in-cooldown-topic",
      maxDepth: 0,
      paceMs: 0,
      cooldownMs: 60_000
    },
    deps(clock, reportImpl, researchImpl, { sleepImpl })
  ));

  const snap = await waitForDone(id);
  assert.equal(snap.state, "stopped");
  assert.equal(snap.stoppedReason, "stop_requested");
  assert.equal(snap.totals.cooldowns, 1);
  assert.equal(clock.sleeps.length, 1, "one 5s slice, not twelve — the stop cut the wait short");
  assert.equal(snap.cooldownUntil, null);
});
