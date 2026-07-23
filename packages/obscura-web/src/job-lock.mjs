/**
 * One background network-job at a time, ACROSS job types (ADR-0062, extending ADR-0057 §6).
 *
 * deep-research.mjs already enforces "one research job at a time" via its own registry, for a
 * documented reason: an unattended multi-round fan-out is exactly what suspends every SearXNG
 * engine on the machine. A seed-URL crawl (crawl-job.mjs) fans out just as hard against target
 * sites. Running one of each CONCURRENTLY doubles that pressure and is the fastest way to get the
 * machine rate-limited/banned — the precise failure both features spend so much code avoiding.
 *
 * This module is the single shared slot both registries acquire, so "a research job is running"
 * blocks a crawl from starting and vice versa. It is deliberately tiny and synchronous: a slot
 * holder or nothing. Each registry keeps its OWN per-type guard too (belt-and-suspenders); this
 * only adds the cross-type exclusion neither could see alone without importing the other (which
 * would be a circular dependency).
 */

/** The one typed error acquisition failure raises — `code:"job_active"` matches the code
 * deep-research.mjs already uses for its own singleton rejection, so a caller/test matching on it
 * doesn't care which guard fired. */
export class JobSlotError extends Error {
  /** @param {string} message @param {string} code */
  constructor(message, code) {
    super(message);
    this.name = "JobSlotError";
    this.code = code;
  }
}

/** @type {{ id: string, kind: string } | null} */
let holder = null;

/**
 * Claim the shared slot for `id`. Idempotent for the same `id` (re-acquiring your own slot is a
 * no-op, not an error). Throws {@link JobSlotError} `job_active` when a DIFFERENT job holds it.
 * @param {string} id @param {string} kind human label ("research" | "crawl")
 * @returns {{ id: string, kind: string }}
 */
export function acquireJobSlot(id, kind) {
  if (holder && holder.id !== id) {
    throw new JobSlotError(
      `another background job (${holder.kind} "${holder.id}") is still running — one network job ` +
        `at a time (concurrent fan-out bans the machine, ADR-0057/0062)`,
      "job_active"
    );
  }
  holder = { id, kind };
  return { ...holder };
}

/** Release the slot IFF `id` currently holds it (releasing someone else's slot is a no-op — a
 * finally-block from a job that never acquired must never free the active job's slot). */
export function releaseJobSlot(id) {
  if (holder && holder.id === id) holder = null;
}

/** @returns {{ id: string, kind: string } | null} a copy of the current holder, or null. */
export function jobSlotHolder() {
  return holder ? { ...holder } : null;
}

/** Test helper: force-release the slot regardless of holder. */
export function clearJobSlot() {
  holder = null;
}
