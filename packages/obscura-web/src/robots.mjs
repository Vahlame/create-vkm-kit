/**
 * Pragmatic robots.txt compliance for `obscura_research`'s crawl loop — inspired by Scrapling's
 * `robots_txt_obey` option (verified in its `fetchers` docs: a per-domain-cached opt-in check).
 * Scoped to the automated multi-page crawl only, not `obscura_fetch`: a user naming one URL by
 * hand has already decided to fetch it, the same way Scrapling's own compliance flag lives on
 * its Spider/crawl layer rather than its single-shot `Fetcher.get`.
 *
 * Deliberately a SUBSET of the spec, not a claim of full RFC 9309 compliance:
 *   - matches the FIRST `User-agent: *` group only (this tool doesn't claim a bot identity to
 *     match against a named group — behaving like a generic client is the honest default, and
 *     multiple `*` groups in one file are themselves a spec violation rare enough not to
 *     special-case)
 *   - `Disallow`/`Allow` are plain PREFIX matches; wildcards (`*`) and end-anchors (`$`) inside a
 *     rule's path are NOT interpreted (a rule like `Disallow: /*.pdf$` is compared as a literal
 *     string, which will essentially never prefix-match a real path — the safe-by-construction
 *     direction, since it fails toward ALLOWING rather than wrongly blocking)
 *   - `Crawl-delay`, `Sitemap`, `Host`, and every other directive are ignored
 * A parser that quietly gets a subtlety wrong is worse than one that's honest about what it
 * doesn't attempt — hence documenting the gaps here instead of only in a commit message.
 *
 * Fails OPEN on every kind of trouble: missing robots.txt (404), a network error, a timeout, an
 * empty body, a file with no `*` group. This mirrors the tool's own standing contract ("works
 * with obscura absent, works with SearXNG absent, works with Ollama absent") — a robots.txt
 * hiccup must cost breadth, never break the crawl.
 */

/** Longest-prefix-wins per-path rule set for one `User-agent: *` group. */

/** Split robots.txt into `User-agent` groups. A new group starts at a `User-agent` line that
 * follows at least one rule line in the current group (so multiple consecutive `User-agent`
 * lines sharing one rule block are grouped together, per the informal but near-universal
 * convention) or at the very first `User-agent` line. Non-group-relevant directives
 * (`Crawl-delay`, `Sitemap`, comments, blank lines) are skipped. */
export function parseRobotsTxt(text) {
  const records = [];
  let current = null;
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.split("#")[0].trim(); // strip inline/full-line comments
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === "user-agent") {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        records.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if ((key === "disallow" || key === "allow") && current) {
      current.rules.push({ type: key, path: value });
    }
    // every other key (crawl-delay, sitemap, host, ...) is intentionally ignored — see module doc
  }
  return records;
}

/** The record that applies to a generic, unnamed client: the first group whose agent list
 * contains `*`. Absent that, an empty ruleset — "no restriction found" is the correct read of a
 * robots.txt with no wildcard group, not a parse failure. */
export function findStarRecord(records) {
  return records.find((r) => r.agents.includes("*")) ?? { agents: ["*"], rules: [] };
}

/**
 * Is `path` (pathname + search, e.g. `/docs/api?v=2`) allowed under `record`?
 *
 * Longest-matching-prefix wins, ties favor `Allow` (the same precedence Google's parser
 * documents): find the longest `Disallow` prefix that matches and the longest `Allow` prefix
 * that matches; allowed iff the Allow match is at least as long as the Disallow match. An empty
 * `Disallow:` value is a no-op (the common convention for "allow everything" — the value never
 * satisfies `path.startsWith("")` check below being skipped, since an empty path can't be a
 * meaningful prefix rule).
 */
export function isPathAllowed(record, path) {
  if (!record || !record.rules.length) return true;
  let bestDisallow = -1;
  let bestAllow = -1;
  for (const rule of record.rules) {
    if (!rule.path) continue;
    if (path.startsWith(rule.path)) {
      if (rule.type === "disallow" && rule.path.length > bestDisallow)
        bestDisallow = rule.path.length;
      if (rule.type === "allow" && rule.path.length > bestAllow) bestAllow = rule.path.length;
    }
  }
  return bestDisallow <= bestAllow;
}

const ROBOTS_CACHE = new Map(); // origin -> { at, record: {agents,rules} | null }
const ROBOTS_CACHE_TTL_MS = Number(process.env.OBSCURA_ROBOTS_CACHE_TTL_MS) || 3_600_000; // 1h
const ROBOTS_CACHE_MAX = 200;
const ROBOTS_FETCH_TIMEOUT_MS = 5_000;

async function fetchRecord(origin, fetchImpl, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${origin}/robots.txt`, { signal: ctrl.signal });
    // A missing robots.txt is the normal, common case and means "no restriction" — an empty
    // ruleset, not a failure. `null` is reserved for "we couldn't find out", which fails open
    // identically but is a distinct outcome worth keeping distinct for `checked` below.
    if (!res.ok) return { agents: ["*"], rules: [] };
    const text = await res.text();
    return findStarRecord(parseRobotsTxt(text));
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Is `url` allowed to be fetched, per its host's robots.txt? Cached per origin.
 *
 * @returns {Promise<{allowed: boolean, checked: boolean}>} `checked:false` means robots.txt
 *   itself could not be read (network/timeout) — `allowed` is still `true` in that case
 *   (fail open), but a caller that wants to distinguish "explicitly permitted" from "assumed
 *   permitted because we couldn't ask" can do so via `checked`.
 */
export async function checkRobots(url, opts = {}) {
  const {
    fetchImpl = globalThis.fetch,
    cache = ROBOTS_CACHE,
    ttlMs = ROBOTS_CACHE_TTL_MS,
    timeoutMs = ROBOTS_FETCH_TIMEOUT_MS
  } = opts;

  let u;
  try {
    u = new URL(url);
  } catch {
    return { allowed: true, checked: false }; // a malformed URL isn't this module's job to judge
  }
  const origin = `${u.protocol}//${u.host}`;

  let entry = cache.get(origin);
  if (!entry || Date.now() - entry.at >= ttlMs) {
    const record = await fetchRecord(origin, fetchImpl, timeoutMs);
    entry = { at: Date.now(), record };
    if (cache.size >= ROBOTS_CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(origin, entry);
  }

  if (!entry.record) return { allowed: true, checked: false }; // couldn't fetch/parse — fail open
  return { allowed: isPathAllowed(entry.record, u.pathname + u.search), checked: true };
}

/** Drop every cached robots.txt record. Exported for tests. */
export function clearRobotsCache() {
  ROBOTS_CACHE.clear();
}
