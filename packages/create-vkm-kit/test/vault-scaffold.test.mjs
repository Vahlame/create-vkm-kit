/**
 * The starter vault a fresh install creates.
 *
 * The notes used to be ~206 lines of bilingual Markdown inside template literals in
 * index.js; they are now files under `templates/vault/{es,en}/`. Nothing pinned the
 * result either way, so this file is the parity check that the move preserved it —
 * and the guard that keeps the two languages from drifting into different trees.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findVault, scaffoldNewVault } from "../src/vault-scaffold.mjs";

/** Every note and marker file a scaffolded vault must contain, in either language. */
const EXPECTED = [
  ".gitignore",
  "MEMORY.md",
  "PRACTICES/confirmed-bad.md",
  "PRACTICES/confirmed-good.md",
  "PRACTICES/observations.md",
  "PROJECTS/.gitkeep",
  "RESEARCH/_index.md",
  "RULES/TEMPLATE.md",
  "SESSION_LOG.md",
  "STACKS/.gitkeep",
  "START_HERE.md",
  "_meta/agent-profiles.md"
];

function tmpVault(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

for (const lang of /** @type {const} */ (["es", "en"])) {
  test(`scaffoldNewVault(${lang}) writes the whole starter tree`, async () => {
    const vault = tmpVault(`vkm-scaffold-${lang}-`);
    await scaffoldNewVault(vault, lang, false);

    for (const rel of EXPECTED) {
      assert.ok(fs.existsSync(path.join(vault, rel)), `missing ${rel}`);
    }
    assert.ok(fs.existsSync(path.join(vault, ".obsidian")), "the vault marker directory");
    assert.ok(
      fs.existsSync(path.join(vault, ".vscode", "settings.json")),
      "workspace git settings"
    );
    assert.equal(
      fs.readFileSync(path.join(vault, ".gitignore"), "utf8"),
      ".obsidian-memory-rag/\n",
      "the derived index must stay out of the user's git history"
    );
  });
}

test("both languages ship the same tree — no note exists in only one", async () => {
  const es = tmpVault("vkm-scaffold-parity-es-");
  const en = tmpVault("vkm-scaffold-parity-en-");
  await scaffoldNewVault(es, "es", false);
  await scaffoldNewVault(en, "en", false);

  /** Relative paths of every file under `root`, excluding generated dirs. */
  const treeOf = (root) => {
    /** @type {string[]} */
    const out = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === ".obsidian" || e.name === ".vscode") continue;
        const fp = path.join(dir, e.name);
        if (e.isDirectory()) walk(fp);
        else out.push(path.relative(root, fp).split(path.sep).join("/"));
      }
    };
    walk(root);
    return out.sort();
  };

  assert.deepEqual(treeOf(es), treeOf(en));
});

test("the notes are Spanish in es and English in en", async () => {
  const es = tmpVault("vkm-scaffold-lang-es-");
  const en = tmpVault("vkm-scaffold-lang-en-");
  await scaffoldNewVault(es, "es", false);
  await scaffoldNewVault(en, "en", false);

  assert.match(fs.readFileSync(path.join(es, "MEMORY.md"), "utf8"), /Memoria global/);
  assert.match(fs.readFileSync(path.join(en, "MEMORY.md"), "utf8"), /Global memory/);
  // START_HERE is the note the rules tell every agent to open first, so its wikilink
  // hub is what keeps new notes reachable — a broken hub silently degrades recall.
  for (const vault of [es, en]) {
    const start = fs.readFileSync(path.join(vault, "START_HERE.md"), "utf8");
    assert.match(start, /\[\[MEMORY\]\]/);
    assert.match(start, /\[\[RESEARCH\/_index\|RESEARCH\]\]/);
  }
});

test("--dry-run writes nothing at all", async () => {
  const vault = tmpVault("vkm-scaffold-dry-");
  await scaffoldNewVault(vault, "es", true);
  assert.deepEqual(
    fs.readdirSync(vault),
    [],
    "dry-run created files — this is the defect the guard inside scaffoldNewVault exists to prevent"
  );
});

test("scaffolding never clobbers a note the user already has", async () => {
  const vault = tmpVault("vkm-scaffold-keep-");
  fs.writeFileSync(path.join(vault, "MEMORY.md"), "# mine\n", "utf8");
  await scaffoldNewVault(vault, "es", false);
  assert.equal(
    fs.readFileSync(path.join(vault, "MEMORY.md"), "utf8"),
    "# mine\n",
    "an existing note in a directory without .obsidian must survive"
  );
  assert.ok(fs.existsSync(path.join(vault, "START_HERE.md")), "the rest still lands");
});

test("findVault stops after six levels and falls back to ~/Documents", async () => {
  const home = tmpVault("vkm-findvault-home-");
  const documents = path.join(home, "Documents");
  fs.mkdirSync(path.join(documents, ".obsidian"), { recursive: true });

  // Seven levels deep: past the bound, so the walk must not reach the marker.
  const deep = path.join(home, "a", "b", "c", "d", "e", "f", "g");
  fs.mkdirSync(deep, { recursive: true });
  fs.mkdirSync(path.join(home, ".obsidian"), { recursive: true });
  assert.equal(
    await findVault(deep, home),
    documents,
    "the six-level bound must stop an unbounded walk from adopting a distant ancestor"
  );

  const near = path.join(home, "a", "b");
  assert.equal(await findVault(near, home), home, "within the bound, the ancestor wins");
});
