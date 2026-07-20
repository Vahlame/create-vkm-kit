import test from "node:test";
import assert from "node:assert/strict";
import { compareSemver, updateBanner, fetchLatestVersion } from "../src/version-check.mjs";

// ---- compareSemver: numeric major/minor/patch, prerelease sorts below the same release.

test("compareSemver: equal versions", () => {
  assert.equal(compareSemver("4.3.0", "4.3.0"), 0);
});

test("compareSemver: numeric major/minor/patch ordering", () => {
  assert.equal(compareSemver("4.3.0", "4.4.0"), -1);
  assert.equal(compareSemver("4.4.0", "4.3.0"), 1);
  assert.equal(compareSemver("4.3.9", "4.3.10"), -1, "patch compares numerically, not lexically");
  assert.equal(compareSemver("3.9.0", "4.0.0"), -1);
  assert.equal(compareSemver("10.0.0", "9.0.0"), 1);
});

test("compareSemver: a prerelease suffix sorts below the same release", () => {
  assert.equal(compareSemver("4.4.0-rc.1", "4.4.0"), -1);
  assert.equal(compareSemver("4.4.0", "4.4.0-rc.1"), 1);
});

test("compareSemver: two prereleases of the same core version", () => {
  assert.equal(compareSemver("4.4.0-rc.1", "4.4.0-rc.2"), -1);
  assert.equal(compareSemver("4.4.0-rc.2", "4.4.0-rc.1"), 1);
  assert.equal(compareSemver("4.4.0-rc.1", "4.4.0-rc.1"), 0);
  assert.equal(compareSemver("4.4.0-alpha", "4.4.0-alpha.1"), -1, "fewer identifiers sorts lower");
});

// ---- updateBanner: null unless latest is a real, newer version.

test("updateBanner: null when latest equals current", () => {
  assert.equal(updateBanner({ current: "4.3.0", latest: "4.3.0" }), null);
});

test("updateBanner: null when latest is older than current", () => {
  assert.equal(updateBanner({ current: "4.3.0", latest: "4.2.0" }), null);
});

test("updateBanner: null when latest is null (registry unreachable)", () => {
  assert.equal(updateBanner({ current: "4.3.0", latest: null }), null);
});

test("updateBanner: non-null and names both versions when latest is newer", () => {
  const banner = updateBanner({ current: "4.3.0", latest: "4.4.0" });
  assert.notEqual(banner, null);
  assert.match(banner, /4\.3\.0/);
  assert.match(banner, /4\.4\.0/);
});

// ---- fetchLatestVersion: fails open on every kind of failure, never throws.

test("fetchLatestVersion: resolves the version from a good payload", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ version: "4.5.0" })
  });
  const v = await fetchLatestVersion({ fetchImpl });
  assert.equal(v, "4.5.0");
});

test("fetchLatestVersion: resolves null on a 404", async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({}) });
  const v = await fetchLatestVersion({ fetchImpl });
  assert.equal(v, null);
});

test("fetchLatestVersion: resolves null on malformed JSON", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => {
      throw new SyntaxError("Unexpected token");
    }
  });
  const v = await fetchLatestVersion({ fetchImpl });
  assert.equal(v, null);
});

test("fetchLatestVersion: resolves null when fetchImpl rejects (offline/DNS)", async () => {
  const fetchImpl = async () => {
    throw new Error("getaddrinfo ENOTFOUND registry.npmjs.org");
  };
  const v = await fetchLatestVersion({ fetchImpl });
  assert.equal(v, null);
});

test("fetchLatestVersion: never throws even on a synchronously-throwing fetchImpl", async () => {
  const fetchImpl = () => {
    throw new Error("boom");
  };
  await assert.doesNotReject(() => fetchLatestVersion({ fetchImpl }));
});

test("fetchLatestVersion: resolves null on timeout, respecting the AbortSignal", async () => {
  const fetchImpl = (url, { signal } = {}) =>
    new Promise((resolve, reject) => {
      // Never resolves on its own — only the AbortSignal ends this call, exactly like a real
      // hung connection. Rejecting on abort mirrors the platform fetch's own behavior.
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    });
  const v = await fetchLatestVersion({ fetchImpl, timeoutMs: 20 });
  assert.equal(v, null);
});
