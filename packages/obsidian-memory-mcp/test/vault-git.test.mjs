import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vaultGitHistory } from "../src/vault-git.mjs";

/** Soft skip when git isn't installed (mirrors the symlink-test pattern). */
const HAVE_GIT = (() => {
  try {
    return spawnSync("git", ["--version"]).status === 0;
  } catch {
    return false;
  }
})();

function git(cwd, ...args) {
  execFileSync("git", ["-C", cwd, ...args], {
    stdio: "pipe",
    // Hermetic identity/config: never touch the developer's global git config.
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: join(cwd, ".test-gitconfig"),
      GIT_CONFIG_SYSTEM: process.platform === "win32" ? "NUL" : "/dev/null",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com"
    }
  });
}

/** Vault that is also a git repo with two commits touching PROJECTS/a.md. */
function setupRepoVault() {
  const vault = mkdtempSync(join(tmpdir(), "vault-git-"));
  mkdirSync(join(vault, "PROJECTS"));
  git(vault, "init", "-q");
  writeFileSync(join(vault, "PROJECTS", "a.md"), "v1\n");
  git(vault, "add", ".");
  git(vault, "commit", "-q", "-m", "first version");
  writeFileSync(join(vault, "PROJECTS", "a.md"), "v2\n");
  git(vault, "add", ".");
  git(vault, "commit", "-q", "-m", "second version");
  return vault;
}

test(
  "vaultGitHistory: lists commits newest-first with hash/date/subject",
  { skip: !HAVE_GIT },
  async () => {
    const vault = setupRepoVault();
    try {
      const res = await vaultGitHistory(vault, "PROJECTS/a.md");
      assert.equal(res.path, "PROJECTS/a.md");
      assert.equal(res.commits.length, 2);
      assert.equal(res.commits[0].subject, "second version");
      assert.equal(res.commits[1].subject, "first version");
      assert.match(res.commits[0].hash, /^[0-9a-f]{7,}$/);
      assert.match(res.commits[0].date, /^\d{4}-\d{2}-\d{2}T/);
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  }
);

test(
  "vaultGitHistory: rev returns that version's content (recovery path)",
  { skip: !HAVE_GIT },
  async () => {
    const vault = setupRepoVault();
    try {
      const { commits } = await vaultGitHistory(vault, "PROJECTS/a.md");
      const oldRev = commits[1].hash;
      const res = await vaultGitHistory(vault, "PROJECTS/a.md", { rev: oldRev });
      assert.equal(res.content, "v1");
      assert.equal(res.rev, oldRev);
      // HEAD~1 form is accepted too.
      const viaHead = await vaultGitHistory(vault, "PROJECTS/a.md", { rev: "HEAD~1" });
      assert.equal(viaHead.content, "v1");
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  }
);

test("vaultGitHistory: limit caps the listing", { skip: !HAVE_GIT }, async () => {
  const vault = setupRepoVault();
  try {
    const res = await vaultGitHistory(vault, "PROJECTS/a.md", { limit: 1 });
    assert.equal(res.commits.length, 1);
    assert.equal(res.commits[0].subject, "second version");
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test(
  "vaultGitHistory: rejects a rev that is not hash/HEAD-shaped (option-injection guard)",
  { skip: !HAVE_GIT },
  async () => {
    const vault = setupRepoVault();
    try {
      for (const rev of ["--output=/tmp/x", "main", "HEAD@{1}", "$(rm -rf)"]) {
        await assert.rejects(
          () => vaultGitHistory(vault, "PROJECTS/a.md", { rev }),
          /invalid rev/,
          `rev ${rev} must be refused`
        );
      }
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  }
);

test(
  "vaultGitHistory: clear error when the vault is not a git repo",
  { skip: !HAVE_GIT },
  async () => {
    const vault = mkdtempSync(join(tmpdir(), "vault-nogit-"));
    writeFileSync(join(vault, "a.md"), "x\n");
    try {
      await assert.rejects(() => vaultGitHistory(vault, "a.md"), /not a git repository/);
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  }
);

test("vaultGitHistory: refuses paths escaping the vault", { skip: !HAVE_GIT }, async () => {
  const vault = setupRepoVault();
  try {
    await assert.rejects(() => vaultGitHistory(vault, "../outside.md"), /escapes vault/);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});
