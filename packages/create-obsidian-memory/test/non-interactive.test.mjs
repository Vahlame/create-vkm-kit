import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "dist", "index.js");

test("non-interactive --dry-run exits 0 and prints dry-run", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "com-ni-"));
  fs.mkdirSync(path.join(vault, ".obsidian"));
  const r = spawnSync(process.execPath, [bin, "--non-interactive", "--vault", vault, "--dry-run"], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /\[dry-run\]/);
});

test("non-interactive without --vault exits 2", () => {
  const r = spawnSync(process.execPath, [bin, "--non-interactive", "--no-cursor-mcp", "--no-git-init"], {
    encoding: "utf8",
  });
  assert.equal(r.status, 2);
});
