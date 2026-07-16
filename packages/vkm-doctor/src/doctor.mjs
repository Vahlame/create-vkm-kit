#!/usr/bin/env node
// vkm-doctor (ADR-0044): reads the local telemetry the sink collected and answers the
// questions that decide token strategy — how many tokens per day/model/type, what's the
// cache-hit ratio, is the cache BROKEN (cacheRead flat at ~0 while input flows: the classic
// "every turn recomputes the prefix" failure), what did it cost. OTEL data is the primary
// source; when a day has none, the transcript-estimate fallback (jsonl-fallback.mjs) can
// fill in, ALWAYS labeled `source: "transcript-estimate"` — the two are never blended
// silently (session JSONL is an unstable internal format; treat those numbers as estimates).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { defaultDataDir } from "./otel-sink.mjs";

/** Cache-hit ratio below this, with real input volume, flags a broken/cold cache. */
const BROKEN_CACHE_RATIO = 0.3;
const MIN_INPUT_FOR_DIAGNOSIS = 50000;

/**
 * Aggregate NDJSON telemetry into per-day / per-model / per-type totals.
 * @param {{ dataDir?: string, days?: number }} [opts]
 * @returns {{ byDay: Record<string, Record<string, number>>, byModel: Record<string,
 *   Record<string, number>>, totals: Record<string, number>, costUSD: number,
 *   cacheHitRatio: number | null, brokenCache: boolean, sources: string[] }}
 */
export function aggregate({ dataDir = defaultDataDir(), days = 30 } = {}) {
  const byDay = {};
  const byModel = {};
  const totals = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  let costUSD = 0;
  let files = [];
  try {
    files = fs
      .readdirSync(dataDir)
      .filter((n) => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(n))
      .sort()
      .slice(-days);
  } catch {
    files = [];
  }
  for (const name of files) {
    const day = name.slice(0, 10);
    let lines = [];
    try {
      lines = fs.readFileSync(path.join(dataDir, name), "utf8").split("\n");
    } catch {
      continue;
    }
    for (const line of lines) {
      if (!line.trim()) continue;
      let p;
      try {
        p = JSON.parse(line);
      } catch {
        continue; // tolerate a torn write
      }
      // A torn write or a future OTLP schema drift (otel-sink.mjs's own header flags this
      // as a foreseen risk) can leave `value` malformed — unvalidated, it silently poisons
      // the running sum to NaN (or string-concatenates), collapsing cacheHitRatio to null
      // ("no data yet") and masking a real broken-cache diagnosis instead of just skipping
      // the one bad line, mirroring parseOtlpJson's own Number.isNaN guard in otel-sink.mjs.
      if (!Number.isFinite(p.value)) continue;
      if (p.metric === "claude_code.cost.usage") {
        costUSD += p.value;
        continue;
      }
      if (p.metric !== "claude_code.token.usage" || typeof p.type !== "string") continue;
      const type = p.type in totals ? p.type : null;
      if (!type) continue;
      totals[type] += p.value;
      (byDay[day] ??= { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 })[type] += p.value;
      const model = p.model || "(unknown)";
      (byModel[model] ??= { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 })[type] += p.value;
    }
  }
  const denominator = totals.cacheRead + totals.input + totals.cacheCreation;
  const cacheHitRatio = denominator > 0 ? totals.cacheRead / denominator : null;
  const brokenCache =
    denominator >= MIN_INPUT_FOR_DIAGNOSIS &&
    cacheHitRatio !== null &&
    cacheHitRatio < BROKEN_CACHE_RATIO;
  return { byDay, byModel, totals, costUSD, cacheHitRatio, brokenCache, sources: ["otel"] };
}

function fmt(n) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n);
}

/** Render the human report (plain text table; `--json` bypasses this). */
export function renderReport(report) {
  const lines = [];
  lines.push("vkm-doctor — Claude Code token usage (local OTEL telemetry)");
  const { totals, cacheHitRatio, brokenCache, costUSD } = report;
  lines.push(
    `totals: input ${fmt(totals.input)} · output ${fmt(totals.output)} · cacheRead ${fmt(
      totals.cacheRead
    )} · cacheCreation ${fmt(totals.cacheCreation)}${costUSD ? ` · cost $${costUSD.toFixed(2)}` : ""}`
  );
  lines.push(
    cacheHitRatio === null
      ? "cache-hit ratio: no data yet (run a session with telemetry on)"
      : `cache-hit ratio: ${(cacheHitRatio * 100).toFixed(1)}%${
          brokenCache
            ? "  [!] LOW — the prompt cache looks broken/cold. Check: model/MCP changes mid-session, /compact churn, or update Claude Code."
            : cacheHitRatio >= 0.7
              ? "  (healthy)"
              : "  (room to improve: keep model + MCP set stable, avoid mid-task /compact)"
        }`
  );
  lines.push("", "by model:");
  for (const [model, t] of Object.entries(report.byModel)) {
    lines.push(
      `  ${model}: input ${fmt(t.input)} · output ${fmt(t.output)} · cacheRead ${fmt(t.cacheRead)} · cacheCreation ${fmt(t.cacheCreation)}`
    );
  }
  lines.push("", "by day:");
  for (const [day, t] of Object.entries(report.byDay)) {
    lines.push(
      `  ${day}: input ${fmt(t.input)} · output ${fmt(t.output)} · cacheRead ${fmt(t.cacheRead)}`
    );
  }
  lines.push("", `sources: ${report.sources.join(", ")} (local only; nothing leaves this machine)`);
  if (report.skillsDrift) lines.push("", renderSkillsDrift(report.skillsDrift));
  return lines.join("\n");
}

const SKILLS_REINSTALL_HINT = "npx @vkmikc/create-vkm-kit --ide claude --skills -y";

/** Render the skills-drift section (ADR-0049 companion) — its own labelled block, never
 *  folded into the token totals above: a missing/stale skill is a Claude Code config
 *  problem, not a token-usage number. */
export function renderSkillsDrift(d) {
  if (d.skipped) return `skills: skipped — ${d.reason}`;
  if (!d.missing.length && !d.stale.length) return `skills: ok — ${d.ok.join(", ")} (up to date)`;
  const parts = ["skills: [!] drift detected"];
  if (d.missing.length) parts.push(`  MISSING (not installed): ${d.missing.join(", ")}`);
  if (d.stale.length) parts.push(`  STALE (differs from kit template): ${d.stale.join(", ")}`);
  parts.push(`  fix: ${SKILLS_REINSTALL_HINT}`);
  return parts.join("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  const daysFlag = argv.indexOf("--days");
  const report = aggregate({
    days: daysFlag >= 0 ? Number(argv[daysFlag + 1]) || 30 : 30
  });
  // Skills drift (ADR-0049 companion): degrade honest — a resolution failure of the deep
  // create-vkm-kit import (e.g. a pre-ADR-0049 vkm-doctor install) must never crash the core
  // token report, just mark the check skipped.
  try {
    const { checkSkillsDrift } = await import("./skills-drift.mjs");
    report.skillsDrift = checkSkillsDrift();
  } catch (e) {
    report.skillsDrift = {
      skipped: true,
      reason: `skills-drift check unavailable: ${e?.message || e}`
    };
  }
  // Transcript-estimate fallback, opt-in and NEVER blended: it renders as its own
  // labeled section / JSON key (session JSONL is an unstable internal format).
  if (argv.includes("--include-transcripts")) {
    try {
      const { scanTranscripts } = await import("./jsonl-fallback.mjs");
      report.transcriptEstimate = scanTranscripts();
      report.sources = [...report.sources, "transcript-estimate"];
    } catch (e) {
      report.transcriptEstimate = { error: e?.message || String(e) };
    }
  }
  if (argv.includes("--json")) {
    process.stdout.write(JSON.stringify(report, null, 2));
    return;
  }
  console.log(renderReport(report));
  if (report.transcriptEstimate && !report.transcriptEstimate.error) {
    const t = report.transcriptEstimate.totals;
    console.log(
      `\ntranscript ESTIMATE (unstable format — not blended with OTEL): input ${t.input} · output ${t.output} · cacheRead ${t.cacheRead} · cacheCreation ${t.cacheCreation} across ${report.transcriptEstimate.files} transcripts`
    );
  }
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) main();
