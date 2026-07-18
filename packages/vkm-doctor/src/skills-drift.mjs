// vkm-doctor skills-drift check (companion to ADR-0049's skill/subagent installer): compares
// the kit's canonical skills (`SKILL_NAMES` in create-vkm-kit) against what's actually
// installed under `~/.claude/skills/<name>/`. Reuses `skillAssetFiles` from
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

function sha256(fp) {
  return createHash("sha256").update(fs.readFileSync(fp)).digest("hex");
}

/**
 * @param {{ home?: string, skillNames?: string[], files?: {src: string, dest: string}[] }} [opts]
 *   `files` overrides the {src,dest} pairs — tests fake both the installed skills dir and the
 *   template dir instead of touching the real ones.
 * @returns {{ skipped: true, reason: string } |
 *   { skipped: false, missing: string[], stale: string[], ok: string[] }}
 */
export function checkSkillsDrift({
  home = os.homedir(),
  skillNames = SKILL_NAMES,
  files = skillAssetFiles(home, { skills: true, agents: false })
} = {}) {
  const skillsDir = path.join(home, ".claude", "skills");
  if (!fs.existsSync(skillsDir)) {
    return { skipped: true, reason: "no ~/.claude/skills directory (skills not installed)" };
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
    // Stale if ANY of the skill's template files is absent or differs installed-side.
    const isStale = recs.some((r) => !fs.existsSync(r.dest) || sha256(r.src) !== sha256(r.dest));
    (isStale ? stale : ok).push(name);
  }
  return { skipped: false, missing, stale, ok };
}
