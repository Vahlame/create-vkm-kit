/**
 * Background deep-research orchestrator (ADR-0057, fourth addendum's revisit trigger).
 *
 * The user wants research that runs like a human researcher spends on a hard question —
 * 10-20 minutes, several seed topics, then iteratively chasing subtopics, correlated areas,
 * cross-domain analogies and application ideas, all anchored to one objective. No single MCP
 * tool call can ever do that: the SDK's `DEFAULT_REQUEST_TIMEOUT_MSEC = 60000` is enforced
 * CLIENT-side (`resetTimeoutOnProgress` defaults false, protocol.js:714) and the server cannot
 * extend it — see research.mjs's own header for the same wall applied to a single round. ADR-
 * 0057's fourth addendum declined background continuation for the interactive agent-loop case
 * but named the revisit trigger explicitly: an unattended long run. This module is that trigger
 * firing. The long loop moves INSIDE the MCP server process: `startResearchJob` returns in
 * milliseconds, each round persists to disk as it finishes (a killed process loses nothing
 * already banked), and `getResearchJob` is just a snapshot read of in-memory state — no polling
 * transport, no client-side timer to babysit.
 *
 * Each round reuses `deepResearch` WHOLE (expansion, gather, fusion, curation, sanitization,
 * excludeHashes) — this module is orchestration only, never a second implementation of the
 * crawl. Pacing between rounds and the suspension cooldown both exist for the same reason
 * ADR-0057 §6 documents: an unthrottled 15-minute fan-out is exactly what suspended every
 * SearXNG engine on this machine during development, and a suspended engine answers `200` +
 * `[]` rather than erroring — so a background job that doesn't watch for that grinds a banned
 * machine for the rest of its budget instead of noticing. One active job at a time, for the
 * identical reason.
 *
 * Suspension is TRANSIENT (SearXNG's own suspended_times: 180s-3600s), so the loop treats it
 * as weather, not as failure: a round whose search dies or comes back banned re-enqueues its
 * query at the END of the frontier (bounded attempts, never silently dropped), and a streak of
 * suspicious rounds parks the whole job in an exponential global cooldown — zero upstream
 * requests while it waits, `cooldownUntil` visible in the status snapshot — then resumes while
 * budget remains. A job only ends `"failed"` when it produced NOT ONE useful round (or hit a
 * structural error like a missing research root); a run that banked useful rounds but had to
 * leave work behind ends `"done-partial"` with the leftovers listed as resumable in the run
 * report. The earlier design (fail hard after 3 consecutive errors, terminal stop after 2
 * banned rounds) burned 26 of a 30-minute budget exactly the way this paragraph forbids.
 */
import { randomUUID } from "node:crypto";
import { deepResearch } from "./research.mjs";
import {
  persistResults,
  listCoveredHashes,
  writeRunReport,
  validateTopic
} from "./research-persist.mjs";
import { generateLeads } from "./ollama-client.mjs";
import { ensureSearxng } from "./ensure-searxng.mjs";
import { hash8 } from "./url-identity.mjs";
import { similarityRatio } from "./text-similarity.mjs";

/** Floor for a round's own deadline — below this a round cannot do meaningful work (one
 * SearXNG round-trip plus at least a couple of fetch+curate cycles), so the budget check stops
 * the job rather than dispatch a round doomed to return almost nothing. */
const MIN_ROUND_MS = 20_000;
/** Reserved off the tail of the budget for `renderRunReport` + the final persisted write —
 * both run in the `finally`, after the last round, and must not themselves blow the budget. */
const REPORT_RESERVE_MS = 5_000;
/** Cap on queued-but-not-yet-processed frontier items. Leads compound (each round can spawn
 * several), and without a ceiling a wide topic could grow the queue unboundedly while the job
 * itself is still bounded by `MAX_ROUNDS`/budget — the excess would just be dead weight. */
const FRONTIER_CAP = 30;
/** `similarityRatio` threshold above which a proposed lead is treated as a near-duplicate of
 * something already seen/queued. High on purpose (see rank thresholds elsewhere in this
 * package): this rejects near-identical PHRASING, not merely related topics. */
const LEAD_SIMILARITY = 0.85;
/** Attempts (first try included) a single frontier item gets before it is moved to the job's
 * `abandoned` list instead of re-enqueued. Bounds the retry loop per query so a genuinely
 * broken query (or a permanent outage) cannot cycle forever, while a transient suspension gets
 * real second chances after a cooldown. */
const MAX_ITEM_ATTEMPTS = 3;
/** Suspicious rounds IN A ROW (thrown search error classified as suspension, or a `200 + []`
 * banned round) before the job parks in a global cooldown. 2, not 1: one banned answer can be
 * a single engine hiccup; two in a row is the wall ADR-0057 §6 describes. */
const SUSPICION_STREAK_LIMIT = 2;
/** ANY-error rounds in a row (suspension-classified or not) before cooling down anyway —
 * covers outages that don't pattern-match suspension (SearXNG down, network gone) but might
 * equally heal with time. Higher than the suspicion limit because the signal is weaker. */
const ERROR_STREAK_LIMIT = 3;
/** Phrases upstream failures use when the machine is rate-limited/banned rather than the query
 * being thin — sourced verbatim from SearXNG suspension reasons and serp.mjs's own error text.
 * `countSuspensionSignals` needs >= SUSPENSION_MIN_SIGNALS distinct matches to classify. */
const SUSPENSION_SIGNALS =
  /suspended|captcha|too many requests|access denied|rate.?limit|every source failed|0 results parsed/gi;
const SUSPENSION_MIN_SIGNALS = Math.max(1, Number(process.env.OBSCURA_DEEP_SUSPENSION_MIN) || 2);
/** Base duration of the global cooldown (doubles per consecutive cooldown, capped below).
 * Default 2 min: SearXNG's shortest suspended_time is 180s, and the pace/retry cycle in front
 * of the cooldown already spends most of the first minute. Override per job (`cooldownMs`) or
 * via env. */
const COOLDOWN_BASE_MS = Number(process.env.OBSCURA_DEEP_COOLDOWN_MS) || 120_000;
/** Ceiling for the exponential cooldown — beyond ~10 min a longer wait is indistinguishable
 * from giving up, and the budget check will end the job honestly instead. */
const COOLDOWN_MAX_MS = Number(process.env.OBSCURA_DEEP_COOLDOWN_MAX_MS) || 600_000;
/** Cooldown sleeps happen in slices this long so `stopRequested` stays responsive mid-cooldown
 * — a user stopping a job must not wait out a 10-minute sleep first. */
const COOLDOWN_SLICE_MS = 5_000;
/** Hard ceiling on rounds regardless of remaining budget — a runaway lead generator (or a
 * pathological `similarityRatio` miss) must not turn one job into an unbounded crawl. */
const MAX_ROUNDS = 40;
/** How many FINISHED jobs the registry keeps for later inspection (`getResearchJob` by id).
 * Bounded because this is a long-lived MCP process — an unbounded job history is a slow leak
 * exactly like the caches in research.mjs. */
const JOB_HISTORY_MAX = 5;

/** The one error type every synchronous validation/registry failure in this module collapses
 * into — same convention as {@link ResearchPersistError}: a `code` a caller (or test) can
 * match on, a message safe to surface to the agent verbatim.
 */
export class DeepResearchError extends Error {
  /** @param {string} message @param {string} code */
  constructor(message, code) {
    super(message);
    this.name = "DeepResearchError";
    this.code = code;
  }
}

/** @param {unknown} value @param {number} lo @param {number} hi @param {number} fallback
 * @returns {number} */
function clampOrDefault(value, lo, hi, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, lo), hi);
}

/** @param {unknown} value @param {number} fallback @returns {number} */
function numOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** How many rate-limit/ban phrases an error message carries. The observed fatal message —
 * "every source failed or returned nothing (duckduckgo: 0 results parsed)" — scores 2; a lone
 * engine timeout scores 0 and stays a generic error (the weaker ERROR_STREAK_LIMIT path).
 * @param {unknown} message @returns {number} */
function countSuspensionSignals(message) {
  return (String(message ?? "").match(SUSPENSION_SIGNALS) ?? []).length;
}

/** Strip serp.mjs's interactive-agent advice from an error before it becomes a JOB-level
 * message: "Fall back to the native WebSearch tool" is correct guidance inside an
 * `obscura_search` tool result, and meaningless inside a background job nobody is watching —
 * the observed failure surfaced it verbatim as the job's cause of death. Round entries keep
 * the original text (evidence); only the job-level summary is rephrased.
 * @param {unknown} message @returns {string} */
function stripInteractiveAdvice(message) {
  return String(message ?? "")
    .replace(/\s*Fall back to the native WebSearch tool for this query\.?/i, "")
    .trim();
}

// ── Registry ─────────────────────────────────────────────────────────────────────────────
// Module-level Map, not per-call state: a background job must outlive the tool call that
// started it, and `getResearchJob`/`stopResearchJob` need to find it from a LATER, unrelated
// tool call in the same server process.

/** @type {Map<string, any>} jobId -> internal job record (never returned to a caller directly —
 * see {@link toSnapshot}) */
const JOBS = new Map();
/** @type {string|null} id of the most recently STARTED job — what `jobId` omitted resolves to. */
let mostRecentId = null;

/**
 * Deep, JSON-safe view of an internal job record — never the record itself, which holds a
 * mutable `frontier` array, a stored promise, and injected fn references. `structuredClone`
 * over a plain-object projection is enough (no functions/Sets/Maps survive into `view`).
 * @param {any} job
 * @returns {object}
 */
function toSnapshot(job) {
  const finished = job.state !== "running";
  const nowMs = job.nowImpl();
  const view = {
    id: job.id,
    state: job.state,
    objective: job.objective,
    topic: job.topic,
    topics: job.topics,
    startedAt: new Date(job.startedAtMs).toISOString(),
    budgetMs: job.budgetMs,
    elapsedMs: (finished ? job.finishedAtMs : nowMs) - job.startedAtMs,
    remainingMs: finished ? 0 : Math.max(0, job.startedAtMs + job.budgetMs - nowMs),
    searxng: job.searxng,
    currentQuery: job.currentQuery ?? null,
    // Non-null while the job is parked waiting out an engine suspension — the caller's answer
    // to "why is nothing happening": zero upstream requests until this instant passes.
    cooldownUntil: job.cooldownUntilMs ? new Date(job.cooldownUntilMs).toISOString() : null,
    roundsTotal: job.rounds.length,
    rounds: job.rounds.slice(-20),
    totals: { ...job.totals },
    topFindings: job.topFindings.slice(0, 15),
    pendingLeads: job.frontier
      .slice(0, 15)
      .map((f) => ({ query: f.query, kind: f.kind, why: f.why, depth: f.depth })),
    frontierSize: job.frontier.length,
    // Queries that exhausted MAX_ITEM_ATTEMPTS — reported (and listed in the run report as
    // resumable) rather than silently vanishing from the frontier.
    abandonedQueries: (job.abandoned ?? [])
      .slice(0, 15)
      .map((a) => ({ query: a.query, kind: a.kind, depth: a.depth, error: a.error })),
    // `remainingMs` is 0 for every finished job BY DEFINITION (nothing is left to run); this
    // is the honest companion: how much of the budget the job never got to use. The observed
    // failure read as "26 min cancelled" precisely because only remainingMs:0 was reported.
    ...(finished
      ? { budgetUnusedMs: Math.max(0, job.startedAtMs + job.budgetMs - job.finishedAtMs) }
      : {}),
    ...(job.stoppedReason !== undefined ? { stoppedReason: job.stoppedReason } : {}),
    ...(job.report !== undefined ? { report: job.report } : {}),
    ...(job.reportError !== undefined ? { reportError: job.reportError } : {}),
    ...(job.error !== undefined ? { error: job.error } : {})
  };
  return structuredClone(view);
}

/** Evict the oldest finished jobs until fewer than {@link JOB_HISTORY_MAX} remain — called
 * right before a new job is registered, so the new (running) job never counts against its own
 * limit. Only ever touches non-running jobs; the caller has already confirmed none are running. */
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
 * Validate params synchronously and register a new background research job; the async crawl
 * loop is kicked off unawaited (its promise is stored on the job and `.catch`-handled — the
 * loop itself never rejects, see {@link runJob}'s `finally`, but nothing may float regardless).
 * @param {{ objective: string, topics: string[], topic: string, budgetMs?: number,
 *           roundMs?: number, paceMs?: number, cooldownMs?: number, maxDepth?: number,
 *           topK?: number, maxCandidates?: number, subQueries?: number, dropBelow?: number,
 *           passageChars?: number, categories?: string, stealth?: boolean,
 *           researchDir?: string, searxngUrl?: string }} params
 * @param {{ researchImpl?: typeof deepResearch, persistImpl?: typeof persistResults,
 *           coveredHashesImpl?: typeof listCoveredHashes, reportImpl?: typeof writeRunReport,
 *           leadsImpl?: typeof generateLeads, ensureImpl?: typeof ensureSearxng,
 *           now?: () => number, sleepImpl?: (ms: number) => Promise<void> }} [deps]
 * @returns {{ id: string }}
 */
export function startResearchJob(params, deps = {}) {
  const objective = typeof params.objective === "string" ? params.objective.trim() : "";
  if (!objective) {
    throw new DeepResearchError("objective must be a non-empty string", "invalid_params");
  }

  const topicsIn = params.topics;
  if (
    !Array.isArray(topicsIn) ||
    topicsIn.length < 1 ||
    topicsIn.length > 6 ||
    topicsIn.some((t) => typeof t !== "string" || !t.trim())
  ) {
    throw new DeepResearchError(
      "topics must be an array of 1-6 non-empty strings",
      "invalid_params"
    );
  }
  const topics = topicsIn.map((t) => t.trim());

  // Not wrapped: the contract is to let ResearchPersistError propagate as-is, so a caller
  // matching on ITS codes (invalid_topic) doesn't have to also know this module's codes.
  const topic = validateTopic(params.topic);

  for (const job of JOBS.values()) {
    if (job.state === "running") {
      throw new DeepResearchError(
        `another research job "${job.id}" is still running — one at a time (fan-out bans the ` +
          `machine, ADR-0057)`,
        "job_active"
      );
    }
  }
  evictOldFinished();

  const budgetMs = clampOrDefault(params.budgetMs, 60_000, 1_800_000, 900_000);
  const roundMs = clampOrDefault(
    params.roundMs,
    20_000,
    300_000,
    Number(process.env.OBSCURA_DEEP_ROUND_MS) || 100_000
  );
  const paceMs = clampOrDefault(
    params.paceMs,
    0,
    120_000,
    Number(process.env.OBSCURA_DEEP_PACE_MS) || 15_000
  );
  const cooldownMs = clampOrDefault(params.cooldownMs, 30_000, 900_000, COOLDOWN_BASE_MS);
  const maxDepth = clampOrDefault(params.maxDepth, 0, 4, 2);

  const {
    researchImpl = deepResearch,
    persistImpl = persistResults,
    coveredHashesImpl = listCoveredHashes,
    reportImpl = writeRunReport,
    leadsImpl = generateLeads,
    ensureImpl = ensureSearxng,
    now = Date.now,
    sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  } = deps;

  const id = `deep-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

  const job = {
    id,
    state: "running",
    objective,
    topic,
    topics,
    startedAtMs: now(),
    budgetMs,
    roundMs,
    paceMs,
    cooldownMs,
    cooldownUntilMs: null,
    maxDepth,
    topK: numOr(params.topK, 12),
    maxCandidates: numOr(params.maxCandidates, 60),
    subQueries: numOr(params.subQueries, 4),
    dropBelow: params.dropBelow,
    passageChars: params.passageChars,
    categories: params.categories,
    stealth: params.stealth,
    researchDir: params.researchDir,
    searxngUrlParam: params.searxngUrl,
    resolvedSearxngUrl: null,
    searxng: false,
    currentQuery: null,
    rounds: [],
    totals: {
      rounds: 0,
      usefulRounds: 0,
      fetched: 0,
      curated: 0,
      persistedWritten: 0,
      persistedUpdated: 0,
      leadsGenerated: 0,
      leadsFailed: 0,
      retries: 0,
      cooldowns: 0,
      abandoned: 0
    },
    topFindings: [],
    frontier: [],
    abandoned: [],
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
    researchImpl,
    persistImpl,
    coveredHashesImpl,
    reportImpl,
    leadsImpl,
    ensureImpl,
    now,
    sleepImpl
  }).catch((e) => {
    // `runJob`'s own try/catch/finally is designed to never let this reject — this is a last-
    // resort guard so a genuinely unexpected throw still lands as a typed, visible job state
    // instead of an unhandled rejection with no observer.
    job.state = "failed";
    job.error = e?.message ?? String(e);
    job.finishedAtMs = job.finishedAtMs ?? now();
    job.currentQuery = null;
  });
  job.promise = promise;

  return { id };
}

/** Compute and apply the inter-round pace sleep (loop step m). Doubled while `troubleStreak > 0`
 * (a suspicious or errored round just happened) — the same backoff-on-suspicion idea as
 * `SEARX_CACHE`'s TTL in research.mjs, applied to the job's own pacing: a machine that just got
 * one banned round is a machine that should slow down before finding out whether the second one
 * confirms a full suspension.
 * @param {any} job @param {(ms: number) => Promise<void>} sleepImpl @param {() => number} now
 * @param {number} troubleStreak */
async function paceSleep(job, sleepImpl, now, troubleStreak) {
  const pace = troubleStreak > 0 ? job.paceMs * 2 : job.paceMs;
  const sleepFor = Math.min(
    pace,
    Math.max(0, job.startedAtMs + job.budgetMs - now() - MIN_ROUND_MS - REPORT_RESERVE_MS)
  );
  if (sleepFor > 0) await sleepImpl(sleepFor);
}

/**
 * Park the job in a global cooldown: `cooldownMs * 2^cooldownCount` (capped at
 * COOLDOWN_MAX_MS), slept in COOLDOWN_SLICE_MS slices so `stopRequested` stays responsive.
 * Refuses (returns false) when the FULL cooldown plus one minimum round plus the report
 * reserve no longer fits the remaining budget — cooling down for 10s against a 180s
 * suspension is just a slower way to grind a banned machine, so the caller ends the job
 * gracefully instead. `job.cooldownUntilMs` is set for the whole wait (visible in snapshots)
 * and always cleared on the way out, including a stop-requested early exit.
 * @param {any} job @param {(ms: number) => Promise<void>} sleepImpl @param {() => number} now
 * @param {number} cooldownCount consecutive cooldowns without a useful round in between
 * @returns {Promise<boolean>} whether the cooldown ran (false: budget can't fit it)
 */
async function coolDown(job, sleepImpl, now, cooldownCount) {
  const wanted = Math.min(job.cooldownMs * 2 ** cooldownCount, COOLDOWN_MAX_MS);
  const available = job.startedAtMs + job.budgetMs - now() - MIN_ROUND_MS - REPORT_RESERVE_MS;
  if (available < wanted) return false;

  job.cooldownUntilMs = now() + wanted;
  job.totals.cooldowns++;
  try {
    while (!job.stopRequested && now() < job.cooldownUntilMs) {
      await sleepImpl(Math.min(COOLDOWN_SLICE_MS, job.cooldownUntilMs - now()));
    }
  } finally {
    job.cooldownUntilMs = null;
  }
  return true;
}

/**
 * Re-enqueue a failed/banned frontier item at the END of the queue (never the front — the
 * rest of the frontier deserves its turn first, and by then the suspension may have lifted),
 * or move it to `job.abandoned` once MAX_ITEM_ATTEMPTS is spent. Never a silent drop: the
 * abandoned list reaches both the snapshot and the run report as resumable work.
 * @param {any} job @param {any} item @param {string|null} error
 * @returns {{ attempt: number, requeued: boolean }}
 */
function requeueOrAbandon(job, item, error) {
  const attempt = (item.attempts ?? 0) + 1;
  const requeued = attempt < MAX_ITEM_ATTEMPTS;
  if (requeued) {
    // Deliberately NOT gated by FRONTIER_CAP: the cap bounds NEW leads; an item already
    // admitted to the frontier keeps its slot when it retries.
    job.frontier.push({ ...item, attempts: attempt });
    job.totals.retries++;
  } else {
    job.abandoned.push({
      query: item.query,
      kind: item.kind,
      depth: item.depth,
      ...(item.why ? { why: item.why } : {}),
      error: error ?? "no results (engines suspended)"
    });
    job.totals.abandoned++;
  }
  return { attempt, requeued };
}

/**
 * The background crawl loop. Every branch that can end the job sets `job.stoppedReason` (a
 * graceful stop) OR flips the local `fatal` flag (an unrecoverable one) — the `finally` is the
 * single place that turns either into the job's final `state`, so a throw ANYWHERE inside the
 * loop (not just the branches that anticipate failure) still reaches the report-writing step.
 *
 * Failure taxonomy (the observed 4-minutes-of-a-30-minute-budget death was the old design
 * getting this wrong):
 *   - a round's search THROWING or coming back banned (`200 + []` + engines down) is WEATHER —
 *     the item re-enqueues (bounded attempts) and a streak of it parks the job in `coolDown`;
 *   - `fatal` is reserved for structural errors (missing research root, invalid topic, an
 *     unexpected loop throw) that no amount of waiting fixes;
 *   - `"failed"` additionally requires that the job banked ZERO useful rounds — a job with
 *     useful rounds that had to leave work behind is `"done-partial"`, never `"failed"`.
 * @param {any} job @param {{ researchImpl: typeof deepResearch, persistImpl: typeof
 *           persistResults, coveredHashesImpl: typeof listCoveredHashes, reportImpl: typeof
 *           writeRunReport, leadsImpl: typeof generateLeads, ensureImpl: typeof ensureSearxng,
 *           now: () => number, sleepImpl: (ms: number) => Promise<void> }} deps
 */
async function runJob(job, deps) {
  const {
    researchImpl,
    persistImpl,
    coveredHashesImpl,
    reportImpl,
    leadsImpl,
    ensureImpl,
    now,
    sleepImpl
  } = deps;

  let fatal = false;
  // Suspicious rounds in a row: a thrown search error that pattern-matches suspension, OR a
  // returned-but-banned round (scanned:0 + engines down). Reset only by a USEFUL round — a
  // generic error in the middle of a suspension must not launder the streak.
  let suspicionStreak = 0;
  // ANY thrown-error rounds in a row (superset trigger with a higher limit). Reset by any
  // round that returns at all — the transport works, whatever the results look like.
  let errorStreak = 0;
  // Consecutive cooldowns without a useful round in between — the exponent of the backoff.
  let cooldownCount = 0;
  // Most recent round error, for the job-level failure summary in the `finally`.
  let lastRoundError = null;

  try {
    const searxngUrl = job.searxngUrlParam ?? (await ensureImpl().catch(() => null));
    job.resolvedSearxngUrl = searxngUrl;
    job.searxng = Boolean(searxngUrl);

    const covered = await coveredHashesImpl(job.topic, job.researchDir).catch(() => new Set());

    job.frontier = job.topics.map((q) => ({
      query: q.trim(),
      kind: "seed",
      depth: 0,
      parent: null
    }));
    const seen = new Set(job.frontier.map((f) => f.query.toLowerCase()));

    for (;;) {
      if (job.stopRequested) {
        job.stoppedReason = "stop_requested";
        break;
      }

      const remaining = job.startedAtMs + job.budgetMs - now();
      if (remaining < MIN_ROUND_MS + REPORT_RESERVE_MS) {
        job.stoppedReason = "budget_exhausted";
        break;
      }

      if (job.rounds.length >= MAX_ROUNDS) {
        job.stoppedReason = "max_rounds";
        break;
      }

      const item = job.frontier.shift();
      if (!item) {
        job.stoppedReason = "frontier_empty";
        break;
      }

      job.currentQuery = { query: item.query, kind: item.kind, depth: item.depth };
      const deadlineMs = Math.min(job.roundMs, remaining - REPORT_RESERVE_MS);

      let res;
      try {
        res = await researchImpl(item.query, {
          maxCandidates: job.maxCandidates,
          topK: job.topK,
          subQueries: job.subQueries,
          dropBelow: job.dropBelow,
          passageChars: job.passageChars,
          categories: job.categories,
          stealth: job.stealth,
          excludeHashes: covered,
          deadlineMs,
          searxngUrl: job.resolvedSearxngUrl ?? ""
        });
      } catch (e) {
        const message = e?.message ?? String(e);
        lastRoundError = message;
        const { attempt, requeued } = requeueOrAbandon(job, item, message);
        // Verbatim message in the round entry — it is the evidence trail; only the JOB-level
        // summary (finally) strips the interactive-tool advice baked into serp.mjs's error.
        job.rounds.push({
          query: item.query,
          kind: item.kind,
          depth: item.depth,
          parent: item.parent,
          error: message,
          attempt,
          ...(requeued ? { requeued: true } : { abandoned: true })
        });
        errorStreak++;
        if (countSuspensionSignals(message) >= SUSPENSION_MIN_SIGNALS) suspicionStreak++;
        if (
          (suspicionStreak >= SUSPICION_STREAK_LIMIT || errorStreak >= ERROR_STREAK_LIMIT) &&
          job.frontier.length > 0
        ) {
          suspicionStreak = 0;
          errorStreak = 0;
          if (!(await coolDown(job, sleepImpl, now, cooldownCount++))) {
            // The remaining budget can't hold a full cooldown + one more round: end gracefully
            // with everything banked; final state comes from the useful-rounds rule.
            job.stoppedReason = "engines_suspended";
            break;
          }
          continue; // the cooldown already paced far beyond paceMs
        }
        await paceSleep(job, sleepImpl, now, suspicionStreak + errorStreak);
        continue;
      }
      errorStreak = 0;

      let persisted = { written: 0, updated: 0 };
      let persistError;
      try {
        persisted = await persistImpl({
          topic: job.topic,
          query: item.query,
          results: res.results,
          researchDir: job.researchDir
        });
      } catch (e) {
        if (e && (e.code === "missing_root" || e.code === "invalid_topic")) {
          fatal = true;
          job.error = e.message;
          break;
        }
        persistError = e?.message ?? String(e);
        persisted = { written: 0, updated: 0 };
      }

      for (const r of res.results ?? []) {
        if (r && r.url) covered.add(hash8(r.url));
      }

      const curatedKept = (res.results ?? []).filter(
        (r) => r.relevant === true && typeof r.relevance === "number"
      );

      // A fully-suspended SearXNG answers 200 + [] (ADR-0057 §6) — `scanned:0` with engines
      // reported down is the one shape that means "banned", not "this query is thin". A banned
      // round is NOT a useful round: the query was never really searched, so it re-enqueues
      // exactly like a thrown search error does.
      const bannedRound = res.scanned === 0 && (res.enginesUnavailable?.length ?? 0) > 0;
      const bannedDisposition = bannedRound ? requeueOrAbandon(job, item, null) : null;

      job.rounds.push({
        query: item.query,
        kind: item.kind,
        depth: item.depth,
        parent: item.parent,
        ...(item.why ? { why: item.why } : {}),
        source: res.source,
        scanned: res.scanned,
        fetched: res.fetched,
        kept: res.results.length,
        curated: curatedKept.length,
        dropped: res.dropped ?? 0,
        alreadyCovered: res.alreadyCovered ?? 0,
        persisted: { written: persisted.written, updated: persisted.updated },
        ...(res.enginesUnavailable ? { enginesUnavailable: res.enginesUnavailable } : {}),
        ...(persistError ? { persistError } : {}),
        ...(bannedDisposition
          ? {
              banned: true,
              attempt: bannedDisposition.attempt,
              ...(bannedDisposition.requeued ? { requeued: true } : { abandoned: true })
            }
          : {})
      });

      job.totals.rounds++;
      if (!bannedRound) job.totals.usefulRounds++;
      job.totals.fetched += res.fetched ?? 0;
      job.totals.curated += curatedKept.length;
      job.totals.persistedWritten += persisted.written ?? 0;
      job.totals.persistedUpdated += persisted.updated ?? 0;

      if (curatedKept.length) {
        const additions = curatedKept.map((r) => ({
          title: r.title,
          url: r.url,
          relevance: r.relevance,
          ...(r.reason ? { reason: r.reason } : {}),
          query: item.query
        }));
        job.topFindings = [...job.topFindings, ...additions]
          .sort((a, b) => b.relevance - a.relevance)
          .slice(0, 15);
      }

      if (bannedRound) {
        suspicionStreak++;
        if (suspicionStreak >= SUSPICION_STREAK_LIMIT && job.frontier.length > 0) {
          suspicionStreak = 0;
          if (!(await coolDown(job, sleepImpl, now, cooldownCount++))) {
            job.stoppedReason = "engines_suspended";
            break;
          }
          continue;
        }
        await paceSleep(job, sleepImpl, now, suspicionStreak);
        continue;
      }
      // A useful round is the recovery signal: the machine is being answered again, so the
      // suspicion streak AND the cooldown backoff exponent both reset.
      suspicionStreak = 0;
      cooldownCount = 0;

      if (item.depth < job.maxDepth && curatedKept.length > 0) {
        const findings = curatedKept.slice(0, 8).map((r) => ({
          title: r.title,
          note: String(r.reason || r.snippet || "").slice(0, 200)
        }));
        try {
          const { leads } = await leadsImpl({
            objective: job.objective,
            findings,
            done: [...seen],
            max: 5
          });
          for (const lead of leads ?? []) {
            const q = String(lead.query ?? "").trim();
            if (!q || q.length > 200) continue;
            const key = q.toLowerCase();
            if (seen.has(key)) continue;
            let nearDup = false;
            for (const s of seen) {
              if (similarityRatio(key, s) >= LEAD_SIMILARITY) {
                nearDup = true;
                break;
              }
            }
            if (nearDup) continue;
            if (job.frontier.length >= FRONTIER_CAP) continue;
            seen.add(key);
            job.frontier.push({
              query: q,
              kind: lead.kind,
              why: String(lead.why ?? ""),
              depth: item.depth + 1,
              parent: item.query
            });
            job.totals.leadsGenerated++;
          }
        } catch {
          // Enhancement, never a dependency — same degradation contract expandQuery gets in
          // research.mjs: a bad/absent local model costs breadth (fewer leads), never the round.
          job.totals.leadsFailed++;
        }
      }

      await paceSleep(job, sleepImpl, now, suspicionStreak);
    }
  } catch (e) {
    fatal = true;
    job.error = e?.message ?? String(e);
  } finally {
    job.finishedAtMs = now();
    job.currentQuery = null;
    job.cooldownUntilMs = null;

    // "failed" is reserved for a run that banked NOTHING (or a structural error): rounds were
    // attempted and not one was useful. A run with useful rounds that had to leave work behind
    // (unexplored frontier, abandoned retries) is "done-partial" — the report lists the
    // leftovers as resumable, which is the whole difference between those two words.
    const barren =
      !fatal && !job.stopRequested && job.rounds.length > 0 && job.totals.usefulRounds === 0;
    if (barren && !job.error) {
      job.error =
        "no round produced results — engines suspended or rate-limited" +
        (lastRoundError ? ` (last error: ${stripInteractiveAdvice(lastRoundError)})` : "") +
        ". Wait for the suspension to lift and start a new run; the run report lists every " +
        "unexplored query, and already-persisted URLs are excluded automatically.";
    }
    const partial = job.frontier.length > 0 || job.abandoned.length > 0;
    // Final state is decided BEFORE the report renders so the report can print it; `job.state`
    // itself flips only AFTER the report write, preserving the invariant that a job whose
    // state is no longer "running" has already had its report attempted.
    const outcome = job.stopRequested
      ? "stopped"
      : fatal || barren
        ? "failed"
        : partial
          ? "done-partial"
          : "done";
    job.outcome = outcome;

    const content = renderRunReport(job);
    const rep = await reportImpl({ topic: job.topic, content, researchDir: job.researchDir }).catch(
      (e) => {
        job.reportError = e?.message ?? String(e);
        return null;
      }
    );
    if (rep) job.report = rep.path;
    job.state = outcome;
  }
}

/**
 * Read-only snapshot of a job's current state. JSON-safe (see {@link toSnapshot}), never the
 * live internal record — a caller mutating the returned object cannot affect the running job.
 * @param {string} [jobId] omitted -> the most recently STARTED job
 * @returns {object|null} `null` when no such job (or no job at all) has ever been started
 */
export function getResearchJob(jobId) {
  const id = jobId ?? mostRecentId;
  const job = id ? JOBS.get(id) : undefined;
  if (!job) return null;
  return toSnapshot(job);
}

/**
 * Request a graceful stop: the round already in flight (bounded by `roundMs`) finishes and
 * persists normally, and the loop breaks on its NEXT top-of-loop check rather than being killed
 * mid-round — an in-flight `deepResearch` call is not cancellable without losing whatever it had
 * already curated.
 * @param {string} [jobId] omitted -> the most recently STARTED job
 * @returns {object} the job's snapshot, immediately after the flag is set
 */
export function stopResearchJob(jobId) {
  const id = jobId ?? mostRecentId;
  const job = id ? JOBS.get(id) : undefined;
  if (!job) {
    throw new DeepResearchError(
      id ? `no research job "${id}" found` : "no research job has been started",
      "unknown_job"
    );
  }
  job.stopRequested = true;
  return toSnapshot(job);
}

/** Test helper: reset the registry. Refuses while any job is `running` — silently discarding a
 * live job's handle would leak its promise (still executing, `.catch`-handled but now
 * unreachable from any tool) and make the "one job at a time" guarantee meaningless.
 * @returns {void} */
export function clearResearchJobs() {
  for (const job of JOBS.values()) {
    if (job.state === "running") {
      throw new DeepResearchError(
        "a research job is still running — stop it and let it finish before clearing",
        "job_active"
      );
    }
  }
  JOBS.clear();
  mostRecentId = null;
}

/** @param {Map<string|null, any[]>} byParent @param {string|null} parentKey @param {number} depth
 * @returns {string[]} */
function genealogyLines(byParent, parentKey, depth) {
  const lines = [];
  for (const r of byParent.get(parentKey) ?? []) {
    const indent = "  ".repeat(depth);
    const label = depth === 0 ? r.query : `${r.kind}: ${r.query}${r.why ? ` — ${r.why}` : ""}`;
    lines.push(`${indent}- ${label}`);
    lines.push(...genealogyLines(byParent, r.query, depth + 1));
  }
  return lines;
}

/**
 * Render a finished (or in-progress, for the `finally`-time write) job as the Markdown run
 * report saved to `RESEARCH/<topic>/runs/`. Pure function of `job` — no I/O, no clock reads
 * beyond what `job` already carries — so it is directly testable without running a job at all.
 * @param {any} job
 * @returns {string}
 */
export function renderRunReport(job) {
  const startedIso = new Date(job.startedAtMs).toISOString();
  const finishedIso = new Date(job.finishedAtMs ?? job.nowImpl()).toISOString();

  const frontmatter = [
    "---",
    `topic: ${JSON.stringify(job.topic)}`,
    `objective: ${JSON.stringify(job.objective)}`,
    `started: ${JSON.stringify(startedIso)}`,
    `finished: ${JSON.stringify(finishedIso)}`,
    `budget_ms: ${job.budgetMs}`,
    `rounds: ${job.rounds.length}`,
    `pages_fetched: ${job.totals.fetched}`,
    `curated_relevant: ${job.totals.curated}`,
    `stopped_reason: ${JSON.stringify(job.stoppedReason ?? "")}`,
    `outcome: ${JSON.stringify(job.outcome ?? "")}`,
    `origin: "deep-research"`,
    "---",
    ""
  ].join("\n");

  const lines = [frontmatter, `# Deep research run: ${job.topic}`, ""];

  lines.push("## Objective", "", job.objective, "");

  lines.push("## Topics", "");
  for (const t of job.topics) lines.push(`- ${t}`);
  lines.push("");

  lines.push("## Round log", "");
  lines.push("| # | kind | depth | query | scanned | fetched | curated | dropped | new |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  job.rounds.forEach((r, i) => {
    const queryCell = r.error ? `ERROR: ${r.error}` : r.query;
    lines.push(
      `| ${i + 1} | ${r.kind} | ${r.depth} | ${queryCell} | ${r.scanned ?? ""} | ${r.fetched ?? ""} | ` +
        `${r.curated ?? ""} | ${r.dropped ?? ""} | ${r.persisted?.written ?? ""} |`
    );
  });
  lines.push("");

  lines.push("## Query genealogy", "");
  const byParent = new Map();
  for (const r of job.rounds) {
    const key = r.parent ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(r);
  }
  lines.push(...genealogyLines(byParent, null, 0));
  lines.push("");

  lines.push("## Top findings", "");
  for (const f of job.topFindings) {
    lines.push(`- [${f.relevance}] ${f.title} — ${f.url} — ${f.reason ?? ""}`);
  }
  lines.push("");

  // Required even when empty — this is where application/improvement ideas the job never got
  // to surface for the user, so an empty section must still be a clearly-labeled empty section.
  lines.push("## Unexplored leads", "");
  if (job.frontier.length) {
    for (const p of job.frontier) lines.push(`- (${p.kind}) ${p.query} — ${p.why ?? ""}`);
  } else {
    lines.push("(none)");
  }
  lines.push("");

  // Queries that ran out of retry attempts (engines suspended for longer than the job could
  // wait). Kept separate from the frontier: these were TRIED and lost, not merely never reached.
  const abandoned = job.abandoned ?? [];
  if (abandoned.length) {
    lines.push("## Abandoned after retries", "");
    for (const a of abandoned) lines.push(`- (${a.kind}) ${a.query} — ${a.error}`);
    lines.push("");
  }

  if (job.frontier.length || abandoned.length) {
    lines.push(
      "Resume: pass the queries above as `topics` to a new obscura_research_start run with " +
        "the same topic slug — URLs already persisted under RESEARCH/ are excluded " +
        "automatically, so a resumed run only spends budget on new ground.",
      ""
    );
  }

  return lines.join("\n");
}
