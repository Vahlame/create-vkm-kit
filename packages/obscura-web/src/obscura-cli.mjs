/**
 * Thin wrapper around the `obscura` CLI (https://github.com/h4ckf0r0day/obscura).
 *
 * We invoke `obscura fetch <url>` PER REQUEST rather than running a long-lived
 * `obscura serve` CDP server: obscura exposes no `--host`/`--bind` flag, so a
 * persistent server would open a port we cannot pin to loopback — a per-request
 * fetch opens no port at all and is the safer default for low-volume agent use
 * (verified against obscura v0.1.10's CLI: `fetch` supports
 * `--dump html|text|links|markdown|assets|original`, `--stealth`, `--timeout <secs>`,
 * `--wait-until`, `--selector`, `--quiet`).
 *
 * Everything spawns with an argv array (never `shell: true`) — a crafted URL must
 * never reach a shell — and only http(s) URLs are accepted so a value starting with
 * "-" cannot be reinterpreted as an obscura flag.
 */
import { execa } from "execa";

/** Absolute obscura binary path (installer sets OBSCURA_BIN), else `obscura` on PATH. */
export function obscuraBin() {
  return process.env.OBSCURA_BIN || "obscura";
}

/** Stealth (anti-detection) is on unless explicitly disabled. */
export function defaultStealth() {
  return process.env.OBSCURA_STEALTH !== "0";
}

/** Default per-fetch navigation budget (ms). */
export function defaultTimeoutMs() {
  const v = Number(process.env.OBSCURA_FETCH_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 30_000;
}

/** How many extra attempts a transient failure gets (0 = no retry). */
export function defaultRetries() {
  const v = Number(process.env.OBSCURA_FETCH_RETRIES);
  return Number.isFinite(v) && v >= 0 ? v : 2;
}

/** Backoff base (ms) — attempt N waits `base * 2^N` plus jitter in `[0, base*2^N)`. */
export function defaultRetryBaseMs() {
  const v = Number(process.env.OBSCURA_FETCH_RETRY_BASE_MS);
  return Number.isFinite(v) && v > 0 ? v : 500;
}

/** Matches a transient timeout/network failure — the class a retry can plausibly fix. A missing
 * binary (`ENOENT`), a bad-URL validation error, or an unrecognized navigation error (which may be
 * a permanent 4xx/DNS failure obscura has no structured way to distinguish from a blip) is left
 * alone: retrying those wastes the caller's deadline on something a second attempt won't change. */
const RETRYABLE_ERROR =
  /timeout|ETIMEDOUT|ECONNRESET|EAI_AGAIN|net::ERR_(TIMED_OUT|CONNECTION_RESET|CONNECTION_REFUSED|CONNECTION_CLOSED|NETWORK_CHANGED|INTERNET_DISCONNECTED)/i;

/** @param {Error & { code?: string }} err */
function isRetryable(err) {
  if (err?.code === "ENOENT") return false;
  return RETRYABLE_ERROR.test(String(err?.message || ""));
}

/** Real delay, injectable so tests never actually wait. */
async function defaultSleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** obscura `--dump` value for each MCP `format`. */
const DUMP_BY_FORMAT = {
  markdown: "markdown",
  md: "markdown",
  text: "text",
  html: "html",
  links: "links",
  // `raw` = obscura's `--dump original`: the pristine response body, unparsed by the browser DOM.
  // Needed for structured feeds (RSS/XML/JSON) — `--dump html` mangles them (voids <link>, drops items).
  raw: "original",
  original: "original"
};

/** True only for absolute http(s) URLs — blocks flag-injection and non-web schemes. */
export function isHttpUrl(u) {
  return typeof u === "string" && /^https?:\/\/\S/i.test(u);
}

/**
 * Default runner: spawn obscura with argv (no shell), enforce a hard timeout, and
 * surface a clear error. `code === "ENOENT"` is preserved so callers can detect a
 * missing binary and steer the agent to the native fallback.
 * @param {string} bin
 * @param {string[]} args
 * @param {{ timeoutMs: number }} opts
 * @returns {Promise<string>} stdout
 */
async function defaultRun(bin, args, { timeoutMs }) {
  const res = await execa(bin, args, {
    timeout: timeoutMs,
    reject: false,
    windowsHide: true,
    stripFinalNewline: false
  });
  if (res.failed || res.exitCode !== 0) {
    const detail = String(res.stderr || res.shortMessage || `exit ${res.exitCode}`).trim();
    /** @type {Error & { code?: string, exitCode?: number|null }} */
    const err = new Error(detail);
    if (res.code) err.code = res.code;
    err.exitCode = res.exitCode ?? null;
    throw err;
  }
  return res.stdout ?? "";
}

/**
 * Is the obscura binary present and runnable? (`obscura --version`.)
 * @param {(bin: string, args: string[], opts: { timeoutMs: number }) => Promise<string>} [run]
 * @returns {Promise<boolean>}
 */
export async function obscuraAvailable(run = defaultRun) {
  try {
    await run(obscuraBin(), ["--version"], { timeoutMs: 8_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch (and, with stealth, render) a URL via obscura. Transient failures (timeout, connection
 * reset) get up to `opts.retries` extra attempts with exponential backoff+jitter; anything else
 * (missing binary, a non-transient navigation error) throws on the first attempt.
 * @param {string} url http(s) URL to fetch
 * @param {{ format?: keyof typeof DUMP_BY_FORMAT, stealth?: boolean, timeoutMs?: number,
 *           retries?: number, retryBaseMs?: number }} [opts]
 * @param {(bin: string, args: string[], opts: { timeoutMs: number }) => Promise<string>} [run]
 * @param {(ms: number) => Promise<void>} [sleep]
 * @returns {Promise<{ content: string, format: string }>}
 */
export async function obscuraFetch(url, opts = {}, run = defaultRun, sleep = defaultSleep) {
  if (!isHttpUrl(url)) {
    throw new Error(`obscura_fetch: refusing non-http(s) URL: ${JSON.stringify(url)}`);
  }
  const format = opts.format ?? "markdown";
  const stealth = opts.stealth ?? defaultStealth();
  const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs();
  const dump = DUMP_BY_FORMAT[format] || "markdown";
  const secs = Math.max(1, Math.ceil(timeoutMs / 1000));
  const args = ["fetch", url, "--dump", dump, "--timeout", String(secs), "--quiet"];
  if (stealth) args.push("--stealth");
  const retries = opts.retries ?? defaultRetries();
  const retryBaseMs = opts.retryBaseMs ?? defaultRetryBaseMs();

  for (let attempt = 0; ; attempt++) {
    try {
      // Give execa a slightly larger deadline than obscura's own navigation timeout so
      // obscura wins the race and we get its error message, not a hard process kill.
      const content = await run(obscuraBin(), args, { timeoutMs: timeoutMs + 15_000 });
      return { content, format: dump };
    } catch (e) {
      if (attempt >= retries || !isRetryable(e)) throw e;
      const backoff = retryBaseMs * 2 ** attempt;
      await sleep(backoff + Math.random() * backoff);
    }
  }
}
