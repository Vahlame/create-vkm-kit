#!/usr/bin/env node
/**
 * Skills triggering-accuracy eval — does the skill LISTING (name + description alone,
 * exactly what a session pre-loads) route each prompt to the right skill?
 *
 * Modes:
 *   --emit-prompts            print {id, prompt} JSONL of full subject prompts (for an
 *                             external orchestrator to run against any model/CLI)
 *   --grade <answers.jsonl>   grade {id, answer} lines; prints per-skill hit rate,
 *                             false-positive rate and the failing cases
 *   --provider api            run end-to-end via ANTHROPIC_API_KEY (model from
 *                             --model, default claude-haiku-4-5-20251001)
 *
 * Gate (per skill): hit-rate >= 0.9 on its should-trigger cases AND false-positive
 * rate <= 0.1 across everyone else's cases (exit 1 below either floor).
 * Zero deps; the api provider uses fetch directly.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(HERE, "..", "..", "packages", "create-vkm-kit", "templates", "skills");
const SKILLS = ["vkm-discipline", "vkm-spec", "vkm-design", "vkm-research"];

function frontmatter(name) {
  const text = readFileSync(path.join(TEMPLATES, name, "SKILL.md"), "utf8");
  const desc = text.match(/^description: (.+)$/m)?.[1];
  if (!desc) throw new Error(`no description in ${name}/SKILL.md`);
  return desc;
}

export function buildListing() {
  return SKILLS.map((n) => `- ${n}: ${frontmatter(n)}`).join("\n");
}

export function subjectPrompt(userPrompt) {
  return [
    "You are an agent with these optional skills available (name: description):",
    "",
    buildListing(),
    "",
    "A user sends the following message. Decide which single skill, if any, you would",
    "invoke FIRST for it. Answer with exactly one token: the skill name, or none.",
    "",
    `User message: ${JSON.stringify(userPrompt)}`,
    "",
    "Answer (one of: " + SKILLS.join(", ") + ", none):"
  ].join("\n");
}

export function loadCases() {
  return readFileSync(path.join(HERE, "cases.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

export function normalizeAnswer(raw) {
  const t = String(raw).toLowerCase();
  for (const s of SKILLS) if (t.includes(s)) return s;
  return "none";
}

export function grade(cases, answers) {
  const byId = new Map(answers.map((a) => [a.id, normalizeAnswer(a.answer)]));
  const perSkill = Object.fromEntries(
    SKILLS.map((s) => [s, { hits: 0, total: 0, fps: 0, fpPool: 0 }])
  );
  const failures = [];
  for (const c of cases) {
    const got = byId.get(c.id);
    if (got === undefined) {
      failures.push({ id: c.id, expected: c.expected, got: "(no answer)" });
      continue;
    }
    for (const s of SKILLS) {
      if (c.expected === s) {
        perSkill[s].total++;
        if (got === s) perSkill[s].hits++;
      } else {
        perSkill[s].fpPool++;
        if (got === s) perSkill[s].fps++;
      }
    }
    if (got !== c.expected) failures.push({ id: c.id, expected: c.expected, got });
  }
  const rows = SKILLS.map((s) => ({
    skill: s,
    hitRate: perSkill[s].total ? perSkill[s].hits / perSkill[s].total : 1,
    fpRate: perSkill[s].fpPool ? perSkill[s].fps / perSkill[s].fpPool : 0
  }));
  const ok = rows.every((r) => r.hitRate >= 0.9 && r.fpRate <= 0.1);
  return { ok, rows, failures };
}

async function callApi(prompt, model) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: "user", content: prompt }] })
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

function printReport(result, meta) {
  console.log(`skills-triggering — ${meta}`);
  for (const r of result.rows) {
    console.log(
      `  ${r.skill.padEnd(16)} hit-rate ${(r.hitRate * 100).toFixed(0).padStart(3)}%  false-positive ${(r.fpRate * 100).toFixed(1)}%`
    );
  }
  if (result.failures.length) {
    console.log(`  failures (${result.failures.length}):`);
    for (const f of result.failures)
      console.log(`    ${f.id}: expected ${f.expected}, got ${f.got}`);
  }
  console.log(result.ok ? "OK — gates met (hit >= 0.9, FP <= 0.1 per skill)" : "GATE FAILED");
}

async function main() {
  const args = process.argv.slice(2);
  const cases = loadCases();

  if (args.includes("--emit-prompts")) {
    for (const c of cases)
      console.log(JSON.stringify({ id: c.id, prompt: subjectPrompt(c.prompt) }));
    return;
  }

  const gi = args.indexOf("--grade");
  if (gi !== -1) {
    const answers = readFileSync(args[gi + 1], "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const result = grade(cases, answers);
    printReport(result, `graded ${answers.length} answers from ${args[gi + 1]}`);
    process.exit(result.ok ? 0 : 1);
  }

  if (args.includes("--provider") && args[args.indexOf("--provider") + 1] === "api") {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("ANTHROPIC_API_KEY not set — use --emit-prompts/--grade for external subjects");
      process.exit(2);
    }
    const model = args.includes("--model")
      ? args[args.indexOf("--model") + 1]
      : "claude-haiku-4-5-20251001";
    const answers = [];
    for (const c of cases) {
      const answer = await callApi(subjectPrompt(c.prompt), model);
      answers.push({ id: c.id, answer });
      process.stderr.write(".");
    }
    process.stderr.write("\n");
    const result = grade(cases, answers);
    printReport(result, `provider api, model ${model}, n=${cases.length}`);
    process.exit(result.ok ? 0 : 1);
  }

  console.error(
    "usage: run.mjs --emit-prompts | --grade <answers.jsonl> | --provider api [--model <id>]"
  );
  process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
