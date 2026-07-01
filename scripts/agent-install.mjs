#!/usr/bin/env node
/**
 * Agent-friendly one-shot installer + verifier.
 *
 * Hand this repo to a Claude Code or Codex agent and say "install it": the agent
 * runs `npm run setup`, this preflights the dependencies, runs the `--full`
 * install (Codex + Claude by default, or whatever CLIs are on PATH), verifies the
 * result, and prints a status table + a RESTART notice.
 *
 * Honest limitation it encodes: MCP servers register at user scope, but the
 * *running* agent cannot hot-load its own MCP tools — they go live only after the
 * IDE/CLI restarts. So this wires + builds + verifies what is verifiable without a
 * restart (config present, `mcp list` shows the servers, vault + index on disk),
 * then tells the user to restart to make the tools live.
 *
 * Pure Node built-ins (no deps) so it runs before `npm ci`, like version.mjs.
 *
 * Usage:
 *   node scripts/agent-install.mjs [--vault <path>] [--ide codex,claude,cursor]
 *                                  [--lang es|en] [--dry-run] [--no-rules]
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = path.join(ROOT, "packages", "create-obsidian-memory", "src", "index.js");
const WIN = process.platform === "win32";
const HOME = process.env.HOME || process.env.USERPROFILE || os.homedir();

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};
const dryRun = has("--dry-run");
const lang = val("--lang") === "en" ? "en" : "es";
const vault = val("--vault") || defaultVault();
const ideOverride = val("--ide");

function defaultVault() {
  return path.join(HOME, "Documents", "obsidian-memory-vault");
}

/**
 * Run a fixed command line and capture its output. Uses `shell: true` (with a
 * STRING, not an args array — avoids Node's DEP0190) so Windows resolves `.cmd`
 * shims like `claude.cmd` / `uvx.cmd`. Only ever called with trusted literals
 * (no user input), so there's no shell-injection surface.
 */
function sh(cmdline, envOverlay) {
  const r = spawnSync(cmdline, {
    encoding: "utf8",
    shell: true,
    env: envOverlay ? { ...process.env, ...envOverlay } : process.env
  });
  return {
    ok: !r.error && r.status === 0,
    out: `${r.stdout || ""}${r.stderr || ""}`
  };
}

/** First output line of `cmd --version` (or `verArgs`), or null if not runnable. */
function probe(cmd, verArgs = "--version") {
  const r = sh(`${cmd} ${verArgs}`);
  if (!r.ok) return null;
  return r.out.trim().split(/\r?\n/)[0] || "(ok)";
}

function capture(cmd, args) {
  return sh(`${cmd} ${args.join(" ")}`);
}

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`
};
const noColor = "NO_COLOR" in process.env;
for (const k of Object.keys(C)) if (noColor) C[k] = (s) => s;

function hint(tool) {
  const w = {
    node: "winget install OpenJS.NodeJS.LTS",
    uv: "winget install astral-sh.uv",
    git: "winget install Git.Git",
    python: "winget install Python.Python.3.12"
  };
  const m = {
    node: "brew install node",
    uv: "brew install uv",
    git: "brew install git",
    python: "brew install python"
  };
  return WIN ? w[tool] : `${m[tool]}  (Linux: see each tool's docs)`;
}

console.log(C.cyan(C.bold("obsidian-memory · agent install")), dryRun ? C.dim("(dry-run)") : "");
console.log(C.dim(`repo:  ${ROOT}`));
console.log(C.dim(`vault: ${vault}${val("--vault") ? "" : " (default)"}`));

// ── 1 · Preflight ─────────────────────────────────────────────────────────────
const node = process.version;
const uv = probe("uvx");
const git = probe("git");
const python = probe("python") || probe("python3");
const pip = python ? probe(WIN ? "python" : "python3", "-m pip --version") : null;
const claude = probe("claude");
const codex = probe("codex");

console.log("\n" + C.bold("Preflight"));
line("node ≥ 20", node, true);
line("uv / uvx (runs basic-memory MCP)", uv, true, "uv");
line("git", git, false, "git");
line("python ≥ 3.11 (hybrid + semantic)", python, false, "python");
line("pip", pip, false, "python");
line("claude CLI", claude, false);
line("codex CLI", codex, false);

function line(label, value, required, tool) {
  if (value) {
    console.log(`  ${C.green("✓")} ${label}: ${C.dim(value)}`);
  } else if (required) {
    console.log(`  ${C.red("✗")} ${label} — ${C.red("MISSING")} → ${C.dim(hint(tool))}`);
  } else {
    console.log(
      `  ${C.yellow("–")} ${label}: ${C.dim("not found")}${tool ? ` → ${C.dim(hint(tool))}` : ""}`
    );
  }
}

if (!uv) {
  console.log(
    "\n" +
      C.yellow(
        "uv/uvx is required for the basic-memory MCP. I'll still write the config, but the server won't connect until uv is installed and the terminal is reopened."
      )
  );
}

// ── 2 · Decide the install shape ───────────────────────────────────────────────
// IDEs: explicit override wins; else whichever agent CLIs are present; else Cursor.
let ides = ideOverride;
if (!ides) {
  const detected = [codex && "codex", claude && "claude"].filter(Boolean);
  ides = detected.length ? detected.join(",") : "cursor";
}
// Full power (hybrid + semantic + index + backend) needs python + pip. Without
// them, fall back to the basic-memory install so we never wire a hybrid bridge
// that can't import its Python backend.
const canFull = Boolean(python && pip);

const installerArgs = [
  INSTALLER,
  "--repo-root",
  ROOT,
  "--lang",
  lang,
  "--vault",
  vault,
  "--ide",
  ides
];
if (canFull) {
  installerArgs.push("--full");
} else {
  // basic, but still non-interactive + rules for every wired agent
  installerArgs.push("-y", "--rules", "all");
  console.log(
    "\n" +
      C.yellow(
        "Python/pip not found → installing the basic-memory stack (no hybrid/semantic). Install Python ≥ 3.11, then re-run `npm run setup` to add hybrid search."
      )
  );
}
if (has("--no-rules")) installerArgs.push("--no-rules");
if (dryRun) installerArgs.push("--dry-run");

console.log(
  "\n" +
    C.bold("Install") +
    C.dim(
      `  (${canFull ? "--full: hybrid + semantic + index + rules" : "basic-memory + rules"}, ide=${ides})`
    )
);
console.log(C.dim("  node " + installerArgs.join(" ")));

const run = spawnSync(process.execPath, installerArgs, { stdio: "inherit" });
if (run.status !== 0) {
  console.error(
    C.red(`\nInstaller exited ${run.status}. Fix the error above and re-run \`npm run setup\`.`)
  );
  process.exit(run.status || 1);
}

// ── 3 · Verify ─────────────────────────────────────────────────────────────────
console.log("\n" + C.bold("Verify"));
if (dryRun) {
  console.log(C.dim("  (dry-run: skipped — no files were written)"));
} else {
  const vaultOk = existsSync(path.join(vault, "START_HERE.md"));
  status("vault scaffolded", vaultOk, vault);

  if (canFull) {
    const idxOk = existsSync(path.join(vault, ".obsidian-memory-rag", "fts.sqlite"));
    status("search index built", idxOk, path.join(vault, ".obsidian-memory-rag", "fts.sqlite"));

    // The index FILE existing is not proof the hybrid backend can RUN. Because
    // --install-backend / --build-index are best-effort, a failed backend install
    // plus a leftover index would show all-green here while every real search
    // fails at first use (the "No Python at …" / import-error landmine). Invoke the
    // backend exactly the way the MCP will — bare `python`/`python3` (matching
    // rag-client.mjs defaultPython) + the wired PYTHONPATH — so a non-importable
    // backend fails loudly now, not later.
    const pyCmd = WIN ? "python" : "python3";
    const ragSrc = path.join(ROOT, "packages", "obsidian-memory-rag", "src");
    const pyPath = process.env.PYTHONPATH
      ? `${ragSrc}${path.delimiter}${process.env.PYTHONPATH}`
      : ragSrc;
    const backend = sh(`${pyCmd} -m obsidian_memory_rag --help`, { PYTHONPATH: pyPath });
    status("Python backend runnable", backend.ok, `${pyCmd} -m obsidian_memory_rag`);
    if (!backend.ok) {
      console.log(
        C.dim(
          "    ↳ hybrid search will fail until the backend imports — recreate the venv / reinstall,"
        )
      );
      console.log(C.dim("      then rebuild the index. See docs/en/troubleshooting.md."));
    }
  }

  const wired = ides.split(",").map((s) => s.trim());
  if (wired.includes("claude") && claude) {
    const r = capture("claude", ["mcp", "list"]);
    status("Claude Code MCP registered", r.ok && /basic-memory/.test(r.out), "claude mcp list");
  }
  if (wired.includes("codex") && codex) {
    const r = capture("codex", ["mcp", "list"]);
    status("Codex CLI MCP registered", r.ok && /basic-memory/.test(r.out), "codex mcp list");
  }
  if (wired.includes("cursor")) {
    const fp = path.join(HOME, ".cursor", "mcp.json");
    let ok = false;
    try {
      ok = existsSync(fp) && /basic-memory/.test(readFileSync(fp, "utf8"));
    } catch {
      ok = false;
    }
    status("Cursor mcp.json written", ok, fp);
  }
}

function status(label, ok, detail) {
  console.log(
    `  ${ok ? C.green("✓") : C.yellow("?")} ${label}${detail ? C.dim("  " + detail) : ""}`
  );
}

// ── 4 · Restart notice + next steps ────────────────────────────────────────────
console.log("\n" + C.bold(C.green("Done.")) + " " + C.bold("One thing left — restart to go live:"));
console.log(
  C.yellow(
    "  ⮑ MCP tools load when the CLI/IDE (re)starts. The agent that ran this can't hot-load them."
  )
);
console.log(
  "    • Claude Code: quit and reopen (or run `claude mcp list` to confirm it's registered)."
);
console.log("    • Codex CLI: reopen; check with `codex mcp list`.");
console.log(
  "    • Cursor: Command Palette → “Developer: Reload Window”, then paste the global User Rules"
);
console.log(
  C.dim("      block (between obsidian-memory:start/end) into Settings → Rules → User Rules.")
);
console.log("\n  Then, in a fresh chat, prove it works:");
console.log(
  C.cyan(`    “Read START_HERE.md from my vault (${vault}) and tell me what it contains.”`)
);
console.log(
  C.dim(
    "\n  Troubleshooting: docs/en/troubleshooting.md (MCP / Cursor) · re-running this is safe (idempotent)."
  )
);
