import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OBSCURA_VERSION,
  resolveSpec,
  obscuraBinPath,
  downloadUrl,
  installFromSpec,
  maybeInstallObscura
} from "../src/obscura-setup.mjs";

const neverInstalled = { isRunnable: async () => false };

test("resolveSpec/obscuraBinPath map platform+arch to the right asset", () => {
  assert.equal(resolveSpec("win32", "x64").asset, "obscura-x86_64-windows.zip");
  assert.equal(resolveSpec("linux", "arm64").asset, "obscura-aarch64-linux.tar.gz");
  assert.equal(resolveSpec("sunos", "sparc"), null);
  assert.ok(obscuraBinPath("win32", "x64").endsWith("obscura.exe"));
  assert.ok(obscuraBinPath("linux", "x64").endsWith(join(".vkm", "obscura", "obscura")));
  assert.equal(obscuraBinPath("sunos", "sparc"), null);
});

test("downloadUrl pins the release tag and asset", () => {
  assert.equal(
    downloadUrl("obscura-x86_64-windows.zip"),
    `https://github.com/h4ckf0r0day/obscura/releases/download/v${OBSCURA_VERSION}/obscura-x86_64-windows.zip`
  );
});

test("every baked-in asset ships a real 64-hex SHA-256 (checksums pinned)", () => {
  for (const [platform, arch] of [
    ["win32", "x64"],
    ["linux", "x64"],
    ["linux", "arm64"],
    ["darwin", "x64"],
    ["darwin", "arm64"]
  ]) {
    assert.match(resolveSpec(platform, arch).sha256, /^[0-9a-f]{64}$/);
  }
});

test("maybeInstallObscura: disabled → skipped", async () => {
  const r = await maybeInstallObscura(false, { enable: false });
  assert.equal(r.status, "skipped");
  assert.equal(r.binPath, null);
});

test("maybeInstallObscura: unsupported platform → manual", async () => {
  const r = await maybeInstallObscura(false, { platform: "sunos", arch: "sparc" }, neverInstalled);
  assert.equal(r.status, "manual");
});

test("maybeInstallObscura: with a pinned checksum and no existing install, invokes the installer", async () => {
  let calledSpec = null;
  const r = await maybeInstallObscura(
    false,
    { platform: "linux", arch: "x64" },
    {
      isRunnable: async () => false,
      installImpl: async (spec) => {
        calledSpec = spec;
        return { status: "ready", binPath: "/fake/obscura" };
      }
    }
  );
  assert.equal(r.status, "ready");
  assert.equal(r.binPath, "/fake/obscura");
  assert.equal(calledSpec.asset, "obscura-x86_64-linux.tar.gz");
});

test("maybeInstallObscura: dry-run never downloads (reports skipped with the target path)", async () => {
  const r = await maybeInstallObscura(true, { platform: "win32", arch: "x64" }, neverInstalled);
  assert.equal(r.status, "skipped");
  assert.ok(String(r.binPath).endsWith("obscura.exe"));
});

test("installFromSpec: SHA-256 mismatch aborts before extracting (never runs the bytes)", async () => {
  const home = mkdtempSync(join(tmpdir(), "obscura-mismatch-"));
  try {
    let extracted = false;
    const deps = {
      download: async (_url, dest) => writeFileSync(dest, "PAYLOAD"),
      hashFile: async () => "deadbeef",
      extract: async () => {
        extracted = true;
      },
      isRunnable: async () => true
    };
    const r = await installFromSpec(
      { asset: "a.tar.gz", sha256: "cafef00d", bin: "obscura" },
      { platform: "linux", home, tmpDir: home },
      deps
    );
    assert.equal(r.status, "failed");
    assert.equal(r.binPath, null);
    assert.equal(extracted, false, "must not extract a checksum-mismatched download");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("installFromSpec: matching checksum extracts, locates the binary, and reports ready", async () => {
  const home = mkdtempSync(join(tmpdir(), "obscura-ok-"));
  try {
    const deps = {
      download: async (_url, dest) => writeFileSync(dest, "PAYLOAD"),
      hashFile: async () => "ABC123", // compared case-insensitively
      extract: async (_archive, dst) => writeFileSync(join(dst, "obscura"), "#!/bin/sh\n"),
      isRunnable: async () => true
    };
    const r = await installFromSpec(
      { asset: "a.tar.gz", sha256: "abc123", bin: "obscura" },
      { platform: "linux", home, tmpDir: home },
      deps
    );
    assert.equal(r.status, "ready");
    assert.equal(r.binPath, join(home, "obscura"));
    assert.ok(existsSync(r.binPath));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("installFromSpec: locates a binary nested one folder deep inside the archive", async () => {
  const home = mkdtempSync(join(tmpdir(), "obscura-nested-"));
  try {
    const deps = {
      download: async (_url, dest) => writeFileSync(dest, "PAYLOAD"),
      hashFile: async () => "abc123",
      extract: async (_archive, dst) => {
        const sub = join(dst, "obscura-v0.1.10");
        mkdirSync(sub, { recursive: true });
        writeFileSync(join(sub, "obscura"), "#!/bin/sh\n");
      },
      isRunnable: async () => true
    };
    const r = await installFromSpec(
      { asset: "a.tar.gz", sha256: "abc123", bin: "obscura" },
      { platform: "linux", home, tmpDir: home },
      deps
    );
    assert.equal(r.status, "ready");
    assert.ok(r.binPath.endsWith(join("obscura-v0.1.10", "obscura")));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
