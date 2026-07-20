// npm-registry version check for the `--check-update` / `--update` CLI flags (ADR-0061 sibling
// slice). This module makes the ONLY network call the installer performs on the user's behalf
// for version purposes — and only when the user explicitly opts in via --check-update or
// --update. A normal `create-vkm-kit` / `npx @vkmikc/create-vkm-kit` run never phones home:
// this file is imported but its network function is invoked from nowhere else in `index.js`.
// The request sends nothing but the package name npx already resolved to run this CLI (a plain
// GET to the public npm registry, no telemetry, no user data, no auth).
import pc from "picocolors";

const REGISTRY_ORIGIN = "https://registry.npmjs.org";

/**
 * Fetch the latest published version of `pkg` from the npm registry. FAILS OPEN by design: any
 * failure (offline, DNS, non-2xx, malformed JSON, timeout) resolves to `null` instead of
 * throwing, so a user checking for updates while offline never sees a crash. Bounded by an
 * AbortController timeout so a hung connection can't stall the CLI indefinitely.
 * @param {object} [opts]
 * @param {string} [opts.pkg] - npm package name to look up.
 * @param {number} [opts.timeoutMs] - abort the request after this many milliseconds.
 * @param {typeof fetch} [opts.fetchImpl] - injectable for tests; defaults to the global `fetch`.
 * @returns {Promise<string|null>} the published `version` string, or `null` on any failure.
 */
export async function fetchLatestVersion({
  pkg = "@vkmikc/create-vkm-kit",
  timeoutMs = 3000,
  fetchImpl = globalThis.fetch
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${REGISTRY_ORIGIN}/${encodeURIComponent(pkg)}/latest`, {
      signal: controller.signal
    });
    if (!res || !res.ok) return null;
    const body = await res.json();
    const version = body && typeof body.version === "string" ? body.version : null;
    return version;
  } catch {
    // Offline, DNS failure, non-JSON body, abort — all collapse to "couldn't check", never throw.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse a (loose) semver string into comparable parts. Unknown/non-numeric core segments fall
 * back to 0 rather than throwing — this module compares, it doesn't validate.
 * @param {string} v
 * @returns {{ major: number, minor: number, patch: number, prerelease: string|null }}
 */
function parseSemver(v) {
  const s = String(v).trim().replace(/^v/, "");
  const dashIdx = s.indexOf("-");
  const core = dashIdx === -1 ? s : s.slice(0, dashIdx);
  const prerelease = dashIdx === -1 ? null : s.slice(dashIdx + 1);
  const [major, minor, patch] = core.split(".").map((n) => Number.parseInt(n, 10) || 0);
  return { major, minor, patch, prerelease };
}

/**
 * Compare two (loose) semver strings numerically by major/minor/patch. A prerelease suffix
 * (e.g. "4.4.0-rc.1") sorts BELOW the same release ("4.4.0"); between two prereleases, dot-
 * separated identifiers compare per semver's own rule (numeric identifiers compare numerically
 * and always sort below non-numeric ones; non-numeric identifiers compare lexically). Pure, no
 * dependencies.
 * @param {string} a
 * @param {string} b
 * @returns {-1|0|1} -1 if a<b, 0 if equal, 1 if a>b.
 */
export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (const key of /** @type {const} */ (["major", "minor", "patch"])) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
  }
  if (pa.prerelease === null && pb.prerelease === null) return 0;
  if (pa.prerelease === null) return 1; // release beats any prerelease of the same core version
  if (pb.prerelease === null) return -1;

  const ida = pa.prerelease.split(".");
  const idb = pb.prerelease.split(".");
  const len = Math.max(ida.length, idb.length);
  for (let i = 0; i < len; i++) {
    if (ida[i] === undefined) return -1; // fewer identifiers sorts lower
    if (idb[i] === undefined) return 1;
    const aNum = /^\d+$/.test(ida[i]);
    const bNum = /^\d+$/.test(idb[i]);
    if (aNum && bNum) {
      const na = Number.parseInt(ida[i], 10);
      const nb = Number.parseInt(idb[i], 10);
      if (na !== nb) return na < nb ? -1 : 1;
    } else if (aNum !== bNum) {
      return aNum ? -1 : 1; // numeric identifiers always sort below non-numeric ones
    } else if (ida[i] !== idb[i]) {
      return ida[i] < idb[i] ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Build the one-line "update available" banner, or `null` when there's nothing to announce
 * (no reachable registry, or the installed version is already current/newer).
 * @param {object} opts
 * @param {string} opts.current - the installed version (`readKitVersion()`).
 * @param {string|null} opts.latest - the registry's latest version, or `null` if unreachable.
 * @returns {string|null}
 */
export function updateBanner({ current, latest }) {
  if (!latest) return null;
  if (compareSemver(latest, current) <= 0) return null;
  return pc.yellow(
    `Update available: ${pc.dim(current)} -> ${pc.bold(latest)}. Run: ${pc.cyan("npx @vkmikc/create-vkm-kit --update")}`
  );
}
