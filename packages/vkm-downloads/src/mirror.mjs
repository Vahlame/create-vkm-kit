/**
 * Pick the fastest of several mirror URLs for the SAME file by measuring each one, so a large
 * download runs from the source that actually delivers bytes fastest right now (not the first one
 * listed). The agent finds candidate mirrors (obscura_search / WebSearch); this probes them.
 *
 * Each probe is a small ranged GET (default 512 KB): we time the connection latency (time to
 * headers) and the throughput of reading that slice, then abort — so probing a 3 GB mirror costs
 * ~512 KB, even if the server ignores `Range` and starts sending the whole file. Every probe goes
 * through the same guarded {@link openStream} as a real download (http(s) only, IP-pinned, private
 * ranges refused, redirects re-validated), so probing can't be turned against a local service.
 */
import { openStream, resolveDeps } from "./download.mjs";

const DEFAULT_PROBE_BYTES = 512 * 1024;
const DEFAULT_PROBE_IDLE_MS = 15000;

/** Parse the total size from a `Content-Range: bytes 0-511/12345` header, else null. */
function totalFromContentRange(cr) {
  const m = /\/(\d+)\s*$/.exec(String(cr || ""));
  return m ? Number(m[1]) : null;
}

/**
 * Probe a single mirror: measure latency (ms to response headers) and throughput (bytes/s over the
 * probed slice). Reads at most `probeBytes` then aborts. Never throws — a failed probe comes back
 * as `{ url, ok: false, error, code }` so one bad mirror can't sink the ranking.
 * @param {string} url
 * @param {{ deps?, idleMs?: number, probeBytes?: number, now?: () => number, signal?: AbortSignal }} [opts]
 * @returns {Promise<object>}
 */
export async function probeMirror(url, opts = {}) {
  const deps = resolveDeps(opts);
  const idleMs = opts.idleMs || DEFAULT_PROBE_IDLE_MS;
  const probeBytes = opts.probeBytes || DEFAULT_PROBE_BYTES;
  const now = opts.now || Date.now;

  const t0 = now();
  let res, finalUrl;
  try {
    ({ res, finalUrl } = await openStream(url, {
      method: "GET",
      deps,
      idleMs,
      extraHeaders: { range: `bytes=0-${probeBytes - 1}` },
      signal: opts.signal
    }));
  } catch (e) {
    return { url, ok: false, error: e.message, code: e.code || "probe_failed" };
  }
  const latency_ms = now() - t0;
  const status = res.statusCode || 0;
  if (status < 200 || status >= 300) {
    res.destroy();
    return { url, ok: false, error: `HTTP ${status}`, code: "http_error", status };
  }

  const size_bytes =
    totalFromContentRange(res.headers["content-range"]) ??
    (Number.isFinite(Number(res.headers["content-length"])) && status === 200
      ? Number(res.headers["content-length"])
      : null);

  // Read up to probeBytes, timing the transfer, then abort.
  const tRead0 = now();
  const measured = await new Promise((resolve) => {
    let bytes = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const ms = Math.max(1, now() - tRead0);
      res.destroy();
      resolve({ bytes, ms });
    };
    res.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes >= probeBytes) finish();
    });
    res.on("end", finish);
    res.on("error", finish);
  });

  const throughput_bps = Math.round((measured.bytes / measured.ms) * 1000);
  return {
    url,
    final_url: finalUrl.href,
    ok: true,
    status,
    latency_ms,
    throughput_bps,
    probed_bytes: measured.bytes,
    size_bytes
  };
}

/**
 * Probe every mirror (bounded concurrency) and return them ranked fastest-first: OK before failed,
 * then by throughput desc, latency asc. When OK mirrors report different sizes, the majority size is
 * treated as canonical and the odd ones out get `size_mismatch: true` (they may not be the same
 * file). Adds `rank` (1-based) to each OK entry.
 * @param {string[]} urls
 * @param {{ deps?, idleMs?, probeBytes?, now?, concurrency?: number, signal?: AbortSignal }} [opts]
 * @returns {Promise<object[]>}
 */
export async function probeMirrors(urls, opts = {}) {
  const list = [...new Set((urls || []).filter((u) => typeof u === "string" && u))];
  if (!list.length) return [];
  const concurrency = Math.min(opts.concurrency || 4, list.length);
  const results = new Array(list.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= list.length) return;
      results[i] = await probeMirror(list[i], opts);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  // Canonical size = the most common non-null size among OK probes; flag the outliers.
  const sizes = results
    .filter((r) => r.ok && Number.isFinite(r.size_bytes))
    .map((r) => r.size_bytes);
  if (sizes.length) {
    const counts = new Map();
    for (const s of sizes) counts.set(s, (counts.get(s) || 0) + 1);
    const canonical = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    for (const r of results) {
      if (r.ok && Number.isFinite(r.size_bytes) && r.size_bytes !== canonical)
        r.size_mismatch = true;
    }
  }

  const ranked = results.slice().sort((a, b) => {
    if (a.ok !== b.ok) return a.ok ? -1 : 1;
    if (!a.ok) return 0;
    if (b.throughput_bps !== a.throughput_bps) return b.throughput_bps - a.throughput_bps;
    return a.latency_ms - b.latency_ms;
  });
  let rank = 0;
  for (const r of ranked) if (r.ok) r.rank = ++rank;
  return ranked;
}

/**
 * Return the single fastest reachable mirror URL, or throw if none responded.
 * @param {string[]} urls
 * @param {object} [opts]
 * @returns {Promise<{ url: string, probe: object, ranked: object[] }>}
 */
export async function pickFastest(urls, opts = {}) {
  const ranked = await probeMirrors(urls, opts);
  const best = ranked.find((r) => r.ok);
  if (!best) {
    const err = /** @type {NodeJS.ErrnoException} */ (
      new Error(
        `No mirror responded. Tried: ${(urls || []).join(", ") || "(none)"}. ` +
          `Check the URLs or fall back to a single-URL download.`
      )
    );
    err.code = "no_mirror";
    throw err;
  }
  return { url: best.url, probe: best, ranked };
}
