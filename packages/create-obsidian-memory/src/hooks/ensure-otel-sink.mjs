#!/usr/bin/env node
// SessionStart hook shipped by create-obsidian-memory (ADR-0044): guarantees the vkm-kit
// OTLP telemetry sink is alive whenever a Claude Code session starts, with no OS service or
// scheduled task. Checks the sink lockfile (pid liveness) and, when absent/stale, spawns
// `vkm-otel-sink` detached and exits immediately — the fast path is a single stat+kill(0)
// well under 50ms. Fail-open: ANY error exits 0 silently (a telemetry hiccup must never
// block a session). argv: node <hook> <sink-script-path>.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

function dataDir() {
  return process.env.VKM_TELEMETRY_DIR || path.join(os.homedir(), ".vkm", "telemetry");
}

/** True if a live sink already holds the lock. */
export function sinkAlive(dir = dataDir()) {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(dir, "sink.lock"), "utf8"));
    process.kill(lock.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function main() {
  const sinkScript = process.argv[2];
  if (!sinkScript || sinkAlive()) return;
  try {
    const child = spawn(process.execPath, [sinkScript], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
  } catch {
    // fail open
  }
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  try {
    main();
  } catch {
    // fail open — never block a session over telemetry
  }
}
