/**
 * Unit coverage for the per-host circuit breaker (circuit-breaker.mjs) used by crawl.mjs and
 * research.mjs to stop hammering a host that just failed repeatedly.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { OriginCircuitBreaker } from "../src/circuit-breaker.mjs";

test("stays closed below the failure threshold", () => {
  const b = new OriginCircuitBreaker({ failureThreshold: 3 });
  b.recordFailure("foo.com");
  b.recordFailure("foo.com");
  assert.equal(b.isOpen("foo.com"), false, "2 failures, threshold 3 — still closed");
});

test("opens after failureThreshold consecutive failures", () => {
  const b = new OriginCircuitBreaker({ failureThreshold: 3, cooldownMs: 60_000 });
  b.recordFailure("foo.com");
  b.recordFailure("foo.com");
  b.recordFailure("foo.com");
  assert.equal(b.isOpen("foo.com"), true);
});

test("a success resets the failure count, so it takes threshold failures again to reopen", () => {
  const b = new OriginCircuitBreaker({ failureThreshold: 2 });
  b.recordFailure("foo.com");
  b.recordSuccess("foo.com");
  b.recordFailure("foo.com");
  assert.equal(b.isOpen("foo.com"), false, "success cleared the earlier failure");
});

test("closes again once cooldownMs elapses (injectable clock, no real sleep)", () => {
  let t = 0;
  const b = new OriginCircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => t });
  b.recordFailure("foo.com");
  assert.equal(b.isOpen("foo.com"), true);
  t = 1500;
  assert.equal(b.isOpen("foo.com"), false, "cooldown elapsed");
});

test("hosts are tracked independently", () => {
  const b = new OriginCircuitBreaker({ failureThreshold: 1 });
  b.recordFailure("foo.com");
  assert.equal(b.isOpen("foo.com"), true);
  assert.equal(b.isOpen("bar.com"), false, "a different host is unaffected");
});

test("a fresh instance starts closed for every host", () => {
  const b = new OriginCircuitBreaker();
  assert.equal(b.isOpen("never-seen.com"), false);
});
