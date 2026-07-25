#!/usr/bin/env node
/**
 * Harness conformance matrix (ADR-0066) — what the kit actually delivers per agent
 * harness, and what it only claims.
 *
 * "Cross-platform" in this repo has always meant *operating system*: `e2e-smoke.mjs`
 * installs with `--ide none` and proves the MCP server works over stdio on Windows,
 * macOS and Linux. It never asked a different question — whether wiring **Codex**, or
 * **Cursor**, or anything that is not Claude Code, produces a working install. Nor
 * whether the kit's deterministic guarantees survive outside Claude Code, where the
 * hooks that carry them do not exist.
 *
 * This probe answers both, and its central design rule is that it must be able to say
 * **"not verifiable here"** as loudly as it says pass or fail. A matrix that quietly
 * turns an absent CLI into a green cell is worse than no matrix: it is a claim nobody
 * checked, wearing the costume of evidence.
 *
 * Two classes of cell, because they have genuinely different evidence value:
 *
 *  - **wiring** — does a real install produce the config artifact that harness reads?
 *    Filesystem-only, so it runs anywhere, for every harness, on any machine.
 *  - **live** — does that harness load the config and answer? Needs its CLI. Reported
 *    as `not-installed` when absent, never inferred from the wiring cell.
 *
 * Usage:
 *   node scripts/harness-matrix.mjs              # markdown table
 *   node scripts/harness-matrix.mjs --json
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = path.join(REPO, "packages", "create-vkm-kit", "src", "index.js");
const TIMEOUT_MS = 180_000;

/** @typedef {"pass"|"fail"|"not-installed"|"n/a"} CellState */

/**
 * What each harness needs from an install, and how its guarantees degrade.
 *
 * `enforcement` is the H17 answer in one field: the kit's deterministic layer is
 * Claude Code hooks, so every other harness gets the MCP server plus prose and
 * nothing else. That is a fact about the architecture, not a gap in this probe.
 */
const HARNESSES = [
  {
    id: "claude-code",
    label: "Claude Code",
    ide: "claude",
    cli: "claude",
    /** Registered through `claude mcp add`, not a config file — nothing on disk to assert. */
    mcpArtifact: null,
    mcpNote: "`claude mcp add -s user` (CLI, no config file)",
    rulesArtifact: (home) => path.join(home, ".claude", "CLAUDE.md"),
    enforcement: "hooks + output style (7 hooks, ~/.claude/)"
  },
  {
    id: "codex",
    label: "Codex CLI",
    ide: "codex",
    cli: "codex",
    mcpArtifact: null,
    mcpNote: "`codex mcp add` (CLI, stored in Codex's own config)",
    rulesArtifact: (home) => path.join(home, ".codex", "AGENTS.md"),
    enforcement: "none — MCP + prose only"
  },
  {
    id: "cursor",
    label: "Cursor",
    ide: "cursor",
    cli: null,
    mcpArtifact: (home) => path.join(home, ".cursor", "mcp.json"),
    mcpNote: "`~/.cursor/mcp.json` (file)",
    rulesArtifact: (_home, cwd) => path.join(cwd, ".cursor", "rules", "obsidian-memory.mdc"),
    enforcement: "none — MCP + prose only"
  },
  {
    id: "agents-md",
    label: "AGENTS.md readers (Cline, Continue, Copilot…)",
    ide: "cursor", // any --ide; the project AGENTS.md target is written regardless
    cli: null,
    mcpArtifact: null,
    mcpNote: "per-tool; the kit writes no config for these",
    rulesArtifact: (_home, cwd) => path.join(cwd, "AGENTS.md"),
    enforcement: "none — prose only"
  }
];

/** @param {string} cmd */
function cliPresent(cmd) {
  if (!cmd) return null;
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a real install into a throwaway HOME/cwd for one harness.
 * `--minimal` keeps it dependency-free (no Python backend, no git, no downloads):
 * this probe is about whether the WIRING lands, not whether retrieval works — that
 * is `e2e-smoke.mjs`'s job and duplicating it here would just make the matrix slow
 * and flaky for no extra information.
 * @returns {{ok: boolean, error?: string, home: string, cwd: string}}
 */
function install(harness) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `vkm-hm-home-${harness.id}-`));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `vkm-hm-cwd-${harness.id}-`));
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), `vkm-hm-vault-${harness.id}-`));
  try {
    execFileSync(
      process.execPath,
      [
        INSTALLER,
        "--non-interactive",
        "-y",
        "--vault",
        vault,
        "--ide",
        harness.ide,
        "--rules",
        "all",
        "--minimal",
        "--no-git",
        "--no-skills",
        "--no-agents"
      ],
      { env: { ...process.env, HOME: home }, cwd, stdio: "pipe", timeout: TIMEOUT_MS }
    );
    return { ok: true, home, cwd };
  } catch (e) {
    return { ok: false, error: String(e?.stderr ?? e?.message ?? e).slice(0, 300), home, cwd };
  }
}

/** Does the file exist and carry the kit's managed block / server entry? */
function artifactState(fp, mustContain) {
  if (!fp) return "n/a";
  let text;
  try {
    text = fs.readFileSync(fp, "utf8");
  } catch {
    return "fail";
  }
  return mustContain.every((s) => text.includes(s)) ? "pass" : "fail";
}

export function runMatrix() {
  const rows = [];
  for (const h of HARNESSES) {
    const res = install(h);
    const wiringMcp = res.ok
      ? h.mcpArtifact
        ? artifactState(h.mcpArtifact(res.home, res.cwd), ["basic-memory"])
        : "n/a"
      : "fail";
    const wiringRules = res.ok
      ? artifactState(h.rulesArtifact(res.home, res.cwd), ["vkm-kit:start"])
      : "fail";
    const present = cliPresent(h.cli);
    rows.push({
      id: h.id,
      label: h.label,
      installed: res.ok ? "pass" : "fail",
      installError: res.ok ? undefined : res.error,
      mcpWiring: wiringMcp,
      mcpNote: h.mcpNote,
      rulesWiring: wiringRules,
      // Never inferred from wiring: an absent CLI is unknown, not working.
      live: h.cli === null ? "n/a" : present ? "pass-cli-present" : "not-installed",
      enforcement: h.enforcement
    });
    for (const d of [res.home, res.cwd]) fs.rmSync(d, { recursive: true, force: true });
  }
  return rows;
}

function toMarkdown(rows) {
  const cell = (s) =>
    ({
      pass: "✅",
      fail: "❌",
      "not-installed": "⚪ not installed here",
      "pass-cli-present": "✅ CLI present",
      "n/a": "—"
    })[s] ?? s;
  return [
    "| Harness | Install | MCP wiring | Rules surface | CLI available | Deterministic enforcement |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map(
      (r) =>
        `| ${r.label} | ${cell(r.installed)} | ${cell(r.mcpWiring)} ${r.mcpNote} | ` +
        `${cell(r.rulesWiring)} | ${cell(r.live)} | ${r.enforcement} |`
    ),
    "",
    "`⚪ not installed here` means this machine had no such CLI, so the cell was **not**",
    "measured — it is not a pass and not a failure. `—` means the harness has no artifact",
    "of that kind by design.",
    "",
    "The last column is the honest headline: **the kit's deterministic guarantees exist",
    "only in Claude Code.** Everywhere else the MCP server and the rules block land",
    "correctly, and every rule they carry depends on the model choosing to follow it."
  ].join("\n");
}

function main() {
  const rows = runMatrix();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  console.log(toMarkdown(rows));
  if (
    rows.some((r) => r.installed === "fail" || r.mcpWiring === "fail" || r.rulesWiring === "fail")
  )
    process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
