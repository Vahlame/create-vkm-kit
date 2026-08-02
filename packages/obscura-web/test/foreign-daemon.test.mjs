/**
 * The hole this closes: the launcher protects the tree it starts, and "start it if it is not
 * already running" means the kit routinely attaches to a daemon somebody else started — whose
 * children it therefore cannot keep windowless.
 *
 * The tests pin two things that are easy to get wrong in opposite directions: never calling a
 * correctly-started daemon foreign (that sends the user hunting the wrong process), and never
 * calling an unknown one ours (that hides the real cause behind a green check).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  adoptionEnabled,
  foreignDaemons,
  probePort,
  probeScript,
  stopDaemon,
  verdict,
  watchedDaemons
} from "../src/foreign-daemon.mjs";

const chain = (...images) => ({
  listening: true,
  chain: images.map((image, i) => ({ pid: 100 + i, image }))
});

test("a daemon under the launcher is ours, however deep the chain", () => {
  const v = verdict(chain("ollama.exe", "vkm-runhidden.exe", "node.exe"));
  assert.equal(v.status, "ours");
});

test("a daemon started by anything else is foreign, and names the process", () => {
  const v = verdict(chain("ollama.exe", "explorer.exe"));
  assert.deepEqual(v, { status: "foreign", pid: 100, image: "ollama.exe" });
});

test("nothing listening is absent, not foreign", () => {
  assert.equal(verdict({ listening: false, chain: [] }).status, "absent");
});

test("a listening port whose chain could not be read is unknown, never foreign", () => {
  // Reporting "foreign" here would blame a daemon that may be perfectly wired, and the user would
  // go kill the wrong thing.
  assert.equal(verdict({ listening: true, chain: [] }).status, "unknown");
});

test("foreignDaemons reports one actionable warning per foreign daemon", async () => {
  const warnings = await foreignDaemons({
    probe: async (port) =>
      port === 11434
        ? chain("ollama.exe", "services.exe")
        : chain("python.exe", "vkm-runhidden.exe")
  });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].reason, "foreign-daemon");
  assert.equal(warnings[0].label, "ollama");
  assert.equal(warnings[0].image, "ollama.exe");
  assert.match(warnings[0].hint, /VKM_ADOPT_DAEMONS=1/);
});

test("probePort is a no-op off Windows and never throws", async () => {
  const res = await probePort(11434, {
    platform: "linux",
    run: async () => {
      throw new Error("must not run");
    }
  });
  assert.deepEqual(res, { listening: false, chain: [] });
});

test("a broken probe degrades to 'not listening' instead of failing the research run", async () => {
  const res = await probePort(11434, { platform: "win32", run: async () => "not json at all" });
  assert.deepEqual(res, { listening: false, chain: [] });
});

test("the port reaches the script as a literal, not as an ignored -Port argument", () => {
  // The bug this pins, caught in live testing: `powershell -Command "param([int]$Port) …" -Port N`
  // silently drops the argument, so `-LocalPort $Port` matched nothing and EVERY daemon came back
  // "absent" — a probe that always answers "all clear" is worse than none, because it looks green.
  const script = probeScript(11434);
  assert.match(script, /-LocalPort 11434 -State Listen/);
  assert.doesNotMatch(script, /param\(/, "no parameter block: -Command would ignore it");
});

test("the watched ports follow the same env overrides as the code that starts the daemons", () => {
  const custom = watchedDaemons({
    OLLAMA_HOST: "http://127.0.0.1:11999",
    OBSCURA_SEARXNG_PORT: "9001"
  });
  assert.deepEqual(custom, [
    { label: "ollama", port: 11999 },
    { label: "searxng", port: 9001 }
  ]);
  assert.deepEqual(watchedDaemons({}), [
    { label: "ollama", port: 11434 },
    { label: "searxng", port: 8888 }
  ]);
});

test("adoption is opt-in and stopDaemon refuses anything but a real PID", async () => {
  assert.equal(adoptionEnabled({}), false);
  assert.equal(adoptionEnabled({ VKM_ADOPT_DAEMONS: "1" }), true);

  let called = 0;
  const run = async () => {
    called++;
  };
  assert.equal(await stopDaemon(0, { platform: "win32", run }), false);
  assert.equal(await stopDaemon(-1, { platform: "win32", run }), false);
  assert.equal(await stopDaemon(1234, { platform: "linux", run }), false);
  assert.equal(called, 0, "no kill may be issued for an invalid target or off Windows");

  assert.equal(await stopDaemon(1234, { platform: "win32", run }), true);
  assert.equal(called, 1);
});
