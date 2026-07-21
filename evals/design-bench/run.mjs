#!/usr/bin/env node
/**
 * design-bench AUTO harness — the round-based complement to the manual before/after
 * protocol in README.md. Subjects produce a SINGLE-FILE HTML page from a brief;
 * grading runs the validators the skill itself ships (slop-check fingerprint +
 * audit-css contrast/scale/rhythm) — mechanical axes only. The judgment axes
 * (nameable direction, lineup test) stay in the manual protocol and are NEVER folded
 * into this score.
 *
 * Conditions: "skill" (SKILL.md + direction.md + foundations.md injected — the core a
 * session progressively loads) vs "stock" (brief alone).
 * Briefs: "facturio" (the README's fixed slop-attractor) and "kelpwatch" — HELD OUT:
 * written for this harness, never used to tune the skill.
 * Modes: --emit-prompts [--n N] | --grade <answers.jsonl> | --models a,b --n N.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSubject } from "../lib/subject-runner.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.join(
  HERE,
  "..",
  "..",
  "packages",
  "create-vkm-kit",
  "templates",
  "skills",
  "vkm-design"
);
const SCRIPTS = path.join(SKILL_DIR, "scripts");

export const BRIEFS = [
  {
    id: "facturio",
    brief:
      "Build a single-file landing page for 'Facturio', a SaaS invoicing tool for freelancers: hero, three feature highlights, pricing teaser, sign-up call to action. Semantic HTML, all CSS in one <style> block, no JavaScript, no external resources."
  },
  {
    id: "kelpwatch",
    brief:
      "Build a single-file status dashboard page for 'Kelpwatch', a marine sensor fleet monitor: fleet health summary, a list of 6 buoys with live-ish readings (temp, salinity, battery), one alert banner state. Semantic HTML, all CSS in one <style> block, no JavaScript, no external resources."
  }
];

/** @param {{id:string,brief:string}} b @param {string} condition — "skill" | "stock" */
export function subjectPrompt(b, condition) {
  const parts = [b.brief, ""];
  if (condition === "skill") {
    parts.push(
      "Follow this design skill (its contract binds your output):",
      "--- SKILL.md ---",
      readFileSync(path.join(SKILL_DIR, "SKILL.md"), "utf8"),
      "--- references/direction.md ---",
      readFileSync(path.join(SKILL_DIR, "references", "direction.md"), "utf8"),
      "--- references/foundations.md ---",
      readFileSync(path.join(SKILL_DIR, "references", "foundations.md"), "utf8"),
      ""
    );
  }
  parts.push("Return ONLY the complete HTML document, nothing else.");
  return parts.join("\n");
}

/**
 * Deterministic grade 0–100 from the skill's own validators:
 *   40 — slop fingerprint (−10 per hit, floor 0)
 *   20 — declared contrast pairs (−10 per failing pair, floor 0)
 *   20 — type scale coherent (PASS)
 *   20 — spacing rhythm coherent (PASS)
 */
export async function grade(b, answer) {
  const html = String(answer)
    .replace(/^```html?\n/, "")
    .replace(/\n```\s*$/, "");
  const dir = mkdtempSync(path.join(tmpdir(), "design-grade-"));
  const file = path.join(dir, "page.html");
  writeFileSync(file, html);

  const { scan } = await import(path.join(SCRIPTS, "slop-check.mjs"));
  const hits = scan(html).length;
  const slop = Math.max(0, 40 - hits * 10);

  let audit;
  try {
    audit = execFileSync("node", [path.join(SCRIPTS, "audit-css.mjs"), file], { encoding: "utf8" });
  } catch (e) {
    audit = String(e && typeof e === "object" && "stdout" in e ? e.stdout : "");
  }
  const failPairs = audit.split("\n").filter((l) => /^FAIL\s/.test(l)).length;
  const contrast = Math.max(0, 20 - failPairs * 10);
  const type = /^TYPE\s+PASS/m.test(audit) ? 20 : 0;
  const space = /^SPACE\s+PASS/m.test(audit) ? 20 : 0;
  return slop + contrast + type + space;
}

async function main() {
  const args = process.argv.slice(2);
  const get = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
  const n = Number(get("--n") ?? 1);
  const conditions = ["skill", "stock"];

  if (args.includes("--emit-prompts")) {
    for (const b of BRIEFS)
      for (const c of conditions)
        for (let r = 1; r <= n; r++)
          console.log(
            JSON.stringify({ id: b.id, condition: c, replica: r, prompt: subjectPrompt(b, c) })
          );
    return;
  }
  const gi = args.indexOf("--grade");
  if (gi !== -1) {
    for (const line of readFileSync(args[gi + 1], "utf8")
      .split("\n")
      .filter(Boolean)) {
      const a = JSON.parse(line);
      const b = BRIEFS.find((x) => x.id === a.id);
      const score = await grade(b, a.answer);
      console.log(
        JSON.stringify({
          id: a.id,
          condition: a.condition,
          replica: a.replica,
          model: a.model,
          score
        })
      );
    }
    return;
  }

  const models = (get("--models") ?? "claude-haiku-4-5-20251001").split(",");
  for (const model of models)
    for (const b of BRIEFS)
      for (const c of conditions)
        for (let r = 1; r <= n; r++) {
          const { answer } = await runSubject({
            prompt: subjectPrompt(b, c),
            agentCmd: `${get("--agent-cmd") ?? "claude -p --output-format json --model"} ${model}`
          });
          console.log(
            JSON.stringify({
              id: b.id,
              condition: c,
              replica: r,
              model,
              score: await grade(b, answer)
            })
          );
        }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
