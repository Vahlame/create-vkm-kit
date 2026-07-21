// Mechanical gate for Anthropic's skill-authoring checklist (structure, not content) applied
// to every shipped skill template. Mirrors skills-install.test.mjs: reads the TEMPLATE sources
// directly via skillAssetFiles — installs nothing, this is a static check on the repo tree.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { skillAssetFiles } from "../src/skills-install.mjs";

/**
 * Allowlist of relative-.md cross-references inside a skill (Anthropic: "keep references
 * one level deep from SKILL.md" — Claude partial-reads nested references). EMPTY since the
 * 4-entry baseline vkm-design carried was retired: those pointers now live as plain-text
 * mentions ("`contemporary.md`, this folder") at the point of use, and SKILL.md — which the
 * gate exempts — remains the only place that links. Keep it empty: a new cross-reference
 * means restructure the file, not grow this set.
 */
const KNOWN_CROSS_REFS = new Set([]);

/** Every skill template markdown file, as absolute src paths (no install side effects). */
function templateMdFiles() {
  return skillAssetFiles(os.homedir(), { skills: true, agents: false })
    .map((f) => f.src)
    .filter((src) => path.extname(src) === ".md");
}

/** Splits a template src path into {skillName, relInSkill} (relInSkill uses '/' separators). */
function skillRelParts(src) {
  const parts = src.split(path.sep);
  const ti = parts.lastIndexOf("templates");
  return { skillName: parts[ti + 2], relInSkill: parts.slice(ti + 3).join("/") };
}

function readLines(src) {
  return fs.readFileSync(src, "utf8").split(/\r\n|\n/);
}

test("SKILL.md body stays under 500 lines", () => {
  for (const src of templateMdFiles()) {
    if (path.basename(src) !== "SKILL.md") continue;
    const lines = readLines(src);
    const fmEnd = lines.indexOf("---", 1); // closing frontmatter fence
    const bodyLines = lines.length - fmEnd - 1;
    assert.ok(bodyLines <= 500, `${src}: SKILL.md body is ${bodyLines} lines, must be <= 500`);
  }
});

test("skill reference files over 100 lines have a Contents heading in the first 25 lines", () => {
  const offenders = [];
  for (const src of templateMdFiles()) {
    if (path.basename(src) === "SKILL.md") continue;
    const lines = readLines(src);
    if (lines.length <= 100) continue;
    const head = lines.slice(0, 25).join("\n");
    const hasToc = /^##\s+(table of contents|contents)\s*$/im.test(head);
    if (!hasToc) offenders.push(`${src} (${lines.length} lines)`);
  }
  assert.deepEqual(
    offenders,
    [],
    `missing "## Contents" heading in first 25 lines:\n${offenders.join("\n")}`
  );
});

test("reference depth is one level: no new relative .md-to-.md links inside a skill", () => {
  const mdLinkRe = /\]\(([^)]*\.md(?:#[^)]*)?)\)/g;
  const offenders = [];
  for (const src of templateMdFiles()) {
    if (path.basename(src) === "SKILL.md") continue;
    const { skillName, relInSkill } = skillRelParts(src);
    const text = fs.readFileSync(src, "utf8");
    let m;
    while ((m = mdLinkRe.exec(text))) {
      const target = m[1];
      if (/^https?:\/\//.test(target)) continue;
      const key = `${skillName}/${relInSkill} -> ${target}`;
      if (!KNOWN_CROSS_REFS.has(key)) offenders.push(key);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `new relative .md link(s) not in KNOWN_CROSS_REFS allowlist (one-level-deep rule):\n${offenders.join("\n")}`
  );
});

test("no Windows-style backslash paths in skill markdown links", () => {
  const linkRe = /\]\(([^)]*)\)/g;
  const offenders = [];
  for (const src of templateMdFiles()) {
    const text = fs.readFileSync(src, "utf8");
    let m;
    while ((m = linkRe.exec(text))) {
      if (m[1].includes("\\")) offenders.push(`${src} -> ${m[1]}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `backslash path(s) in markdown link (use forward slashes):\n${offenders.join("\n")}`
  );
});

test("every SKILL.md frontmatter name is a valid, non-branded slug", () => {
  for (const src of templateMdFiles()) {
    if (path.basename(src) !== "SKILL.md") continue;
    const text = fs.readFileSync(src, "utf8");
    const name = text.match(/^name: (.+)$/m)?.[1] ?? "";
    assert.match(
      name,
      /^[a-z0-9-]{1,64}$/,
      `${src}: name "${name}" must match /^[a-z0-9-]{1,64}$/`
    );
    assert.ok(
      !/anthropic|claude/i.test(name),
      `${src}: name "${name}" must not contain "anthropic" or "claude"`
    );
  }
});
