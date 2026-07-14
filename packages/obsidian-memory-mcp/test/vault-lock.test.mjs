import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { acquireVaultLock, withVaultLock } from "../src/vault-lock.mjs";
import { vaultEditFile, vaultWriteFile } from "../src/vault-fs.mjs";

const LOCK_REL = join(".obsidian-memory-rag", "write.lock");

async function setupVault() {
  const root = await mkdtemp(join(tmpdir(), "vault-lock-"));
  await writeFile(join(root, "MEMORY.md"), "line 1\nline 2\n");
  return root;
}

async function plantLock(root, info) {
  await mkdir(join(root, ".obsidian-memory-rag"), { recursive: true });
  await writeFile(join(root, LOCK_REL), typeof info === "string" ? info : JSON.stringify(info));
}

test("acquire/release lifecycle: lockfile appears then disappears", async () => {
  const vault = await setupVault();
  try {
    const release = await acquireVaultLock(vault, { tool: "t" });
    const raw = JSON.parse(await readFile(join(vault, LOCK_REL), "utf8"));
    assert.equal(raw.pid, process.pid);
    assert.equal(raw.tool, "t");
    await release();
    await assert.rejects(() => readFile(join(vault, LOCK_REL), "utf8"), { code: "ENOENT" });
  } finally {
    await rm(vault, { recursive: true });
  }
});

test("a live same-host holder makes the second acquire fail with vault busy", async () => {
  const vault = await setupVault();
  try {
    const release = await acquireVaultLock(vault);
    await assert.rejects(
      () => acquireVaultLock(vault, { waitMs: 120 }),
      /vault busy: write lock held by pid/
    );
    await release();
  } finally {
    await rm(vault, { recursive: true });
  }
});

test("waiter succeeds once the holder releases", async () => {
  const vault = await setupVault();
  // Track the holder's async release instead of firing it and forgetting it — otherwise a
  // real error from release() (or rm() below racing its still-pending unlink) becomes an
  // unhandled rejection blamed on whichever test happens to be running when it lands.
  let holderReleased = Promise.resolve();
  try {
    const release = await acquireVaultLock(vault);
    holderReleased = new Promise((resolve, reject) => {
      setTimeout(() => release().then(resolve, reject), 80);
    });
    const release2 = await acquireVaultLock(vault, { waitMs: 2000 });
    await release2();
  } finally {
    await holderReleased;
    await rm(vault, { recursive: true });
  }
});

test("steals an expired-TTL lock from this host", async () => {
  const vault = await setupVault();
  try {
    await plantLock(vault, {
      pid: process.pid, // alive — expiry alone must justify the steal
      hostname: hostname(),
      tool: "crashed",
      acquiredAt: Date.now() - 60_000
    });
    const release = await acquireVaultLock(vault, { ttlMs: 10_000, waitMs: 200 });
    await release();
  } finally {
    await rm(vault, { recursive: true });
  }
});

test("steals a dead-PID lock from this host even inside TTL", async () => {
  const vault = await setupVault();
  try {
    await plantLock(vault, {
      pid: 2 ** 30, // far beyond any real pid space
      hostname: hostname(),
      tool: "crashed",
      acquiredAt: Date.now()
    });
    const release = await acquireVaultLock(vault, { waitMs: 200 });
    await release();
  } finally {
    await rm(vault, { recursive: true });
  }
});

test("never steals a foreign host's lock, even expired", async () => {
  const vault = await setupVault();
  try {
    await plantLock(vault, {
      pid: 1,
      hostname: "some-other-machine",
      tool: "remote",
      acquiredAt: Date.now() - 3_600_000
    });
    await assert.rejects(
      () => acquireVaultLock(vault, { waitMs: 100 }),
      /vault busy: .*host some-other-machine/
    );
  } finally {
    await rm(vault, { recursive: true });
  }
});

test("unparseable lockfile is treated as stale debris", async () => {
  const vault = await setupVault();
  try {
    await plantLock(vault, "not json {{");
    const release = await acquireVaultLock(vault, { waitMs: 200 });
    await release();
  } finally {
    await rm(vault, { recursive: true });
  }
});

test("OBSIDIAN_MEMORY_NO_LOCK=1 bypasses locking entirely", async () => {
  const vault = await setupVault();
  process.env.OBSIDIAN_MEMORY_NO_LOCK = "1";
  try {
    await plantLock(vault, {
      pid: process.pid,
      hostname: hostname(),
      tool: "holder",
      acquiredAt: Date.now()
    });
    // Despite a live lock, acquisition is a no-op and does not touch the file.
    const release = await acquireVaultLock(vault, { waitMs: 50 });
    await release();
    const raw = await readFile(join(vault, LOCK_REL), "utf8");
    assert.ok(raw.includes("holder"));
  } finally {
    delete process.env.OBSIDIAN_MEMORY_NO_LOCK;
    await rm(vault, { recursive: true });
  }
});

test("withVaultLock releases on throw", async () => {
  const vault = await setupVault();
  try {
    await assert.rejects(
      () =>
        withVaultLock(vault, "boom", async () => {
          throw new Error("inner failure");
        }),
      /inner failure/
    );
    // Immediately reacquirable — the lock did not leak.
    const release = await acquireVaultLock(vault, { waitMs: 50 });
    await release();
  } finally {
    await rm(vault, { recursive: true });
  }
});

test("vault-fs: failed edit releases the lock", async () => {
  const vault = await setupVault();
  try {
    await assert.rejects(
      () => vaultEditFile(vault, "MEMORY.md", [{ oldText: "nope", newText: "x" }]),
      /not found/
    );
    const release = await acquireVaultLock(vault, { waitMs: 50 });
    await release();
  } finally {
    await rm(vault, { recursive: true });
  }
});

test("vault-fs: concurrent writes to one file serialize and both land", async () => {
  const vault = await setupVault();
  try {
    const [a, b] = await Promise.all([
      vaultWriteFile(vault, "race.md", "writer A"),
      vaultWriteFile(vault, "race.md", "writer B")
    ]);
    assert.ok(a.etag && b.etag);
    const finalText = await readFile(join(vault, "race.md"), "utf8");
    assert.ok(finalText === "writer A" || finalText === "writer B");
    // Lock is free afterwards.
    const release = await acquireVaultLock(vault, { waitMs: 50 });
    await release();
  } finally {
    await rm(vault, { recursive: true });
  }
});
