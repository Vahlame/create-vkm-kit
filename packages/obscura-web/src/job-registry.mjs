/**
 * The background-job registry both long-running tools keep.
 *
 * # Why one module
 *
 * `obscura_research_start` and `obscura_crawl_start` are the package's two newest features
 * and the second was built from the first, so they carried the same registry twice:
 * `clampOrDefault` byte-identical, `evictOldFinished` byte-identical, and `get`/`stop`/
 * `clear` differing only in the function name and two message strings. They had already
 * started to diverge where it counts — `obscura-mcp.mjs` enumerates the crawl's finished
 * states in one place while a comment a few hundred lines up documents that exact
 * enumeration going stale for research.
 *
 * What is genuinely per-tool stays per-tool: the job RECORD shape, the loop that fills it,
 * the report renderer, and `toSnapshot` (injected, because the two records are different
 * objects). What is shared is the bookkeeping: which jobs exist, which was most recent,
 * how many finished ones to keep, and the refusal to clear while one is running.
 *
 * Sits next to `job-lock.mjs`, which owns the CROSS-type exclusion (a research job and a
 * crawl cannot both hold the network slot). This module is per-type bookkeeping only.
 *
 * @module
 */

/** How many FINISHED jobs stay inspectable after they end. */
export const JOB_HISTORY_MAX = 5;

/**
 * Coerce `value` to a finite number inside `[lo, hi]`, or fall back.
 *
 * Every tunable a caller can pass to a background job goes through this: a job that runs
 * for half an hour must not be startable with a negative budget or a `NaN` depth, and an
 * MCP caller is a language model, so out-of-range values are a normal input, not an error
 * worth failing a whole job over.
 *
 * @param {unknown} value
 * @param {number} lo
 * @param {number} hi
 * @param {number} fallback used when `value` is not a finite number
 * @returns {number}
 */
export function clampOrDefault(value, lo, hi, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, lo), hi);
}

/**
 * A per-tool registry of background jobs.
 *
 * @param {object} spec
 * @param {string} spec.kind human name used in every message, e.g. "research" / "crawl"
 * @param {new (message: string, code: string) => Error} spec.ErrorClass the tool's own error type,
 *   so a caller keeps catching one thing
 * @param {(job: any) => object} spec.toSnapshot JSON-safe projection of a job record — NEVER the
 *   live record, which holds a stored promise and injected function references
 * @param {number} [spec.historyMax]
 */
export function createJobRegistry({ kind, ErrorClass, toSnapshot, historyMax = JOB_HISTORY_MAX }) {
  /** @type {Map<string, any>} jobId -> internal job record */
  const jobs = new Map();
  /** @type {string|null} the most recently STARTED job — what an omitted `jobId` resolves to. */
  let mostRecentId = null;

  /** The live record for `jobId`, or the most recent one. @param {string} [jobId] */
  const find = (jobId) => {
    const id = jobId ?? mostRecentId;
    return { id, job: id ? jobs.get(id) : undefined };
  };

  const running = () => [...jobs.values()].find((j) => j.state === "running") ?? null;

  return {
    /** The live records, for the loop that owns them. Callers outside get snapshots. */
    jobs,

    /** The one job currently `running`, or null. @returns {any|null} */
    running,

    /**
     * Refuse to start a second job of this kind.
     * @param {string} reason appended after the em dash, e.g. why one at a time
     */
    assertIdle(reason) {
      const live = running();
      if (live) {
        throw new ErrorClass(
          `another ${kind} job "${live.id}" is still running — ${reason}`,
          "job_active"
        );
      }
    },

    /**
     * Drop the oldest FINISHED jobs until fewer than `historyMax` remain, then record `job`
     * as the newest. Eviction runs before registration on purpose, so a new (running) job
     * never counts against its own limit, and it only ever touches non-running records.
     * @param {any} job a record carrying `id`, `state` and `startedAtMs`
     */
    register(job) {
      const finished = [...jobs.values()]
        .filter((j) => j.state !== "running")
        .sort((a, b) => a.startedAtMs - b.startedAtMs);
      while (finished.length >= historyMax) {
        jobs.delete(/** @type {any} */ (finished.shift()).id);
      }
      jobs.set(job.id, job);
      mostRecentId = job.id;
    },

    /**
     * Read-only snapshot of a job's state, or null when no such job has ever been started.
     * @param {string} [jobId] omitted -> the most recently STARTED job
     * @returns {object|null}
     */
    get(jobId) {
      const { job } = find(jobId);
      return job ? toSnapshot(job) : null;
    },

    /**
     * Request a graceful stop: whatever is in flight finishes and persists normally, and the
     * loop breaks on its NEXT top-of-loop check rather than being killed mid-step — work
     * already done is never thrown away.
     * @param {string} [jobId] omitted -> the most recently STARTED job
     * @returns {object} the snapshot taken immediately after the flag is set
     */
    stop(jobId) {
      const { id, job } = find(jobId);
      if (!job) {
        throw new ErrorClass(
          id ? `no ${kind} job "${id}" found` : `no ${kind} job has been started`,
          "unknown_job"
        );
      }
      job.stopRequested = true;
      return toSnapshot(job);
    },

    /**
     * Reset the registry. Refuses while any job is `running`: silently discarding a live
     * job's handle would leak its promise — still executing, `.catch`-handled, but now
     * unreachable from any tool — and make the one-at-a-time guarantee meaningless.
     */
    clear() {
      if (running()) {
        throw new ErrorClass(
          `a ${kind} job is still running — stop it and let it finish before clearing`,
          "job_active"
        );
      }
      jobs.clear();
      mostRecentId = null;
    }
  };
}
