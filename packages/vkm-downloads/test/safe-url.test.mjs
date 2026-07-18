/**
 * The address guard is the load-bearing security control: it is the reason downloading through
 * this tool can't be turned against the kit's own loopback services. These tests pin its behavior
 * across IPv4, IPv6, IPv4-mapped, and the DNS-rebinding ("resolves to both public and private")
 * case, plus the scheme gate. All offline — resolveAndValidate takes an injected lookup.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertHttpUrl,
  isPrivateAddress,
  resolveAndValidate,
  UnsupportedSchemeError,
  BlockedAddressError
} from "../src/safe-url.mjs";

test("isPrivateAddress: blocks loopback/private/link-local/CGNAT IPv4", () => {
  for (const ip of [
    "127.0.0.1",
    "127.5.5.5",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.10.10",
    "100.64.0.1",
    "0.0.0.0",
    "255.255.255.255"
  ]) {
    assert.equal(isPrivateAddress(ip), true, `${ip} must be blocked`);
  }
});

test("isPrivateAddress: allows public IPv4", () => {
  for (const ip of [
    "93.184.216.34",
    "8.8.8.8",
    "1.1.1.1",
    "172.15.0.1",
    "172.32.0.1",
    "11.0.0.1"
  ]) {
    assert.equal(isPrivateAddress(ip), false, `${ip} must be allowed`);
  }
});

test("isPrivateAddress: blocks loopback/ULA/link-local IPv6 (and mapped IPv4)", () => {
  for (const ip of [
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "fe80::abcd",
    "::ffff:127.0.0.1",
    "::ffff:192.168.0.1"
  ]) {
    assert.equal(isPrivateAddress(ip), true, `${ip} must be blocked`);
  }
});

test("isPrivateAddress: allows public IPv6 and mapped-public IPv4", () => {
  assert.equal(isPrivateAddress("2606:4700:4700::1111"), false);
  assert.equal(isPrivateAddress("::ffff:93.184.216.34"), false);
});

test("isPrivateAddress: fails closed on garbage", () => {
  for (const junk of ["", "not-an-ip", "999.999.999.999", null, undefined]) {
    assert.equal(isPrivateAddress(junk), true, `${junk} must fail closed (blocked)`);
  }
});

test("assertHttpUrl: accepts http(s), rejects everything else", () => {
  assert.equal(assertHttpUrl("https://example.com/a").protocol, "https:");
  assert.equal(assertHttpUrl("http://example.com").protocol, "http:");
  for (const bad of [
    "file:///etc/passwd",
    "ftp://x/y",
    "data:text/plain,hi",
    "javascript:1",
    "not a url"
  ]) {
    assert.throws(() => assertHttpUrl(bad), UnsupportedSchemeError, bad);
  }
});

test("resolveAndValidate: rejects a host that resolves to a private address", async () => {
  const lookup = (_h, _o, cb) => cb(null, [{ address: "127.0.0.1", family: 4 }]);
  await assert.rejects(() => resolveAndValidate("evil.test", lookup), BlockedAddressError);
});

test("resolveAndValidate: rejects if ANY resolved record is private (DNS-rebinding guard)", async () => {
  const lookup = (_h, _o, cb) =>
    cb(null, [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 }
    ]);
  await assert.rejects(() => resolveAndValidate("rebind.test", lookup), BlockedAddressError);
});

test("resolveAndValidate: returns the first validated address for a public host", async () => {
  const lookup = (_h, _o, cb) => cb(null, [{ address: "93.184.216.34", family: 4 }]);
  const pinned = await resolveAndValidate("example.com", lookup);
  assert.equal(pinned.address, "93.184.216.34");
  assert.equal(pinned.family, 4);
});

test("resolveAndValidate: propagates a DNS lookup error", async () => {
  const lookup = (_h, _o, cb) => cb(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }));
  await assert.rejects(() => resolveAndValidate("nope.test", lookup), /ENOTFOUND/);
});
