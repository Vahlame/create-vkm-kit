/**
 * The vkm-console build step — through injected fakes (no Go toolchain in unit tests).
 * Pins the status contract the summary prints: skipped (off / no kit / dry-run), manual
 * (no Go, no source — with the hint), ready (binary path reported), failed (Go present,
 * build broke), and that the build itself runs hidden with a bounded timeout (ADR-0078).
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { maybeBuildConsole, consoleBinPath } from "../src/console-setup.mjs";

const KIT = "/kit";

test("consoleBinPath lands in <kit>/bin with the platform suffix", () => {
  assert.equal(consoleBinPath(KIT, "win32"), path.join(KIT, "bin", "vkm-console.exe"));
  assert.equal(consoleBinPath(KIT, "linux"), path.join(KIT, "bin", "vkm-console"));
});

test("disabled / no kit clone / dry-run → skipped, and no command ever runs", async () => {
  const calls = [];
  const deps = {
    execaImpl: (...a) => {
      calls.push(a);
      return Promise.resolve({ exitCode: 0 });
    },
    pathExists: async () => true
  };
  assert.equal(
    (await maybeBuildConsole({ enable: false, dryRun: false, kitRoot: KIT }, deps)).status,
    "skipped"
  );
  assert.equal(
    (await maybeBuildConsole({ enable: true, dryRun: false, kitRoot: null }, deps)).status,
    "skipped"
  );
  const dry = await maybeBuildConsole({ enable: true, dryRun: true, kitRoot: KIT }, deps);
  assert.equal(dry.status, "skipped");
  assert.deepEqual(calls, [], "no probe and no build in any of the three");
});

test("missing cmd/vkm-console source → manual, without probing Go", async () => {
  const calls = [];
  const r = await maybeBuildConsole(
    { enable: true, dryRun: false, kitRoot: KIT },
    {
      execaImpl: (...a) => {
        calls.push(a);
        return Promise.resolve({ exitCode: 0 });
      },
      pathExists: async () => false
    }
  );
  assert.equal(r.status, "manual");
  assert.deepEqual(calls, []);
});

test("Go not installed → manual with the install hint, build never attempted", async () => {
  const calls = [];
  const r = await maybeBuildConsole(
    { enable: true, dryRun: false, kitRoot: KIT },
    {
      execaImpl: (bin, args) => {
        calls.push([bin, args]);
        return Promise.resolve({ exitCode: 127 });
      },
      pathExists: async () => true
    }
  );
  assert.equal(r.status, "manual");
  assert.equal(calls.length, 1, "only the `go version` probe ran");
  assert.deepEqual(calls[0], ["go", ["version"]]);
});

test("happy path: go build runs hidden, bounded and from the kit root; ready + binPath", async () => {
  const calls = [];
  const r = await maybeBuildConsole(
    { enable: true, dryRun: false, kitRoot: KIT },
    {
      execaImpl: (bin, args, opts) => {
        calls.push([bin, args, opts]);
        return Promise.resolve({ exitCode: 0 });
      },
      pathExists: async () => true,
      platform: "win32"
    }
  );
  assert.equal(r.status, "ready");
  assert.equal(r.binPath, path.join(KIT, "bin", "vkm-console.exe"));
  const [bin, args, opts] = calls.at(-1);
  assert.equal(bin, "go");
  assert.deepEqual(args, ["build", "-o", r.binPath, "./cmd/vkm-console"]);
  assert.equal(opts.cwd, KIT, "the module path ./cmd/vkm-console is relative to the kit root");
  assert.equal(opts.windowsHide, true, "ADR-0078: nothing an installer runs may flash a console");
  assert.equal(opts.timeout, 120_000, "a wedged toolchain must not hang the install");
});

test("Go present but the build fails → failed (not manual: the hint would mislead)", async () => {
  const r = await maybeBuildConsole(
    { enable: true, dryRun: false, kitRoot: KIT },
    {
      execaImpl: (bin, args) =>
        Promise.resolve(
          args[0] === "version" ? { exitCode: 0 } : { exitCode: 1, stderr: "compile error" }
        ),
      pathExists: async () => true
    }
  );
  assert.equal(r.status, "failed");
  assert.equal(r.binPath, null);
});
