/**
 * Drives the REAL registered obscura_crawl_start/status/stop handlers (zod validation included)
 * over an in-memory transport, injecting stub start/get/stop impls so no real crawl or filesystem
 * write runs. Proves: all three tools are registered; start maps seeds/topic/etc. to the params
 * startCrawlJob expects and applies the MCP-layer defaults (max_depth/max_pages/download_assets/
 * asset_max_count/budget_minutes/respect_robots); start fails typed (isError mentioning
 * OBSCURA_RESEARCH_DIR) before ever calling the impl when the research root is unset; a
 * CrawlJobError surfaces as isError; status of an unknown job is a typed error; a finished status
 * adds next/_trust and caps recentPages; and stop forwards the id and returns a graceful note.
 */
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { buildServer } from "../src/obscura-mcp.mjs";
import { CrawlJobError } from "../src/crawl-job.mjs";

async function connect(deps) {
  const server = buildServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const textOf = (r) => r.content[0].text;

function fakeCrawlSnapshot(over = {}) {
  return {
    id: "crawl-1",
    state: "running",
    topic: "docs",
    seeds: ["https://foo.com/"],
    startedAt: new Date(0).toISOString(),
    budgetMs: 900_000,
    elapsedMs: 1000,
    remainingMs: 899_000,
    config: {
      maxDepth: 3,
      maxPages: 200,
      allow: null,
      keywords: null,
      downloadAssets: true,
      respectRobots: true
    },
    currentUrl: "https://foo.com/a",
    totals: {
      crawled: 1,
      kept: 1,
      gated: 0,
      fetchFailed: 0,
      robotsBlocked: 0,
      assetsSaved: 0,
      persistedWritten: 1,
      persistedUpdated: 0
    },
    recentPages: Array.from({ length: 20 }, (_, i) => ({
      url: `https://foo.com/${i}`,
      depth: 1,
      status: "kept",
      title: ""
    })),
    gatedUrls: [],
    exportPaths: { json: "crawl.json", csv: "crawl.csv" },
    ...over
  };
}

const ORIG_ROOT = process.env.OBSCURA_RESEARCH_DIR;
afterEach(() => {
  if (ORIG_ROOT === undefined) delete process.env.OBSCURA_RESEARCH_DIR;
  else process.env.OBSCURA_RESEARCH_DIR = ORIG_ROOT;
});

test("all three crawl tools are registered", async () => {
  const client = await connect({});
  const names = (await client.listTools()).tools.map((t) => t.name);
  for (const n of ["obscura_crawl_start", "obscura_crawl_status", "obscura_crawl_stop"]) {
    assert.ok(names.includes(n), `missing ${n}`);
  }
});

test("obscura_crawl_start maps args + defaults to startCrawlJob and returns job_id", async () => {
  process.env.OBSCURA_RESEARCH_DIR = "/tmp/vkm-research";
  let captured;
  const client = await connect({
    startCrawlImpl: (params) => {
      captured = params;
      return { id: "crawl-xyz" };
    }
  });
  const res = await client.callTool({
    name: "obscura_crawl_start",
    arguments: { seeds: ["https://foo.com/"], topic: "docs" }
  });
  const out = JSON.parse(textOf(res));
  assert.equal(out.job_id, "crawl-xyz");
  assert.equal(out.state, "running");
  // MCP-layer defaults applied and mapped to startCrawlJob's camelCase param names.
  assert.equal(captured.maxDepth, 3);
  assert.equal(captured.maxPages, 200);
  assert.equal(captured.downloadAssets, true);
  assert.equal(captured.assetMaxCount, 200);
  assert.equal(captured.respectRobots, true);
  assert.equal(captured.budgetMs, 900_000);
  assert.deepEqual(captured.seeds, ["https://foo.com/"]);
  assert.equal(captured.topic, "docs");
});

test("obscura_crawl_start fails typed (OBSCURA_RESEARCH_DIR) before calling the impl", async () => {
  delete process.env.OBSCURA_RESEARCH_DIR;
  let called = false;
  const client = await connect({
    startCrawlImpl: () => {
      called = true;
      return { id: "x" };
    }
  });
  const res = await client.callTool({
    name: "obscura_crawl_start",
    arguments: { seeds: ["https://foo.com/"], topic: "docs" }
  });
  assert.equal(res.isError, true);
  assert.match(textOf(res), /OBSCURA_RESEARCH_DIR/);
  assert.equal(called, false, "the job is never started when the root is unconfigured");
});

test("obscura_crawl_start surfaces a CrawlJobError(job_active) as isError", async () => {
  process.env.OBSCURA_RESEARCH_DIR = "/tmp/vkm-research";
  const client = await connect({
    startCrawlImpl: () => {
      throw new CrawlJobError("another crawl job is running", "job_active");
    }
  });
  const res = await client.callTool({
    name: "obscura_crawl_start",
    arguments: { seeds: ["https://foo.com/"], topic: "docs" }
  });
  assert.equal(res.isError, true);
  assert.match(textOf(res), /another crawl job is running/);
});

test("obscura_crawl_status: unknown job is a typed error, not a crash", async () => {
  const client = await connect({ getCrawlImpl: () => null });
  const res = await client.callTool({
    name: "obscura_crawl_status",
    arguments: { job_id: "nope" }
  });
  assert.equal(res.isError, true);
  assert.match(textOf(res), /no crawl job found/);
});

test("obscura_crawl_status: a finished job adds next/_trust and caps recentPages at 10", async () => {
  const client = await connect({
    getCrawlImpl: () => fakeCrawlSnapshot({ state: "done", report: "runs/crawl-x.md" })
  });
  const res = await client.callTool({ name: "obscura_crawl_status", arguments: {} });
  const out = JSON.parse(textOf(res));
  assert.match(out.next, /crawl\.json/);
  assert.match(out.next, /\/vkm-research docs/);
  assert.ok(out._trust);
  assert.equal(out.recentPages.length, 10, "recentPages capped for a status read");
});

test("obscura_crawl_status: a running job gets neither next nor _trust", async () => {
  const client = await connect({ getCrawlImpl: () => fakeCrawlSnapshot({ state: "running" }) });
  const res = await client.callTool({ name: "obscura_crawl_status", arguments: {} });
  const out = JSON.parse(textOf(res));
  assert.equal(out.next, undefined);
  assert.equal(out._trust, undefined);
});

test("obscura_crawl_stop forwards job_id and returns a graceful note", async () => {
  let stoppedId;
  const client = await connect({
    stopCrawlImpl: (id) => {
      stoppedId = id;
      return fakeCrawlSnapshot({ state: "running" });
    }
  });
  const res = await client.callTool({
    name: "obscura_crawl_stop",
    arguments: { job_id: "crawl-1" }
  });
  const out = JSON.parse(textOf(res));
  assert.equal(stoppedId, "crawl-1");
  assert.match(out.note, /Graceful/);
});
