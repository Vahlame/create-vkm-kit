/**
 * Per-host circuit breaker for the crawl/research fetch loops.
 *
 * `obscura-cli.mjs` already retries a single `obscura_fetch`/`_many` call with backoff — but a
 * crawl (ADR-0062) or a research call (ADR-0054) can queue hundreds of URLs on a handful of
 * hosts, and a host that just went down must not eat the whole page/candidate budget being
 * retried one URL at a time. After `failureThreshold` consecutive failures on one host, this
 * opens the circuit for `cooldownMs`: further URLs on that host are skipped outright instead of
 * paying a fetch attempt (and its own retries) that will almost certainly fail too — the same
 * ban-avoidance posture ADR-0057/ADR-0062 already center the rest of this package's design on.
 *
 * Deliberately NOT a shared/global singleton — one instance per crawl/research call (constructed
 * fresh by the caller, injectable via `deps.breakerImpl` for tests). A host down during one job
 * may be back by the next; nothing here should remember a failure past the run that observed it.
 */
export class OriginCircuitBreaker {
  /**
   * @param {{ failureThreshold?: number, cooldownMs?: number, now?: () => number }} [opts]
   *   Defaults are overridable per-machine via `OBSCURA_CIRCUIT_FAILURE_THRESHOLD` /
   *   `OBSCURA_CIRCUIT_COOLDOWN_MS`, matching every other resilience knob in this package.
   */
  constructor({
    failureThreshold = Number(process.env.OBSCURA_CIRCUIT_FAILURE_THRESHOLD) || 3,
    cooldownMs = Number(process.env.OBSCURA_CIRCUIT_COOLDOWN_MS) || 60_000,
    now = Date.now
  } = {}) {
    this.failureThreshold = Math.max(1, Number(failureThreshold) || 3);
    this.cooldownMs = Math.max(0, Number(cooldownMs) || 0);
    this.now = now;
    /** @type {Map<string, { failures: number, openUntil: number }>} */
    this.state = new Map();
  }

  /** Is `host` currently refusing new attempts? */
  isOpen(host) {
    const s = this.state.get(host);
    return Boolean(s && s.openUntil > this.now());
  }

  /** A fetch on `host` succeeded — clears its failure count and closes the circuit. */
  recordSuccess(host) {
    this.state.delete(host);
  }

  /** A fetch on `host` failed. Opens the circuit once `failureThreshold` consecutive failures
   * (uninterrupted by a success) is reached. */
  recordFailure(host) {
    const s = this.state.get(host) ?? { failures: 0, openUntil: 0 };
    s.failures += 1;
    if (s.failures >= this.failureThreshold) s.openUntil = this.now() + this.cooldownMs;
    this.state.set(host, s);
  }
}
