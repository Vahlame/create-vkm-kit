import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("shim package identity: old npm name, forwarding bin, no feature surface", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.name, "@vkmikc/create-obsidian-memory");
  assert.deepEqual(Object.keys(pkg.bin), ["create-obsidian-memory"]);
  const src = fs.readFileSync(path.join(root, "src", "index.js"), "utf8");
  assert.match(src, /@vkmikc\/create-vkm-kit@latest/);
  assert.match(src, /process\.argv\.slice\(2\)/); // full argv forwarded
});
