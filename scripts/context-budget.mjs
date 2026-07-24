#!/usr/bin/env node
/**
 * WP0 — fixed-context budget inventory (ADR-0063).
 *
 * The kit's *fixed layer* is every character an agent pays at the start of every
 * session, before it calls a single tool: the memory-rules block, the MCP servers'
 * tool schemas, the SessionStart injection, skill and sub-agent descriptions, the
 * output style. It is a permanent behavioural prior, not just a token cost — so it
 * has to be measurable, attributable to a `file:line`, and split into what is paid
 * ALWAYS versus what is paid only when something triggers.
 *
 * Two views:
 *
 *  - **repo view** (default): what an install *would* cost, measured from this
 *    checkout's sources. Deterministic, no install required — this is what the CI
 *    baseline test pins.
 *  - **installed view** (`--home <dir>` [`--cwd <dir>`]): what a REAL install on
 *    disk actually costs, including the surface multiplier (the rules block lands
 *    on up to four surfaces, and a Claude Code session inside an installed project
 *    loads two of them — see `surfaces` below).
 *
 * Deliberately NOT a gate. WP0 records the baseline; turning it into a budget is a
 * later, reviewed decision (the ADR-0035 / ADR-0036 precedent: measure first, gate
 * second, and only with the number in hand).
 *
 * Usage:
 *   node scripts/context-budget.mjs                      # repo view, es, markdown
 *   node scripts/context-budget.mjs --lang en --json
 *   node scripts/context-budget.mjs --home ~ --cwd .     # installed view
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  memoryRulesBlock,
  RULES_START,
  RULES_END
} from "../packages/create-vkm-kit/src/memory-rules.mjs";
import {
  reminders,
  MAX_INDEX_CHARS
} from "../packages/create-vkm-kit/src/hooks/session-start-vault-context.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The repo's own estimator: ceil(chars / 4). Same one `audit.py:171` uses for the
 * vault, so budget numbers here and in `vault_audit` are directly comparable. */
export const CHARS_PER_TOKEN = 4;

/** @param {number} chars */
export function approxTokens(chars) {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * When a piece is paid.
 *  - `always`     — every session, before any tool call. The behavioural prior.
 *  - `on-trigger` — only when a skill/sub-agent is invoked or a hook fires.
 *  - `on-call`    — per tool call, bounded by that tool's own budget.
 *  - `opt-in`     — only when the user passes a flag the default install doesn't.
 * @typedef {"always"|"on-trigger"|"on-call"|"opt-in"} When
 */

/**
 * @typedef {object} Piece
 * @property {string} id
 * @property {string} group
 * @property {number} chars
 * @property {number} tokens
 * @property {string} source     `file:line` the text is defined at
 * @property {When} when
 * @property {string} [note]
 */

/**
 * Extract every schema string an MCP server ships: tool descriptions, parameter
 * `.describe()` text and the server `instructions`.
 *
 * Unlike the regex in `schema-budget.test.mjs`, this follows `"a" + "b" + "c"`
 * concatenation. That is not a nicety: `obscura-mcp.mjs` and `downloads-mcp.mjs`
 * write nearly every description that way, so a first-fragment-only match
 * undercounts them by a wide margin — and the same blind spot would silently
 * gut the existing schema gate the day `hybrid-mcp.mjs` is refactored to
 * concatenation (it has none today, which is the only reason that gate is
 * currently honest). Measured, not assumed: see the ADR.
 *
 * @param {string} src
 * @returns {string[]}
 */
export function extractSchemaStrings(src) {
  const anchor = /(?:description:|instructions:)\s*|\.describe\(\s*/g;
  /** @type {string[]} */
  const out = [];
  for (const m of src.matchAll(anchor)) {
    const parsed = readConcatenatedStrings(src, m.index + m[0].length);
    if (parsed) out.push(parsed);
  }
  return out;
}

/**
 * Read a run of string literals joined by `+`, starting at `i` (whitespace and
 * newlines allowed anywhere between tokens). Returns null when position `i`
 * doesn't begin a string literal — e.g. `description: someVariable`.
 * @param {string} src
 * @param {number} i
 * @returns {string|null}
 */
function readConcatenatedStrings(src, i) {
  let acc = "";
  let any = false;
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i++;
    const quote = src[i];
    if (quote !== '"' && quote !== "'") break;
    i++;
    let buf = "";
    while (i < src.length && src[i] !== quote) {
      if (src[i] === "\\") {
        buf += src[i] + src[i + 1];
        i += 2;
        continue;
      }
      buf += src[i++];
    }
    i++; // closing quote
    acc += buf;
    any = true;
    // A `+` (and only a `+`) continues the same logical string.
    let j = i;
    while (j < src.length && /\s/.test(src[j])) j++;
    if (src[j] !== "+") break;
    i = j + 1;
  }
  return any ? acc : null;
}

/**
 * 1-based line number of the first occurrence of `needle`, for `file:line`
 * attribution. 0 when absent — an attribution that says "somewhere in this file"
 * is better than one that lies about a line.
 * @param {string} src
 * @param {string} needle
 */
function lineOf(src, needle) {
  const at = src.indexOf(needle);
  if (at < 0) return 0;
  return src.slice(0, at).split("\n").length;
}

/** @param {string} rel */
function readRepo(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/**
 * @param {string} rel repo-relative path of an MCP server module
 * @param {string} id
 * @param {When} when
 * @param {string} note
 * @returns {Piece}
 */
function mcpSchemaPiece(rel, id, when, note) {
  const src = readRepo(rel);
  const strings = extractSchemaStrings(src);
  const chars = strings.reduce((a, s) => a + s.length, 0);
  const tools = (src.match(/server\.registerTool\(/g) ?? []).length;
  return {
    id,
    group: "mcp-schemas",
    chars,
    tokens: approxTokens(chars),
    source: `${rel}:${lineOf(src, "server.registerTool(")}`,
    when,
    note: `${tools} tools, ${strings.length} schema strings — ${note}`
  };
}

/** Frontmatter `description:` of a SKILL.md / agent .md, including continuations. */
function frontmatterDescription(src) {
  const fm = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return "";
  const m = fm[1].match(/^description:[ \t]*([\s\S]*?)(?=\n[a-zA-Z-]+:|$)/m);
  return m ? m[1].trim() : "";
}

/**
 * The four agent-config surfaces the rules block can land on, and whether a Claude
 * Code session opened in an installed project loads that surface. `--full` writes
 * three of them (`index.js:234-240` → agents + claude + codex), two of which Claude
 * Code loads together — so the block is paid TWICE in the common case.
 * @param {string} home
 * @param {string} cwd
 */
function rulesSurfaces(home, cwd) {
  return [
    { id: "claude", file: path.join(home, ".claude", "CLAUDE.md"), loadedByClaudeCode: true },
    { id: "agents", file: path.join(cwd, "AGENTS.md"), loadedByClaudeCode: true },
    { id: "codex", file: path.join(home, ".codex", "AGENTS.md"), loadedByClaudeCode: false },
    {
      id: "cursor",
      file: path.join(cwd, ".cursor", "rules", "obsidian-memory.mdc"),
      loadedByClaudeCode: false
    }
  ];
}

/** Size of the managed block inside an installed file, or 0 when absent. */
function installedBlockChars(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return 0;
  }
  const a = text.indexOf(RULES_START);
  const b = text.indexOf(RULES_END);
  return a >= 0 && b > a ? text.slice(a, b + RULES_END.length).length : 0;
}

/**
 * Measure the fixed layer from this checkout.
 * @param {{ lang?: "es"|"en" }} [opts]
 * @returns {{ pieces: Piece[], totals: Record<string, number> }}
 */
export function measureRepo({ lang = "es" } = {}) {
  /** @type {Piece[]} */
  const pieces = [];
  const push = (p) => pieces.push({ ...p, tokens: approxTokens(p.chars) });

  // ── rules block ────────────────────────────────────────────────────────────
  const rulesSrc = readRepo("packages/create-vkm-kit/src/memory-rules.mjs");
  const block = memoryRulesBlock(lang);
  push({
    id: `rules-block:${lang}`,
    group: "rules",
    chars: block.length,
    source: `packages/create-vkm-kit/src/memory-rules.mjs:${lineOf(rulesSrc, "const BODY")}`,
    when: "always",
    note: "per surface it lands on; a Claude Code session in an installed project loads 2 (see --home)"
  });

  // ── MCP tool schemas ───────────────────────────────────────────────────────
  push(
    mcpSchemaPiece(
      "packages/obsidian-memory-mcp/src/hybrid-mcp.mjs",
      "mcp-schemas:vault",
      "always",
      "gated by schema-budget.test.mjs"
    )
  );
  push(
    mcpSchemaPiece(
      "packages/obscura-web/src/obscura-mcp.mjs",
      "mcp-schemas:obscura",
      "always",
      "wired by the default --full install; NO budget gate"
    )
  );
  push(
    mcpSchemaPiece(
      "packages/vkm-downloads/src/downloads-mcp.mjs",
      "mcp-schemas:downloads",
      "opt-in",
      "only with --downloads; NO budget gate"
    )
  );

  // ── SessionStart injection (Claude Code only) ──────────────────────────────
  const hookSrc = readRepo("packages/create-vkm-kit/src/hooks/session-start-vault-context.mjs");
  push({
    id: `session-start:reminders:${lang}`,
    group: "session-start",
    chars: reminders(lang).length,
    source: `packages/create-vkm-kit/src/hooks/session-start-vault-context.mjs:${lineOf(hookSrc, "export function reminders")}`,
    when: "always",
    note: "Claude Code only (T2) — deliberately duplicates the rules block (ADR-0035)"
  });
  push({
    id: "session-start:index",
    group: "session-start",
    chars: MAX_INDEX_CHARS,
    source: `packages/create-vkm-kit/src/hooks/session-start-vault-context.mjs:${lineOf(hookSrc, "export const MAX_INDEX_CHARS")}`,
    when: "always",
    note: "worst case: the cap. Smaller vaults pay less; the cap is what an aging vault converges to"
  });

  // ── skills: descriptions are always loaded, bodies only on trigger ─────────
  const skillsDir = path.join(ROOT, "packages/create-vkm-kit/templates/skills");
  for (const name of fs.readdirSync(skillsDir).sort()) {
    const rel = `packages/create-vkm-kit/templates/skills/${name}/SKILL.md`;
    const src = readRepo(rel);
    push({
      id: `skill-desc:${name}`,
      group: "skills",
      chars: frontmatterDescription(src).length,
      source: `${rel}:${lineOf(src, "description:")}`,
      when: "always",
      note: "skill discovery — paid whether or not the skill is invoked"
    });
    push({
      id: `skill-body:${name}`,
      group: "skills",
      chars: src.length,
      source: `${rel}:1`,
      when: "on-trigger",
      note: "SKILL.md only; bundled references/ and examples/ are read on demand"
    });
  }

  // ── sub-agent ──────────────────────────────────────────────────────────────
  const agentRel = "packages/create-vkm-kit/templates/agents/vkm-implementer.md";
  const agentSrc = readRepo(agentRel);
  push({
    id: "subagent-desc:vkm-implementer",
    group: "subagents",
    chars: frontmatterDescription(agentSrc).length,
    source: `${agentRel}:${lineOf(agentSrc, "description:")}`,
    when: "always",
    note: "listed in the Task tool's schema"
  });
  push({
    id: "subagent-body:vkm-implementer",
    group: "subagents",
    chars: agentSrc.length,
    source: `${agentRel}:1`,
    when: "on-trigger"
  });

  // ── output style ───────────────────────────────────────────────────────────
  const styleRel = "packages/create-vkm-kit/templates/output-styles/vkm-terse.md";
  push({
    id: "output-style:vkm-terse",
    group: "output-style",
    chars: readRepo(styleRel).length,
    source: `${styleRel}:1`,
    when: "always",
    note: "token-saver is on by default; kill switch VKM_TOKEN_SAVER=0"
  });

  // ── per-call runtime budgets (not fixed, but they bound the worst case) ────
  const assembleRel = "packages/obsidian-memory-mcp/src/context-assemble.mjs";
  const assembleSrc = readRepo(assembleRel);
  const assembleBudget = Number(assembleSrc.match(/DEFAULT_BUDGET_CHARS\s*=\s*(\d+)/)?.[1] ?? 6000);
  push({
    id: "runtime:assemble_context",
    group: "runtime",
    chars: assembleBudget,
    source: `${assembleRel}:${lineOf(assembleSrc, "DEFAULT_BUDGET_CHARS")}`,
    when: "on-call",
    note: "default budget_chars cap for one assemble_context call"
  });

  return { pieces, totals: totalsOf(pieces) };
}

/**
 * @param {Piece[]} pieces
 * @returns {Record<string, number>}
 */
function totalsOf(pieces) {
  const sum = (f) => pieces.filter(f).reduce((a, p) => a + p.chars, 0);
  const always = sum((p) => p.when === "always");
  // Worst case = the permanent prior + every conditional piece at its cap, i.e.
  // all four skills loaded, the sub-agent spawned, and one full assemble_context.
  const conditional = sum((p) => p.when === "on-trigger" || p.when === "on-call");
  return {
    alwaysChars: always,
    alwaysTokens: approxTokens(always),
    conditionalChars: conditional,
    conditionalTokens: approxTokens(conditional),
    worstCaseChars: always + conditional,
    worstCaseTokens: approxTokens(always + conditional)
  };
}

/**
 * Installed view: how many surfaces actually carry the block, and how many of them
 * a Claude Code session in `cwd` loads at once.
 * @param {{ home: string, cwd: string, lang?: "es"|"en" }} opts
 */
export function measureInstalled({ home, cwd, lang = "es" }) {
  const surfaces = rulesSurfaces(home, cwd).map((s) => ({
    ...s,
    chars: installedBlockChars(s.file)
  }));
  const present = surfaces.filter((s) => s.chars > 0);
  const loaded = present.filter((s) => s.loadedByClaudeCode);
  const repo = measureRepo({ lang });
  // The repo view counts the block once; a session that loads N surfaces pays N.
  const extra = Math.max(0, loaded.length - 1) * memoryRulesBlock(lang).length;
  return {
    surfaces,
    surfacesPresent: present.map((s) => s.id),
    surfacesLoadedByClaudeCode: loaded.map((s) => s.id),
    rulesMultiplier: loaded.length,
    ...repo,
    totals: {
      ...repo.totals,
      alwaysChars: repo.totals.alwaysChars + extra,
      alwaysTokens: approxTokens(repo.totals.alwaysChars + extra),
      worstCaseChars: repo.totals.worstCaseChars + extra,
      worstCaseTokens: approxTokens(repo.totals.worstCaseChars + extra)
    }
  };
}

/** @param {ReturnType<typeof measureRepo>} report */
function toMarkdown(report, lang) {
  const rows = report.pieces
    .slice()
    .sort((a, b) => b.chars - a.chars)
    .map(
      (p) =>
        `| \`${p.id}\` | ${p.chars.toLocaleString("en-US")} | ${p.tokens.toLocaleString("en-US")} | \`${p.source}\` | ${p.when} | ${p.note ?? ""} |`
    );
  const t = report.totals;
  return [
    `# Fixed-context budget — repo view (lang: ${lang})`,
    "",
    "| piece | chars | ~tokens | source | when | note |",
    "| --- | --: | --: | --- | --- | --- |",
    ...rows,
    "",
    `**Always (the permanent prior):** ${t.alwaysChars.toLocaleString("en-US")} chars ≈ ${t.alwaysTokens.toLocaleString("en-US")} tokens`,
    `**Conditional (at cap):** ${t.conditionalChars.toLocaleString("en-US")} chars ≈ ${t.conditionalTokens.toLocaleString("en-US")} tokens`,
    `**Worst case:** ${t.worstCaseChars.toLocaleString("en-US")} chars ≈ ${t.worstCaseTokens.toLocaleString("en-US")} tokens`
  ].join("\n");
}

function main() {
  const argv = process.argv.slice(2);
  const get = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
  const lang = get("--lang") === "en" ? "en" : "es";
  const home = get("--home");
  const report = home
    ? measureInstalled({ home, cwd: get("--cwd") ?? process.cwd(), lang })
    : measureRepo({ lang });

  if (argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(toMarkdown(report, lang));
  if ("rulesMultiplier" in report) {
    console.log(
      `\n**Installed surfaces carrying the block:** ${report.surfacesPresent.join(", ") || "none"}` +
        `\n**Loaded together by a Claude Code session in this cwd:** ${report.rulesMultiplier}` +
        (report.rulesMultiplier > 1 ? " — the block is paid once per loaded surface." : "")
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
