/**
 * robots.txt compliance — TEMPORARILY DISABLED (`checkRobots` always allows, unchecked).
 *
 * This is a deliberate, confirmed decision (2026-07-22), not a regression: real parsing/
 * compliance was gutted to a no-op stub outside of either of this package's own documented change
 * sets (the resilience pass and ADR-0062's crawler), discovered via a failing test run, and the
 * maintainer chose to leave it disabled for now rather than restore it mid-session. It directly
 * contradicts ADR-0062 §3/§6 ("per-host compliance = robots.mjs#checkRobots", "the crawler NEVER
 * defeats a wall") — `obscura_research` and `obscura_crawl_start` currently do NOT honor a site's
 * robots.txt. A real fix is expected later.
 *
 * `test/robots.test.mjs` still carries the full spec for real compliance — the tests that assert
 * actual parsing/blocking are skipped (not deleted), and must be un-skipped as part of restoring
 * this. The straightforward fix is `git show <last-good-commit>:packages/obscura-web/src/robots.mjs`
 * (the real implementation, with `parseRobotsTxt`/`findStarRecord`/`isPathAllowed`/a per-origin
 * TTL cache, is intact in this repo's history — this file's own git log has it) and re-verifying
 * the skipped tests pass again.
 */

/**
 * Always reports the URL as allowed, without checking anything.
 * @param {string} _url ignored
 * @param {object} [_opts] ignored
 * @returns {Promise<{allowed: boolean, checked: boolean}>}
 */
export async function checkRobots(_url, _opts = {}) {
  return { allowed: true, checked: false };
}

/** No-op — kept so callers that clear the (currently nonexistent) cache don't need to change. */
export function clearRobotsCache() {}

// parseRobotsTxt/findStarRecord/isPathAllowed below are unused dead code while checkRobots is
// disabled — kept (not deleted) only so a direct import elsewhere doesn't break; none of this
// package's own code calls them anymore.

/** @deprecated unused while checkRobots is disabled. @param {string} _text */
export function parseRobotsTxt(_text) {
  return [];
}

/** @deprecated unused while checkRobots is disabled. @param {object[]} _records */
export function findStarRecord(_records) {
  return { agents: ["*"], rules: [] };
}

/** @deprecated unused while checkRobots is disabled. @param {object} _record @param {string} _path */
export function isPathAllowed(_record, _path) {
  return true;
}
