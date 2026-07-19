/**
 * Advisory cross-process write lock for the vault (single host).
 *
 * Why: vault writes are individually atomic (tmp+rename in vault-fs.mjs), but
 * two MCP sidecars serving the same vault (several IDE windows, an agent
 * fan-out) can interleave read-check-write spans — the ifMatch etag check and
 * the rename are not one atomic step. This lock closes that window on one
 * host. It is deliberately NOT a cross-machine lock: the lockfile lives in the
 * derived sidecar dir and PID liveness means nothing on another machine, so
 * stealing is same-hostname-only; cross-machine safety remains git's job
 * (pull --rebase + conflict surfacing — see docs/en/sync.md).
 *
 * Acquisition is O_EXCL create (`wx`, atomic on POSIX and Windows) of a JSON
 * lockfile {pid, hostname, tool, acquiredAt}. On contention the holder is
 * inspected: a dead PID or an expired TTL on the same host is stale debris
 * from a crashed writer and is stolen; a live holder is awaited with short
 * backoff, then surfaced as a retryable "vault busy" error. Hold times are
 * sub-millisecond (one file write), so waiters virtually never surface.
 *
 * Kill-switch: OBSIDIAN_MEMORY_NO_LOCK=1 disables locking entirely (single
 *-writer setups that want zero extra syscalls).
 */
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";

/** Sidecar dir shared with the Python RAG index — already git-ignored and
 * excluded from indexing/audit, so lock churn never becomes vault content. */
const SIDECAR_DIR = ".obsidian-memory-rag";
const LOCK_NAME = "write.lock";

const DEFAULT_TTL_MS = 10_000;
const DEFAULT_WAIT_MS = 2_000;
const RETRY_START_MS = 25;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Windows enforces mandatory file locking around delete; POSIX doesn't, which is why this
 * whole class of error only ever surfaced in Windows CI. While one lockfile path is mid-delete
 * (unlink puts it in a "pending delete" state until every handle closes, not gone instantly),
 * a concurrent create/read of that SAME path can transiently see EPERM/EBUSY where POSIX would
 * just see ENOENT-then-success. Every unlink/create/read of the lockfile in this module treats
 * EPERM/EBUSY as "contended right now," never as fatal — correctness never depends on any one
 * of these calls succeeding on its first try: the retry loop converges, and worst case the next
 * acquirer's dead-PID/TTL check reclaims a lock this code failed to clear.
 */
export function isLockContentionError(err) {
  return err.code === "EPERM" || err.code === "EBUSY";
}

/** Already gone (ENOENT), or transiently contended (see {@link isLockContentionError}) —
 * either way, safe to treat the unlink as having done its job. */
export function isBenignUnlinkError(err) {
  return err.code === "ENOENT" || isLockContentionError(err);
}

/** True when `pid` is a live process on THIS host. EPERM means "alive but not
 * ours"; only ESRCH (and bogus input) count as dead. */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

/**
 * Acquire the vault write lock. Resolves to a release() function; always call
 * it in a finally block. Throws a retryable Error("vault busy: …") when a live
 * same-host holder outlasts `waitMs` (or a foreign-host lockfile exists).
 * @param {string} vaultAbs absolute vault root
 * @param {{tool?: string, ttlMs?: number, waitMs?: number}} [opts]
 * @returns {Promise<() => Promise<void>>}
 */
export async function acquireVaultLock(vaultAbs, opts = {}) {
  if (process.env.OBSIDIAN_MEMORY_NO_LOCK === "1") {
    return async () => {};
  }
  const tool = opts.tool ?? "vault-fs";
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const waitMs = opts.waitMs ?? DEFAULT_WAIT_MS;
  const dir = join(vaultAbs, SIDECAR_DIR);
  const lockPath = join(dir, LOCK_NAME);
  await mkdir(dir, { recursive: true });

  const payload = JSON.stringify({
    pid: process.pid,
    hostname: hostname(),
    tool,
    acquiredAt: Date.now()
  });

  const deadline = Date.now() + waitMs;
  let backoff = RETRY_START_MS;
  // One extra iteration past the deadline so waitMs: 0 still gets one attempt.
  for (;;) {
    try {
      await writeFile(lockPath, payload, { flag: "wx" });
      return async () => {
        try {
          await unlink(lockPath);
        } catch (err) {
          if (!isBenignUnlinkError(err)) throw err;
        }
      };
    } catch (err) {
      // EEXIST is the normal "someone's holding it" outcome; a transient EPERM/EBUSY from a
      // concurrent release's in-flight unlink means the same thing here — treat both as
      // "contended, go inspect the holder and back off," not as fatal.
      if (err.code !== "EEXIST" && !isLockContentionError(err)) throw err;
    }

    const holder = await readHolder(lockPath);
    if (holder.stale) {
      // Crashed writer's debris: remove and immediately retry the exclusive
      // create. If a rival stealer wins the race we just loop again.
      try {
        await unlink(lockPath);
      } catch (unlinkErr) {
        if (!isBenignUnlinkError(unlinkErr)) throw unlinkErr;
      }
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `vault busy: write lock held by pid ${holder.pid ?? "?"} (${holder.tool ?? "unknown"}` +
          `${holder.foreignHost ? `, host ${holder.hostname}` : ""}) — retry shortly`
      );
    }
    await sleep(Math.min(backoff, Math.max(1, deadline - Date.now())));
    backoff *= 2;
  }

  /** Inspect the current lockfile. `stale` ⇒ safe to steal (same host only). */
  async function readHolder(fp) {
    let raw;
    try {
      raw = await readFile(fp, "utf8");
    } catch (err) {
      // ENOENT: released between attempts. EPERM/EBUSY: someone's unlink of this same path is
      // in flight on Windows (see isLockContentionError) — functionally the same "releasing
      // right now" situation, so treat it the same way rather than throwing.
      if (err.code === "ENOENT" || isLockContentionError(err)) return { stale: true };
      throw err;
    }
    let info;
    try {
      info = JSON.parse(raw);
    } catch {
      // Unparseable lockfile: treat as stale debris — it cannot be verified,
      // and leaving it would wedge every writer forever.
      return { stale: true };
    }
    const sameHost = info.hostname === hostname();
    const expired = !Number.isFinite(info.acquiredAt) || Date.now() - info.acquiredAt > ttlMs;
    const dead = sameHost && !pidAlive(info.pid);
    return {
      pid: info.pid,
      tool: info.tool,
      hostname: info.hostname,
      foreignHost: !sameHost,
      // Never steal a foreign host's lock: its PID liveness is unknowable here
      // and the file may just be Syncthing-replicated junk mid-transfer.
      stale: sameHost && (dead || expired)
    };
  }
}

/**
 * Run `fn` under the vault write lock (see {@link acquireVaultLock}), always
 * releasing — including on throw.
 * @template T
 * @param {string} vaultAbs
 * @param {string} tool label recorded in the lockfile for busy-error messages
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withVaultLock(vaultAbs, tool, fn) {
  const release = await acquireVaultLock(vaultAbs, { tool });
  try {
    return await fn();
  } finally {
    await release();
  }
}
