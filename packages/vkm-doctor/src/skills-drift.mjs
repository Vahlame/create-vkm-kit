// vkm-doctor skills-drift check (companion to ADR-0049's skill/subagent installer): compares
// the kit's canonical skills (`SKILL_NAMES` in create-vkm-kit) against what's actually
// installed under `~/.claude/skills/<name>/SKILL.md`. Reuses `skillAssetFiles` from
// create-vkm-kit for the exact {src, dest} pairs, so this check can never disagree with what
// `configureSkillAssets` actually installs — no duplicated skill list to keep in sync, no
// separate drift-gate test. Two drift kinds: MISSING (no installed SKILL.md) and STALE
// (installed content differs from the shipped template — content hash, never mtime: a
// copy/touch changes mtime independent of bytes, and vice versa).
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
    const dest = path.join(skillsDir, name, "SKILL.md");
    const rec = files.find((f) => f.dest === dest);
    if (!rec || !fs.existsSync(rec.dest)) {
      missing.push(name);
    } else {
      (sha256(rec.src) === sha256(rec.dest) ? ok : stale).push(name);
    }
  }
  return { skipped: false, missing, stale, ok };
}
