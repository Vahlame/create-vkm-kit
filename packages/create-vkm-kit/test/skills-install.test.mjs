import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  configureSkillAssets,
  uninstallSkillAssets,
  skillAssetFiles,
  SKILL_NAMES
} from "../src/skills-install.mjs";

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "skills-install-test-"));
}

test("configureSkillAssets installs skills + agent template; idempotent", async () => {
  const home = tempHome();
  await configureSkillAssets(home, false);
  await configureSkillAssets(home, false);
  for (const name of SKILL_NAMES) {
    const fp = path.join(home, ".claude", "skills", name, "SKILL.md");
    assert.ok(fs.existsSync(fp), `missing ${fp}`);
    const text = fs.readFileSync(fp, "utf8");
    assert.match(text, /^---\r?\nname: /, "frontmatter must open the file");
    assert.match(text, /create-vkm-kit/, "ownership marker must be present");
  }
  assert.ok(fs.existsSync(path.join(home, ".claude", "agents", "vkm-implementer.md")));
});

test("skill descriptions stay within Claude Code's always-in-context caps", async () => {
  // Descriptions are ALWAYS in context (hard cap 1536 chars; soft target ≤300).
  for (const { src } of skillAssetFiles(os.homedir(), { skills: true, agents: false })) {
    const text = fs.readFileSync(src, "utf8");
    const description = text.match(/^description: (.+)$/m)?.[1] ?? "";
    assert.ok(description.length > 0, `${src}: description missing`);
    assert.ok(
      description.length <= 300,
      `${src}: description ${description.length} > 300 soft cap`
    );
  }
});

test("uninstall removes unmodified assets but keeps a user-customized skill", async () => {
  const home = tempHome();
  await configureSkillAssets(home, false);
  const customized = path.join(home, ".claude", "skills", "vkm-discipline", "SKILL.md");
  fs.writeFileSync(customized, "my own rules\n");
  await uninstallSkillAssets(home, false);
  assert.ok(fs.existsSync(customized), "user-modified skill must survive");
  assert.equal(fs.existsSync(path.join(home, ".claude", "skills", "vkm-spec", "SKILL.md")), false);
  assert.equal(fs.existsSync(path.join(home, ".claude", "agents", "vkm-implementer.md")), false);
});

test("dry-run writes nothing", async () => {
  const home = tempHome();
  await configureSkillAssets(home, true);
  assert.equal(fs.existsSync(path.join(home, ".claude")), false);
});
