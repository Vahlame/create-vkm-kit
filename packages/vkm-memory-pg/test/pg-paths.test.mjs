import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  vaultSlug,
  pgHome,
  vaultPgDir,
  serviceInfoPath,
  tokenPath,
  lockPath,
  readServiceInfo,
  readToken,
  lockAlive
} from "../src/pg-paths.mjs";

/** A pid that is (practically) never alive — process ids near the 32-bit cap. */
const DEAD_PID = 2 ** 30 + 12345;

test("vaultSlug is deterministic and shaped <kebab-basename>-<8 hex>", () => {
  const p = join(tmpdir(), "My Vault (2024)");
  const slug = vaultSlug(p);
  assert.equal(slug, vaultSlug(p));
  assert.match(slug, /^my-vault-2024-[0-9a-f]{8}$/);
});

test("vaultSlug: same basename, different parent -> different hash suffix", () => {
  const a = vaultSlug(join(tmpdir(), "a", "vault"));
  const b = vaultSlug(join(tmpdir(), "b", "vault"));
  assert.notEqual(a, b);
  assert.equal(a.split("-").slice(0, -1).join("-"), b.split("-").slice(0, -1).join("-"));
});

test(
  "vaultSlug on win32 is case-insensitive over the path",
  { skip: process.platform !== "win32" },
  () => {
    const p = join(tmpdir(), "CaseVault");
    assert.equal(vaultSlug(p.toUpperCase()), vaultSlug(p.toLowerCase()));
  }
);

test("pgHome and vaultPgDir honor VKM_PG_DATA_ROOT", () => {
  const root = join(tmpdir(), "vkm-pg-root");
  const env = { VKM_PG_DATA_ROOT: root };
  assert.equal(pgHome(env), root);
  const dir = vaultPgDir(join(tmpdir(), "somevault"), env);
  assert.ok(dir.startsWith(root));
  assert.match(dir, /somevault-[0-9a-f]{8}$/);
});

test("path helpers name the contract files", () => {
  assert.equal(serviceInfoPath("X"), join("X", "service.json"));
  assert.equal(tokenPath("X"), join("X", "service.token"));
  assert.equal(lockPath("X"), join("X", "service.lock"));
});

test("readServiceInfo: live pid -> info, dead pid -> null, garbage -> null", () => {
  const dir = mkdtempSync(join(tmpdir(), "vkm-pg-paths-"));
  try {
    assert.equal(readServiceInfo(dir), null); // missing file

    writeFileSync(
      serviceInfoPath(dir),
      JSON.stringify({ port: 12345, pid: process.pid, vault: "v", version: "5.4.0" }),
      "utf8"
    );
    const live = readServiceInfo(dir);
    assert.ok(live);
    assert.equal(live.port, 12345);
    assert.equal(live.pid, process.pid);

    writeFileSync(serviceInfoPath(dir), JSON.stringify({ port: 1, pid: DEAD_PID }), "utf8");
    assert.equal(readServiceInfo(dir), null); // stale: pid not alive

    writeFileSync(serviceInfoPath(dir), "not json at all", "utf8");
    assert.equal(readServiceInfo(dir), null);

    writeFileSync(serviceInfoPath(dir), JSON.stringify({ port: "x", pid: "y" }), "utf8");
    assert.equal(readServiceInfo(dir), null); // non-integer fields
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("lockAlive: live pid true, dead pid (stale lock) false, missing false", () => {
  const dir = mkdtempSync(join(tmpdir(), "vkm-pg-lock-"));
  try {
    assert.equal(lockAlive(dir), false);
    writeFileSync(lockPath(dir), JSON.stringify({ pid: process.pid, port: 1 }), "utf8");
    assert.equal(lockAlive(dir), true);
    writeFileSync(lockPath(dir), JSON.stringify({ pid: DEAD_PID, port: 1 }), "utf8");
    assert.equal(lockAlive(dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readToken trims, and returns null for missing/empty", () => {
  const dir = mkdtempSync(join(tmpdir(), "vkm-pg-token-"));
  try {
    assert.equal(readToken(dir), null);
    writeFileSync(tokenPath(dir), "abc123\n", "utf8");
    assert.equal(readToken(dir), "abc123");
    writeFileSync(tokenPath(dir), "   \n", "utf8");
    assert.equal(readToken(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("vaultPgDir never collides two distinct vaults in the same data root", () => {
  const env = { VKM_PG_DATA_ROOT: join(tmpdir(), "root") };
  const seen = new Set();
  for (const name of ["v1", "v2", "V1 copy", "ñandú", "a b c"]) {
    const dir = vaultPgDir(join(tmpdir(), name), env);
    assert.ok(!seen.has(dir), `collision on ${name}`);
    seen.add(dir);
    mkdirSync(dir, { recursive: true }); // path is actually creatable
    rmSync(dir, { recursive: true, force: true });
  }
});
