/**
 * Safe asset downloader for the seed-URL crawler (ADR-0062).
 *
 * The crawler may, opt-in, save the PDF/image assets a kept page references. Downloading BINARY
 * files from untrusted web content is the single most safety-sensitive thing this package does, so
 * the envelope is deliberately narrow and defense-in-depth:
 *
 *   1. http(s) only — never file:/data:/blob:, never a non-web scheme.
 *   2. Content-Type allowlist, checked against the RESPONSE header (not the URL extension): PDFs and
 *      raster images only. SVG is EXCLUDED on purpose — it is XML that can carry <script>, so it is
 *      an active-content vector, not an "informative image."
 *   3. Hard byte cap enforced by STREAMING: the body is read chunk-by-chunk and the transfer is
 *      aborted the moment it exceeds `maxBytes`, so a lying/absent Content-Length can't be used to
 *      write a multi-gigabyte file. A present Content-Length over the cap short-circuits earlier.
 *   4. Per-request timeout via AbortController.
 *   5. Filename is DERIVED and SANITIZED (hash8 prefix + a `[A-Za-z0-9._-]`-only basename + an
 *      extension forced from the Content-Type), and the write is root-checked under
 *      OBSCURA_RESEARCH_DIR/<topic>/assets/ — a crafted URL/basename cannot escape the assets dir.
 *   6. The file is written as inert data (default permissions, never an exec bit) and NEVER opened
 *      or executed — matching the vkm-downloads MCP's own "saved as-is, never run" contract.
 *
 * Uses the platform `fetch` (undici, global in Node 18+), NOT obscura: assets are static files on
 * CDNs that don't JS-render or bot-wall a direct GET, and obscura streams text through stdout,
 * which would corrupt binary. `fetchImpl` is injectable so the whole path is unit-testable with no
 * network. robots.txt for the asset host is enforced by the CALLER (crawlSite) before this runs.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { hash8 } from "./url-identity.mjs";
import { resolveResearchRoot, safeResearchPath, validateTopic } from "./research-persist.mjs";

/** 25 MiB — a generous ceiling for a real PDF/diagram, small enough that a runaway or malicious
 * response is capped long before it fills a disk. Overridable per call. */
export const DEFAULT_ASSET_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_ASSET_TIMEOUT_MS = 30_000;

/** Content-Type (base, sans parameters) → canonical file extension. The ONLY types that may be
 * written. Deliberately excludes `image/svg+xml` (scriptable XML) and every non-image/non-pdf type. */
const ALLOWED_TYPES = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "image/tiff": ".tiff"
};

/** The kinds crawlSite reports, mapped to the Content-Type families each may legitimately be. A
 * `kind:"pdf"` link that resolves to `image/png` is a mismatch we refuse — the discovery heuristic
 * and the real bytes disagree, so we keep neither. */
const KIND_PREFIX = { pdf: "application/pdf", image: "image/" };

/** Content-Type header, lowercased, parameters stripped (`application/pdf; charset=binary` →
 * `application/pdf`). Empty string when absent. */
function baseContentType(res) {
  const raw = (res.headers?.get?.("content-type") || "").toLowerCase();
  return raw.split(";")[0].trim();
}

/** Sanitize the URL's basename to `[A-Za-z0-9._-]`, strip leading dots (no `..`/dotfiles), cap
 * length, and force `ext`. Always returns a safe, non-empty filename. */
function safeFilename(url, ext) {
  let base = "asset";
  try {
    const p = new URL(url).pathname;
    const last = decodeURIComponent(p.split("/").filter(Boolean).pop() || "");
    const cleaned = last.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^\.+/, "");
    if (cleaned) base = cleaned.slice(0, 60);
  } catch {
    /* keep the default base */
  }
  base = base.replace(/\.[A-Za-z0-9]+$/, ""); // drop any original extension; we force ours
  if (!base) base = "asset";
  return `${hash8(url)}-${base}${ext}`;
}

/** Stream `res.body` into a Buffer, aborting past `maxBytes`. Returns null when the cap is blown
 * (the caller treats that as a skip, not a partial write). */
async function readCapped(res, maxBytes, controller) {
  const reader = res.body?.getReader?.();
  if (!reader) {
    // No web-stream body (e.g. an injected fake without one) — fall back to arrayBuffer, still
    // capped after the fact so an oversized body is refused rather than written.
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > maxBytes ? null : buf;
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      controller?.abort();
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/**
 * Download one asset into `OBSCURA_RESEARCH_DIR/<topic>/assets/`, subject to the full envelope
 * documented at the top of this module. Never throws for an expected refusal — a disallowed type,
 * an oversized body, a non-ok status, or a network error all come back as `{ saved:false, reason }`
 * so a single bad asset never sinks a crawl. Only a programming/During-write filesystem fault
 * propagates.
 *
 * @param {string} url absolute http(s) asset URL
 * @param {{ topic: string, kind?: "pdf"|"image", researchDir?: string, maxBytes?: number,
 *           timeoutMs?: number }} opts
 * @param {{ fetchImpl?: typeof fetch, writeImpl?: typeof writeFile }} [deps]
 * @returns {Promise<{ saved: true, path: string, bytes: number, contentType: string }
 *                  | { saved: false, reason: string }>}
 */
export async function downloadAsset(url, opts, deps = {}) {
  const { topic, kind, researchDir, maxBytes = DEFAULT_ASSET_MAX_BYTES } = opts ?? {};
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_ASSET_TIMEOUT_MS;
  const { fetchImpl = fetch, writeImpl = writeFile } = deps;

  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return { saved: false, reason: "not_http" };
  }
  let topicSlug;
  try {
    topicSlug = validateTopic(topic);
  } catch (e) {
    return { saved: false, reason: e?.code || "invalid_topic" };
  }
  const root = resolveResearchRoot(researchDir);
  const dir = safeResearchPath(root, topicSlug, "assets");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, redirect: "follow" });
    if (!res.ok) return { saved: false, reason: `http_${res.status}` };

    const ct = baseContentType(res);
    const ext = ALLOWED_TYPES[ct];
    if (!ext) return { saved: false, reason: `type_not_allowed:${ct || "unknown"}` };
    if (kind && KIND_PREFIX[kind] && !ct.startsWith(KIND_PREFIX[kind])) {
      return { saved: false, reason: `type_mismatch:${kind}!=${ct}` };
    }

    const declared = Number(res.headers?.get?.("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      return { saved: false, reason: "too_large" };
    }

    const body = await readCapped(res, maxBytes, controller);
    if (!body) return { saved: false, reason: "too_large" };

    const filename = safeFilename(url, ext);
    const fp = safeResearchPath(root, topicSlug, "assets", filename);
    await mkdir(dir, { recursive: true });
    await writeImpl(fp, body);
    return { saved: true, path: fp, bytes: body.length, contentType: ct };
  } catch (e) {
    return {
      saved: false,
      reason: e?.name === "AbortError" ? "timeout" : e?.message || "fetch_error"
    };
  } finally {
    clearTimeout(timer);
  }
}
