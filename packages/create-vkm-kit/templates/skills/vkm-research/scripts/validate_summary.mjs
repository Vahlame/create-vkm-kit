#!/usr/bin/env node
/**
 * vkm-research summary validator — mechanical check that a summary.md is a real
 * CONSOLIDATION (synthesis) and not a promoted draft or a transcription.
 * Zero deps, Node >= 18. Exit 0 = valid, 1 = errors (each says how to fix).
 *
 * Usage: node validate_summary.mjs <summary.md> [--sources <dir-or-file>...] [--json]
 *
 * What "consolidated > draft-local" means, mechanically: the local map-reduce draft
 * has NO wikilinks, NO supersedes relations, and keeps per-source seams (---
 * separators, "## <file>.md" headings, leaked url:/title: lines). This validator
 * checks exactly those axes. Doubles as the deterministic grader for research-bench —
 * keep changes backward-compatible.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const WIKILINK_RE = /\[\[[^\]]+\]\]/g;
// The typed relation, optionally followed by a " — what changed" comment (the
// template asks for one) — the KG indexes the "- supersedes [[target]]" prefix.
const SUPERSEDES_LINE_RE = /^\s*-\s+supersedes\s+\[\[[^\]]+\]\]\s*(?:—.*)?$/;
const DRAFT_SEAM_RES = [
  { re: /\n---\n/g, what: "`---` chunk separators (map-reduce seam)" },
  { re: /^##\s+\S+\.md\s*$/m, what: 'a "## <file>.md" heading (per-source seam)' },
  {
    re: /^(url|title):\s/m,
    what: "a leaked `url:`/`title:` line in the body (source-preformat seam)"
  }
];
const MAX_COMPRESSION_RATIO = 0.6;

function splitFrontmatter(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { fm: null, body: String(text) };
  return { fm: m[1], body: m[2] };
}

/**
 * @param {string} text summary.md content
 * @param {{sourcesText?: string}} [opts]
 */
export function validateSummary(text, opts = {}) {
  const errors = [];
  const warnings = [];
  const { fm, body } = splitFrontmatter(text);

  if (!fm) {
    errors.push(
      "no YAML frontmatter — the consolidated summary keeps the draft's frontmatter shape (see references/summary-template.md) with status: consolidated"
    );
  } else {
    const status = fm.match(/^status:\s*(\S+)/m)?.[1];
    if (status !== "consolidated") {
      errors.push(
        `frontmatter status is ${status ? `"${status}"` : "missing"} — a finished consolidation sets "status: consolidated" (that line is what locks the note against local overwrites)`
      );
    }
  }

  const trimmed = body.trim();
  if (trimmed.length < 200) {
    errors.push(
      `summary body is ${trimmed.length} chars — a consolidation distills, it doesn't vanish; write the synthesis (claims, connections, contradictions)`
    );
  }

  const wikilinks = [...trimmed.matchAll(WIKILINK_RE)].map((m) => m[0]);
  if (wikilinks.length === 0) {
    errors.push(
      "zero [[wikilinks]] — connect the topic to the vault (PROJECTS/, STACKS/, or related RESEARCH notes); an unlinked summary is exactly what the local draft already produces"
    );
  }

  for (const { re, what } of DRAFT_SEAM_RES) {
    if (re.test(trimmed)) {
      errors.push(
        `draft seam detected: ${what} — this reads as promoted map-reduce output, not synthesis; rewrite across sources instead of keeping per-source blocks`
      );
    }
  }

  const supersedesMentions = trimmed.split("\n").filter((l) => /\bsupersedes\b/i.test(l));
  const supersedes = supersedesMentions.filter((l) => SUPERSEDES_LINE_RE.test(l));
  for (const l of supersedesMentions) {
    if (!SUPERSEDES_LINE_RE.test(l) && /^\s*-\s/.test(l)) {
      errors.push(
        `malformed supersedes relation: "${l.trim()}" — the recoverable form is "- supersedes [[target]]" (typed relation the KG can index)`
      );
    }
  }

  let ratio = null;
  if (opts.sourcesText) {
    const srcLen = opts.sourcesText.trim().length;
    // Below ~2k chars of sources the ratio is meaningless (a faithful synthesis of
    // three short notes can legitimately be near their size) — skip, don't misfire.
    if (srcLen >= 2000) {
      ratio = trimmed.length / srcLen;
      if (ratio > MAX_COMPRESSION_RATIO) {
        errors.push(
          `summary is ${Math.round(ratio * 100)}% the size of its sources (max ${MAX_COMPRESSION_RATIO * 100}%) — that's transcription, not synthesis; keep the claims, drop the prose`
        );
      }
      if (ratio < 0.02) {
        warnings.push(
          `summary is only ${(ratio * 100).toFixed(1)}% the size of its sources — possibly too thin; check no seeded contradiction or key claim was dropped`
        );
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    counts: {
      wikilinks: wikilinks.length,
      supersedes: supersedes.length,
      bodyChars: trimmed.length,
      compressionRatio: ratio === null ? null : Math.round(ratio * 1000) / 1000
    }
  };
}

function readSources(paths) {
  let out = "";
  for (const p of paths) {
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p)
        .filter((f) => f.endsWith(".md"))
        .sort()) {
        out += readFileSync(path.join(p, f), "utf8") + "\n";
      }
    } else {
      out += readFileSync(p, "utf8") + "\n";
    }
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("usage: validate_summary.mjs <summary.md> [--sources <dir-or-file>...] [--json]");
    process.exit(2);
  }
  const si = args.indexOf("--sources");
  const sourcePaths = si === -1 ? [] : args.slice(si + 1).filter((a) => !a.startsWith("--"));
  const result = validateSummary(readFileSync(file, "utf8"), {
    sourcesText: sourcePaths.length ? readSources(sourcePaths) : undefined
  });
  if (args.includes("--json")) {
    console.log(JSON.stringify(result));
  } else {
    const c = result.counts;
    console.log(
      `vkm-research validate: ${c.wikilinks} wikilink(s), ${c.supersedes} supersedes, ${c.bodyChars} chars` +
        (c.compressionRatio !== null
          ? `, compression ${Math.round(c.compressionRatio * 100)}%`
          : "")
    );
    for (const w of result.warnings) console.log(`WARN ${w}`);
    for (const e of result.errors) console.log(`ERROR ${e}`);
    console.log(
      result.ok
        ? "OK — reads as a real consolidation"
        : `${result.errors.length} error(s) — fix before setting status: consolidated`
    );
  }
  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
