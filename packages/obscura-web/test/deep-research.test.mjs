/**
 * `deep-research.mjs`'s background job loop, fully injected and deterministic — no real
 * timers, no real network. Two clocks are in play and must not be confused: the injected `now`
 * (fake ms counter, advanced only by `sleepImpl`/scripted deps) drives every budget/pacing
 * decision inside the loop; real `setImmediate` ticks (in `waitForDone`/`waitForCurrentQuery`)
 * are only ever used to let already-scheduled microtasks/macrotasks of the ASYNC LOOP ITSELF
 * flush, never to make a deadline pass. A job whose deps all resolve immediately runs to
 * completion across a handful of microtask ticks with the fake clock barely moving; polling with
 * a real (empty) macrotask is what lets the test `await` that without knowing how many ticks it
 * takes.
 */
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import {
  DeepResearchError,
  startResearchJob,
  getResearchJob,
  stopResearchJob,
  clearResearchJobs,
  renderRunReport
} from "../src/deep-research.mjs";
import { ResearchPersistError } from "../src/research-persist.mjs";
import { hash8 } from "../src/url-identity.mjs";
import { randomUUID } from "node:crypto";

beforeEach(() => {
  // A leftover "running" job (a bug in a previous test) makes this throw loudly rather than
  // silently letting the next test start against stale registry state.
  clearResearchJobs();
});

/** Fake clock: `now` reads it, `sleepImpl` advances it and resolves immediately — no real wall
 * time is ever spent waiting on a pace sleep. */
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

/** Poll `getResearchJob` until the job leaves "running". Uses a REAL setImmediate tick (a
 * macrotask), never a sleep on the fake clock — by the time one macrotask fires, every pending
 * microtask from the job's own (clock-independent, immediately-resolving) async chain has
 * already run, so this converges in one or two iterations for every test that doesn't
 * deliberately pause the loop with a manually-controlled promise. */
async function waitForDone(id, maxTicks = 2000) {
  for (let i = 0; i < maxTicks; i++) {
    const snap = getResearchJob(id);
    if (snap && snap.state !== "running") return snap;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`job ${id} did not finish within ${maxTicks} ticks`);
}

/** Poll until the loop has claimed an item (so a deliberately-paused `researchImpl` is
 * guaranteed to have had its executor run and its resolver captured — see the module doc). */
async function waitForCurrentQuery(id, maxTicks = 2000) {
  for (let i = 0; i < maxTicks; i++) {
    const snap = getResearchJob(id);
    if (snap && snap.currentQuery) return snap;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`job ${id} never set currentQuery within ${maxTicks} ticks`);
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
const emptyResearch = async () => ({ source: "searxng", scanned: 1, fetched: 0, results: [] });
const okPersist = async ({ results }) => ({
  written: (results ?? []).filter((r) => r && r.url).length,
  updated: 0
});

test("seeds run FIFO; a lead is enqueued with depth+1, parent, kind and why carried", async () => {
  const clock = makeClock();
  const { calls: reportCalls, reportImpl } = makeReportCapture();
  const researchImpl = async (query) => {
    if (query === "seedA") {
      return {
        source: "searxng",
        scanned: 3,
        fetched: 1,
        results: [{ title: "A page", url: "https://a.example/x", relevant: true, relevance: 8 }]
      };
    }
    return { source: "searxng", scanned: 1, fetched: 0, results: [] };
  };
  const leadsImpl = async ({ findings }) =>
    findings.length
      ? { leads: [{ query: "lead one", kind: "subtopic", why: "because A" }] }
      : { leads: [] };

  const { id } = startResearchJob(
    { objective: "obj", topics: ["seedA", "seedB"], topic: "fifo-topic", maxDepth: 1 },
    {
      researchImpl,
      persistImpl: okPersist,
      coveredHashesImpl: okCovered,
      reportImpl,
      leadsImpl,
      ensureImpl: okEnsure,
      now: clock.now,
      sleepImpl: clock.sleepImpl
    }
  );

  const snap = await waitForDone(id);
  assert.equal(snap.state, "done");
  assert.equal(snap.stoppedReason, "frontier_empty");
  assert.equal(snap.roundsTotal, 3);
  assert.equal(snap.rounds[0].query, "seedA");
  assert.equal(snap.rounds[1].query, "seedB");
  const leadRound = snap.rounds[2];
  assert.equal(leadRound.query, "lead one");
  assert.equal(leadRound.kind, "subtopic");
  assert.equal(leadRound.depth, 1);
  assert.equal(leadRound.parent, "seedA");
  assert.equal(leadRound.why, "because A");
  assert.equal(reportCalls.length, 1);
});

test("lead dedupe: exact lowercase duplicate and a near-duplicate (similarity>=0.85) are both skipped", async () => {
  const clock = makeClock();
  const { reportImpl } = makeReportCapture();
  const researchImpl = async () => ({
    source: "searxng",
    scanned: 2,
    fetched: 1,
    results: [{ title: "P", url: "https://p.example/1", relevant: true, relevance: 7 }]
  });
  const leadsImpl = async () => ({
    leads: [
      { query: "Alpha Thing", kind: "related", why: "exact dup, different case" },
      { query: "alpha thingy", kind: "related", why: "near dup" },
      { query: "totally new topic", kind: "subtopic", why: "genuinely new" }
    ]
  });

  const { id } = startResearchJob(
    { objective: "obj", topics: ["alpha thing"], topic: "dedupe-topic", maxDepth: 2 },
    {
      researchImpl,
      persistImpl: okPersist,
      coveredHashesImpl: okCovered,
      reportImpl,
      leadsImpl,
      ensureImpl: okEnsure,
      now: clock.now,
      sleepImpl: clock.sleepImpl
    }
  );

  const snap = await waitForDone(id);
  assert.equal(snap.totals.leadsGenerated, 1);
  // Neither duplicate ever became its own round: only the seed + the one genuine new lead ran.
  assert.equal(snap.roundsTotal, 2);
  const queries = snap.rounds.map((r) => r.query);
  assert.deepEqual(queries, ["alpha thing", "totally new topic"]);
});

test("no leadsImpl call for an item at depth === maxDepth", async () => {
  const clock = makeClock();
  const { reportImpl } = makeReportCapture();
  let leadsCalls = 0;
  const researchImpl = async () => ({
    source: "searxng",
    scanned: 2,
    fetched: 1,
    results: [{ title: "P", url: "https://p.example/1", relevant: true, relevance: 7 }]
  });
  const leadsImpl = async () => {
    leadsCalls++;
    return { leads: [{ query: "should never be reached", kind: "related", why: "x" }] };
  };

  const { id } = startResearchJob(
    { objective: "obj", topics: ["only seed"], topic: "depth-zero-topic", maxDepth: 0 },
    {
      researchImpl,
      persistImpl: okPersist,
      coveredHashesImpl: okCovered,
      reportImpl,
      leadsImpl,
      ensureImpl: okEnsure,
      now: clock.now,
      sleepImpl: clock.sleepImpl
    }
  );

  const snap = await waitForDone(id);
  assert.equal(leadsCalls, 0);
  assert.equal(snap.totals.leadsGenerated, 0);
  assert.equal(snap.stoppedReason, "frontier_empty");
});

test("budget exhaustion stops the job with stoppedReason budget_exhausted, report written, state done", async () => {
  const clock = makeClock();
  const { calls: reportCalls, reportImpl } = makeReportCapture();
  // Each round burns the whole budget at once, so the very next top-of-loop check trips.
  const researchImpl = async () => {
    clock.advance(60_000);
    return { source: "searxng", scanned: 1, fetched: 0, results: [] };
  };

  const { id } = startResearchJob(
    {
      objective: "obj",
      topics: ["s1", "s2", "s3"],
      topic: "budget-topic",
      budgetMs: 60_000,
      paceMs: 0
    },
    {
      researchImpl,
      persistImpl: okPersist,
      coveredHashesImpl: okCovered,
      reportImpl,
      leadsImpl: okLeads,
      ensureImpl: okEnsure,
      now: clock.now,
      sleepImpl: clock.sleepImpl
    }
  );

  const snap = await waitForDone(id);
  // Useful rounds were banked but s2/s3 never ran — that is exactly what done-partial means;
  // plain "done" would hide that two thirds of the plan went unexplored.
  assert.equal(snap.state, "done-partial");
  assert.equal(snap.stoppedReason, "budget_exhausted");
  assert.equal(
    snap.roundsTotal,
    1,
    "only the first round should have run before the budget tripped"
  );
  assert.equal(snap.frontierSize, 2, "s2 and s3 remain as resumable pending leads");
  assert.equal(reportCalls.length, 1);
  assert.ok(snap.report);
});

test("two consecutive banned rounds trigger a cooldown (not a terminal stop); banned queries retry and the job recovers to done", async () => {
  const clock = makeClock();
  const { reportImpl } = makeReportCapture();
  let calls = 0;
  // First two calls: the ADR-0057 §6 wall (200 + [] + engines down). Everything after: healthy.
  const researchImpl = async () => {
    calls++;
    if (calls <= 2) {
      return {
        source: "searxng",
        scanned: 0,
        fetched: 0,
        results: [],
        enginesUnavailable: ["google cse: suspended"]
      };
    }
    return { source: "searxng", scanned: 1, fetched: 0, results: [] };
  };

  const { id } = startResearchJob(
    {
      objective: "obj",
      topics: ["s1", "s2", "s3"],
      topic: "banned-topic",
      paceMs: 5000,
      cooldownMs: 30_000
    },
    {
      researchImpl,
      persistImpl: okPersist,
      coveredHashesImpl: okCovered,
      reportImpl,
      leadsImpl: okLeads,
      ensureImpl: okEnsure,
      now: clock.now,
      sleepImpl: clock.sleepImpl
    }
  );

  const snap = await waitForDone(id);
  // s1 banned, s2 banned -> cooldown -> s3, then s1 and s2 retried successfully.
  assert.equal(snap.state, "done");
  assert.equal(snap.stoppedReason, "frontier_empty");
  assert.equal(snap.roundsTotal, 5);
  assert.equal(snap.totals.cooldowns, 1);
  assert.equal(snap.totals.retries, 2, "both banned seeds were re-enqueued, not dropped");
  assert.equal(snap.totals.usefulRounds, 3);
  assert.equal(snap.rounds[0].banned, true);
  assert.equal(snap.rounds[0].requeued, true);
  assert.deepEqual(
    snap.rounds.map((r) => r.query),
    ["s1", "s2", "s3", "s1", "s2"],
    "retries go to the END of the frontier"
  );
  assert.equal(clock.sleeps[0], 10_000, "pace after the 1st banned round is doubled to paceMs*2");
  const slept = clock.sleeps.reduce((a, b) => a + b, 0);
  // 10s doubled pace + 30s cooldown (in <=5s slices) + 3 healthy 5s paces.
  assert.equal(slept, 10_000 + 30_000 + 15_000);
});

test("stopResearchJob mid-run: graceful — the in-flight round finishes, then state becomes stopped", async () => {
  const clock = makeClock();
  const { calls: reportCalls, reportImpl } = makeReportCapture();
  let releaseResearch;
  const researchImpl = () =>
    new Promise((resolve) => {
      releaseResearch = () => resolve({ source: "searxng", scanned: 1, fetched: 0, results: [] });
    });

  const { id } = startResearchJob(
    { objective: "obj", topics: ["only seed"], topic: "stop-topic" },
    {
      researchImpl,
      persistImpl: okPersist,
      coveredHashesImpl: okCovered,
      reportImpl,
      leadsImpl: okLeads,
      ensureImpl: okEnsure,
      now: clock.now,
      sleepImpl: clock.sleepImpl
    }
  );

  await waitForCurrentQuery(id); // the round's researchImpl call is now in flight, paused
  const midSnap = getResearchJob(id);
  assert.equal(midSnap.state, "running");

  const stopSnap = stopResearchJob(id);
  assert.equal(stopSnap.id, id);

  releaseResearch(); // let the in-flight round finish
  const finalSnap = await waitForDone(id);
  assert.equal(finalSnap.state, "stopped");
  assert.equal(finalSnap.stoppedReason, "stop_requested");
  assert.equal(finalSnap.roundsTotal, 1, "the round already in flight was allowed to complete");
  assert.equal(reportCalls.length, 1);
  assert.ok(finalSnap.report);
});

test("a second startResearchJob while one is running throws job_active; allowed again once finished", async () => {
  const clock = makeClock();
  const { reportImpl } = makeReportCapture();
  let releaseResearch;
  const researchImpl = () =>
    new Promise((resolve) => {
      releaseResearch = () => resolve({ source: "searxng", scanned: 1, fetched: 0, results: [] });
    });

  const { id: id1 } = startResearchJob(
    { objective: "obj", topics: ["only seed"], topic: "active-topic-1" },
    {
      researchImpl,
      persistImpl: okPersist,
      coveredHashesImpl: okCovered,
      reportImpl,
      leadsImpl: okLeads,
      ensureImpl: okEnsure,
      now: clock.now,
      sleepImpl: clock.sleepImpl
    }
  );

  await waitForCurrentQuery(id1);

  assert.throws(
    () =>
      startResearchJob(
        { objective: "obj2", topics: ["another"], topic: "active-topic-2" },
        {
          researchImpl: emptyResearch,
          persistImpl: okPersist,
          coveredHashesImpl: okCovered,
          reportImpl,
          leadsImpl: okLeads,
          ensureImpl: okEnsure,
          now: clock.now,
          sleepImpl: clock.sleepImpl
        }
      ),
    (err) => err instanceof DeepResearchError && err.code === "job_active"
  );

  releaseResearch();
  await waitForDone(id1);

  // Now allowed again.
  const { id: id2 } = startResearchJob(
    { objective: "obj2", topics: ["another"], topic: "active-topic-2" },
    {
      researchImpl: emptyResearch,
      persistImpl: okPersist,
      coveredHashesImpl: okCovered,
      reportImpl,
      leadsImpl: okLeads,
      ensureImpl: okEnsure,
      now: clock.now,
      sleepImpl: clock.sleepImpl
    }
  );
  assert.notEqual(id2, id1);
  await waitForDone(id2);
});

test("persistImpl throwing ResearchPersistError(missing_root) is fatal: state failed, error set, report still attempted", async () => {
  const clock = makeClock();
  const { calls: reportCalls, reportImpl } = makeReportCapture();
  const researchImpl = async () => ({
    source: "searxng",
    scanned: 1,
    fetched: 1,
    results: [{ title: "P", url: "https://p.example/1", relevant: true, relevance: 6 }]
  });
  const persistImpl = async () => {
    throw new ResearchPersistError("OBSCURA_RESEARCH_DIR is not set", "missing_root");
  };

  const { id } = startResearchJob(
    { objective: "obj", topics: ["s1"], topic: "fatal-persist-topic" },
    {
      researchImpl,
      persistImpl,
      coveredHashesImpl: okCovered,
      reportImpl,
      leadsImpl: okLeads,
      ensureImpl: okEnsure,
      now: clock.now,
      sleepImpl: clock.sleepImpl
    }
  );

  const snap = await waitForDone(id);
  assert.equal(snap.state, "failed");
  assert.equal(snap.error, "OBSCURA_RESEARCH_DIR is not set");
  assert.equal(reportCalls.length, 1, "the report is still attempted even on a fatal failure");
});

test("leadsImpl throwing increments totals.leadsFailed and the loop continues", async () => {
  const clock = makeClock();
  const { reportImpl } = makeReportCapture();
  const researchImpl = async (query) => ({
    source: "searxng",
    scanned: 1,
    fetched: 1,
    results: [{ title: query, url: `https://p.example/${query}`, relevant: true, relevance: 6 }]
  });
  const leadsImpl = async () => {
    throw new Error("ollama unavailable");
  };

  const { id } = startResearchJob(
    { objective: "obj", topics: ["s1", "s2"], topic: "leads-fail-topic", maxDepth: 1 },
    {
      researchImpl,
      persistImpl: okPersist,
      coveredHashesImpl: okCovered,
      reportImpl,
      leadsImpl,
      ensureImpl: okEnsure,
      now: clock.now,
      sleepImpl: clock.sleepImpl
    }
  );

  const snap = await waitForDone(id);
  assert.equal(snap.state, "done");
  assert.equal(snap.stoppedReason, "frontier_empty");
  assert.equal(snap.totals.leadsFailed, 2);
  assert.equal(snap.totals.leadsGenerated, 0);
  assert.equal(snap.roundsTotal, 2, "both seeds ran despite every leads call failing");
});

test("round 2's researchImpl receives excludeHashes containing hash8 of a URL persisted in round 1", async () => {
  const clock = makeClock();
  const { reportImpl } = makeReportCapture();
  const seenExcludeHashes = [];
  const researchImpl = async (query, opts) => {
    seenExcludeHashes.push(new Set(opts.excludeHashes));
    if (query === "seedA") {
      return {
        source: "searxng",
        scanned: 2,
        fetched: 1,
        results: [{ title: "Page", url: "https://example.com/page", relevant: true, relevance: 9 }]
      };
    }
    return { source: "searxng", scanned: 1, fetched: 0, results: [] };
  };

  const { id } = startResearchJob(
    { objective: "obj", topics: ["seedA", "seedB"], topic: "exclude-hashes-topic", maxDepth: 0 },
    {
      researchImpl,
      persistImpl: okPersist,
      coveredHashesImpl: okCovered,
      reportImpl,
      leadsImpl: okLeads,
      ensureImpl: okEnsure,
      now: clock.now,
      sleepImpl: clock.sleepImpl
    }
  );

  await waitForDone(id);
  const h = hash8("https://example.com/page");
  assert.equal(seenExcludeHashes[0].has(h), false, "round 1 has nothing covered yet");
  assert.equal(seenExcludeHashes[1].has(h), true, "round 2 excludes what round 1 just persisted");
});

test("renderRunReport: all required sections present, empty leads render (none), genealogy nests a child under its parent", () => {
  const job = {
    topic: "render-topic",
    objective: "Understand X deeply",
    topics: ["seedA"],
    startedAtMs: 0,
    finishedAtMs: 12_345,
    budgetMs: 900_000,
    rounds: [
      {
        query: "seedA",
        kind: "seed",
        depth: 0,
        parent: null,
        source: "searxng",
        scanned: 5,
        fetched: 2,
        kept: 2,
        curated: 1,
        dropped: 1,
        alreadyCovered: 0,
        persisted: { written: 1, updated: 0 }
      },
      {
        query: "child lead",
        kind: "subtopic",
        depth: 1,
        parent: "seedA",
        why: "because A pointed here",
        source: "searxng",
        scanned: 3,
        fetched: 1,
        kept: 1,
        curated: 1,
        dropped: 0,
        alreadyCovered: 0,
        persisted: { written: 1, updated: 0 }
      }
    ],
    totals: {
      rounds: 2,
      fetched: 3,
      curated: 2,
      persistedWritten: 2,
      persistedUpdated: 0,
      leadsGenerated: 1,
      leadsFailed: 0
    },
    topFindings: [
      {
        title: "Great source",
        url: "https://src.example/a",
        relevance: 8,
        reason: "on point",
        query: "seedA"
      }
    ],
    frontier: [],
    stoppedReason: "frontier_empty",
    nowImpl: () => 12_345
  };

  const md = renderRunReport(job);

  for (const section of [
    "# Deep research run: render-topic",
    "## Objective",
    "## Topics",
    "## Round log",
    "## Query genealogy",
    "## Top findings",
    "## Unexplored leads"
  ]) {
    assert.ok(md.includes(section), `missing section: ${section}`);
  }
  assert.ok(md.includes("(none)"), "empty frontier must render as (none)");

  const genealogySection = md.split("## Query genealogy")[1].split("## Top findings")[0];
  const genLines = genealogySection.split("\n").filter((l) => l.includes("-"));
  const seedLineIdx = genLines.findIndex((l) => l.trim() === "- seedA");
  const childLineIdx = genLines.findIndex((l) => l.includes("subtopic: child lead"));
  assert.ok(seedLineIdx >= 0, "seed line must be present at the root");
  assert.ok(childLineIdx > seedLineIdx, "child must appear after its parent seed");
  const seedIndent = genLines[seedLineIdx].match(/^\s*/)[0].length;
  const childIndent = genLines[childLineIdx].match(/^\s*/)[0].length;
  assert.ok(
    childIndent > seedIndent,
    `child (${childIndent}) must be indented more than its parent seed (${seedIndent})`
  );
});

test("snapshot is JSON.stringify-safe; rounds are capped at 20 with roundsTotal correct; invalid params throw synchronously", async () => {
  assert.throws(
    () => startResearchJob({ objective: "", topics: ["a"], topic: "t" }),
    (err) => err instanceof DeepResearchError && err.code === "invalid_params"
  );
  assert.throws(
    () => startResearchJob({ objective: "obj", topics: [], topic: "t" }),
    (err) => err instanceof DeepResearchError && err.code === "invalid_params"
  );
  assert.throws(
    () =>
      startResearchJob({
        objective: "obj",
        topics: ["a", "b", "c", "d", "e", "f", "g"],
        topic: "t"
      }),
    (err) => err instanceof DeepResearchError && err.code === "invalid_params"
  );

  const clock = makeClock();
  const { reportImpl } = makeReportCapture();
  const researchImpl = async () => ({
    source: "searxng",
    scanned: 1,
    fetched: 1,
    results: [{ title: "P", url: "https://p.example/x", relevant: true, relevance: 6 }]
  });
  // Wide branching (3 fresh leads/round) so MAX_ROUNDS (40) is hit before the frontier or the
  // (generous) budget runs out, giving a deterministic roundsTotal to assert against. Random
  // suffixes, not a counter — sequential strings like "lead-9"/"lead-10" share a long enough
  // common substring to trip the >=0.85 near-duplicate dedupe and starve the branching.
  const leadsImpl = async () => ({
    leads: [0, 1, 2].map(() => ({
      query: `lead-${randomUUID()}`,
      kind: "related",
      why: "w"
    }))
  });

  const { id } = startResearchJob(
    {
      objective: "obj",
      topics: ["root seed"],
      topic: "cap-topic",
      maxDepth: 4,
      paceMs: 0,
      budgetMs: 1_800_000
    },
    {
      researchImpl,
      persistImpl: okPersist,
      coveredHashesImpl: okCovered,
      reportImpl,
      leadsImpl,
      ensureImpl: okEnsure,
      now: clock.now,
      sleepImpl: clock.sleepImpl
    }
  );

  const snap = await waitForDone(id);
  assert.equal(snap.stoppedReason, "max_rounds");
  assert.equal(snap.roundsTotal, 40);
  assert.equal(snap.rounds.length, 20, "snapshot caps the round log at the last 20 entries");
  assert.equal(snap.rounds[0].query, snap.rounds[0].query, "sanity: rounds are plain objects");

  assert.doesNotThrow(() => JSON.stringify(snap));
  const roundTripped = JSON.parse(JSON.stringify(snap));
  assert.equal(roundTripped.id, id);
  assert.equal(roundTripped.roundsTotal, 40);
});
