import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ragSrc = path.join(root, "packages", "obsidian-memory-rag", "src");
const cliBin = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.mjs");
const py = process.platform === "win32" ? "python" : "python3";

function indexedVault() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-compiler-cli-"));
  fs.mkdirSync(path.join(vault, ".obsidian"));
  fs.mkdirSync(path.join(vault, "PROJECTS"));
  fs.writeFileSync(path.join(vault, "PROJECTS", "demo.md"), "# demo\n- [decision] usar SQLite #db\n", "utf8");
  const env = { ...process.env, PYTHONPATH: ragSrc };
  const r = spawnSync(py, ["-m", "obsidian_memory_rag", "json-index", "--vault", vault], { encoding: "utf8", env });
  return r.status === 0 ? vault : null;
}

test("--help prints usage and exits 0 without touching any vault", () => {
  const r = spawnSync(process.execPath, [cliBin, "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Usage: obsidian-prompt/);
});

test("missing idea argument exits non-zero with a clear error", () => {
  const r = spawnSync(process.execPath, [cliBin, "--project", "demo"], { encoding: "utf8" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Falta la idea/);
});

test("--vault pointing nowhere with no env fallback fails clearly", () => {
  const r = spawnSync(process.execPath, [cliBin, "una idea cualquiera", "--yes", "--no-clipboard"], {
    encoding: "utf8",
    env: { ...process.env, BASIC_MEMORY_HOME: "", OBSIDIAN_MEMORY_VAULT: "" }
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Missing vault/);
});

test("end-to-end: --yes --no-clipboard --no-editor prints a complete, valid orchestration_package", (t) => {
  const vault = indexedVault();
  if (!vault) {
    t.skip("Python backend not runnable in this environment");
    return;
  }
  const r = spawnSync(
    process.execPath,
    [cliBin, "agregar autenticación JWT", "--project", "demo", "--yes", "--no-clipboard", "--no-editor"],
    { encoding: "utf8", env: { ...process.env, PYTHONPATH: ragSrc, BASIC_MEMORY_HOME: vault } }
  );
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /<orchestration_package>/);
  assert.match(r.stdout, /<\/orchestration_package>/);
  assert.match(r.stdout, /usar SQLite #db/);
  assert.match(r.stdout, /agregar autenticación JWT/);
  assert.match(r.stdout, /no se copió, solo se imprimió/);
});

test("end-to-end: --lang en switches the compiled prompt's language", (t) => {
  const vault = indexedVault();
  if (!vault) {
    t.skip("Python backend not runnable in this environment");
    return;
  }
  const r = spawnSync(
    process.execPath,
    [cliBin, "add JWT auth", "--project", "demo", "--lang", "en", "--yes", "--no-clipboard", "--no-editor"],
    { encoding: "utf8", env: { ...process.env, PYTHONPATH: ragSrc, BASIC_MEMORY_HOME: vault } }
  );
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /senior, precise, concise software engineer/);
});

test("end-to-end: an unrelated idea with no project still produces a complete package with fallback text", (t) => {
  const vault = indexedVault();
  if (!vault) {
    t.skip("Python backend not runnable in this environment");
    return;
  }
  const r = spawnSync(
    process.execPath,
    [cliBin, "zzz_unrelated_token_qqq", "--yes", "--no-clipboard", "--no-editor"],
    { encoding: "utf8", env: { ...process.env, PYTHONPATH: ragSrc, BASIC_MEMORY_HOME: vault } }
  );
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /No histórico registrado/);
});
