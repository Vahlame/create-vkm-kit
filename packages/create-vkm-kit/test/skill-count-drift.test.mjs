/**
 * Every shipped skill is named where the kit advertises them.
 *
 * `templates/skills/` held four directories while README.md's "what's inside" block named
 * three, a benchmark paragraph two sections below said "4 skills", and hero.svg's pill
 * said "3 skills" — three different answers on one page. `/vkm-research` had shipped for
 * releases without a mention in either README.
 *
 * Counting by hand does not survive a fifth skill, so this derives the list from the
 * directory that actually gets installed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SKILLS_DIR = path.join(ROOT, "packages", "create-vkm-kit", "templates", "skills");

/** The skills the installer actually copies into `~/.claude/skills/`. */
const SHIPPED = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

test("the skills directory is not empty (guards a broken fixture, not the product)", () => {
  assert.ok(SHIPPED.length >= 3, `expected the shipped skills, found ${SHIPPED.join(", ")}`);
});

for (const readme of ["README.md", "README.en.md"]) {
  test(`${readme} names every shipped skill`, () => {
    const text = readFileSync(path.join(ROOT, readme), "utf8");
    const missing = SHIPPED.filter((name) => !text.includes(`/${name}`));
    assert.deepEqual(
      missing,
      [],
      `these skills ship but are not mentioned in ${readme}: ${missing.join(", ")}`
    );
  });
}

test("hero.svg's skill-count pill matches reality", () => {
  const svg = readFileSync(path.join(ROOT, "docs", "assets", "hero.svg"), "utf8");
  const m = svg.match(/>(\d+) skills</);
  assert.ok(m, "hero.svg should carry a `<n> skills` pill");
  assert.equal(
    Number(m[1]),
    SHIPPED.length,
    `hero.svg says ${m[1]} skills; ${SHIPPED.length} ship (${SHIPPED.join(", ")})`
  );
});

test("the hero band title does not name a major version", () => {
  // It read "Suite de eficiencia 4.x", so the hero image of a 5.0 release would have
  // said 4.x on day one. An asset that has to be re-cut every major will not be.
  const svg = readFileSync(path.join(ROOT, "docs", "assets", "hero.svg"), "utf8");
  assert.doesNotMatch(
    svg,
    /Suite de eficiencia \d/,
    "drop the version from the band title so the asset survives a major"
  );
});
