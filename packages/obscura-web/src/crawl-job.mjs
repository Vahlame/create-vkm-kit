/**
 * Background seed-URL crawl orchestrator (ADR-0062) — the job wrapper around crawlSite, mirroring
 * exactly how deep-research.mjs wraps research.mjs.
 *
 * A "crawl a whole doc/tutorial site" job is minutes of work (hundreds of pages, paced politely),
 * so it cannot live inside one MCP tool call — the SDK's 60 s client-side wall would kill it (see
 * deep-research.mjs's header for the same constraint). The loop therefore runs INSIDE the server
 * process: `startCrawlJob` returns a `job_id` in milliseconds, crawlSite persists to disk as it
 * goes (a killed process loses only the unflushed tail), and `getCrawlJob` is an in-memory snapshot
 * read — no polling transport, no client timer to babysit.
 *
 * This module is orchestration ONLY: state machine, budget → cooperative stop, progress snapshot,
 * run report, and the shared one-job-at-a-time slot. The crawl itself (BFS, scope, dedup, gating,
 * persistence, assets, export) is crawlSite's, injected whole and never re-implemented here.
 */
import { randomUUID } from "node:crypto";
import { crawlSite } from "./crawl.mjs";
import { obscuraFetch, isHttpUrl } from "./obscura-cli.mjs";
import { checkRobots } from "./robots.mjs";
import { downloadAsset, DEFAULT_ASSET_MAX_BYTES } from "./assets.mjs";
import {
  persistResults,
  listCoveredHashes,
  writeCrawlExport,
  writeRunReport,
  validateTopic
} from "./research-persist.mjs";
import { acquireJobSlot, releaseJobSlot, jobSlotHolder } from "./job-lock.mjs";
import { hostOf } from "./url-identity.mjs";

/** How many finished jobs the registry keeps for later inspection — bounded like deep-research's,
 * since this is a long-lived MCP process and an unbounded history is a slow leak. */
const JOB_HISTORY_MAX = 5;
/** Recent-page ring and gated-page list caps kept on the snapshot (the full record is the export
 * JSON on disk; these are just for a cheap status poll). */
const RECENT_PAGES_MAX = 20;
const GATED_URLS_MAX = 50;

/** Typed error for every synchronous validation/registry failure — same convention as
 * DeepResearchError: a `code` a caller/test can match, a message safe to surface verbatim. */
export class CrawlJobError extends Error {
  /** @param {string} message @param {string} code */
  constructor(message, code) {
    super(message);
    this.name = "CrawlJobError";
    this.code = code;
  }
}

/** @param {unknown} value @param {number} lo @param {number} hi @param {number} fallback */
function clampOrDefault(value, lo, hi, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, lo), hi);
}

// ── Registry (module-level — a job outlives the tool call that started it) ─────────────────
/** @type {Map<string, any>} */
const JOBS = new Map();
/** @type {string|null} */
let mostRecentId = null;

/** JSON-safe projection of a job record — never the live record (which holds injected fns). */
function toSnapshot(job) {
  const finished = job.state !== "running";
  const nowMs = job.nowImpl();
  const view = {
    id: job.id,
    state: job.state,
    topic: job.topic,
    seeds: job.seeds,
    startedAt: new Date(job.startedAtMs).toISOString(),
    budgetMs: job.budgetMs,
    elapsedMs: (finished ? job.finishedAtMs : nowMs) - job.startedAtMs,
    remainingMs: finished ? 0 : Math.max(0, job.startedAtMs + job.budgetMs - nowMs),
    config: {
      maxDepth: job.maxDepth,
      maxPages: job.maxPages,
      allow: job.allow ?? null,
      keywords: job.keywords ?? null,
      downloadAssets: job.downloadAssets,
      respectRobots: job.respectRobots
    },
    currentUrl: job.currentUrl ?? null,
    totals: { ...job.totals },
    recentPages: job.recentPages.slice(-RECENT_PAGES_MAX),
    gatedUrls: job.gatedUrls.slice(0, GATED_URLS_MAX),
    exportPaths: { ...job.exportPaths },
    ...(job.stoppedReason !== undefined ? { stoppedReason: job.stoppedReason } : {}),
    ...(job.report !== undefined ? { report: job.report } : {}),
    ...(job.reportError !== undefined ? { reportError: job.reportError } : {}),
    ...(job.error !== undefined ? { error: job.error } : {})
  };
  return structuredClone(view);
}

/** Evict oldest finished jobs until fewer than {@link JOB_HISTORY_MAX} remain. */
function evictOldFinished() {
  const finished = [...JOBS.values()]
    .filter((j) => j.state !== "running")
    .sort((a, b) => a.startedAtMs - b.startedAtMs);
  while (finished.length >= JOB_HISTORY_MAX) {
    const oldest = finished.shift();
    JOBS.delete(oldest.id);
  }
}

/**
 * Validate params synchronously, claim the shared network-job slot, register the job, and kick off
 * the (unawaited, `.catch`-guarded) crawl loop.
 * @param {{ seeds: string[], topic: string, allow?: string[], maxDepth?: number, maxPages?: number,
 *           keywords?: string[], downloadAssets?: boolean, assetMaxBytes?: number,
 *           assetMaxCount?: number, perHostCap?: number, respectRobots?: boolean,
 *           budgetMs?: number, paceMs?: number, stealth?: boolean, researchDir?: string }} params
 * @param {{ crawlImpl?: typeof crawlSite, fetchImpl?: typeof obscuraFetch,
 *           persistImpl?: typeof persistResults, coveredHashesImpl?: typeof listCoveredHashes,
 *           exportImpl?: typeof writeCrawlExport, robotsImpl?: typeof checkRobots,
 *           assetImpl?: typeof downloadAsset, reportImpl?: typeof writeRunReport,
 *           now?: () => number, sleepImpl?: (ms: number) => Promise<void> }} [deps]
 * @returns {{ id: string }}
 */
export function startCrawlJob(params, deps = {}) {
  const seedsIn = params.seeds;
  if (!Array.isArray(seedsIn) || !seedsIn.length) {
    throw new CrawlJobError("seeds must be a non-empty array of http(s) URLs", "invalid_params");
  }
  const seeds = seedsIn.filter((s) => isHttpUrl(s));
  if (!seeds.length) {
    throw new CrawlJobError("no valid absolute http(s) seed URL in seeds", "invalid_params");
  }
  const topic = validateTopic(params.topic); // propagates ResearchPersistError as-is

  // Per-type guard first (clearer message), then the cross-type shared slot below.
  for (const job of JOBS.values()) {
    if (job.state === "running") {
      throw new CrawlJobError(
        `another crawl job "${job.id}" is still running — one at a time (fan-out bans the machine)`,
        "job_active"
      );
    }
  }

  const budgetMs = clampOrDefault(params.budgetMs, 60_000, 3_600_000, 900_000);
  const {
    crawlImpl = crawlSite,
    fetchImpl = obscuraFetch,
    persistImpl = persistResults,
    coveredHashesImpl = listCoveredHashes,
    exportImpl = writeCrawlExport,
    robotsImpl = checkRobots,
    assetImpl = downloadAsset,
    reportImpl = writeRunReport,
    now = Date.now,
    sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  } = deps;

  const id = `crawl-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

  // Cross-type exclusion: refuse if a research job (or another crawl) holds the shared slot. Done
  // AFTER the per-type check so a same-type collision gets the clearer message above.
  acquireJobSlot(id, "crawl"); // throws JobSlotError("job_active") if held elsewhere

  evictOldFinished();

  const job = {
    id,
    state: "running",
    topic,
    seeds,
    allow: params.allow,
    maxDepth: clampOrDefault(params.maxDepth, 0, 6, 3),
    maxPages: clampOrDefault(params.maxPages, 1, 5_000, 200),
    keywords: params.keywords,
    downloadAssets: params.downloadAssets !== false,
    assetMaxBytes: clampOrDefault(
      params.assetMaxBytes,
      1024,
      200 * 1024 * 1024,
      DEFAULT_ASSET_MAX_BYTES
    ),
    assetMaxCount: clampOrDefault(params.assetMaxCount, 0, 5_000, 200),
    perHostCap: clampOrDefault(params.perHostCap, 0, 100_000, 0),
    respectRobots: params.respectRobots !== false,
    paceMs: clampOrDefault(params.paceMs, 0, 120_000, 1_000),
    stealth: params.stealth,
    researchDir: params.researchDir,
    startedAtMs: now(),
    budgetMs,
    currentUrl: null,
    totals: {
      crawled: 0,
      kept: 0,
      gated: 0,
      fetchFailed: 0,
      robotsBlocked: 0,
      circuitOpen: 0,
      assetsSaved: 0,
      persistedWritten: 0,
      persistedUpdated: 0
    },
    recentPages: [],
    gatedUrls: [],
    exportPaths: {},
    stopRequested: false,
    stoppedReason: undefined,
    finishedAtMs: undefined,
    report: undefined,
    reportError: undefined,
    error: undefined,
    nowImpl: now
  };

  JOBS.set(id, job);
  mostRecentId = id;

  const promise = runJob(job, {
    crawlImpl,
    fetchImpl,
    persistImpl,
    coveredHashesImpl,
    exportImpl,
    robotsImpl,
    assetImpl,
    reportImpl,
    now,
    sleepImpl
  }).catch((e) => {
    // Last-resort guard: runJob's own finally is designed never to let this reject, but nothing
    // may float in a long-lived server process.
    job.state = "failed";
    job.error = e?.message ?? String(e);
    job.finishedAtMs = job.finishedAtMs ?? now();
    job.currentUrl = null;
    releaseJobSlot(job.id);
  });
  job.promise = promise;

  return { id };
}

/**
 * The crawl loop: build the injected surface crawlSite needs (obscura fetch, robots, capped asset
 * downloader bound to this job's limits, persist/export/covered) plus cooperative stop + progress,
 * run it, and write a run report on EVERY exit path. The `finally` is the single place state is
 * finalized and the shared slot released.
 * @param {any} job @param {any} deps
 */
async function runJob(job, deps) {
  const {
    crawlImpl,
    fetchImpl,
    persistImpl,
    coveredHashesImpl,
    exportImpl,
    robotsImpl,
    assetImpl,
    reportImpl,
    now,
    sleepImpl
  } = deps;

  let fatal = false;
  try {
    const shouldStop = () => job.stopRequested || now() - job.startedAtMs >= job.budgetMs;
    /** @param {{url:string,depth:number,status:string,title?:string}} rec */
    const onPage = (rec) => {
      job.currentUrl = rec.url;
      job.recentPages.push({
        url: rec.url,
        depth: rec.depth,
        status: rec.status,
        title: rec.title ?? ""
      });
      if (job.recentPages.length > RECENT_PAGES_MAX) job.recentPages.shift();
      const t = job.totals;
      if (rec.status === "kept") {
        t.crawled++;
        t.kept++;
      } else if (rec.status === "skipped-no-keyword") {
        t.crawled++;
      } else if (rec.status === "gated") {
        t.crawled++;
        t.gated++;
        if (job.gatedUrls.length < GATED_URLS_MAX) job.gatedUrls.push(rec.url);
      } else if (rec.status === "fetch-failed") {
        t.fetchFailed++;
      } else if (rec.status === "robots-blocked") {
        t.robotsBlocked++;
      } else if (rec.status === "circuit-open") {
        t.circuitOpen++;
      }
    };

    const out = await crawlImpl(
      {
        seeds: job.seeds,
        allow: job.allow,
        maxDepth: job.maxDepth,
        maxPages: job.maxPages,
        keywords: job.keywords,
        topic: job.topic,
        downloadAssets: job.downloadAssets,
        assetMaxCount: job.assetMaxCount,
        perHostCap: job.perHostCap,
        respectRobots: job.respectRobots,
        stealth: job.stealth,
        paceMs: job.paceMs,
        researchDir: job.researchDir
      },
      {
        fetchImpl,
        persistImpl,
        coveredHashesImpl,
        exportImpl,
        robotsImpl,
        assetImpl: (url, o) =>
          assetImpl(url, {
            topic: job.topic,
            kind: o.kind,
            researchDir: job.researchDir,
            maxBytes: job.assetMaxBytes
          }),
        shouldStop,
        onPage,
        sleepImpl
      }
    );

    // crawlSite's return is authoritative (assetsSaved/persisted counts the live onPage view can't
    // see) — adopt it wholesale.
    job.totals = {
      crawled: out.crawled,
      kept: out.kept,
      gated: out.gated,
      fetchFailed: out.fetchFailed,
      robotsBlocked: out.robotsBlocked,
      circuitOpen: out.circuitOpen,
      assetsSaved: out.assetsSaved,
      persistedWritten: out.persistedWritten,
      persistedUpdated: out.persistedUpdated
    };
    job.exportPaths = out.exportPaths ?? {};
    job.stoppedReason = job.stopRequested ? "stop_requested" : out.stoppedReason;
  } catch (e) {
    fatal = true;
    job.error = e?.message ?? String(e);
  } finally {
    job.finishedAtMs = now();
    job.currentUrl = null;
    const content = renderCrawlReport(job);
    const rep = await reportImpl({
      topic: job.topic,
      content,
      filename: `crawl-${new Date(job.finishedAtMs).toISOString().replace(/[:.]/g, "-")}.md`,
      researchDir: job.researchDir
    }).catch((e) => {
      job.reportError = e?.message ?? String(e);
      return null;
    });
    if (rep) job.report = rep.path;
    job.state = job.stopRequested ? "stopped" : fatal ? "failed" : "done";
    releaseJobSlot(job.id);
  }
}

/**
 * Read-only snapshot (JSON-safe, never the live record).
 * @param {string} [jobId] omitted -> most recently started
 * @returns {object|null}
 */
export function getCrawlJob(jobId) {
  const id = jobId ?? mostRecentId;
  const job = id ? JOBS.get(id) : undefined;
  if (!job) return null;
  return toSnapshot(job);
}

/**
 * Request a graceful stop — the in-flight page finishes and the crawl breaks on its next
 * top-of-loop `shouldStop` check, then the report is written. Returns the snapshot immediately.
 * @param {string} [jobId] omitted -> most recently started
 * @returns {object}
 */
export function stopCrawlJob(jobId) {
  const id = jobId ?? mostRecentId;
  const job = id ? JOBS.get(id) : undefined;
  if (!job) {
    throw new CrawlJobError(
      id ? `no crawl job "${id}" found` : "no crawl job has been started",
      "unknown_job"
    );
  }
  job.stopRequested = true;
  return toSnapshot(job);
}

/** Test helper: reset the registry. Refuses while any job is running (its promise would leak). */
export function clearCrawlJobs() {
  for (const job of JOBS.values()) {
    if (job.state === "running") {
      throw new CrawlJobError(
        "a crawl job is still running — stop it and let it finish before clearing",
        "job_active"
      );
    }
  }
  // Release the shared slot only if THIS registry's (now-cleared) job holds it — never stomp a
  // research job's slot.
  const holder = jobSlotHolder();
  if (holder && holder.kind === "crawl") releaseJobSlot(holder.id);
  JOBS.clear();
  mostRecentId = null;
}

/**
 * Render a finished (or in-progress) crawl job as its Markdown run report. Pure function of `job`
 * — directly testable. Points at the machine-readable export for the full record; inlines the
 * totals, a recent-pages sample, and the FULL gated-URL list (the pages the user would need their
 * own login to read — the one place this crawler surfaces "here's what you'd have to sign in for").
 * @param {any} job
 * @returns {string}
 */
export function renderCrawlReport(job) {
  const startedIso = new Date(job.startedAtMs).toISOString();
  const finishedIso = new Date(job.finishedAtMs ?? job.nowImpl()).toISOString();
  const t = job.totals;

  const frontmatter = [
    "---",
    `topic: ${JSON.stringify(job.topic)}`,
    `started: ${JSON.stringify(startedIso)}`,
    `finished: ${JSON.stringify(finishedIso)}`,
    `seeds: ${JSON.stringify(job.seeds)}`,
    `pages_crawled: ${t.crawled}`,
    `pages_kept: ${t.kept}`,
    `gated: ${t.gated}`,
    `circuit_open: ${t.circuitOpen}`,
    `assets_saved: ${t.assetsSaved}`,
    `stopped_reason: ${JSON.stringify(job.stoppedReason ?? "")}`,
    `origin: "crawl"`,
    "---",
    ""
  ].join("\n");

  const lines = [frontmatter, `# Crawl run: ${job.topic}`, ""];

  lines.push("## Seeds", "");
  for (const s of job.seeds) lines.push(`- ${s}`);
  lines.push("");

  lines.push("## Config", "");
  lines.push(`- max_depth: ${job.maxDepth}`);
  lines.push(`- max_pages: ${job.maxPages}`);
  lines.push(
    `- allow: ${job.allow ? job.allow.join(", ") : `(seed hosts: ${job.seeds.map((s) => hostOf(s)).join(", ")})`}`
  );
  lines.push(`- keywords: ${job.keywords ? job.keywords.join(", ") : "(none — keep all)"}`);
  lines.push(`- download_assets: ${job.downloadAssets}`);
  lines.push(`- respect_robots: ${job.respectRobots}`);
  lines.push("");

  lines.push("## Totals", "");
  lines.push(
    "| crawled | kept | gated | fetch-failed | robots-blocked | circuit-open | assets | persisted |"
  );
  lines.push("|---|---|---|---|---|---|---|---|");
  lines.push(
    `| ${t.crawled} | ${t.kept} | ${t.gated} | ${t.fetchFailed} | ${t.robotsBlocked} | ` +
      `${t.circuitOpen} | ${t.assetsSaved} | ${t.persistedWritten}+${t.persistedUpdated} |`
  );
  lines.push("");

  if (job.exportPaths.json || job.exportPaths.csv) {
    lines.push("## Export", "");
    if (job.exportPaths.json) lines.push(`- JSON: ${job.exportPaths.json}`);
    if (job.exportPaths.csv) lines.push(`- CSV: ${job.exportPaths.csv}`);
    lines.push("");
  }

  lines.push("## Recent pages", "");
  if (job.recentPages.length) {
    for (const p of job.recentPages.slice(-RECENT_PAGES_MAX)) {
      lines.push(`- [${p.status}] (d${p.depth}) ${p.title ? `${p.title} — ` : ""}${p.url}`);
    }
  } else {
    lines.push("(none)");
  }
  lines.push("");

  // Always present, even when empty — this is where "pages you'd need your own login to read"
  // surfaces, the honest output of the ADR-0062 boundary (never defeat a wall, report it).
  lines.push("## Gated pages (need your own login — not crawled)", "");
  if (job.gatedUrls.length) {
    for (const u of job.gatedUrls) lines.push(`- ${u}`);
  } else {
    lines.push("(none)");
  }
  lines.push("");

  return lines.join("\n");
}
