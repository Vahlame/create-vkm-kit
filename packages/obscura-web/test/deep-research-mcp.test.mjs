/**
 * Drives the REAL registered obscura_research_start/status/stop handlers (zod validation
 * included) over an in-memory transport, injecting stubbed startJobImpl/getJobImpl/stopJobImpl
 * so no real background job, crawl, or filesystem write ever runs. Proves:
 *  - all three tools are registered;
 *  - start maps budget_minutes/top_k/etc. to the exact params object startResearchJob expects,
 *    and applies the MCP-layer defaults (budget_minutes/top_k/max_candidates/sub_queries only —
 *    every other optional field is left undefined for deep-research.mjs's own defaults to fill);
 *  - start fails typed (isError mentioning OBSCURA_RESEARCH_DIR) before ever calling
 *    startJobImpl when the research root isn't configured;
 *  - start returns job_id + a descriptive note on success;
 *  - a DeepResearchError("job_active") from startJobImpl surfaces as isError with its message;
 *  - status with no matching job (stub returns null) is a typed isError, never a crash;
 *  - status of a finished job adds the next/_trust hints and caps topFindings at 10, but a
 *    still-running job gets neither;
 *  - stop forwards job_id to stopJobImpl and returns its snapshot plus a graceful note, and its
 *    own DeepResearchError("unknown_job") surfaces the same way start's does.
 *
 * Local connect() helper (copied from obscura-mcp.test.mjs rather than imported — this file
 * owns its own fixtures, per this slice's file boundary).
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { buildServer } from "../src/obscura-mcp.mjs";
import { DeepResearchError } from "../src/deep-research.mjs";

async function connect(deps) {
  const server = buildServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const textOf = (r) => r.content[0].text;

/** Minimal but shape-complete stand-in for deep-research.mjs's JSON-safe snapshot. */
function fakeSnapshot(overrides = {}) {
  return {
    id: "deep-test-1",
    state: "running",
    objective: "understand X",
    topic: "cats",
    topics: ["cats"],
    startedAt: new Date().toISOString(),
    budgetMs: 900_000,
    elapsedMs: 1_000,
    remainingMs: 899_000,
    searxng: true,
    currentQuery: { query: "cats", kind: "seed", depth: 0 },
    roundsTotal: 1,
    rounds: [],
    totals: {
      rounds: 1,
      fetched: 3,
      curated: 2,
      persistedWritten: 2,
      persistedUpdated: 0,
      leadsGenerated: 1,
      leadsFailed: 0
    },
    topFindings: [],
    pendingLeads: [],
    frontierSize: 0,
    ...overrides
  };
}

// obscura_research_start's handler calls the real, unmocked resolveResearchRoot() first — every
// test needs OBSCURA_RESEARCH_DIR configured EXCEPT the one that deliberately unsets it, which
// saves/restores around itself, layered on top of this file-wide save/restore.
let prevResearchDir;

before(async () => {
  prevResearchDir = process.env.OBSCURA_RESEARCH_DIR;
  process.env.OBSCURA_RESEARCH_DIR = await mkdtemp(
    path.join(tmpdir(), "obscura-deep-research-mcp-")
  );
});

after(() => {
  if (prevResearchDir === undefined) delete process.env.OBSCURA_RESEARCH_DIR;
  else process.env.OBSCURA_RESEARCH_DIR = prevResearchDir;
});

// ── registration ─────────────────────────────────────────────────────────────────────────

test("obscura_research_start/status/stop are registered", async () => {
  const client = await connect({});
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  assert.ok(names.includes("obscura_research_start"));
  assert.ok(names.includes("obscura_research_status"));
  assert.ok(names.includes("obscura_research_stop"));
});

// ── obscura_research_start ──────────────────────────────────────────────────────────────

test("obscura_research_start: maps budget_minutes/top_k/etc. to the exact params object startJobImpl receives", async () => {
  let seenParams = null;
  const startJobImpl = (params) => {
    seenParams = params;
    return { id: "deep-test-1" };
  };
  const client = await connect({ startJobImpl });
  await client.callTool({
    name: "obscura_research_start",
    arguments: {
      objective: "understand X",
      topics: ["a", "b"],
      topic: "cats",
      budget_minutes: 20,
      round_ms: 50000,
      pace_ms: 5000,
      cooldown_ms: 60000,
      max_depth: 3,
      top_k: 30,
      max_candidates: 100,
      sub_queries: 6,
      drop_below: 4,
      passage_chars: 1000,
      categories: "general,it",
      stealth: false
    }
  });
  assert.deepEqual(seenParams, {
    objective: "understand X",
    topics: ["a", "b"],
    topic: "cats",
    budgetMs: 20 * 60_000,
    roundMs: 50000,
    paceMs: 5000,
    cooldownMs: 60000,
    maxDepth: 3,
    topK: 30,
    maxCandidates: 100,
    subQueries: 6,
    dropBelow: 4,
    passageChars: 1000,
    categories: "general,it",
    stealth: false,
    autoContinue: false,
    maxTotalMs: undefined,
    autoConsolidate: true
  });
});

test("obscura_research_start: auto_continue/max_total_minutes/auto_consolidate map through, minutes->ms", async () => {
  let seenParams = null;
  const startJobImpl = (params) => {
    seenParams = params;
    return { id: "deep-test-2" };
  };
  const client = await connect({ startJobImpl });
  const res = await client.callTool({
    name: "obscura_research_start",
    arguments: {
      objective: "understand X",
      topics: ["a"],
      topic: "cats",
      auto_continue: true,
      max_total_minutes: 45,
      auto_consolidate: false
    }
  });
  assert.equal(seenParams.autoContinue, true);
  assert.equal(seenParams.maxTotalMs, 45 * 60_000);
  assert.equal(seenParams.autoConsolidate, false);
  const data = JSON.parse(textOf(res));
  assert.match(data.note, /auto_continue is on: may run up to 45 min total/);
});

test("obscura_research_start: applies MCP-layer defaults when optional fields are omitted", async () => {
  let seenParams = null;
  const startJobImpl = (params) => {
    seenParams = params;
    return { id: "deep-test-1" };
  };
  const client = await connect({ startJobImpl });
  await client.callTool({
    name: "obscura_research_start",
    arguments: { objective: "understand X", topics: ["a"], topic: "cats" }
  });
  assert.equal(seenParams.budgetMs, 15 * 60_000, "budget_minutes defaults to 15");
  assert.equal(seenParams.topK, 12, "top_k defaults to 12");
  assert.equal(seenParams.maxCandidates, 60, "max_candidates defaults to 60");
  assert.equal(seenParams.subQueries, 4, "sub_queries defaults to 4");
  assert.equal(seenParams.roundMs, undefined, "no MCP-layer default — deep-research.mjs owns it");
  assert.equal(seenParams.paceMs, undefined);
  assert.equal(seenParams.cooldownMs, undefined);
  assert.equal(seenParams.maxDepth, undefined);
  assert.equal(seenParams.dropBelow, undefined);
  assert.equal(seenParams.passageChars, undefined);
  assert.equal(seenParams.autoContinue, false, "auto_continue defaults to off");
  assert.equal(seenParams.maxTotalMs, undefined, "no MCP-layer default when auto_continue is off");
  assert.equal(seenParams.autoConsolidate, true, "auto_consolidate defaults to on");
});

test("obscura_research_start: without OBSCURA_RESEARCH_DIR set, fails typed before ever calling startJobImpl", async () => {
  const saved = process.env.OBSCURA_RESEARCH_DIR;
  delete process.env.OBSCURA_RESEARCH_DIR;
  try {
    const startJobImpl = () => {
      throw new Error("startJobImpl must not be called when the research root isn't configured");
    };
    const client = await connect({ startJobImpl });
    const res = await client.callTool({
      name: "obscura_research_start",
      arguments: { objective: "understand X", topics: ["a"], topic: "cats" }
    });
    assert.equal(res.isError, true);
    assert.match(textOf(res), /OBSCURA_RESEARCH_DIR/);
  } finally {
    process.env.OBSCURA_RESEARCH_DIR = saved;
  }
});

test("obscura_research_start: returns job_id, state, budget_ms, and a note pointing at the topic's RESEARCH dir", async () => {
  const startJobImpl = () => ({ id: "deep-abc123" });
  const client = await connect({ startJobImpl });
  const res = await client.callTool({
    name: "obscura_research_start",
    arguments: {
      objective: "understand X",
      topics: ["cats", "dogs"],
      topic: "pets",
      budget_minutes: 10
    }
  });
  const data = JSON.parse(textOf(res));
  assert.equal(data.job_id, "deep-abc123");
  assert.equal(data.state, "running");
  assert.equal(data.topic, "pets");
  assert.equal(data.budget_ms, 10 * 60_000);
  assert.match(data.note, /RESEARCH\/pets\//);
});

test("obscura_research_start: a job_active DeepResearchError from startJobImpl surfaces as isError with its exact message", async () => {
  const startJobImpl = () => {
    throw new DeepResearchError(
      'another research job "deep-xyz" is still running — one at a time (fan-out bans the machine, ADR-0057)',
      "job_active"
    );
  };
  const client = await connect({ startJobImpl });
  const res = await client.callTool({
    name: "obscura_research_start",
    arguments: { objective: "understand X", topics: ["a"], topic: "cats" }
  });
  assert.equal(res.isError, true);
  assert.match(
    textOf(res),
    /another research job "deep-xyz" is still running — one at a time \(fan-out bans the machine, ADR-0057\)/
  );
});

// ── obscura_research_status ─────────────────────────────────────────────────────────────

test("obscura_research_status: no matching job (stub returns null) -> isError, never a crash", async () => {
  const getJobImpl = () => null;
  const client = await connect({ getJobImpl });
  const res = await client.callTool({ name: "obscura_research_status", arguments: {} });
  assert.equal(res.isError, true);
  assert.match(textOf(res), /no research job found/);
});

test("obscura_research_status: a done job adds the next/_trust hints and caps topFindings at 10", async () => {
  const topFindings = Array.from({ length: 12 }, (_, i) => ({
    title: `Finding ${i}`,
    url: `https://x${i}.example`,
    relevance: 10 - i,
    query: "cats"
  }));
  let seenJobId;
  const getJobImpl = (jobId) => {
    seenJobId = jobId;
    return fakeSnapshot({
      state: "done",
      currentQuery: null,
      remainingMs: 0,
      report: "/fake/RESEARCH/cats/runs/2026-07-19T00-00-00-000Z.md",
      topFindings
    });
  };
  const client = await connect({ getJobImpl });
  const res = await client.callTool({
    name: "obscura_research_status",
    arguments: { job_id: "deep-test-1" }
  });
  const data = JSON.parse(textOf(res));
  assert.equal(seenJobId, "deep-test-1");
  assert.equal(data.topFindings.length, 10, "capped at 10 even though the snapshot carries 12");
  assert.match(data.next, /\/vkm-research cats/);
  assert.match(data.next, /2026-07-19T00-00-00-000Z\.md/);
  assert.match(data._trust, /untrusted/i);
});

test("obscura_research_status: a done job with consolidateResult points at summary.md, still offers /vkm-research", async () => {
  const getJobImpl = () =>
    fakeSnapshot({
      state: "done",
      currentQuery: null,
      remainingMs: 0,
      report: "/fake/RESEARCH/cats/runs/2026-07-19T00-00-00-000Z.md",
      consolidateResult: { wrote: "/fake/RESEARCH/cats/summary.md", sources_read: 12 }
    });
  const client = await connect({ getJobImpl });
  const res = await client.callTool({ name: "obscura_research_status", arguments: {} });
  const data = JSON.parse(textOf(res));
  assert.match(data.next, /Local summary\.md refreshed \(12 sources\)/);
  assert.match(data.next, /\/vkm-research cats/, "still offers the Claude-quality rewrite path");
});

test("obscura_research_status: a done job with consolidateError keeps the /vkm-research fallback, error surfaced", async () => {
  const getJobImpl = () =>
    fakeSnapshot({
      state: "done",
      currentQuery: null,
      remainingMs: 0,
      report: "/fake/RESEARCH/cats/runs/2026-07-19T00-00-00-000Z.md",
      consolidateError: "Ollama is unavailable"
    });
  const client = await connect({ getJobImpl });
  const res = await client.callTool({ name: "obscura_research_status", arguments: {} });
  const data = JSON.parse(textOf(res));
  assert.match(data.next, /\/vkm-research cats/);
  assert.match(data.next, /local auto-consolidate failed: Ollama is unavailable/);
});

test("obscura_research_status: a done-partial job is finished too — next/_trust hints present", async () => {
  const getJobImpl = () =>
    fakeSnapshot({
      state: "done-partial",
      currentQuery: null,
      remainingMs: 0,
      report: "/fake/RESEARCH/cats/runs/partial.md"
    });
  const client = await connect({ getJobImpl });
  const res = await client.callTool({ name: "obscura_research_status", arguments: {} });
  const data = JSON.parse(textOf(res));
  assert.match(data.next, /\/vkm-research cats/);
  assert.match(data._trust, /untrusted/i);
});

test("obscura_research_status: a still-running job gets neither next nor _trust", async () => {
  const getJobImpl = () => fakeSnapshot({ state: "running" });
  const client = await connect({ getJobImpl });
  const res = await client.callTool({ name: "obscura_research_status", arguments: {} });
  const data = JSON.parse(textOf(res));
  assert.equal(data.next, undefined);
  assert.equal(data._trust, undefined);
});

// ── obscura_research_stop ───────────────────────────────────────────────────────────────

test("obscura_research_stop: passes job_id through to stopJobImpl and returns its snapshot plus a graceful note", async () => {
  let seenJobId;
  const stopJobImpl = (jobId) => {
    seenJobId = jobId;
    return fakeSnapshot({ id: "deep-test-1", state: "running" });
  };
  const client = await connect({ stopJobImpl });
  const res = await client.callTool({
    name: "obscura_research_stop",
    arguments: { job_id: "deep-test-1" }
  });
  const data = JSON.parse(textOf(res));
  assert.equal(seenJobId, "deep-test-1");
  assert.equal(data.id, "deep-test-1");
  assert.match(data.note, /Graceful/);
  assert.match(data.note, /round_ms/);
});

test("obscura_research_stop: job_id omitted is passed through as undefined (most-recently-started job)", async () => {
  let seenJobId = "not-called";
  const stopJobImpl = (jobId) => {
    seenJobId = jobId;
    return fakeSnapshot();
  };
  const client = await connect({ stopJobImpl });
  await client.callTool({ name: "obscura_research_stop", arguments: {} });
  assert.equal(seenJobId, undefined);
});

test("obscura_research_stop: an unknown_job DeepResearchError from stopJobImpl surfaces as isError", async () => {
  const stopJobImpl = () => {
    throw new DeepResearchError("no research job found", "unknown_job");
  };
  const client = await connect({ stopJobImpl });
  const res = await client.callTool({
    name: "obscura_research_stop",
    arguments: { job_id: "deep-missing" }
  });
  assert.equal(res.isError, true);
  assert.match(textOf(res), /no research job found/);
});
