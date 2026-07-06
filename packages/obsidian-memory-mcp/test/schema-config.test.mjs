import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSchemaConfig, validateFrontmatter } from "../src/schema-config.mjs";
import { vaultEditFile, vaultWriteFile } from "../src/vault-fs.mjs";

const CONFIG = {
  folders: {
    PROJECTS: { required: ["title", "type", "tags"] },
    "*": { required: ["title"] }
  }
};

async function setupVault(config) {
  const root = await mkdtemp(join(tmpdir(), "vault-schema-"));
  if (config !== undefined) {
    await writeFile(
      join(root, "memory-schema.json"),
      typeof config === "string" ? config : JSON.stringify(config)
    );
  }
  return root;
}

test("validateFrontmatter: folder rule, wildcard fallback, non-md skipped", () => {
  const ok = "---\ntitle: X\ntype: project\ntags: [a]\n---\nbody";
  assert.deepEqual(validateFrontmatter("PROJECTS/x.md", ok, CONFIG), []);
  assert.deepEqual(validateFrontmatter("PROJECTS/x.md", "---\ntitle: X\n---\n", CONFIG), [
    "type",
    "tags"
  ]);
  // Root note falls back to "*" (title only).
  assert.deepEqual(validateFrontmatter("MEMORY.md", "no frontmatter at all", CONFIG), ["title"]);
  assert.deepEqual(validateFrontmatter("MEMORY.md", "---\ntitle: y\n---\n", CONFIG), []);
  // Non-markdown files are never validated.
  assert.deepEqual(validateFrontmatter("assets/img.png", "binary", CONFIG), []);
});

test("no config file → writes are unaffected", async () => {
  const vault = await setupVault(undefined);
  try {
    const res = await vaultWriteFile(vault, "PROJECTS/x.md", "no frontmatter");
    assert.equal(res.warnings, undefined);
  } finally {
    await rm(vault, { recursive: true });
  }
});

test("warn mode: violating write lands but carries warnings", async () => {
  const vault = await setupVault(CONFIG);
  try {
    const res = await vaultWriteFile(vault, "PROJECTS/x.md", "---\ntitle: X\n---\nbody");
    assert.equal(res.warnings.length, 1);
    assert.match(res.warnings[0], /missing required key\(s\): type, tags/);
    // File landed despite the warning.
    assert.match(await readFile(join(vault, "PROJECTS", "x.md"), "utf8"), /body/);
  } finally {
    await rm(vault, { recursive: true });
  }
});

test("enforce mode: violating write throws and file is not created", async () => {
  const vault = await setupVault({ ...CONFIG, enforce: true });
  try {
    await assert.rejects(
      () => vaultWriteFile(vault, "PROJECTS/x.md", "no frontmatter"),
      /schema violation: frontmatter missing required key/
    );
    await assert.rejects(() => readFile(join(vault, "PROJECTS", "x.md"), "utf8"), {
      code: "ENOENT"
    });
    // A compliant write goes through.
    const res = await vaultWriteFile(
      vault,
      "PROJECTS/x.md",
      "---\ntitle: X\ntype: t\ntags: [a]\n---\nok"
    );
    assert.equal(res.warnings, undefined);
  } finally {
    await rm(vault, { recursive: true });
  }
});

test("enforce mode: an edit that strips a required key is rejected, file untouched", async () => {
  const vault = await setupVault({ ...CONFIG, enforce: true });
  try {
    const before = "---\ntitle: X\ntype: t\ntags: [a]\n---\nok";
    await vaultWriteFile(vault, "PROJECTS/x.md", before);
    await assert.rejects(
      () => vaultEditFile(vault, "PROJECTS/x.md", [{ oldText: "type: t\n", newText: "" }]),
      /schema violation/
    );
    assert.equal(await readFile(join(vault, "PROJECTS", "x.md"), "utf8"), before);
  } finally {
    await rm(vault, { recursive: true });
  }
});

test("malformed config: ignored but surfaced as a warning on writes", async () => {
  const vault = await setupVault("not json {{");
  try {
    const res = await vaultWriteFile(vault, "PROJECTS/x.md", "anything");
    assert.equal(res.warnings.length, 1);
    assert.match(res.warnings[0], /memory-schema\.json: invalid JSON — ignored/);
  } finally {
    await rm(vault, { recursive: true });
  }
});

test("loadSchemaConfig: mtime cache serves the same object until the file changes", async () => {
  const vault = await setupVault(CONFIG);
  try {
    const a = await loadSchemaConfig(vault);
    const b = await loadSchemaConfig(vault);
    assert.equal(a, b); // cache hit — identical result object
    // Rewrite with a different mtime → fresh parse.
    await new Promise((r) => setTimeout(r, 10));
    await writeFile(
      join(vault, "memory-schema.json"),
      JSON.stringify({ folders: { "*": { required: [] } } })
    );
    const c = await loadSchemaConfig(vault);
    assert.notEqual(a, c);
  } finally {
    await rm(vault, { recursive: true });
  }
});
