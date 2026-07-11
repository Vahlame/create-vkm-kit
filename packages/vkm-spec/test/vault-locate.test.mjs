import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { locateVault, defaultVaultCandidate } from "../src/vault-locate.mjs";

function withCleanEnv(fn) {
  const saved = {};
  for (const key of ["VKM_VAULT", "BASIC_MEMORY_HOME", "OBSIDIAN_MEMORY_VAULT"]) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("explicit path wins over everything", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-locate-"));
  assert.equal(locateVault(dir), path.resolve(dir));
});

test("env var wins when set", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-locate-"));
  withCleanEnv(() => {
    process.env.VKM_VAULT = dir;
    assert.equal(locateVault(), path.resolve(dir));
  });
});

test("no env: falls back to the installer default WHEN it is a real vault (first-run fix)", () => {
  withCleanEnv(() => {
    const candidate = defaultVaultCandidate();
    if (fs.existsSync(path.join(candidate, ".obsidian"))) {
      // On a machine with the default vault (like the one this bug was reported on).
      assert.equal(locateVault(), candidate);
    } else {
      // On CI: no default vault → a clear, actionable error.
      assert.throws(() => locateVault(), /--vault <path> or set VKM_VAULT/);
    }
  });
});
