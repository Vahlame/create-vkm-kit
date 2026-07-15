// vkm-kit skills + subagent installer (ADR-0049): copies the discipline/spec skills into
// `~/.claude/skills/` and the implementer subagent template into `~/.claude/agents/`.
// Pure file assets — no settings.json changes — tracked by content hash through
// `asset-install.mjs`, so uninstall never deletes a file the user customized. Skills load
// their body only when invoked (Claude Code progressive disclosure); the always-in-context
// cost is just each skill's frontmatter description.
import path from "node:path";
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pc from "picocolors";
import {
  ASSETS_SIDECAR_BASENAME,
  installManagedAssets,
  removeManagedAssets
} from "./asset-install.mjs";

export const SKILL_NAMES = ["vkm-discipline", "vkm-spec", "vkm-design", "vkm-research"];
export const AGENT_BASENAMES = ["vkm-implementer.md"];

function templatesDir() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "templates");
}

/** The {src,dest} pairs for each asset group under a given `home`. */
/** Every file under a skill's template dir (SKILL.md + any domain/reference files), as {src,dest}. */
function skillDirFiles(name, claudeDir) {
  const root = path.join(templatesDir(), "skills", name);
  const out = [];
  for (const rel of readdirSync(root, { recursive: true })) {
    const src = path.join(root, String(rel));
    if (!statSync(src).isFile()) continue;
    out.push({ src, dest: path.join(claudeDir, "skills", name, String(rel)) });
  }
  return out;
}

export function skillAssetFiles(home, { skills = true, agents = true } = {}) {
  const claudeDir = path.join(home, ".claude");
  const files = [];
  if (skills) {
    for (const name of SKILL_NAMES) files.push(...skillDirFiles(name, claudeDir));
  }
  if (agents) {
    for (const basename of AGENT_BASENAMES) {
      files.push({
        src: path.join(templatesDir(), "agents", basename),
        dest: path.join(claudeDir, "agents", basename)
      });
    }
  }
  return files;
}

/**
 * Install / reconcile / remove the skill + agent assets. Symmetric like the sibling
 * modules: a piece that is NOT wanted is actively removed (hash-guarded).
 * @param {string} home
 * @param {boolean} dryRun
 * @param {{ skills?: boolean, agents?: boolean }} [opts]
 */
export async function configureSkillAssets(home, dryRun, { skills = true, agents = true } = {}) {
  const sidecarFp = path.join(home, ".claude", ASSETS_SIDECAR_BASENAME);
  try {
    const wanted = skillAssetFiles(home, { skills, agents });
    const unwanted = skillAssetFiles(home, { skills: !skills, agents: !agents });
    if (dryRun) {
      for (const { dest } of wanted) console.log(pc.cyan("[dry-run] would install"), pc.dim(dest));
      for (const { dest } of unwanted) {
        console.log(pc.cyan("[dry-run] would remove (if unmodified)"), pc.dim(dest));
      }
      return;
    }
    if (wanted.length) {
      const { installed } = await installManagedAssets({ files: wanted, sidecarFp });
      if (skills) console.log(pc.green("Skills installed:"), pc.dim(SKILL_NAMES.join(", ")));
      if (agents) {
        console.log(pc.green("Subagent template installed:"), pc.dim(AGENT_BASENAMES.join(", ")));
      }
      void installed;
    }
    if (unwanted.length) {
      const { skipped } = await removeManagedAssets({
        sidecarFp,
        dests: unwanted.map((f) => f.dest)
      });
      for (const fp of skipped) console.warn(pc.yellow("Kept (modified by user):"), fp);
    }
  } catch (e) {
    console.warn(pc.yellow("Could not configure vkm skills/agents (skipped):"), e?.message || e);
  }
}

/** Full teardown of both groups (hash-guarded). */
export async function uninstallSkillAssets(home, dryRun) {
  await configureSkillAssets(home, dryRun, { skills: false, agents: false });
}
