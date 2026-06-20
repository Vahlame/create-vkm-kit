import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ragSrc = path.join(root, "packages", "obsidian-memory-rag", "src");
const py = process.platform === "win32" ? "python" : "python3";

function kgVault() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "kg-bridge-"));
  fs.mkdirSync(path.join(vault, ".obsidian"));
  fs.mkdirSync(path.join(vault, "docs"));
  fs.writeFileSync(
    path.join(vault, "docs", "adr-0023.md"),
    "# ADR-0023\n\n- implements [[adr-0014]]\n- [decision] typed KG layer #graph\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(vault, "docs", "adr-0014.md"),
    "# ADR-0014\nhybrid retrieval\n",
    "utf8"
  );
  return vault;
}

function rag(vault, args) {
  const env = { ...process.env, PYTHONPATH: ragSrc };
  const r = spawnSync(py, ["-m", "obsidian_memory_rag", ...args], { encoding: "utf8", env });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

test("json-relations bridges typed edges with resolved target paths", () => {
  const vault = kgVault();
  rag(vault, ["json-index", "--vault", vault]);
  const data = JSON.parse(
    rag(vault, [
      "json-relations",
      "--vault",
      vault,
      "adr-0023",
      "--direction",
      "out",
      "--no-auto-index"
    ])
  );
  const impl = data.relations.find((r) => r.relation_type === "implements");
  assert.ok(impl, "expected an implements relation");
  assert.equal(impl.target_path, "docs/adr-0014.md");
});

test("json-observations bridges category/tag filters", () => {
  const vault = kgVault();
  rag(vault, ["json-index", "--vault", vault]);
  const byCat = JSON.parse(
    rag(vault, ["json-observations", "--vault", vault, "--category", "decision", "--no-auto-index"])
  );
  assert.equal(byCat.count, 1);
  assert.match(byCat.observations[0].content, /typed KG layer/);

  const byTag = JSON.parse(
    rag(vault, ["json-observations", "--vault", vault, "--tag", "graph", "--no-auto-index"])
  );
  assert.equal(byTag.count, 1);
});

test("json-kg-suggest is read-only and reports existing structure", () => {
  const vault = kgVault();
  rag(vault, ["json-index", "--vault", vault]);
  const data = JSON.parse(
    rag(vault, ["json-kg-suggest", "--vault", vault, "adr-0023", "--no-auto-index"])
  );
  assert.equal(data.note, "docs/adr-0023.md");
  assert.ok(data.relations.some((r) => r.relation_type === "implements"));
  assert.ok(data.observations.some((o) => o.category === "decision"));
  assert.ok(typeof data.notice === "string");
});

test("json-memory-report bridges indices + hygiene + suggestions", () => {
  const vault = kgVault();
  rag(vault, ["json-index", "--vault", vault]);
  const rep = JSON.parse(rag(vault, ["json-memory-report", "--vault", vault, "--no-auto-index"]));
  assert.equal(rep.totals.notes, 2);
  assert.ok(rep.totals.observations >= 1);
  assert.ok(Array.isArray(rep.indices.observations_by_category));
  assert.ok(rep.indices.observations_by_category.some((c) => c.category === "decision"));
  assert.ok(Array.isArray(rep.suggested_actions) && rep.suggested_actions.length >= 1);
  assert.ok(typeof rep.notice === "string");
});
