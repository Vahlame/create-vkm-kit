import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintForWrite } from "../src/vault-lint.mjs";
import { vaultAppendFile, vaultEditFile, vaultWriteFile } from "../src/vault-fs.mjs";

async function setupVault() {
  const root = await mkdtemp(join(tmpdir(), "vault-lint-"));
  await writeFile(join(root, "MEMORY.md"), "# MEMORY\n");
  await mkdir(join(root, "PROJECTS"));
  await writeFile(join(root, "PROJECTS", "alpha.md"), "# alpha\n");
  return root;
}

test("lintForWrite: canonical lowercase categories and resolvable links are clean", async () => {
  const vault = await setupVault();
  try {
    const warnings = await lintForWrite(vault, "PROJECTS/alpha.md", [
      "- [decision] use X because Y #arch\n- see [[MEMORY]] and [[PROJECTS/alpha]]\n"
    ]);
    assert.deepEqual(warnings, []);
  } finally {
    await rm(vault, { recursive: true });
  }
});

test("lintForWrite: uppercase canonical category → lowercase suggestion", async () => {
  const vault = await setupVault();
  try {
    const warnings = await lintForWrite(vault, "n.md", ["- [DECISION] shouty\n"]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /"\[DECISION\]" — write it lowercase as "\[decision\]"/);
  } finally {
    await rm(vault, { recursive: true });
  }
});

test("lintForWrite: Spanish/accented aliases map to the canonical category", async () => {
  const vault = await setupVault();
  try {
    const warnings = await lintForWrite(vault, "n.md", [
      "- [DECISIÓN] drift real\n- [LECCIÓN GENERAL] otra\n- **[LECCIÓN] bolded variant\n"
    ]);
    assert.equal(warnings.length, 3);
    assert.match(warnings[0], /use "\[decision\]"/);
    assert.match(warnings[1], /use "\[lesson\]"/);
    assert.match(warnings[2], /use "\[lesson\]"/);
  } finally {
    await rm(vault, { recursive: true });
  }
});

test("lintForWrite: unknown wordish category flagged; checkboxes/dates/versions ignored", async () => {
  const vault = await setupVault();
  try {
    const warnings = await lintForWrite(vault, "n.md", [
      "- [vibes] not a thing\n- [ ] open task\n- [x] done task\n- [2026-07-12] date\n- [v1.2.3] version\n"
    ]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /unknown observation category "\[vibes\]"/);
    assert.match(warnings[0], /observationCategories/);
  } finally {
    await rm(vault, { recursive: true });
  }
});

test("lintForWrite: memory-schema.json observationCategories extends the canonical set", async () => {
  const vault = await setupVault();
  try {
    await writeFile(
      join(vault, "memory-schema.json"),
      JSON.stringify({ observationCategories: ["vibes"] })
    );
    const warnings = await lintForWrite(vault, "n.md", ["- [vibes] now allowed\n"]);
    assert.deepEqual(warnings, []);
  } finally {
    await rm(vault, { recursive: true });
  }
});

test("lintForWrite: unresolved wikilink warns; alias/heading/basename forms resolve", async () => {
  const vault = await setupVault();
  try {
    const warnings = await lintForWrite(vault, "n.md", [
      "see [[ghost-note]] and [[alpha|the project]] and [[MEMORY#section]]\n"
    ]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /\[\[ghost-note\]\] does not resolve/);
  } finally {
    await rm(vault, { recursive: true });
  }
});

test("lintForWrite: template placeholders and self-references are exempt", async () => {
  const vault = await setupVault();
  try {
    const warnings = await lintForWrite(
      vault,
      "PROJECTS/brand-new.md",
      ["part_of [[PROJECTS/<proyecto>]] y self [[brand-new]]\n"],
      { newNote: true }
    );
    // Placeholder skipped, self-link resolves even though the file isn't on disk yet.
    assert.deepEqual(warnings, []);
  } finally {
    await rm(vault, { recursive: true });
  }
});

test("lintForWrite: new knowledge note without links warns (orphan at birth)", async () => {
  const vault = await setupVault();
  try {
    const orphan = await lintForWrite(
      vault,
      "STACKS/newtech.md",
      ["# newtech\n\nverdict: unknown\n"],
      {
        newNote: true
      }
    );
    assert.equal(orphan.length, 1);
    assert.match(orphan[0], /new note has no \[\[wikilinks\]\]/);

    // Linked new note: clean. Existing note (newNote false): clean.
    const linked = await lintForWrite(
      vault,
      "STACKS/newtech.md",
      ["# newtech\n\n- used_by [[PROJECTS/alpha]]\n"],
      { newNote: true }
    );
    assert.deepEqual(linked, []);
    const existing = await lintForWrite(vault, "STACKS/newtech.md", ["# newtech\n"], {
      newNote: false
    });
    assert.deepEqual(existing, []);
    // Templates and non-knowledge dirs are exempt.
    const tmpl = await lintForWrite(vault, "STACKS/TEMPLATE.md", ["# t\n"], { newNote: true });
    assert.deepEqual(tmpl, []);
    const meta = await lintForWrite(vault, "_meta/notes.md", ["# m\n"], { newNote: true });
    assert.deepEqual(meta, []);
  } finally {
    await rm(vault, { recursive: true });
  }
});

test("lintForWrite: non-markdown paths are skipped entirely", async () => {
  const vault = await setupVault();
  try {
    const warnings = await lintForWrite(vault, "assets/data.json", ['{"a": "[DECISIÓN]"}'], {
      newNote: true
    });
    assert.deepEqual(warnings, []);
  } finally {
    await rm(vault, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Integration through the write paths (vault-fs)
// ---------------------------------------------------------------------------

test("vaultWriteFile: surfaces lint warnings but writes anyway (warn, never block)", async () => {
  const vault = await setupVault();
  try {
    const res = await vaultWriteFile(
      vault,
      "STACKS/newtech.md",
      "- [DECISIÓN] drift\n- see [[ghost]]\n"
    );
    assert.ok(Array.isArray(res.warnings));
    assert.equal(res.warnings.length, 2);
    assert.match(res.warnings[0], /use "\[decision\]"/);
    assert.match(res.warnings[1], /\[\[ghost\]\] does not resolve/);
    // The write itself succeeded — lint warns, never blocks.
    assert.match(await readFile(join(vault, "STACKS", "newtech.md"), "utf8"), /DECISIÓN/);
  } finally {
    await rm(vault, { recursive: true });
  }
});

test("vaultEditFile: lints only the newText, not pre-existing offending lines", async () => {
  const vault = await setupVault();
  try {
    await writeFile(
      join(vault, "PROJECTS", "alpha.md"),
      "# alpha\n\n- [DECISIÓN] pre-existing drift\n\nfooter\n"
    );
    // Edit an unrelated line: the old [DECISIÓN] must NOT be flagged.
    const clean = await vaultEditFile(vault, "PROJECTS/alpha.md", [
      { oldText: "footer", newText: "footer v2" }
    ]);
    assert.equal(clean.warnings, undefined);
    // Edit that INTRODUCES a bad category: flagged.
    const flagged = await vaultEditFile(vault, "PROJECTS/alpha.md", [
      { oldText: "footer v2", newText: "footer v2\n- [LECCIÓN] nueva línea" }
    ]);
    assert.equal(flagged.warnings.length, 1);
    assert.match(flagged.warnings[0], /use "\[lesson\]"/);
  } finally {
    await rm(vault, { recursive: true });
  }
});

test("vaultAppendFile: lints the appended chunk only", async () => {
  const vault = await setupVault();
  try {
    await writeFile(join(vault, "SESSION_LOG.md"), "- [DECISIÓN] old drift untouched\n");
    const clean = await vaultAppendFile(vault, "SESSION_LOG.md", "- **2026-07-12 — ok** #tag");
    assert.equal(clean.warnings, undefined);
    const flagged = await vaultAppendFile(vault, "SESSION_LOG.md", "- [REGLA] appended drift");
    assert.equal(flagged.warnings.length, 1);
    assert.match(flagged.warnings[0], /use "\[decision\]"/);
  } finally {
    await rm(vault, { recursive: true });
  }
});
