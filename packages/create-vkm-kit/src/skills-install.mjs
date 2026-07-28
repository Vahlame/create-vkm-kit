// vkm-kit skills + subagent installer (ADR-0049): copies the four skill directories and
// a surface-native vkm-implementer agent into Claude Code or Codex's user scope.
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

export const SKILL_NAMES = [
  "vkm-discipline",
  "vkm-spec",
  "vkm-design",
  "vkm-research",
  "vkm-verify"
];
export const AGENT_BASENAMES = ["vkm-implementer.md"];
export const CODEX_AGENT_BASENAMES = ["vkm-implementer.toml"];

function templatesDir() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "templates");
}

/** The {src,dest} pairs for each asset group under a given `home`. */
/** Every file under a skill's template dir (SKILL.md + any domain/reference files), as {src,dest}. */
function skillDirFiles(name, skillsDir) {
  const root = path.join(templatesDir(), "skills", name);
  const out = [];
  for (const rel of readdirSync(root, { recursive: true })) {
    const src = path.join(root, String(rel));
    if (!statSync(src).isFile()) continue;
    out.push({ src, dest: path.join(skillsDir, name, String(rel)) });
  }
  return out;
}

export function skillAssetFiles(home, { ide = "claude", skills = true, agents = true } = {}) {
  const isCodex = ide === "codex";
  const scopeDir = path.join(home, isCodex ? ".agents" : ".claude");
  const agentDir = path.join(home, isCodex ? ".codex" : ".claude", "agents");
  const agentBasenames = isCodex ? CODEX_AGENT_BASENAMES : AGENT_BASENAMES;
  const files = [];
  if (skills) {
    for (const name of SKILL_NAMES)
      files.push(...skillDirFiles(name, path.join(scopeDir, "skills")));
  }
  if (agents) {
    for (const basename of agentBasenames) {
      files.push({
        src: path.join(templatesDir(), "agents", basename),
        dest: path.join(agentDir, basename)
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
 * @param {{ ide?: "claude" | "codex", skills?: boolean, agents?: boolean }} [opts]
 */
export async function configureSkillAssets(
  home,
  dryRun,
  { ide = "claude", skills = true, agents = true } = {}
) {
  const isCodex = ide === "codex";
  const sidecarFp = path.join(home, isCodex ? ".codex" : ".claude", ASSETS_SIDECAR_BASENAME);
  try {
    const wanted = skillAssetFiles(home, { ide, skills, agents });
    const unwanted = skillAssetFiles(home, { ide, skills: !skills, agents: !agents });
    if (dryRun) {
      for (const { dest } of wanted) console.log(pc.cyan("[dry-run] would install"), pc.dim(dest));
      for (const { dest } of unwanted) {
        console.log(pc.cyan("[dry-run] would remove (if unmodified)"), pc.dim(dest));
      }
      return;
    }
    if (wanted.length) {
      const { installed } = await installManagedAssets({ files: wanted, sidecarFp });
      if (skills) {
        console.log(
          pc.green("Skills installed:"),
          pc.dim(`${SKILL_NAMES.join(", ")} (${isCodex ? "~/.agents/skills" : "~/.claude/skills"})`)
        );
      }
      if (agents) {
        console.log(
          pc.green("Subagent template installed:"),
          pc.dim(
            `${(isCodex ? CODEX_AGENT_BASENAMES : AGENT_BASENAMES).join(", ")} (${isCodex ? "~/.codex/agents" : "~/.claude/agents"})`
          )
        );
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

/**
 * Full teardown of both groups (hash-guarded).
 * @param {string} home
 * @param {boolean} dryRun
 * @param {{ ide?: "claude" | "codex" }} [opts]
 */
export async function uninstallSkillAssets(home, dryRun, { ide = "claude" } = {}) {
  await configureSkillAssets(home, dryRun, { ide, skills: false, agents: false });
}
