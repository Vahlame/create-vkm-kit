import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  configureSkillAssets,
  installSkillsInto,
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
  assert.ok(
    fs.existsSync(path.join(home, ".claude", "skills", "_GUIDANCE.md")),
    "shared _GUIDANCE.md must install alongside skills"
  );
  for (const name of SKILL_NAMES) {
    const fp = path.join(home, ".claude", "skills", name, "SKILL.md");
    assert.ok(fs.existsSync(fp), `missing ${fp}`);
    const text = fs.readFileSync(fp, "utf8");
    assert.match(text, /^---\r?\nname: /, "frontmatter must open the file");
    assert.match(text, /create-vkm-kit/, "ownership marker must be present");
  }
  assert.ok(
    fs.existsSync(
      path.join(home, ".claude", "skills", "vkm-discipline", "domains", "web-search.md")
    ),
    "domain reference files must install alongside SKILL.md"
  );
  for (const rel of [
    ["references", "designer-mind.md"],
    ["references", "lineages.md"],
    ["references", "marks.md"],
    ["references", "contemporary.md"],
    ["references", "illustration.md"],
    ["references", "inspiration.md"],
    ["references", "craft-tech.md"],
    ["examples", "illustration-gallery.md"],
    ["scripts", "trace-svg.mjs"],
    ["scripts", "treat-photo.mjs"],
    ["modes", "generate.md"],
    ["scripts", "contrast.mjs"],
    ["scripts", "palette.mjs"],
    ["scripts", "audit-css.mjs"],
    ["scripts", "slop-check.mjs"],
    ["examples", "worked-example.md"]
  ]) {
    assert.ok(
      fs.existsSync(path.join(home, ".claude", "skills", "vkm-design", ...rel)),
      `vkm-design nested asset must install: ${rel.join("/")}`
    );
  }
  assert.ok(fs.existsSync(path.join(home, ".claude", "agents", "vkm-implementer.md")));
});

test("skill descriptions stay within Claude Code's always-in-context caps", async () => {
  // Descriptions are ALWAYS in context (hard cap 1536 chars; soft target ≤300).
  for (const { src } of skillAssetFiles(os.homedir(), { skills: true, agents: false })) {
    if (path.basename(src) !== "SKILL.md") continue; // domain reference files carry no description
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

test("installSkillsInto lands every skill in an arbitrary client dir; idempotent", async () => {
  // The Kimi Code / opencode compatibility path: no --ide, just a folder.
  const dir = path.join(tempHome(), "kimi", "skills");
  await installSkillsInto(dir, false);
  await installSkillsInto(dir, false);
  for (const name of SKILL_NAMES) {
    assert.ok(fs.existsSync(path.join(dir, name, "SKILL.md")), `${name} missing in ${dir}`);
  }
  assert.ok(
    fs.existsSync(path.join(dir, "vkm-ui-judge", "scripts", "ui-audit.mjs")),
    "bundled scripts must travel with the skill"
  );
  assert.ok(
    fs.existsSync(path.join(dir, "vkm-ui-judge", "scripts", "layout-checks.mjs")),
    "layout geometry gates must travel with ui-judge"
  );
});

test("installSkillsInto dry-run writes nothing", async () => {
  const dir = path.join(tempHome(), "other-agent-skills");
  await installSkillsInto(dir, true);
  assert.equal(fs.existsSync(dir), false);
});

test("configureSkillAssets kimi: skills + agent land under ~/.kimi-code", async () => {
  const home = tempHome();
  const prior = process.env.KIMI_CODE_HOME;
  delete process.env.KIMI_CODE_HOME;
  try {
    await configureSkillAssets(home, false, { ide: "kimi" });
    for (const name of SKILL_NAMES) {
      assert.ok(
        fs.existsSync(path.join(home, ".kimi-code", "skills", name, "SKILL.md")),
        `${name} missing under ~/.kimi-code/skills`
      );
    }
    const agentFp = path.join(home, ".kimi-code", "agents", "vkm-implementer.md");
    assert.ok(fs.existsSync(agentFp), "kimi agent template installed");
    const agent = fs.readFileSync(agentFp, "utf8");
    assert.match(agent, /^---\r?\nname: vkm-implementer\r?\n/, "frontmatter opens the file");
    assert.ok(!agent.includes("model: sonnet"), "no Claude-only frontmatter in the kimi variant");
    assert.ok(!fs.existsSync(path.join(home, ".claude")), "claude scope untouched");
    // Removal is symmetric and hash-guarded.
    await uninstallSkillAssets(home, false, { ide: "kimi" });
    assert.equal(fs.existsSync(agentFp), false, "uninstall removes the unmodified agent");
    assert.equal(
      fs.existsSync(path.join(home, ".kimi-code", "skills", "vkm-spec", "SKILL.md")),
      false,
      "uninstall removes unmodified skills"
    );
  } finally {
    if (prior === undefined) delete process.env.KIMI_CODE_HOME;
    else process.env.KIMI_CODE_HOME = prior;
  }
});
