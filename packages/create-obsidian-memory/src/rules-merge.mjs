// Idempotent install of the managed memory-rules block into agent-config files
// (~/.claude/CLAUDE.md, ./AGENTS.md, .cursor/rules/*.mdc). The block is wrapped
// in sentinels so re-runs replace ONLY our block and never clobber user content.
import path from "node:path";
import fse from "fs-extra";
import pc from "picocolors";
import { RULES_START, RULES_END, memoryRulesBlock } from "./memory-rules.mjs";

/**
 * Merge a managed block into existing text.
 * - If both sentinels are present → replace everything between them (inclusive).
 * - Else if the file is empty → just the block.
 * - Else → append the block after the existing content (preserving it verbatim).
 * @param {string} existing
 * @param {string} block - full block, sentinels included
 * @returns {string}
 */
export function mergeManagedBlock(existing, block) {
  const blk = block.trim();
  const text = (existing || "").replace(/\s+$/, "");
  const s = text.indexOf(RULES_START);
  const e = text.indexOf(RULES_END);
  if (s !== -1 && e !== -1 && e > s) {
    const before = text.slice(0, s).replace(/\s+$/, "");
    const after = text.slice(e + RULES_END.length).replace(/^\s+/, "");
    return (
      [before, blk, after]
        .filter(Boolean)
        .join("\n\n")
        .replace(/\n{3,}/g, "\n\n") + "\n"
    );
  }
  if (!text) return blk + "\n";
  return text + "\n\n" + blk + "\n";
}

/**
 * @param {string} fp
 * @param {string} block
 * @param {{ dryRun?: boolean, newFilePrefix?: string }} [opts]
 */
async function installRulesFile(fp, block, { dryRun = false, newFilePrefix = "" } = {}) {
  const exists = await fse.pathExists(fp);
  const base = exists ? await fse.readFile(fp, "utf8") : newFilePrefix;
  const merged = mergeManagedBlock(base, block);
  if (dryRun) {
    console.log(pc.cyan("[dry-run] would update rules"), fp);
    return;
  }
  await fse.ensureDir(path.dirname(fp));
  await fse.writeFile(fp, merged, "utf8");
  console.log(pc.green(exists ? "Updated rules" : "Wrote rules"), fp);
}

/**
 * Install the memory-rules block into the requested targets.
 * @param {string[]} targets - any of "claude" | "agents" | "cursor"
 * @param {"es"|"en"} lang
 * @param {{ home: string, cwd: string, dryRun?: boolean }} ctx
 * @returns {Promise<string[]>} files written
 */
export async function installRules(targets, lang, { home, cwd, dryRun = false }) {
  const block = memoryRulesBlock(lang);
  const written = [];
  if (targets.includes("claude")) {
    const fp = path.join(home, ".claude", "CLAUDE.md");
    await installRulesFile(fp, block, { dryRun });
    written.push(fp);
  }
  if (targets.includes("agents")) {
    const fp = path.join(cwd, "AGENTS.md");
    await installRulesFile(fp, block, { dryRun });
    written.push(fp);
  }
  if (targets.includes("cursor")) {
    const fp = path.join(cwd, ".cursor", "rules", "obsidian-memory.mdc");
    const frontmatter =
      "---\ndescription: Markdown vault memory protocol (obsidian-memory-kit)\nalwaysApply: true\n---\n\n";
    await installRulesFile(fp, block, { dryRun, newFilePrefix: frontmatter });
    written.push(fp);
  }
  return written;
}
