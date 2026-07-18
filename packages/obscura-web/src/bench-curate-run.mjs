#!/usr/bin/env node
/**
 * The curator bake-off ADR-0057 left as a measured decision, not a hypothesis: run each candidate
 * model as `curatePage`'s curator against the same frozen golden set (`evals/research/curation.jsonl`
 * + `curation-fixtures/`), score with `bench-curate.mjs`, and report accuracy/false-positive-rate/
 * latency/GPU-residency side by side. The model that ships as `OBSCURA_OLLAMA_MODEL`'s default is
 * whichever wins on the numbers here — this file IS the evidence, re-runnable by the next person
 * who doubts it, not a claim to take on faith.
 *
 * Usage:
 *   node src/bench-curate-run.mjs                                  # default 3-model bake-off
 *   node src/bench-curate-run.mjs --models phi4-mini:3.8b-q4_K_M,qwen3.5:4b-q4_K_M
 *   node src/bench-curate-run.mjs --json
 *
 * Requires the candidate models already pulled (`ollama pull <model>`) and a local Ollama running.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { curatePage, DEFAULT_OLLAMA_HOST } from "./ollama-client.mjs";
import { evaluateCuration, formatCurationReport } from "./bench-curate.mjs";
import { CURATION_FIXTURES_DIR, fixturePath, loadCurationSet } from "./bench-curate-capture.mjs";

const execFileP = promisify(execFile);

const DEFAULT_MODELS = ["phi4-mini:3.8b-q4_K_M", "qwen3.5:4b-q4_K_M", "qwen3.5:9b-q4_K_M"];

/** `ollama ps`'s PROCESSOR column for one model, e.g. "100% GPU" or "48%/52% CPU/GPU" — the
 * direct answer to "does this spill off the GPU", read from the tool ollama itself ships for it
 * rather than parsing `nvidia-smi` output by hand. Returns null if the model isn't (no longer)
 * resident — `ollama ps` only lists what is currently loaded. */
async function residency(model) {
  try {
    const { stdout } = await execFileP("ollama", ["ps"]);
    const line = stdout.split(/\r?\n/).find((l) => l.startsWith(model));
    if (!line) return null;
    const cols = line.trim().split(/\s{2,}/);
    // NAME  ID  SIZE  PROCESSOR  CONTEXT  UNTIL — PROCESSOR is the 4th column.
    return cols[3] ?? null;
  } catch {
    return null;
  }
}

async function loadFixtures(entries) {
  const { readFile } = await import("node:fs/promises");
  const fixtures = new Map();
  for (const url of new Set(entries.map((e) => e.url))) {
    fixtures.set(url, await readFile(fixturePath(url, CURATION_FIXTURES_DIR), "utf8"));
  }
  return fixtures;
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const modelsArg = args.indexOf("--models");
  const models =
    modelsArg !== -1 && args[modelsArg + 1] ? args[modelsArg + 1].split(",") : DEFAULT_MODELS;

  const entries = await loadCurationSet();
  const fixtures = await loadFixtures(entries);

  const reports = {};
  for (const model of models) {
    console.error(`\n=== ${model} ===`);
    const report = await evaluateCuration({
      entries,
      fixtures,
      curate: (args_) =>
        curatePage({ ...args_, model, host: DEFAULT_OLLAMA_HOST, timeoutMs: 60_000 })
    });
    report.processor = await residency(model);
    reports[model] = report;
    if (!asJson) {
      console.error(formatCurationReport(report, model));
      if (report.processor) console.error(`  GPU residency: ${report.processor}`);
    }
  }

  if (asJson) {
    console.log(JSON.stringify(reports, null, 2));
    return;
  }

  console.error("\n=== bake-off summary ===");
  console.error(
    "  model".padEnd(28) +
      "accuracy".padEnd(10) +
      "FP-rate".padEnd(10) +
      "separation".padEnd(12) +
      "ms/page".padEnd(10) +
      "GPU"
  );
  for (const [model, r] of Object.entries(reports)) {
    console.error(
      `  ${model}`.padEnd(28) +
        r.accuracy.toFixed(3).padEnd(10) +
        r.falsePositiveRate.toFixed(3).padEnd(10) +
        r.separation.toFixed(2).padEnd(12) +
        r.meanMs.toFixed(0).padEnd(10) +
        (r.processor ?? "?")
    );
  }
  // Winner: fewest false positives first (the expensive mistake this bench exists to catch),
  // accuracy as tiebreak, never a model that spills off the GPU (measured unusable latency is
  // still a real cost even if its numbers otherwise won) — reported, not auto-applied: picking
  // the actual default and pruning the losers (`ollama rm`) is a deliberate, separate step.
  const ranked = Object.entries(reports).sort(
    (a, b) => a[1].falsePositiveCount - b[1].falsePositiveCount || b[1].accuracy - a[1].accuracy
  );
  console.error(`\n  best (fewest false positives, then accuracy): ${ranked[0][0]}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
