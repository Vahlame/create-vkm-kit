import { strict as assert } from "node:assert";
import test from "node:test";
import { throughHiddenConsole, runHiddenLauncher } from "../src/hidden-console.mjs";

// The regression this guards is subtle and silent: getting windowsHide the "obvious" way round
// re-creates the flashing it is supposed to remove, and nothing fails loudly when it does.

test("uses the launcher and does NOT ask for CREATE_NO_WINDOW when it exists", () => {
  const r = throughHiddenConsole("ollama.exe", ["serve"], { exists: () => true, platform: "win32" });

  assert.equal(r.viaLauncher, true);
  assert.ok(r.command.endsWith("vkm-runhidden.exe"), `unexpected command ${r.command}`);
  assert.deepEqual(r.args, ["ollama.exe", "serve"]);

  // The load-bearing assertion. windowsHide:true here would deny the child the hidden console the
  // launcher just created, forcing its own children to allocate visible ones — the exact bug.
  assert.equal(r.windowsHide, false);
});

test("falls back to a direct hidden spawn when the launcher is not installed", () => {
  const r = throughHiddenConsole("ollama.exe", ["serve"], { exists: () => false, platform: "win32" });

  assert.equal(r.viaLauncher, false);
  assert.equal(r.command, "ollama.exe");
  assert.deepEqual(r.args, ["serve"]);
  assert.equal(r.windowsHide, true);
});

test("does nothing on platforms that have no consoles to hide", () => {
  const r = throughHiddenConsole("ollama", ["serve"], { exists: () => true, platform: "linux" });

  assert.equal(r.viaLauncher, false);
  assert.equal(r.command, "ollama");
});

test("VKM_RUNHIDDEN overrides the install location", () => {
  const previous = process.env.VKM_RUNHIDDEN;
  process.env.VKM_RUNHIDDEN = "D:\custom\vkm-runhidden.exe";
  try {
    assert.equal(runHiddenLauncher(), "D:\custom\vkm-runhidden.exe");
  } finally {
    if (previous === undefined) delete process.env.VKM_RUNHIDDEN;
    else process.env.VKM_RUNHIDDEN = previous;
  }
});

test("the original command is never lost, only wrapped", () => {
  const r = throughHiddenConsole("python.exe", ["-m", "searx.webapp"], { exists: () => true, platform: "win32" });

  assert.deepEqual(r.args, ["python.exe", "-m", "searx.webapp"]);
});
