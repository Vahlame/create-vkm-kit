import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installManagedAssets, removeManagedAssets } from "../src/asset-install.mjs";

/** Fresh sandbox per test: a fake package template dir + a fake ~/.claude profile. */
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "asset-install-test-"));
  const srcDir = path.join(root, "templates");
  const destDir = path.join(root, "claude");
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, "vkm-terse.md"), "terse style body\n");
  fs.writeFileSync(path.join(srcDir, "SKILL.md"), "skill body\n");
  const files = [
    {
      src: path.join(srcDir, "vkm-terse.md"),
      dest: path.join(destDir, "output-styles", "vkm-terse.md")
    },
    {
      src: path.join(srcDir, "SKILL.md"),
      dest: path.join(destDir, "skills", "vkm-discipline", "SKILL.md")
    }
  ];
  return { root, files, sidecarFp: path.join(destDir, "vkm-kit.assets.json") };
}

test("install copies files, creates parents and records hashes in the sidecar", async () => {
  const { files, sidecarFp } = sandbox();
  const { installed } = await installManagedAssets({ files, sidecarFp });
  assert.deepEqual(
    installed,
    files.map((f) => f.dest)
  );
  for (const { dest } of files) assert.ok(fs.existsSync(dest));
  const manifest = JSON.parse(fs.readFileSync(sidecarFp, "utf8"));
  for (const { dest } of files) {
    assert.match(manifest.assets[dest].hash, /^[0-9a-f]{64}$/);
  }
});

test("reinstall is idempotent (same files, same manifest keys)", async () => {
  const { files, sidecarFp } = sandbox();
  await installManagedAssets({ files, sidecarFp });
  await installManagedAssets({ files, sidecarFp });
  const manifest = JSON.parse(fs.readFileSync(sidecarFp, "utf8"));
  assert.equal(Object.keys(manifest.assets).length, files.length);
});

test("remove deletes unmodified files and the emptied sidecar (no trace)", async () => {
  const { files, sidecarFp } = sandbox();
  await installManagedAssets({ files, sidecarFp });
  const { removed, skipped } = await removeManagedAssets({ sidecarFp });
  assert.deepEqual(removed.sort(), files.map((f) => f.dest).sort());
  assert.deepEqual(skipped, []);
  for (const { dest } of files) assert.equal(fs.existsSync(dest), false);
  assert.equal(fs.existsSync(sidecarFp), false);
});

test("remove SKIPS a user-modified file but releases its manifest claim", async () => {
  const { files, sidecarFp } = sandbox();
  await installManagedAssets({ files, sidecarFp });
  fs.writeFileSync(files[0].dest, "user customized this\n");
  const { removed, skipped } = await removeManagedAssets({ sidecarFp });
  assert.deepEqual(skipped, [files[0].dest]);
  assert.ok(fs.existsSync(files[0].dest)); // the user's edit survives
  assert.deepEqual(removed, [files[1].dest]);
  assert.equal(fs.existsSync(sidecarFp), false); // claim released either way
});

test("remove narrowed to dests leaves other recorded assets in place", async () => {
  const { files, sidecarFp } = sandbox();
  await installManagedAssets({ files, sidecarFp });
  const { removed } = await removeManagedAssets({ sidecarFp, dests: [files[0].dest] });
  assert.deepEqual(removed, [files[0].dest]);
  assert.ok(fs.existsSync(files[1].dest));
  const manifest = JSON.parse(fs.readFileSync(sidecarFp, "utf8"));
  assert.deepEqual(Object.keys(manifest.assets), [files[1].dest]);
});

test("dry-run plans without writing anything", async () => {
  const { files, sidecarFp } = sandbox();
  const plan = await installManagedAssets({ files, sidecarFp, dryRun: true });
  assert.deepEqual(
    plan.installed,
    files.map((f) => f.dest)
  );
  assert.equal(fs.existsSync(sidecarFp), false);
  for (const { dest } of files) assert.equal(fs.existsSync(dest), false);

  await installManagedAssets({ files, sidecarFp });
  const before = fs.readFileSync(sidecarFp, "utf8");
  const removal = await removeManagedAssets({ sidecarFp, dryRun: true });
  assert.equal(removal.removed.length, files.length);
  assert.equal(fs.readFileSync(sidecarFp, "utf8"), before); // untouched
  for (const { dest } of files) assert.ok(fs.existsSync(dest));
});

test("corrupt sidecar degrades to an empty manifest instead of crashing", async () => {
  const { files, sidecarFp } = sandbox();
  fs.mkdirSync(path.dirname(sidecarFp), { recursive: true });
  fs.writeFileSync(sidecarFp, "{not json");
  const { installed } = await installManagedAssets({ files, sidecarFp });
  assert.equal(installed.length, files.length);
  const manifest = JSON.parse(fs.readFileSync(sidecarFp, "utf8"));
  assert.equal(Object.keys(manifest.assets).length, files.length);
});
