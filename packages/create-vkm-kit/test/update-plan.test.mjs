import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  UPDATE_STATES,
  APPLY_BY_DEFAULT,
  classifyAsset,
  buildUpdatePlan,
  summarizePlan,
  applyUpdatePlan,
  readKitVersion
} from "../src/update-plan.mjs";

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function entryFor(plan, basename) {
  const found = plan.entries.find((e) => path.basename(e.dest) === basename);
  assert.ok(found, `expected an entry for ${basename}`);
  return found;
}

/**
 * One fixture that deliberately exercises every UPDATE_STATES member at once:
 *  - unchanged.md: disk === recorded === template
 *  - update.md:    disk === recorded, template changed (kit-only change)
 *  - local.md:     disk changed, template === recorded (user-only change)
 *  - conflict.md:  disk changed AND template changed (both sides)
 *  - new.md:       no record, no disk file
 *  - missing.md:   recorded, but disk file gone
 *  - untracked.md: disk file present, never recorded (not ours)
 *  - orphan.md / orphan-modified.md: recorded in the sidecar but NOT shipped anymore
 *    (absent from `files`) — the modified one must survive an apply.
 */
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "update-plan-test-"));
  const templatesDir = path.join(root, "templates");
  const claudeDir = path.join(root, "claude");
  fs.mkdirSync(templatesDir, { recursive: true });
  fs.mkdirSync(claudeDir, { recursive: true });
  const sidecarFp = path.join(claudeDir, "vkm-kit.assets.json");

  const templateContent = {
    "unchanged.md": "same content\n",
    "update.md": "update v2\n",
    "local.md": "local v1\n", // unchanged from what was recorded
    "conflict.md": "conflict v2\n",
    "new.md": "new v2\n",
    "missing.md": "missing v2\n",
    "untracked.md": "untracked v2\n"
  };
  for (const [name, content] of Object.entries(templateContent)) {
    fs.writeFileSync(path.join(templatesDir, name), content);
  }
  const files = Object.keys(templateContent).map((name) => ({
    src: path.join(templatesDir, name),
    dest: path.join(claudeDir, name)
  }));

  const diskContent = {
    "unchanged.md": "same content\n",
    "update.md": "update v1\n",
    "local.md": "local v1 EDITED\n",
    "conflict.md": "conflict v1 EDITED\n",
    "untracked.md": "pre-existing unrelated file\n",
    "orphan.md": "orphan content\n",
    "orphan-modified.md": "orphan-modified EDITED\n"
    // new.md, missing.md: intentionally absent from disk
  };
  for (const [name, content] of Object.entries(diskContent)) {
    fs.writeFileSync(path.join(claudeDir, name), content);
  }

  const recorded = {
    "unchanged.md": "same content\n",
    "update.md": "update v1\n",
    "local.md": "local v1\n",
    "conflict.md": "conflict v1\n",
    "missing.md": "missing v1\n",
    "orphan.md": "orphan content\n",
    "orphan-modified.md": "orphan-modified original\n"
    // new.md, untracked.md: intentionally never recorded
  };
  const assets = {};
  for (const [name, content] of Object.entries(recorded)) {
    assets[path.join(claudeDir, name)] = {
      hash: sha256(content),
      installedAt: "2020-01-01T00:00:00.000Z"
    };
  }
  fs.writeFileSync(sidecarFp, JSON.stringify({ version: 1, assets }, null, 2));

  return { root, templatesDir, claudeDir, sidecarFp, files };
}

// ---------------------------------------------------------------------------
// classifyAsset: table-driven, one case per decision-table branch (9 branches;
// "untracked" is reachable via two distinct branches).
// ---------------------------------------------------------------------------

test("classifyAsset covers every decision-table branch", () => {
  const cases = [
    {
      name: "both template and recorded absent -> untracked",
      hashes: { templateHash: null, recordedHash: null, diskHash: null },
      expected: "untracked"
    },
    {
      name: "template absent, recorded present -> orphan",
      hashes: { templateHash: null, recordedHash: "rh", diskHash: null },
      expected: "orphan"
    },
    {
      name: "template absent, recorded present, disk present -> orphan",
      hashes: { templateHash: null, recordedHash: "rh", diskHash: "dh" },
      expected: "orphan"
    },
    {
      name: "template present, nothing recorded, nothing on disk -> new",
      hashes: { templateHash: "th", recordedHash: null, diskHash: null },
      expected: "new"
    },
    {
      name: "template present, never recorded, disk present -> untracked",
      hashes: { templateHash: "th", recordedHash: null, diskHash: "dh" },
      expected: "untracked"
    },
    {
      name: "recorded present, disk absent -> missing",
      hashes: { templateHash: "th", recordedHash: "rh", diskHash: null },
      expected: "missing"
    },
    {
      name: "disk === recorded === template -> unchanged",
      hashes: { templateHash: "rh", recordedHash: "rh", diskHash: "rh" },
      expected: "unchanged"
    },
    {
      name: "disk === recorded, template changed -> update",
      hashes: { templateHash: "th", recordedHash: "rh", diskHash: "rh" },
      expected: "update"
    },
    {
      name: "disk changed, template === recorded -> local-only",
      hashes: { templateHash: "rh", recordedHash: "rh", diskHash: "dh" },
      expected: "local-only"
    },
    {
      name: "disk changed and template changed -> conflict",
      hashes: { templateHash: "th", recordedHash: "rh", diskHash: "dh" },
      expected: "conflict"
    }
  ];
  for (const { name, hashes, expected } of cases) {
    assert.equal(classifyAsset(hashes), expected, name);
  }
  // Every published state is exercised by the table above.
  const covered = new Set(cases.map((c) => c.expected));
  for (const state of UPDATE_STATES) assert.ok(covered.has(state), `${state} not covered`);
});

// ---------------------------------------------------------------------------
// buildUpdatePlan
// ---------------------------------------------------------------------------

test("buildUpdatePlan classifies every state from one fixture, including orphans", async () => {
  const { root, claudeDir, sidecarFp, files } = makeFixture();
  const plan = await buildUpdatePlan({ home: root, files, sidecarFp });

  assert.equal(entryFor(plan, "unchanged.md").state, "unchanged");
  assert.equal(entryFor(plan, "update.md").state, "update");
  assert.equal(entryFor(plan, "local.md").state, "local-only");
  assert.equal(entryFor(plan, "conflict.md").state, "conflict");
  assert.equal(entryFor(plan, "new.md").state, "new");
  assert.equal(entryFor(plan, "missing.md").state, "missing");
  assert.equal(entryFor(plan, "untracked.md").state, "untracked");

  const orphan = entryFor(plan, "orphan.md");
  assert.equal(orphan.state, "orphan");
  assert.equal(orphan.src, null); // sidecar-only entry: no template to point at
  assert.equal(orphan.dest, path.join(claudeDir, "orphan.md"));
  const orphanModified = entryFor(plan, "orphan-modified.md");
  assert.equal(orphanModified.state, "orphan");

  assert.equal(plan.counts.unchanged, 1);
  assert.equal(plan.counts.update, 1);
  assert.equal(plan.counts["local-only"], 1);
  assert.equal(plan.counts.conflict, 1);
  assert.equal(plan.counts.new, 1);
  assert.equal(plan.counts.missing, 1);
  assert.equal(plan.counts.untracked, 1);
  assert.equal(plan.counts.orphan, 2);
  assert.equal(plan.entries.length, files.length + 2); // + the two orphan-only entries

  assert.equal(plan.recordedKitVersion, null); // legacy sidecar, no kitVersion key
});

test("corrupt sidecar JSON degrades to an empty manifest instead of throwing", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "update-plan-corrupt-"));
  const templatesDir = path.join(root, "templates");
  const claudeDir = path.join(root, "claude");
  fs.mkdirSync(templatesDir, { recursive: true });
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(path.join(templatesDir, "a.md"), "a v2\n");
  const sidecarFp = path.join(claudeDir, "vkm-kit.assets.json");
  fs.writeFileSync(sidecarFp, "{not json");

  const files = [{ src: path.join(templatesDir, "a.md"), dest: path.join(claudeDir, "a.md") }];
  const plan = await buildUpdatePlan({ home: root, files, sidecarFp });
  assert.equal(plan.entries.length, 1);
  assert.equal(plan.entries[0].state, "new"); // empty manifest -> nothing recorded
  assert.equal(plan.recordedKitVersion, null);
});

test("summarizePlan never lists unchanged files, only their count", async () => {
  const { root, sidecarFp, files } = makeFixture();
  const plan = await buildUpdatePlan({ home: root, files, sidecarFp });
  const summary = summarizePlan(plan);
  assert.match(summary, /^unchanged: 1$/m);
  assert.doesNotMatch(summary, /unchanged\.md/);
  assert.match(summary, /update: 1/);
  assert.match(summary, /update\.md/);
  assert.match(summary, /conflict: 1/);
  assert.match(summary, /orphan: 2/);
});

// ---------------------------------------------------------------------------
// applyUpdatePlan
// ---------------------------------------------------------------------------

test("applyUpdatePlan writes exactly APPLY_BY_DEFAULT, keeps a conflict byte-identical, drops an unmodified orphan, and stamps kitVersion", async () => {
  const { root, claudeDir, sidecarFp, files } = makeFixture();
  const plan = await buildUpdatePlan({ home: root, files, sidecarFp });
  const conflictDest = path.join(claudeDir, "conflict.md");
  const conflictBytesBefore = fs.readFileSync(conflictDest);

  const { applied, skipped, removed } = await applyUpdatePlan({ plan, sidecarFp });

  const appliedBasenames = applied.map((d) => path.basename(d)).sort();
  assert.deepEqual(appliedBasenames, ["missing.md", "new.md", "update.md"]);
  for (const dest of applied) {
    const state = entryFor(plan, path.basename(dest)).state;
    assert.ok(APPLY_BY_DEFAULT.has(state));
  }

  assert.ok(skipped.some((s) => s.dest === conflictDest && s.state === "conflict"));
  assert.deepEqual(fs.readFileSync(conflictDest), conflictBytesBefore); // byte-identical

  assert.deepEqual(removed, [path.join(claudeDir, "orphan.md")]);
  assert.ok(fs.existsSync(path.join(claudeDir, "orphan-modified.md"))); // modified orphan survives
  assert.equal(
    fs.readFileSync(path.join(claudeDir, "orphan-modified.md"), "utf8"),
    "orphan-modified EDITED\n"
  );

  assert.equal(fs.readFileSync(path.join(claudeDir, "update.md"), "utf8"), "update v2\n");
  assert.equal(fs.readFileSync(path.join(claudeDir, "missing.md"), "utf8"), "missing v2\n");
  assert.equal(fs.readFileSync(path.join(claudeDir, "new.md"), "utf8"), "new v2\n");
  // never-applied states stay untouched
  assert.equal(fs.readFileSync(path.join(claudeDir, "local.md"), "utf8"), "local v1 EDITED\n");
  assert.equal(
    fs.readFileSync(path.join(claudeDir, "untracked.md"), "utf8"),
    "pre-existing unrelated file\n"
  );

  const manifest = JSON.parse(fs.readFileSync(sidecarFp, "utf8"));
  assert.equal(manifest.kitVersion, readKitVersion());
  assert.equal(manifest.assets[path.join(claudeDir, "orphan.md")], undefined);
  assert.ok(manifest.assets[path.join(claudeDir, "orphan-modified.md")]); // claim kept, file kept
});

test("applyUpdatePlan with force:true overwrites a conflict", async () => {
  const { root, claudeDir, sidecarFp, files } = makeFixture();
  const plan = await buildUpdatePlan({ home: root, files, sidecarFp });
  const conflictDest = path.join(claudeDir, "conflict.md");

  const { applied, skipped } = await applyUpdatePlan({ plan, sidecarFp, force: true });

  assert.ok(applied.includes(conflictDest));
  assert.ok(!skipped.some((s) => s.dest === conflictDest));
  assert.equal(fs.readFileSync(conflictDest, "utf8"), "conflict v2\n");
});

// Regression: --force used to reach "conflict" ONLY, so a file the user edited that the kit
// had NOT since changed (local-only — the common case, since any given file changes rarely)
// silently survived a run the user explicitly asked to discard their edits. A no-op that
// reports success is worse than an error. Both forcible states are pinned here.
test("applyUpdatePlan with force:true also resets a local-only edit, not just a conflict", async () => {
  const { root, claudeDir, sidecarFp, files } = makeFixture();
  const plan = await buildUpdatePlan({ home: root, files, sidecarFp });
  const localDest = path.join(claudeDir, "local.md");
  assert.equal(entryFor(plan, "local.md").state, "local-only", "fixture precondition");

  const { applied, skipped } = await applyUpdatePlan({ plan, sidecarFp, force: true });

  assert.ok(applied.includes(localDest), "force must reach local-only");
  assert.ok(!skipped.some((s) => s.dest === localDest));
  assert.equal(fs.readFileSync(localDest, "utf8"), "local v1\n", "reset to the shipped bytes");
});

test("applyUpdatePlan without force leaves BOTH local-only and conflict untouched", async () => {
  const { root, claudeDir, sidecarFp, files } = makeFixture();
  const plan = await buildUpdatePlan({ home: root, files, sidecarFp });

  const { skipped } = await applyUpdatePlan({ plan, sidecarFp });

  const skippedStates = new Map(skipped.map((s) => [s.dest, s.state]));
  assert.equal(skippedStates.get(path.join(claudeDir, "local.md")), "local-only");
  assert.equal(skippedStates.get(path.join(claudeDir, "conflict.md")), "conflict");
  assert.equal(fs.readFileSync(path.join(claudeDir, "local.md"), "utf8"), "local v1 EDITED\n");
  assert.equal(
    fs.readFileSync(path.join(claudeDir, "conflict.md"), "utf8"),
    "conflict v1 EDITED\n"
  );
});

test("applyUpdatePlan dryRun writes nothing at all", async () => {
  const { root, claudeDir, sidecarFp, files } = makeFixture();
  const plan = await buildUpdatePlan({ home: root, files, sidecarFp });
  const sidecarBefore = fs.readFileSync(sidecarFp);
  const snapshotBefore = {};
  for (const name of ["unchanged.md", "update.md", "local.md", "conflict.md", "untracked.md"]) {
    snapshotBefore[name] = fs.readFileSync(path.join(claudeDir, name));
  }

  const { applied, removed } = await applyUpdatePlan({ plan, sidecarFp, dryRun: true });

  // still reports what WOULD happen...
  assert.ok(applied.length > 0);
  assert.ok(removed.length > 0);
  // ...but wrote nothing.
  assert.deepEqual(fs.readFileSync(sidecarFp), sidecarBefore);
  for (const [name, bytesBefore] of Object.entries(snapshotBefore)) {
    assert.deepEqual(fs.readFileSync(path.join(claudeDir, name)), bytesBefore);
  }
  assert.equal(fs.existsSync(path.join(claudeDir, "new.md")), false);
  assert.equal(fs.existsSync(path.join(claudeDir, "missing.md")), false);
  assert.ok(fs.existsSync(path.join(claudeDir, "orphan.md"))); // not actually removed
});

test("applyUpdatePlan is a no-op on a plan with nothing to apply or remove (no sidecar write)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "update-plan-noop-"));
  const claudeDir = path.join(root, "claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  const sidecarFp = path.join(claudeDir, "vkm-kit.assets.json");
  const dest = path.join(claudeDir, "u.md");
  fs.writeFileSync(dest, "same\n");
  fs.writeFileSync(
    sidecarFp,
    JSON.stringify({ version: 1, assets: { [dest]: { hash: sha256("same\n"), installedAt: "x" } } })
  );
  const before = fs.readFileSync(sidecarFp);

  const plan = {
    entries: [
      {
        src: dest,
        dest,
        state: "unchanged",
        templateHash: sha256("same\n"),
        recordedHash: sha256("same\n"),
        diskHash: sha256("same\n")
      }
    ]
  };
  const { applied, skipped, removed } = await applyUpdatePlan({ plan, sidecarFp });
  assert.deepEqual(applied, []);
  assert.deepEqual(removed, []);
  assert.deepEqual(skipped, [{ dest, state: "unchanged" }]);
  assert.deepEqual(fs.readFileSync(sidecarFp), before); // untouched, no gratuitous rewrite
});
