/**
 * Killing the launcher must kill what it launched.
 *
 * `vkm-runhidden.exe` forwards stdin, stdout and the exit code, which made it look
 * transparent. It was not: `cmd.Run()` waited on the child, and when the LAUNCHER was
 * killed the child was orphaned and kept running. Every caller in the kit that bounds a
 * subprocess by killing it — execa's `timeout` on the Python RAG backend, on an obscura
 * fetch, on git — was reduced to killing a middleman while the real process held the pipe.
 *
 * This surfaced the moment the MCP sidecars started routing spawns through the launcher:
 * `rag-client`'s "a hung subprocess is killed and rejects with a clear timeout error, not
 * a hang" test stopped timing out and ran for 1,000 SECONDS. The fix is a Windows job
 * object with KILL_ON_JOB_CLOSE (cmd/vkm-runhidden/job_windows.go); this is the test that
 * would have caught it.
 *
 * Runs against the REAL built binary or not at all — a fallback to plain `node` would make
 * the assertion pass while proving nothing. `npm run build:runhidden` produces it, and the
 * Windows CI leg runs that before the test suite.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packagedRunHidden } from "../src/runhidden-setup.mjs";

const LAUNCHER = packagedRunHidden();
const AVAILABLE = process.platform === "win32" && existsSync(LAUNCHER);
const SKIP = AVAILABLE
  ? false
  : {
      skip: `needs the built launcher on Windows (${path.basename(LAUNCHER)}); run npm run build:runhidden`
    };

/** A child that would outlive any sane timeout if it were orphaned. */
const LONG_SLEEP = ["-e", "setTimeout(() => {}, 600000)"];

test("a killed launcher takes its child with it", SKIP, async () => {
  const started = Date.now();
  const child = execFile(LAUNCHER, [process.execPath, ...LONG_SLEEP], { timeout: 1500 });

  const outcome = await new Promise((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal }));
    child.on("error", (err) => resolve({ err }));
  });

  const elapsed = Date.now() - started;
  assert.ok(
    elapsed < 60_000,
    `the launcher was killed at 1.5s but the call took ${elapsed}ms — the child outlived it ` +
      `and kept the pipe open, which is exactly the orphaning this test exists to catch`
  );
  assert.ok(outcome.signal || outcome.code !== 0, "a killed launcher must not report success");
});

test("a launcher that exits normally still forwards the exit code", SKIP, async () => {
  // The job object must not change the ordinary path: a hook that blocks a tool call by
  // exiting 2 is how the PreToolUse guards work, and swallowing that would disarm them.
  const code = await new Promise((resolve) => {
    const child = execFile(LAUNCHER, [process.execPath, "-e", "process.exit(2)"]);
    child.on("close", (c) => resolve(c));
  });
  assert.equal(code, 2);
});

test("the launcher this repo builds is the one the installer ships", () => {
  // packagedRunHidden() is what `installRunHidden` copies into ~/.claude/bin, so a test that
  // exercised some other path would prove nothing about what users get.
  assert.equal(
    path.resolve(LAUNCHER),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "vkm-runhidden.exe")
  );
});
