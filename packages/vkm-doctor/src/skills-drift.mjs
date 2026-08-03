// vkm-doctor skills-drift check (companion to ADR-0049's skill/subagent installer): compares
// the kit's canonical skills (`SKILL_NAMES` in create-vkm-kit) against what's actually
// installed under each IDE home the kit wires (Claude `~/.claude/skills`, Cursor
// `~/.cursor/skills`, Codex `~/.agents/skills`). Reuses `skillAssetFiles` from
// create-vkm-kit for the exact {src, dest} pairs, so this check can never disagree with what
// `configureSkillAssets` actually installs — no duplicated skill list to keep in sync, no
// separate drift-gate test. Two drift kinds: MISSING (no installed SKILL.md) and STALE
// (ANY installed file of the skill differs from the shipped template, or a template file has
// no installed counterpart — content hash, never mtime: a copy/touch changes mtime independent
// of bytes, and vice versa). Per-skill EVERY template file is compared, not just SKILL.md:
// the real 2026-07-18 drift was a stale vkm-discipline/domains/design-ui.md under a byte-
// identical SKILL.md — the SKILL.md-only version of this check reported "ok" for it.
//
// Lives in its own file (same reason as jsonl-fallback.mjs): the deep `@vkmikc/create-vkm-kit`
// import can fail to resolve (e.g. a pre-ADR-0049 vkm-doctor install without the dependency) —
// isolating it here means that failure only disables THIS check (doctor.mjs dynamic-imports it
// in a try/catch), never crashes the core token report.
//
// Real case (2026-07-15): a pre-existing install had vkm-design and vkm-research missing from
// ~/.claude/skills/ and nothing detected it until a user noticed by hand.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { SKILL_NAMES, skillAssetFiles } from "@vkmikc/create-vkm-kit/src/skills-install.mjs";

/** @typedef {"claude"|"cursor"|"codex"} Ide */

/** IDE homes the installer can populate; checked in this order for the union report. */
export const SKILL_DRIFT_IDES = /** @type {const} */ (["claude", "cursor", "codex"]);

function sha256(fp) {
  return createHash("sha256").update(fs.readFileSync(fp)).digest("hex");
}

function skillsDirFor(home, ide) {
  if (ide === "codex") return path.join(home, ".agents", "skills");
  if (ide === "cursor") return path.join(home, ".cursor", "skills");
  return path.join(home, ".claude", "skills");
}

/**
 * Drift for one IDE skill home.
 * @param {{ home?: string, ide?: Ide, skillNames?: string[], files?: {src: string, dest: string}[] }} [opts]
 * @returns {{ skipped: true, reason: string, ide: Ide } |
 *   { skipped: false, ide: Ide, missing: string[], stale: string[], ok: string[] }}
 */
export function checkSkillsDriftForIde({
  home = os.homedir(),
  ide = "claude",
  skillNames = SKILL_NAMES,
  files = skillAssetFiles(home, { ide, skills: true, agents: false })
} = {}) {
  const skillsDir = skillsDirFor(home, ide);
  if (!fs.existsSync(skillsDir)) {
    const label =
      ide === "codex" ? "~/.agents/skills" : ide === "cursor" ? "~/.cursor/skills" : "~/.claude/skills";
    return {
      skipped: true,
      ide,
      reason: `no ${label} directory (skills not installed for ${ide})`
    };
  }
  const missing = [];
  const stale = [];
  const ok = [];
  for (const name of skillNames) {
    const skillRoot = path.join(skillsDir, name);
    const recs = files.filter((f) => f.dest.startsWith(skillRoot + path.sep));
    const mdRec = recs.find((f) => f.dest === path.join(skillRoot, "SKILL.md"));
    if (!mdRec || !fs.existsSync(mdRec.dest)) {
      missing.push(name);
      continue;
    }
    const isStale = recs.some((r) => !fs.existsSync(r.dest) || sha256(r.src) !== sha256(r.dest));
    (isStale ? stale : ok).push(name);
  }
  return { skipped: false, ide, missing, stale, ok };
}

/**
 * @typedef {{ skipped: true, reason: string, ide: Ide }} SkillsDriftSkipped
 * @typedef {{ skipped: false, ide: Ide, missing: string[], stale: string[], ok: string[] }} SkillsDriftActive
 */

/**
 * Union across Claude / Cursor / Codex skill homes. Skips IDEs with no skills dir.
 * If NONE are installed, returns skipped (same UX as the old Claude-only check).
 * @param {{ home?: string, skillNames?: string[], ides?: Ide[],
 *   files?: {src: string, dest: string}[] }} [opts]
 * @returns {{ skipped: true, reason: string } |
 *   { skipped: false, missing: string[], stale: string[], ok: string[],
 *     byIde: (SkillsDriftSkipped | SkillsDriftActive)[] }}
 */
export function checkSkillsDrift({
  home = os.homedir(),
  skillNames = SKILL_NAMES,
  ides = [...SKILL_DRIFT_IDES],
  // Backward-compat: tests that passed `files` still get a single Claude-home check.
  files
} = {}) {
  if (files) {
    const one = checkSkillsDriftForIde({ home, ide: "claude", skillNames, files });
    if (one.skipped === true) return { skipped: true, reason: one.reason };
    /** @type {SkillsDriftActive} */
    const activeOne = one;
    return {
      skipped: false,
      missing: activeOne.missing,
      stale: activeOne.stale,
      ok: activeOne.ok,
      byIde: [activeOne]
    };
  }

  /** @type {(SkillsDriftSkipped | SkillsDriftActive)[]} */
  const byIde = [];
  for (const ide of ides) {
    byIde.push(checkSkillsDriftForIde({ home, ide, skillNames }));
  }
  /** @type {SkillsDriftActive[]} */
  const active = [];
  for (const r of byIde) {
    if (r.skipped === false) active.push(r);
  }
  if (!active.length) {
    return {
      skipped: true,
      reason: "no skills directory under ~/.claude, ~/.cursor, or ~/.agents (skills not installed)"
    };
  }

  // Union: a skill is missing/stale if ANY active IDE reports it that way; ok only if
  // every active IDE lists it ok (and none list it missing/stale).
  const missing = new Set();
  const stale = new Set();
  for (const r of active) {
    for (const n of r.missing) missing.add(n);
    for (const n of r.stale) stale.add(n);
  }
  const ok = skillNames.filter((n) => !missing.has(n) && !stale.has(n));
  return {
    skipped: false,
    missing: [...missing].sort(),
    stale: [...stale].sort(),
    ok,
    byIde
  };
}
