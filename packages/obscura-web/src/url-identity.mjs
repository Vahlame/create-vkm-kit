/** URL identity for obscura-web: one place, two deliberately different functions.
 *
 * Before this module there were three ad-hoc notions of "same URL" in the package —
 * exact string match in `serp.mjs` (dedupe), exact string match in `research.mjs`
 * (dedupeByUrl), and a real normalizer in `research-persist.mjs` (normalizeUrl/hash8).
 * Only the third one was right, and it was the only one not used for candidate dedup.
 *
 * ── Why two functions and not one ────────────────────────────────────────────────────
 *
 * `normalizeUrl` feeds `hash8`, which names the files in `RESEARCH/<topic>/sources/`
 * (`<hash8>-<slug>.md`, ADR-0056). Its output is therefore **persisted state**: changing
 * it renames every future note for a URL already on disk, so the by-URL dedup silently
 * stops matching and the bank grows duplicates of notes it already has. It is frozen on
 * purpose — byte-identical to the original in `research-persist.mjs`. Do not "improve" it.
 *
 * `canonicalizeUrl` is the aggressive one, and it is safe to be aggressive precisely
 * because nothing durable depends on it: it only decides whether two *candidates* in one
 * crawl are the same page. Its worst case is merging two candidates that were actually
 * different (we fetch one page instead of two); it can never corrupt a fetch, because the
 * original URL string is what gets fetched — the canonical form is only ever a Map key.
 */

import { createHash } from "node:crypto";

/** Tracking/analytics params that never change what a page returns. Stripped by
 * `canonicalizeUrl` so `?utm_source=x` and the bare URL dedup to one candidate. */
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid",
  "msclkid",
  "yclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_ga",
  "_gl",
  "ref_src",
  "spm"
]);

/** Normalize a URL for dedup hashing only (not a general canonicalizer): lowercase host,
 * drop the fragment, drop a bare trailing `/`. Falls back to a trimmed lowercase string for
 * anything `URL` can't parse rather than throwing — dedup degrades, it never blocks a write.
 *
 * FROZEN: `hash8` derives `RESEARCH/<topic>/sources/` filenames from this (ADR-0056). Any
 * change here orphans every note already on disk and breaks by-URL dedup against the bank.
 * Reach for `canonicalizeUrl` instead — that one is free to change.
 */
export function normalizeUrl(raw) {
  try {
    const u = new URL(String(raw));
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    let s = u.toString();
    if (s.endsWith("/") && u.pathname === "/" && !u.search) s = s.slice(0, -1);
    return s;
  } catch {
    return String(raw ?? "")
      .trim()
      .toLowerCase();
  }
}

/** Stable 8-hex-char identity for a URL. Names the notes in `RESEARCH/<topic>/sources/`.
 * FROZEN together with `normalizeUrl` — see this module's header. */
export function hash8(url) {
  return createHash("sha256").update(normalizeUrl(url), "utf8").digest("hex").slice(0, 8);
}

/** Aggressive canonical form for in-crawl candidate dedup. Never persisted, never fetched —
 * a Map key only, so over-merging costs one skipped fetch and under-merging costs one wasted
 * fetch. Neither can produce a wrong result, which is what licenses the aggressiveness.
 *
 * Unifies, beyond what `normalizeUrl` does:
 *   - scheme      — `http` and `https` collapse to one key (same page, and we upgrade anyway)
 *   - `www.`      — stripped; a host serving different content with and without it is a
 *                   misconfiguration, and every SEO canonicalizer makes the same call
 *   - trailing `/` — dropped from any path, not just the bare root
 *   - tracking     — `utm_*`/`fbclid`/`gclid`/… removed (see TRACKING_PARAMS)
 *   - param order  — sorted, so `?a=1&b=2` and `?b=2&a=1` are one candidate
 *   - default port — `:80`/`:443` dropped (the URL parser already does this)
 *
 * Unparseable input degrades to a trimmed lowercase string, same as `normalizeUrl`.
 */
export function canonicalizeUrl(raw) {
  try {
    const u = new URL(String(raw));
    u.hash = "";
    u.protocol = "https:";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");

    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) u.searchParams.delete(key);
    }
    u.searchParams.sort();

    // Collapse `/a/` and `/a` — but keep the bare root as `/` so `https://x` has one form.
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.replace(/\/+$/, "");
    }

    let s = u.toString();
    if (s.endsWith("?")) s = s.slice(0, -1);
    if (s.endsWith("/") && u.pathname === "/" && !u.search) s = s.slice(0, -1);
    return s;
  } catch {
    return String(raw ?? "")
      .trim()
      .toLowerCase();
  }
}

/** Registrable-ish host for per-domain caps: lowercase, `www.` stripped. Deliberately NOT a
 * public-suffix parse (`docs.rs` and `foo.github.io` should cap separately, and pulling in a
 * PSL table for a diversity heuristic is not worth the dependency). Unparseable → "". */
export function hostOf(raw) {
  try {
    return new URL(String(raw)).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Order-preserving dedup of `{url}` records by `canonicalizeUrl`. First occurrence wins —
 * callers pass candidates in relevance order, so the best-ranked copy of a duplicated page
 * is the one that survives. Records without a usable `url` are dropped. */
export function dedupeByUrl(records) {
  const seen = new Set();
  const out = [];
  for (const r of records) {
    if (!r || !r.url) continue;
    const key = canonicalizeUrl(r.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
