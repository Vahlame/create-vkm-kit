/**
 * The actual file download, over `node:http`/`node:https` (stdlib — no browser binary is needed to
 * copy bytes, and unlike global `fetch` this lets us PIN the socket to a pre-validated IP, closing
 * the DNS-rebinding TOCTOU that a resolve-then-fetch would leave in the private-range guard).
 *
 * Flow per call:
 *   1. `assertHttpUrl` — http(s) only.
 *   2. `resolveAndValidate` — resolve the host ONCE, reject any private/loopback/link-local record,
 *      and pin the connection to the validated address via a fixed `lookup` (no second resolution).
 *   3. follow up to MAX_REDIRECTS, re-running 1+2 on every hop (a redirect to 127.0.0.1 is refused).
 *   4. enforce the byte cap by declared Content-Length AND, authoritatively, mid-stream — a lying
 *      or chunked server can't get past it; a partial file is deleted on abort.
 *   5. hash while streaming (SHA-256) and return the path/size/hash.
 *
 * All network seams (`requestImpl`, `lookupImpl`) and `existsSync` are injectable so the whole
 * module is testable offline with a fake request/response — no real sockets, no real DNS.
 */
import { createHash } from "node:crypto";
import dns from "node:dns";
import { createWriteStream, existsSync as fsExistsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { assertHttpUrl, resolveAndValidate } from "./safe-url.mjs";
import { deriveFilename, resolveWithinRoot } from "./filename.mjs";

const DEFAULT_MAX_BYTES = 500 * 1024 * 1024; // 500 MB
const DEFAULT_IDLE_MS = 30000; // socket-inactivity timeout, not a total-time cap
const MAX_REDIRECTS = 5;

const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  } catch {
    return "0.0.0";
  }
})();
const USER_AGENT = `vkm-downloads/${VERSION}`;

/** A non-2xx HTTP status on the final response. */
export class DownloadHttpError extends Error {
  constructor(status, url) {
    super(`Download failed: HTTP ${status} from ${url}`);
    this.name = "DownloadHttpError";
    this.code = "http_error";
    this.status = status;
  }
}

/** The response exceeded the byte cap (by declared Content-Length or mid-stream). */
export class DownloadSizeError extends Error {
  constructor(maxBytes, seen) {
    super(
      `Download exceeds the ${maxBytes}-byte cap (saw ${seen}). Raise VKM_DOWNLOAD_MAX_BYTES if ` +
        `this file is expected to be that large.`
    );
    this.name = "DownloadSizeError";
    this.code = "too_large";
  }
}

/** The socket stalled past the inactivity timeout. */
export class DownloadTimeoutError extends Error {
  constructor(idleMs) {
    super(
      `Download stalled: no data for ${idleMs}ms. The server may be unreachable or throttling.`
    );
    this.name = "DownloadTimeoutError";
    this.code = "timeout";
  }
}

/** Too many redirects — likely a loop. */
export class TooManyRedirectsError extends Error {
  constructor() {
    super(`Too many redirects (> ${MAX_REDIRECTS}).`);
    this.name = "TooManyRedirectsError";
    this.code = "too_many_redirects";
  }
}

/** The default download root: ~/Downloads/vkm-kit (override with VKM_DOWNLOAD_DIR). */
export function downloadDir() {
  return process.env.VKM_DOWNLOAD_DIR || path.join(homedir(), "Downloads", "vkm-kit");
}

function envMaxBytes() {
  const n = Number(process.env.VKM_DOWNLOAD_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_BYTES;
}

/** Default request factory: pick http/https by protocol and issue the request. */
function defaultRequestImpl(urlObj, options) {
  const mod = urlObj.protocol === "https:" ? https : http;
  return mod.request(urlObj, options);
}

/** A `lookup` that always returns a fixed, already-validated address — this is what pins the
 * socket to the IP we vetted, so `net`/`tls` never re-resolves the hostname. */
function fixedLookup({ address, family }) {
  const fam = family || net.isIP(address);
  return (hostname, options, callback) => {
    const cb = typeof options === "function" ? options : callback;
    const all = typeof options === "object" && options && options.all;
    if (all) return cb(null, [{ address, family: fam }]);
    return cb(null, address, fam);
  };
}

function resolveDeps(opts) {
  return {
    requestImpl: opts.requestImpl || defaultRequestImpl,
    lookupImpl: opts.lookupImpl || dns.lookup,
    existsSync: opts.existsSync || fsExistsSync
  };
}

/**
 * Issue one request to `urlObj` and resolve with its response stream. Resolves+validates the host
 * first and pins the socket to that address.
 * @returns {Promise<{ res: import("node:http").IncomingMessage, req: import("node:http").ClientRequest }>}
 */
async function dispatch(urlObj, { method, headers, deps, idleMs }) {
  const pinned = await resolveAndValidate(urlObj.hostname, deps.lookupImpl);
  return new Promise((resolve, reject) => {
    const req = deps.requestImpl(urlObj, { method, headers, lookup: fixedLookup(pinned) });
    req.on("response", (res) => resolve({ res, req }));
    req.on("error", reject);
    if (typeof req.setTimeout === "function") {
      req.setTimeout(idleMs, () => req.destroy(new DownloadTimeoutError(idleMs)));
    }
    req.end();
  });
}

/**
 * Follow redirects manually (http.request does not), re-validating scheme + address on every hop.
 * @returns {Promise<{ res, req, finalUrl: URL }>}
 */
async function follow(url, { method, deps, idleMs, redirectsLeft = MAX_REDIRECTS }) {
  const urlObj = assertHttpUrl(url);
  const headers = { "user-agent": USER_AGENT, "accept-encoding": "identity" };
  const { res, req } = await dispatch(urlObj, { method, headers, deps, idleMs });
  const status = res.statusCode || 0;
  const location = res.headers?.location;
  if ([301, 302, 303, 307, 308].includes(status) && location) {
    res.resume(); // drain and free the socket — we are not reading this body
    if (redirectsLeft <= 0) throw new TooManyRedirectsError();
    const nextUrl = new URL(location, urlObj).href; // resolves relative Location too
    // 303 mandates GET; we only ever issue GET/HEAD, so keep the method otherwise.
    const nextMethod = status === 303 ? "GET" : method;
    return follow(nextUrl, { method: nextMethod, deps, idleMs, redirectsLeft: redirectsLeft - 1 });
  }
  return { res, req, finalUrl: urlObj };
}

/**
 * Metadata only — writes NOTHING to disk. HEAD first; if the server refuses HEAD, a GET whose
 * body is destroyed the moment headers arrive.
 * @param {string} url
 * @param {{ requestImpl?, lookupImpl?, idleMs?: number }} [opts]
 * @returns {Promise<{ final_url: string, filename: string, content_type: string|null, size_bytes: number|null }>}
 */
export async function resolveMetadata(url, opts = {}) {
  assertHttpUrl(url); // fail fast on a bad scheme before any network
  const deps = resolveDeps(opts);
  const idleMs = opts.idleMs || DEFAULT_IDLE_MS;

  let hop = null;
  try {
    hop = await follow(url, { method: "HEAD", deps, idleMs });
  } catch (e) {
    // A refused scheme / blocked address is a hard no — surface it, don't retry as GET.
    if (e?.code === "unsupported_scheme" || e?.code === "blocked_address") throw e;
    hop = null; // server may not support HEAD — fall through to GET-and-abort
  }

  let res, finalUrl;
  const headOk = hop && (hop.res.statusCode || 0) >= 200 && (hop.res.statusCode || 0) < 400;
  if (headOk) {
    ({ res, finalUrl } = hop);
    hop.res.resume(); // HEAD has no body, but drain to free the socket
  } else {
    if (hop) hop.res.resume();
    ({ res, finalUrl } = await follow(url, { method: "GET", deps, idleMs }));
    res.destroy(); // metadata only — headers are already parsed; never read the body
  }

  const contentType =
    String(res.headers["content-type"] || "")
      .split(";")[0]
      .trim() || null;
  const len = Number(res.headers["content-length"]);
  return {
    final_url: finalUrl.href,
    filename: deriveFilename({ url: finalUrl, contentType }),
    content_type: contentType,
    size_bytes: Number.isFinite(len) ? len : null
  };
}

/**
 * Download `url` into the download root, streaming to disk with a running SHA-256 and a hard byte
 * cap. Returns the saved path/size/hash. Never overwrites an existing file (see resolveWithinRoot);
 * a partial file is removed if the stream errors or the cap trips mid-download.
 * @param {string} url
 * @param {{ filename?: string, destDir?: string, maxBytes?: number, requestImpl?, lookupImpl?, existsSync?, idleMs?: number }} [opts]
 * @returns {Promise<{ path: string, filename: string, size_bytes: number, sha256: string, content_type: string|null, final_url: string }>}
 */
export async function downloadTo(url, opts = {}) {
  assertHttpUrl(url); // fail fast before any network
  const deps = resolveDeps(opts);
  const idleMs = opts.idleMs || DEFAULT_IDLE_MS;
  const maxBytes = opts.maxBytes || envMaxBytes();
  const root = opts.destDir || downloadDir();

  const { res, finalUrl } = await follow(url, { method: "GET", deps, idleMs });
  const status = res.statusCode || 0;
  if (status < 200 || status >= 300) {
    res.destroy();
    throw new DownloadHttpError(status, finalUrl.href);
  }
  const declared = Number(res.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) {
    res.destroy();
    throw new DownloadSizeError(maxBytes, declared);
  }

  const contentType =
    String(res.headers["content-type"] || "")
      .split(";")[0]
      .trim() || null;
  const filename = deriveFilename({ suggested: opts.filename, url: finalUrl, contentType });
  await mkdir(root, { recursive: true });
  const dest = resolveWithinRoot(root, filename, deps.existsSync);

  const hash = createHash("sha256");
  let total = 0;
  const meter = new Transform({
    transform(chunk, _enc, cb) {
      total += chunk.length;
      if (total > maxBytes) return cb(new DownloadSizeError(maxBytes, total));
      hash.update(chunk);
      cb(null, chunk);
    }
  });

  try {
    await pipeline(res, meter, createWriteStream(dest));
  } catch (e) {
    await rm(dest, { force: true }).catch(() => {}); // no half-written file left behind
    throw e;
  }

  return {
    path: dest,
    filename: path.basename(dest),
    size_bytes: total,
    sha256: hash.digest("hex"),
    content_type: contentType,
    final_url: finalUrl.href
  };
}
