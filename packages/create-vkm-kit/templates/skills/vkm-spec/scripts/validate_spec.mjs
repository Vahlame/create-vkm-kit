#!/usr/bin/env node
/**
 * vkm-spec validator — mechanical check of a spec produced from the template.
 * Zero deps, Node >= 18. Exit 0 = valid, exit 1 = errors (each says how to fix).
 *
 * Usage: node validate_spec.mjs <spec-file.md> [--json]
 *
 * Parses the six canonical sections (## system_role … ## acceptance_criteria) from
 * markdown; also accepts the <orchestration_package> XML envelope. Doubles as the
 * deterministic grader for the spec-bench eval — keep changes backward-compatible.
 */
import { readFileSync } from "node:fs";

const SECTIONS = [
  "system_role",
  "user_intent",
  "functional_requirements",
  "constraints",
  "current_state",
  "acceptance_criteria"
];
const VAGUE_RE = /\b(should work|works? (correctly|properly|well)|properly|etc\.?)\b/i;
const CURRENT_STATE_MAX = 600;

function parseMarkdown(text) {
  const out = {};
  const re = /^##\s+([a-z_]+)\s*$/gim;
  const marks = [];
  let m;
  while ((m = re.exec(text))) marks.push({ name: m[1].toLowerCase(), end: re.lastIndex });
  for (let i = 0; i < marks.length; i++) {
    const bodyEnd =
      i + 1 < marks.length ? text.lastIndexOf("##", marks[i + 1].end - 3) : text.length;
    out[marks[i].name] = text.slice(marks[i].end, bodyEnd).trim();
  }
  return out;
}

function parseXml(text) {
  const out = {};
  for (const name of SECTIONS) {
    const m = text.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"));
    if (m) out[name] = m[1].trim();
  }
  return out;
}

export function validateSpec(text) {
  const errors = [];
  const warnings = [];
  const isXml = /<orchestration_package>/i.test(text);
  const spec = isXml ? parseXml(text) : parseMarkdown(text);

  for (const name of SECTIONS) {
    if (!spec[name] || !spec[name].trim()) {
      errors.push(
        `missing or empty section "${name}" — the template in references/spec-template.md has all six headings verbatim`
      );
    }
  }

  const role = (spec.system_role ?? "").trim();
  if (role && role.split("\n").filter((l) => l.trim()).length > 1) {
    errors.push(
      `system_role must be ONE line (who executes, at what altitude) — got ${role.split("\n").length} lines`
    );
  }

  const reqSrc = spec.functional_requirements ?? "";
  const reqs = isXml
    ? [...reqSrc.matchAll(/<req\b[^>]*>([\s\S]*?)<\/req>/gi)].map((r) => r[1].trim())
    : [...reqSrc.matchAll(/^\s*\d+\.\s+(.+(?:\n(?!\s*\d+\.).+)*)/gm)].map((r) => r[1].trim());
  if (reqs.length < 3 || reqs.length > 7) {
    errors.push(
      `functional_requirements: found ${reqs.length} numbered items, need 3–7 — fewer means the idea is still vague, more means you're writing the implementation`
    );
  }
  reqs.forEach((r, i) => {
    if (!r) errors.push(`functional_requirements: item ${i + 1} is empty`);
    else if (VAGUE_RE.test(r))
      errors.push(
        `functional_requirements: item ${i + 1} contains a vague phrase (${r.match(VAGUE_RE)?.[0]}) — name the input, the action, and the observable effect`
      );
  });

  const conSrc = spec.constraints ?? "";
  const cons = isXml
    ? [...conSrc.matchAll(/<constraint\b([^>]*)>([\s\S]*?)<\/constraint>/gi)].map((c) => ({
        text: c[2].trim(),
        cited: /source\s*=/.test(c[1])
      }))
    : [...conSrc.matchAll(/^\s*-\s+(.+(?:\n(?!\s*-\s).+)*)/gm)].map((c) => ({
        text: c[1].trim(),
        cited: /\(source:\s*[^)]+\)/.test(c[1]) || /\(assumption\)/i.test(c[1])
      }));
  if (cons.length === 0) {
    errors.push(
      `constraints: none found — list the walls (prior decisions, pinned versions, rules), each with "(source: <path>)" or "(assumption)"`
    );
  }
  cons.forEach((c, i) => {
    if (!c.cited)
      errors.push(
        `constraints: bullet ${i + 1} has no "(source: …)" and no "(assumption)" marker — cite the vault note or repo file that imposes it, or mark it (assumption)`
      );
  });

  const cur = (spec.current_state ?? "").trim();
  if (cur.length > CURRENT_STATE_MAX) {
    errors.push(
      `current_state is ${cur.length} chars, max ${CURRENT_STATE_MAX} — distill: what exists today that this touches, nothing else`
    );
  }

  const accSrc = spec.acceptance_criteria ?? "";
  const boxes = isXml
    ? [...accSrc.matchAll(/<criterion\b[^>]*>([\s\S]*?)<\/criterion>/gi)].map((b) => b[1].trim())
    : [...accSrc.matchAll(/^\s*-\s*\[[ x]\]\s+(.+(?:\n(?!\s*-\s*\[).+)*)/gm)].map((b) =>
        b[1].trim()
      );
  if (boxes.length < 2) {
    errors.push(
      `acceptance_criteria: found ${boxes.length} "- [ ]" boxes, need at least 2 binary checks — each runnable or directly observable`
    );
  }
  boxes.forEach((b, i) => {
    const hit = b.match(VAGUE_RE);
    if (hit)
      errors.push(
        `acceptance_criteria: box ${i + 1} contains "${hit[0]}" — replace with a runnable/observable check (what command, what output?)`
      );
  });

  const assumptions = cons.filter((c) => /\(assumption\)/i.test(c.text)).length;
  if (cons.length > 0 && assumptions === cons.length) {
    warnings.push(
      `every constraint is an (assumption) — nothing grounds this spec in the vault or repo; double-check Step 1 ran`
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    counts: {
      requirements: reqs.length,
      constraints: cons.length,
      assumptions,
      criteria: boxes.length
    }
  };
}

function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("usage: validate_spec.mjs <spec-file.md> [--json]");
    process.exit(2);
  }
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    console.error(
      `cannot read ${file}: ${err && typeof err === "object" && "message" in err ? err.message : err}`
    );
    process.exit(2);
  }
  const result = validateSpec(text);
  if (args.includes("--json")) {
    console.log(JSON.stringify(result));
  } else {
    const c = result.counts;
    console.log(
      `vkm-spec validate: ${c.requirements} requirements, ${c.constraints} constraints (${c.assumptions} assumption${c.assumptions === 1 ? "" : "s"}), ${c.criteria} criteria`
    );
    for (const w of result.warnings) console.log(`WARN ${w}`);
    for (const e of result.errors) console.log(`ERROR ${e}`);
    console.log(
      result.ok
        ? "OK — all checks passed"
        : `${result.errors.length} error${result.errors.length === 1 ? "" : "s"} — fix before showing the spec`
    );
  }
  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
