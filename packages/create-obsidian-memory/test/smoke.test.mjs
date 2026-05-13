import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("dist bin exists", () => {
  assert.ok(existsSync(path.join(root, "dist", "index.js")));
});
