/**
 * Turn an untrusted, web-derived name (a `filename` the agent passed, or the basename of a URL)
 * into a safe file to write UNDER the download root — never above it, never over an existing file.
 *
 * Everything here treats its input as hostile: a suggested filename can carry `../`, absolute
 * paths, NUL bytes, percent-encoded separators (`%2f`), Windows-illegal characters, or a reserved
 * device name (`CON`, `NUL`, `COM1`). The extension is taken from the URL/name or mapped from the
 * server's Content-Type — deliberately NOT from a Content-Disposition header, which is
 * attacker-controlled and unvalidated. The final root-check in {@link resolveWithinRoot} is the
 * hard boundary: it runs `path.resolve` + a prefix check BEFORE any write, so a name that escapes
 * the root is rejected rather than written.
 */
import { existsSync } from "node:fs";
import path from "node:path";

const MAX_LEN = 200;
const RESERVED_WIN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Characters illegal in a Windows filename (control chars handled separately by code point, so
 * the source carries no literal control bytes and no regex range can be miswritten). */
const ILLEGAL_CHARS = new Set('<>:"/\\|?*'.split(""));

/** Strip C0 control chars (0x00–0x1f), DEL (0x7f), and the Windows-illegal set from a string. */
function stripIllegal(s) {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c <= 0x1f || c === 0x7f || ILLEGAL_CHARS.has(ch)) continue;
    out += ch;
  }
  return out;
}

/** Minimal Content-Type → extension map for when a URL basename carries no extension. */
const MIME_EXT = {
  "text/html": ".html",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "text/markdown": ".md",
  "text/xml": ".xml",
  "application/json": ".json",
  "application/xml": ".xml",
  "application/pdf": ".pdf",
  "application/zip": ".zip",
  "application/gzip": ".gz",
  "application/x-tar": ".tar",
  "application/x-7z-compressed": ".7z",
  "application/x-bzip2": ".bz2",
  "application/wasm": ".wasm",
  "application/octet-stream": "",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.android.package-archive": ".apk",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "audio/mpeg": ".mp3",
  "video/mp4": ".mp4"
};

/** A resolved destination escaped the download root, or no free slot could be found. */
export class UnsafePathError extends Error {
  constructor(name) {
    super(`Refusing to write "${name}": the resolved path escapes the download folder.`);
    this.name = "UnsafePathError";
    this.code = "unsafe_path";
  }
}

/**
 * Reduce an arbitrary (possibly hostile) name to a bare, filesystem-safe basename.
 * Returns "" when nothing safe survives — the caller then falls back to a generated name.
 * @param {string} name
 * @returns {string}
 */
export function sanitizeFilename(name) {
  let s = String(name ?? "");
  // Strip any directory component (both separators — a POSIX name can reach a Windows FS and
  // vice-versa), decode one layer of %-encoding, then re-strip (so `%2f` → `/` can't survive).
  s = s.replace(/\\/g, "/").split("/").pop() || "";
  try {
    s = decodeURIComponent(s);
  } catch {
    /* not valid %-encoding — keep the raw string */
  }
  s = s.replace(/\\/g, "/").split("/").pop() || "";
  s = stripIllegal(s);
  s = s.replace(/^\.+/, ""); // no leading dots: kills "..", hidden-file surprises
  s = s.replace(/[. ]+$/, ""); // Windows silently strips a trailing dot/space — do it explicitly
  s = s.trim().replace(/\s+/g, " ");
  if (s.length > MAX_LEN) {
    const ext = path.extname(s).slice(0, 16);
    s = s.slice(0, MAX_LEN - ext.length) + ext;
  }
  // Guard Windows reserved device names on the base (CON, NUL, COM1…): "CON.txt" is still CON.
  const base = s.slice(0, s.length - path.extname(s).length);
  if (RESERVED_WIN.test(base)) s = "_" + s;
  return s;
}

/**
 * Map a Content-Type to a file extension (params like `; charset=` stripped), or "" if unknown.
 * @param {string | null | undefined} contentType
 * @returns {string}
 */
export function extForContentType(contentType) {
  if (!contentType) return "";
  const key = String(contentType).split(";")[0].trim().toLowerCase();
  return MIME_EXT[key] || "";
}

/**
 * Choose the filename to save as: an explicit (untrusted) suggestion wins, else the URL basename,
 * else a timestamped fallback — then ensure it carries an extension (from the URL name or the
 * Content-Type). Never trusts a Content-Disposition header.
 * @param {{ suggested?: string, url?: URL, contentType?: string | null }} args
 * @returns {string}
 */
export function deriveFilename({ suggested, url, contentType } = {}) {
  let name = sanitizeFilename(suggested || "");
  if (!name && url) {
    const last = decodeURIComponentSafe((url.pathname || "").split("/").pop() || "");
    name = sanitizeFilename(last);
  }
  if (!name) name = `download-${Date.now()}`;
  if (!path.extname(name)) {
    const ext = extForContentType(contentType);
    if (ext) name += ext;
  }
  return name;
}

function decodeURIComponentSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Resolve `filename` under `root` and REFUSE anything that escapes the root (the hard boundary,
 * checked before any write). Never overwrites: if the target exists, appends ` (1)`, ` (2)`, …
 * like a browser, so a second download of the same name can't silently clobber the first.
 * @param {string} root download root (absolute or resolvable)
 * @param {string} filename a sanitized basename
 * @param {(p: string) => boolean} [existsFn] injectable for tests
 * @returns {string} absolute destination path, guaranteed inside `root`
 * @throws {UnsafePathError}
 */
export function resolveWithinRoot(root, filename, existsFn = existsSync) {
  const rootAbs = path.resolve(root);
  const destAbs = path.resolve(rootAbs, filename);
  const rel = path.relative(rootAbs, destAbs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new UnsafePathError(filename);
  }
  if (!existsFn(destAbs)) return destAbs;
  const ext = path.extname(destAbs);
  const stem = destAbs.slice(0, destAbs.length - ext.length);
  for (let i = 1; i < 10000; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!existsFn(candidate)) return candidate;
  }
  throw new UnsafePathError(filename);
}
