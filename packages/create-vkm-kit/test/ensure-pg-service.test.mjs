/**
 * The pg-service keep-alive hook (SessionStart). What these pin:
 *
 *   - the per-vault service dir follows the frozen pg-service contract exactly:
 *     <PG_DATA_ROOT>/<folded basename>-<sha256(resolved path, lowercased on win32)[0..8)>,
 *     with VKM_PG_DATA_ROOT as the override — the hook and the service must compute the
 *     SAME directory or the liveness check reads a path nothing ever writes;
 *   - liveness is service.json's pid answering kill(0): own pid → alive, a dead pid or a
 *     missing/corrupt file → not alive (the safe direction, respawn);
 *   - run as a script with no argv, the hook exits 0 fast — fail-open is the contract,
 *     a session must never block on the projection layer;
 *   - argv[4] (the optional DSN) becomes VKM_PG_DSN in the spawned service's env — hooks
 *     inherit no MCP env, so without this every respawn would flip back to PGlite.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  hookDsnPath,
  pgServiceDir,
  pgServiceAlive,
  resolveHookDsnArg
} from "../src/hooks/ensure-pg-service.mjs";

const HOOK = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "hooks",
  "ensure-pg-service.mjs"
);

test("pgServiceDir computes the contract slug: folded basename + 8-hex path hash", () => {
  const root = path.join(os.tmpdir(), "vkm-pg-root");
  const vault = path.join(os.tmpdir(), "My Vault…2026!");
  const dir = pgServiceDir(vault, { VKM_PG_DATA_ROOT: root });

  const resolved = path.resolve(vault);
  const hashed = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  const expectedHash = createHash("sha256").update(hashed).digest("hex").slice(0, 8);

  assert.equal(path.dirname(dir), root, "VKM_PG_DATA_ROOT overrides the default root");
  assert.equal(path.basename(dir), `my-vault-2026-${expectedHash}`);
});

test("pgServiceDir strips leading/trailing separator runs from the folded basename", () => {
  const dir = pgServiceDir(path.join(os.tmpdir(), "¡¡vault!!"), {
    VKM_PG_DATA_ROOT: os.tmpdir()
  });
  assert.match(path.basename(dir), /^vault-[0-9a-f]{8}$/, "no dangling dashes around the slug");
});

test("pgServiceDir defaults to <home>/.vkm/pg when no override is set", () => {
  const dir = pgServiceDir(os.tmpdir(), {});
  assert.equal(path.dirname(dir), path.join(os.homedir(), ".vkm", "pg"));
});

test("pgServiceAlive: live pid → true; dead pid / missing / corrupt file → false", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-pg-alive-"));
  const vault = path.join(root, "vault");
  const env = { VKM_PG_DATA_ROOT: root };
  const dir = pgServiceDir(vault, env);
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, "service.json");

  assert.equal(pgServiceAlive(vault, env), false, "no service.json yet");

  fs.writeFileSync(fp, JSON.stringify({ port: 1, pid: process.pid, vault }), "utf8");
  assert.equal(pgServiceAlive(vault, env), true, "this test's own pid is alive");

  // A pid that cannot exist: kill(0) must throw and the check must say "not alive".
  fs.writeFileSync(fp, JSON.stringify({ port: 1, pid: 2 ** 30, vault }), "utf8");
  assert.equal(pgServiceAlive(vault, env), false, "stale pid means respawn");

  fs.writeFileSync(fp, "{not json", "utf8");
  assert.equal(pgServiceAlive(vault, env), false, "corrupt service.json fails open");
});

test("run with no argv the hook exits 0 and spawns nothing (fail-open contract)", () => {
  const r = spawnSync(process.execPath, [HOOK], { encoding: "utf8", timeout: 15_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "", "a keep-alive hook has nothing to say to the session");
});

test("resolveHookDsnArg: file path reads contents; raw DSN string is legacy-compatible", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-pg-resolve-dsn-"));
  const fp = path.join(root, "hook-dsn");
  fs.writeFileSync(fp, "postgres://from-file/vkm\n", "utf8");
  assert.equal(resolveHookDsnArg(fp), "postgres://from-file/vkm");
  assert.equal(
    resolveHookDsnArg("postgres://legacy/raw"),
    "postgres://legacy/raw",
    "pre-file installs still work"
  );
  assert.equal(resolveHookDsnArg(undefined), undefined);
});

async function spawnHookAndReadEnv(argv4) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-pg-hook-dsn-"));
  const vault = path.join(root, "vault");
  const outFp = path.join(root, "env-dump.json");
  const fakeService = path.join(root, "fake-service.mjs");
  fs.writeFileSync(
    fakeService,
    `import fs from "node:fs";\n` +
      `fs.writeFileSync(${JSON.stringify(outFp)}, JSON.stringify({\n` +
      `  dsn: process.env.VKM_PG_DSN ?? null,\n` +
      `  pg: process.env.VKM_PG ?? null\n` +
      `}));\n`,
    "utf8"
  );
  const r = spawnSync(process.execPath, [HOOK, fakeService, vault, argv4], {
    encoding: "utf8",
    timeout: 15_000,
    env: { ...process.env, VKM_PG_DATA_ROOT: root }
  });
  assert.equal(r.status, 0, r.stderr);
  const deadline = Date.now() + 10_000;
  let dump = null;
  while (dump === null && Date.now() < deadline) {
    try {
      dump = JSON.parse(fs.readFileSync(outFp, "utf8"));
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.ok(dump, "the detached service never ran (no env dump written)");
  return dump;
}

test("argv[4] DSN file contents reach the spawned service as VKM_PG_DSN", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-pg-hook-dsnfile-"));
  const vault = path.join(root, "vault");
  const env = { VKM_PG_DATA_ROOT: root };
  const DSN = "postgres://app:s3cret@db.example:5432/vkm";
  const dsnFile = hookDsnPath(vault, env);
  fs.mkdirSync(path.dirname(dsnFile), { recursive: true });
  fs.writeFileSync(dsnFile, DSN, "utf8");

  const dump = await spawnHookAndReadEnv(dsnFile);
  assert.equal(dump.dsn, DSN, "DSN file must become VKM_PG_DSN in the service env");
  assert.equal(dump.pg, "1", "VKM_PG=1 is always set");
});

test("argv[4] legacy raw DSN still reaches the spawned service as VKM_PG_DSN", async () => {
  const DSN = "postgres://app:s3cret@db.example:5432/vkm";
  const dump = await spawnHookAndReadEnv(DSN);
  assert.equal(dump.dsn, DSN, "legacy argv[4] raw DSN remains supported");
  assert.equal(dump.pg, "1");
});
