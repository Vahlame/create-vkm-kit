#!/usr/bin/env node
// PostToolUse hook (matcher: Bash) shipped by create-obsidian-memory — the vkm-kit
// token-saver (ADR-0043). Compacts noisy shell output BEFORE it enters Claude's context:
// strips ANSI color/cursor codes, keeps only the final repaint of carriage-return progress
// lines, collapses runs of identical lines, and windows very long logs to head+tail with an
// elision marker — while HARD-GUARANTEEING that diagnostic lines (error/warn/fail/exception/
// exit-code patterns) and the final lines of output always survive verbatim. Conservative by
// design: small or already-clean outputs are left untouched (the hook prints nothing, and
// Claude Code keeps the original), and ANY internal failure fails open the same way.
//
// Kill switch: set VKM_TOKEN_SAVER=0 to disable without uninstalling.
//
// stdin:  PostToolUse JSON ({ tool_name, tool_input, tool_response, ... }).
// stdout: { hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput } } —
//         same TYPE as the incoming tool_response (string in → string out; object in →
//         object out with its text fields compacted, other fields preserved verbatim), so a
//         schema mismatch can never corrupt the tool result (Claude Code ignores values that
//         don't match the tool's output schema).
import fs from "node:fs";
import { pathToFileURL } from "node:url";

/** Diagnostic lines that must NEVER be dropped, whatever else gets compacted. Note the
 * punctuation-ending alternatives (`err!`, `npm ERR!`) sit OUTSIDE the trailing `\b` group —
 * `!` followed by a space is not a word boundary — and `\w*` before `error|exception`
 * catches joined names like `TypeError` / `HttpException`. */
export const MUST_KEEP_RE =
  /\b\w*(?:error|exception)s?\b|\berr!|npm ERR!|\b(?:warn|warning|fail|failed|failure|fatal|panic|traceback|assert|denied|refused|timeout|timed out|exit code|exited with|mismatch(?:ed|es)?|reconcil\w*|discrepan\w*)\b|\bexpected\b[^\n]{0,80}\bgot\b|✖|✗|⨯/i;

/** ANSI CSI/OSC escape sequences (colors, cursor movement, titles). */
const ANSI_RE = new RegExp(
  // eslint-disable-next-line no-control-regex
  "[\\u001b\\u009b](?:\\[[0-9;?]*[ -/]*[@-~]|\\][^\\u0007\\u001b]*(?:\\u0007|\\u001b\\\\))",
  "g"
);

const DEFAULTS = {
  /** Outputs at or under this many lines (after cleaning) are never windowed. */
  maxLines: 200,
  /** Head/tail window sizes when windowing kicks in. */
  headLines: 120,
  tailLines: 60,
  /** Identical-line runs longer than this collapse to one line + a repeat marker. */
  repeatThreshold: 3,
  /** Cap on rescued diagnostic lines re-inserted from an elided middle section. */
  maxRescued: 60,
  /** Context lines carried with each rescued diagnostic (detail rarely repeats the keyword). */
  rescueBefore: 1,
  rescueAfter: 3,
  /** Below this many saved characters the hook stays silent (not worth a rewrite). */
  minSavedChars: 500
};

/**
 * Pure compaction: returns `{ text, changed, stats }`. Never throws on string input.
 * @param {string} input
 * @param {Partial<typeof DEFAULTS>} [opts]
 */
export function compactText(input, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const original = String(input ?? "");
  if (!original) return { text: original, changed: false, stats: null };

  // 1. ANSI escapes out; progress repaints: a physical line that was redrawn with `\r`
  //    only ever shows its final segment in a terminal — keep exactly that.
  const cleaned = original
    .replace(ANSI_RE, "")
    .split("\n")
    .map((line) => {
      const i = line.lastIndexOf("\r");
      return i >= 0 ? line.slice(i + 1) : line;
    });

  // 2. Collapse runs of identical (trimmed-equal) lines.
  const collapsed = [];
  let run = 0;
  for (let i = 0; i < cleaned.length; i++) {
    const line = cleaned[i];
    if (i > 0 && line.trim() === cleaned[i - 1].trim()) {
      run += 1;
      continue;
    }
    if (run >= cfg.repeatThreshold) {
      collapsed.push(`  [... repeated ${run} more times]`);
    } else {
      for (let r = 0; r < run; r++) collapsed.push(cleaned[i - 1]);
    }
    run = 0;
    collapsed.push(line);
  }
  if (run >= cfg.repeatThreshold) collapsed.push(`  [... repeated ${run} more times]`);
  else for (let r = 0; r < run; r++) collapsed.push(cleaned[cleaned.length - 1]);

  // 3. Head+tail windowing, rescuing diagnostic BLOCKS from the elided middle.
  //    A diagnostic marker's detail usually lives on neighboring lines with no keyword
  //    of their own (a TS error code under "ERROR in …", a stack frame under
  //    "WARNING: DATA RACE") — rescuing the matched line alone provably lost the
  //    decisive detail (see test/compact-diagnostics.test.mjs), so each match carries
  //    `rescueBefore`/`rescueAfter` context lines with it, overlapping blocks merged.
  let windowed = collapsed;
  if (collapsed.length > cfg.maxLines) {
    const head = collapsed.slice(0, cfg.headLines);
    const tail = collapsed.slice(-cfg.tailLines);
    const middle = collapsed.slice(cfg.headLines, -cfg.tailLines);
    const keep = new Set();
    for (let i = 0; i < middle.length; i++) {
      if (!MUST_KEEP_RE.test(middle[i])) continue;
      const from = Math.max(0, i - cfg.rescueBefore);
      const to = Math.min(middle.length - 1, i + cfg.rescueAfter);
      for (let j = from; j <= to; j++) keep.add(j);
    }
    const rescued = [...keep].sort((a, b) => a - b).slice(0, cfg.maxRescued);
    const rescuedLines = [];
    for (let n = 0; n < rescued.length; n++) {
      if (n > 0 && rescued[n] !== rescued[n - 1] + 1) rescuedLines.push("  [...]");
      rescuedLines.push(middle[rescued[n]]);
    }
    const elided = middle.length - rescued.length;
    windowed = [
      ...head,
      `[vkm token-saver: ${elided} low-signal lines elided; ${rescued.length} diagnostic lines preserved below]`,
      ...rescuedLines,
      ...tail
    ];
  }

  const text = windowed.join("\n");
  const saved = original.length - text.length;
  if (saved < cfg.minSavedChars) {
    return { text: original, changed: false, stats: null };
  }
  const stats = {
    fromChars: original.length,
    toChars: text.length,
    fromLines: cleaned.length,
    toLines: windowed.length
  };
  return {
    text: `${text}\n[vkm token-saver: compacted ${stats.fromChars}→${stats.toChars} chars (${stats.fromLines}→${stats.toLines} lines); diagnostics preserved]`,
    changed: true,
    stats
  };
}

/**
 * Compact a PostToolUse `tool_response`, preserving its shape: strings are compacted
 * directly; plain objects get their known text-bearing fields (`stdout`, `stderr`,
 * `output`, `text`) compacted and every other field passed through verbatim. Returns
 * `null` when nothing changed enough to be worth a rewrite.
 * @param {unknown} toolResponse
 */
export function compactToolResponse(toolResponse) {
  if (typeof toolResponse === "string") {
    const { text, changed } = compactText(toolResponse);
    return changed ? text : null;
  }
  if (toolResponse && typeof toolResponse === "object" && !Array.isArray(toolResponse)) {
    const out = { ...toolResponse };
    let changed = false;
    for (const field of ["stdout", "stderr", "output", "text"]) {
      if (typeof out[field] === "string") {
        const result = compactText(out[field]);
        if (result.changed) {
          out[field] = result.text;
          changed = true;
        }
      }
    }
    return changed ? out : null;
  }
  return null;
}

function main() {
  if (process.env.VKM_TOKEN_SAVER === "0") return;
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    return; // fail open: unreadable stdin → leave the tool output untouched
  }
  const updated = compactToolResponse(payload?.tool_response);
  if (updated === null || updated === undefined) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: updated }
    })
  );
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  try {
    main();
  } catch {
    // fail open — a hook crash must never break the tool call
  }
}
