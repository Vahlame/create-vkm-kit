// vkm-kit skills + subagent installer (ADR-0049): copies the SKILL_NAMES directories and
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
  "vkm-verify",
  "vkm-intake",
  "vkm-ui-judge",
  "vkm-seo"
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

export function skillAssetFiles(
  home,
  { ide = "claude", skills = true, agents = true, skillsDir = null } = {}
) {
  const isCodex = ide === "codex";
  const isCursor = ide === "cursor";
  // Cursor personal skills: ~/.cursor/skills/<name>/SKILL.md (create-skill docs).
  // Codex: ~/.agents/skills. Claude Code: ~/.claude/skills.
  const scopeDir = path.join(home, isCodex ? ".agents" : isCursor ? ".cursor" : ".claude");
  const agentDir = path.join(home, isCodex ? ".codex" : ".claude", "agents");
  const agentBasenames = isCodex ? CODEX_AGENT_BASENAMES : AGENT_BASENAMES;
  const files = [];
  if (skills) {
    const dir = skillsDir || path.join(scopeDir, "skills");
    for (const name of SKILL_NAMES) files.push(...skillDirFiles(name, dir));
  }
  // Cursor has no vkm-implementer agent template format yet — skills only.
  if (agents && !isCursor) {
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
 * Install the skills (only — no client-specific subagent) into an ARBITRARY directory:
 * the compatibility escape hatch for agents the kit has no `--ide` for yet (Kimi Code,
 * opencode, ...). Skills are plain markdown + portable Node scripts, so any client with a
 * skills folder can consume them as-is. Idempotent and hash-tracked like the managed
 * install (sidecar lives inside the target dir); re-run to update, user-modified files
 * are never clobbered.
 *
 * @param {string} skillsDir absolute or cwd-relative target directory
 * @param {boolean} dryRun
 */
export async function installSkillsInto(skillsDir, dryRun) {
  const dir = path.resolve(skillsDir);
  const sidecarFp = path.join(dir, ASSETS_SIDECAR_BASENAME);
  try {
    const files = skillAssetFiles("", { skills: true, agents: false, skillsDir: dir });
    if (dryRun) {
      for (const { dest } of files) console.log(pc.cyan("[dry-run] would install"), pc.dim(dest));
      return;
    }
    await installManagedAssets({ files, sidecarFp });
    console.log(pc.green("Skills installed:"), pc.dim(`${SKILL_NAMES.join(", ")} (${dir})`));
  } catch (e) {
    console.warn(
      pc.yellow("Could not install skills into --skills-dir (skipped):"),
      e?.message || e
    );
  }
}

/**
 * Install / reconcile / remove the skill + agent assets. Symmetric like the sibling
 * modules: a piece that is NOT wanted is actively removed (hash-guarded).
 * @param {string} home
 * @param {boolean} dryRun
 * @param {{ ide?: "claude" | "codex" | "cursor", skills?: boolean, agents?: boolean }} [opts]
 */
export async function configureSkillAssets(
  home,
  dryRun,
  { ide = "claude", skills = true, agents = true } = {}
) {
  const isCodex = ide === "codex";
  const isCursor = ide === "cursor";
  const sidecarHome = isCodex ? ".codex" : isCursor ? ".cursor" : ".claude";
  const sidecarFp = path.join(home, sidecarHome, ASSETS_SIDECAR_BASENAME);
  const skillsLabel = isCodex
    ? "~/.agents/skills"
    : isCursor
      ? "~/.cursor/skills"
      : "~/.claude/skills";
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
        console.log(pc.green("Skills installed:"), pc.dim(`${SKILL_NAMES.join(", ")} (${skillsLabel})`));
      }
      if (agents && !isCursor) {
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
