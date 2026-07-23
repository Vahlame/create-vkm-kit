/**
 * Background crawl-job registry (crawl-job.mjs, ADR-0062). Injected crawlImpl/reportImpl/now — no
 * real crawl, network, timer, or filesystem. Proves: synchronous param validation; the per-type
 * singleton AND the shared cross-type slot (a held "research" slot blocks a crawl); runJob adopts
 * crawlSite's authoritative totals + export paths, writes a run report on every exit, and releases
 * the slot; graceful stop flips state to "stopped"; snapshots are JSON-safe; and renderCrawlReport
 * emits every section including the always-present gated-pages list.
 */
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  startCrawlJob,
  getCrawlJob,
  stopCrawlJob,
  clearCrawlJobs,
  renderCrawlReport,
  CrawlJobError
} from "../src/crawl-job.mjs";
import { acquireJobSlot, releaseJobSlot, jobSlotHolder, clearJobSlot } from "../src/job-lock.mjs";

/** Poll the registry until the job leaves "running" (its runJob promise is not exposed). */
async function settle(id, tries = 100) {
  for (let i = 0; i < tries; i++) {
    const s = getCrawlJob(id);
    if (s && s.state !== "running") return s;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error(`job ${id} did not settle`);
}

/** A crawlImpl that resolves immediately with a fixed summary, and (optionally) drives onPage. */
function fixedCrawl(summary = {}, pages = []) {
  return async (_opts, deps) => {
    for (const p of pages) deps.onPage(p);
    return {
      crawled: 0,
      kept: 0,
      gated: 0,
      fetchFailed: 0,
      robotsBlocked: 0,
      circuitOpen: 0,
      assetsSaved: 0,
      persistedWritten: 0,
      persistedUpdated: 0,
      exportPaths: {},
      stoppedReason: "frontier_empty",
      ...summary
    };
  };
}

const baseParams = { seeds: ["https://foo.com/"], topic: "t", researchDir: "/tmp/x" };
const baseDeps = () => ({
  crawlImpl: fixedCrawl(),
  reportImpl: async () => ({ path: "runs/crawl-x.md", filename: "crawl-x.md" }),
  now: () => 1_000_000
});

beforeEach(() => {
  clearCrawlJobs();
  clearJobSlot();
});
afterEach(async () => {
  // Nothing should still be running, but if a test left one, let it settle before clearing.
  const s = getCrawlJob();
  if (s && s.state === "running") await settle(s.id).catch(() => {});
  clearCrawlJobs();
  clearJobSlot();
});

// ── validation ──────────────────────────────────────────────────────────────────────────────

test("startCrawlJob rejects empty seeds and seeds with no valid http(s) URL", () => {
  assert.throws(() => startCrawlJob({ seeds: [], topic: "t" }, baseDeps()), /seeds must be/);
  assert.throws(
    () => startCrawlJob({ seeds: ["ftp://x", "not a url"], topic: "t" }, baseDeps()),
    /no valid absolute http/
  );
});

test("startCrawlJob rejects an invalid topic slug (ResearchPersistError code)", () => {
  assert.throws(
    () => startCrawlJob({ seeds: ["https://foo.com/"], topic: "../evil" }, baseDeps()),
    (e) => e.code === "invalid_topic"
  );
});

// ── singleton + shared slot ───────────────────────────────────────────────────────────────

test("a second crawl while one runs throws job_active; allowed again once finished", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const deps = { ...baseDeps(), crawlImpl: async () => (await gate, fixedCrawl()()) };
  const { id } = startCrawlJob(baseParams, deps);
  assert.throws(
    () => startCrawlJob(baseParams, baseDeps()),
    (e) => e.code === "job_active"
  );
  release();
  await settle(id);
  // Now a new one is allowed.
  const again = startCrawlJob(baseParams, baseDeps());
  await settle(again.id);
  assert.ok(again.id);
});

test("a held research slot blocks a crawl from starting (cross-type exclusion)", () => {
  acquireJobSlot("deep-fake", "research");
  try {
    assert.throws(
      () => startCrawlJob(baseParams, baseDeps()),
      (e) => e.code === "job_active"
    );
  } finally {
    releaseJobSlot("deep-fake");
  }
});

// ── runJob wiring ─────────────────────────────────────────────────────────────────────────

test("runJob adopts crawlSite's totals/export, writes a report, and releases the slot", async () => {
  let reportArgs;
  const deps = {
    crawlImpl: fixedCrawl({
      crawled: 12,
      kept: 8,
      gated: 2,
      assetsSaved: 3,
      persistedWritten: 8,
      exportPaths: { json: "crawl.json", csv: "crawl.csv" },
      stoppedReason: "max_pages"
    }),
    reportImpl: async (a) => {
      reportArgs = a;
      return { path: `runs/${a.filename}`, filename: a.filename };
    },
    now: () => 2_000_000
  };
  const { id } = startCrawlJob(baseParams, deps);
  const snap = await settle(id);
  assert.equal(snap.state, "done");
  assert.equal(snap.totals.crawled, 12);
  assert.equal(snap.totals.kept, 8);
  assert.equal(snap.totals.assetsSaved, 3);
  assert.deepEqual(snap.exportPaths, { json: "crawl.json", csv: "crawl.csv" });
  assert.equal(snap.stoppedReason, "max_pages");
  assert.match(reportArgs.filename, /^crawl-.*\.md$/);
  assert.match(reportArgs.content, /# Crawl run: t/);
  assert.equal(jobSlotHolder(), null, "shared slot released after the job finishes");
});

test("runJob accounts progress via onPage before crawlSite's authoritative return", async () => {
  const pages = [
    { url: "https://foo.com/a", depth: 0, status: "kept", title: "A" },
    { url: "https://foo.com/b", depth: 1, status: "gated" },
    { url: "https://foo.com/c", depth: 1, status: "fetch-failed" }
  ];
  // crawlSite's return is authoritative and overrides the live onPage tally.
  const deps = {
    ...baseDeps(),
    crawlImpl: fixedCrawl({ crawled: 2, kept: 1, gated: 1, fetchFailed: 1 }, pages)
  };
  const { id } = startCrawlJob(baseParams, deps);
  const snap = await settle(id);
  assert.equal(snap.totals.kept, 1);
  assert.equal(snap.totals.gated, 1);
  assert.deepEqual(snap.gatedUrls, ["https://foo.com/b"]);
  assert.ok(snap.recentPages.some((p) => p.url === "https://foo.com/a" && p.title === "A"));
});

test("a crawlImpl that throws marks the job failed, still writes a report, releases the slot", async () => {
  const deps = {
    ...baseDeps(),
    crawlImpl: async () => {
      throw new Error("boom");
    }
  };
  const { id } = startCrawlJob(baseParams, deps);
  const snap = await settle(id);
  assert.equal(snap.state, "failed");
  assert.equal(snap.error, "boom");
  assert.equal(jobSlotHolder(), null);
});

// ── stop ────────────────────────────────────────────────────────────────────────────────────

test("stopCrawlJob mid-run is graceful: in-flight crawl finishes, then state is stopped", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  let sawStop = null;
  const deps = {
    ...baseDeps(),
    crawlImpl: async (_opts, d) => {
      await gate;
      sawStop = d.shouldStop(); // by now stop was requested
      return fixedCrawl()();
    }
  };
  const { id } = startCrawlJob(baseParams, deps);
  const stopped = stopCrawlJob(id);
  assert.equal(stopped.state, "running", "stop is requested, not immediate");
  release();
  const snap = await settle(id);
  assert.equal(sawStop, true, "shouldStop() reflected the request inside the in-flight crawl");
  assert.equal(snap.state, "stopped");
  assert.equal(snap.stoppedReason, "stop_requested");
});

test("stopCrawlJob with no job throws unknown_job", () => {
  assert.throws(
    () => stopCrawlJob("nope"),
    (e) => e instanceof CrawlJobError && e.code === "unknown_job"
  );
});

// ── snapshot + report ────────────────────────────────────────────────────────────────────

test("getCrawlJob resolves by id, by most-recent, and is null for an unknown id", async () => {
  assert.equal(getCrawlJob("never"), null);
  const { id } = startCrawlJob(baseParams, baseDeps());
  await settle(id);
  assert.equal(getCrawlJob().id, id, "omitted id -> most recent");
  const snap = getCrawlJob(id);
  assert.doesNotThrow(() => JSON.stringify(snap), "snapshot is JSON-safe");
});

test("renderCrawlReport emits all sections; gated list is present even when empty", () => {
  const job = {
    id: "crawl-1",
    topic: "t",
    seeds: ["https://foo.com/"],
    startedAtMs: 0,
    finishedAtMs: 1000,
    budgetMs: 900_000,
    maxDepth: 3,
    maxPages: 200,
    allow: null,
    keywords: null,
    downloadAssets: true,
    respectRobots: true,
    totals: {
      crawled: 5,
      kept: 3,
      gated: 1,
      fetchFailed: 0,
      robotsBlocked: 0,
      circuitOpen: 2,
      assetsSaved: 2,
      persistedWritten: 3,
      persistedUpdated: 0
    },
    recentPages: [{ url: "https://foo.com/a", depth: 0, status: "kept", title: "A" }],
    gatedUrls: [],
    exportPaths: { json: "crawl.json", csv: "crawl.csv" },
    stoppedReason: "frontier_empty",
    nowImpl: () => 1000
  };
  const md = renderCrawlReport(job);
  assert.match(md, /# Crawl run: t/);
  assert.match(md, /## Seeds/);
  assert.match(md, /## Totals/);
  assert.match(md, /## Export/);
  assert.match(md, /## Gated pages/);
  assert.match(md, /\(none\)/, "empty gated list renders (none), never a bare/blank section");
  assert.match(md, /circuit_open: 2/, "frontmatter reports circuit-open count");
  assert.match(md, /circuit-open/, "totals table has a circuit-open column");
});
