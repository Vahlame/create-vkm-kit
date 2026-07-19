/**
 * URL + address safety for the file-download tools.
 *
 * The threat this guards against is NOT classic server-side SSRF (this MCP already runs on the
 * user's own machine). It is a confused-deputy: a URL that reached the agent from an untrusted
 * place — a search result, a fetched page — could point the download tool at a loopback/private
 * service that only exists because this very kit put it there (Ollama on 127.0.0.1:11434, an
 * on-demand SearXNG, a local HTTP MCP). Downloading from those is never a legitimate user ask,
 * so we refuse any URL whose host resolves into a loopback/private/link-local range.
 *
 * Correctness detail that matters: the check must hold at CONNECT time, not just at check time.
 * A resolve-then-fetch leaves a DNS-rebinding TOCTOU (public A record on the check, private on
 * the fetch). {@link resolveAndValidate} resolves exactly once and the caller pins the socket to
 * that validated address (see download.mjs's `fixedLookup`), so there is no second resolution to
 * rebind. Fail-closed throughout: an unparseable address is treated as blocked.
 *
 * Pure (no network beyond the injectable lookup) so it is unit-testable in isolation.
 */
import dns from "node:dns";
import net from "node:net";

/** A non-http(s) URL was handed to a download tool. */
export class UnsupportedSchemeError extends Error {
  constructor(scheme) {
    super(`Only http(s) URLs can be downloaded (got "${scheme || "?"}").`);
    this.name = "UnsupportedSchemeError";
    this.code = "unsupported_scheme";
  }
}

/** A URL's host resolved into a private/loopback/link-local range — refused. */
export class BlockedAddressError extends Error {
  constructor(host, address) {
    super(
      `Refusing to download from "${host}": it resolves to a private/loopback address ` +
        `(${address}). Only public web URLs are allowed — this guards local services (Ollama, ` +
        `SearXNG, MCP servers) against a URL that arrived from an untrusted page or search result.`
    );
    this.name = "BlockedAddressError";
    this.code = "blocked_address";
  }
}

/**
 * Parse a raw URL string and require an http(s) scheme.
 * @param {string | URL} raw
 * @returns {URL}
 * @throws {UnsupportedSchemeError}
 */
export function assertHttpUrl(raw) {
  let u;
  try {
    u = raw instanceof URL ? raw : new URL(String(raw));
  } catch {
    throw new UnsupportedSchemeError(String(raw).slice(0, 24));
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new UnsupportedSchemeError(u.protocol.replace(/:$/, ""));
  }
  return u;
}

/**
 * Expand an IPv6 literal to its 16 bytes, or null if unparseable. Handles `::` zero-compression
 * and IPv4-mapped (`::ffff:1.2.3.4`) forms; a leading zone id (`%eth0`) must be stripped first.
 * @param {string} s
 * @returns {Uint8Array | null}
 */
function ipv6ToBytes(s) {
  let str = s;
  const v4mapped = str.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4mapped) {
    const octets = v4mapped[2].split(".").map(Number);
    if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
    const tail = [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
    str = v4mapped[1] + (tail.length ? tail.map((h) => h.toString(16)).join(":") : "");
  }
  const halves = str.split("::");
  if (halves.length > 2) return null;
  const parseGroups = (part) =>
    part === ""
      ? []
      : part.split(":").map((g) => (/^[0-9a-fA-F]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  const head = parseGroups(halves[0]);
  const back = halves.length === 2 ? parseGroups(halves[1]) : null;
  const groups =
    back === null ? head : [...head, ...new Array(8 - head.length - back.length).fill(0), ...back];
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff))
    return null;
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    bytes[i * 2] = (groups[i] >> 8) & 0xff;
    bytes[i * 2 + 1] = groups[i] & 0xff;
  }
  return bytes;
}

/** @param {string} s dotted-quad */
function isPrivateV4(s) {
  const o = s.split(".").map(Number);
  if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true; // fail closed
  const [a, b] = o;
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 127) return true; // loopback
  if (a === 10) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT shared address space
  if (s === "255.255.255.255") return true; // broadcast
  return false;
}

/** @param {string} s IPv6 literal (zone id already stripped) */
function isPrivateV6(s) {
  const bytes = ipv6ToBytes(s);
  if (!bytes) return true; // fail closed
  const allZeroBut = (lastVal) => bytes.every((v, i) => (i === 15 ? v === lastVal : v === 0));
  if (bytes.every((v) => v === 0)) return true; // :: unspecified
  if (allZeroBut(1)) return true; // ::1 loopback
  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  // IPv4-mapped ::ffff:a.b.c.d — defer to the v4 ranges on the embedded address.
  const mapped =
    bytes.slice(0, 10).every((v) => v === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (mapped) return isPrivateV4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
  return false;
}

/**
 * Is this resolved IP address in a loopback/private/link-local range we refuse to reach?
 * Fail-closed: anything not recognizably a public IP returns true (blocked).
 * @param {string} address
 * @returns {boolean}
 */
export function isPrivateAddress(address) {
  const s = String(address ?? "")
    .trim()
    .replace(/%.*$/, ""); // drop IPv6 zone id
  const fam = net.isIP(s);
  if (fam === 4) return isPrivateV4(s);
  if (fam === 6) return isPrivateV6(s);
  return true; // not an IP we can vet → block
}

/**
 * Resolve a hostname once via `lookupImpl` (default `dns.lookup`), reject if ANY returned address
 * is private/loopback/link-local, and return the first validated address for the caller to pin
 * the connection to. Rejecting on ANY private record (not just the one we'd pick) closes the
 * "resolves to both a public and a private A record" rebinding trap.
 * @param {string} hostname
 * @param {typeof dns.lookup} [lookupImpl]
 * @returns {Promise<{ address: string, family: number }>}
 * @throws {BlockedAddressError}
 */
export function resolveAndValidate(hostname, lookupImpl = dns.lookup) {
  return new Promise((resolve, reject) => {
    lookupImpl(hostname, { all: true }, (err, result) => {
      if (err) return reject(err);
      const list = (Array.isArray(result) ? result : [result])
        .filter(Boolean)
        .map((x) => (typeof x === "string" ? { address: x, family: net.isIP(x) } : x));
      if (!list.length) return reject(new BlockedAddressError(hostname, "(no address)"));
      for (const { address } of list) {
        if (isPrivateAddress(address)) return reject(new BlockedAddressError(hostname, address));
      }
      resolve({ address: list[0].address, family: list[0].family || net.isIP(list[0].address) });
    });
  });
}
