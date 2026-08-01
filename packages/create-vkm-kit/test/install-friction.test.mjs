// Regressions for the four install-friction defects found by a clean v5.2.0 reinstall on
// Windows, plus the close-ritual guard that never counted the tool its own rules prescribe.
// Each test fails on the pre-fix code and passes on the fix — that pairing is the point.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

import { maybeInstallObscura, OBSCURA_VERSION } from "../src/obscura-setup.mjs";
import { configureCodexNative } from "../src/codex-native.mjs";
import { ollamaServing } from "../src/ollama-setup.mjs";
import { scanTranscript } from "../src/hooks/stop-vault-close-reminder.mjs";

const tmp = (p) => mkdtempSync(join(tmpdir(), p));

test("obscura: a STALE managed copy is upgraded, not respected (presence-only gate)", async () => {
  let installed = false;
  const res = await maybeInstallObscura(
    false,
    { platform: "win32", arch: "x64" },
    {
      probeVersion: async () => "0.0.9", // an older pin, still perfectly runnable
      isRunnable: async () => true, // …and an obscura on PATH that must NOT mask it
      installImpl: async () => {
        installed = true;
        return { status: "ready", binPath: "X" };
      }
    }
  );
  assert.equal(installed, true, "a stale managed copy must trigger the pinned download");
  assert.equal(res.status, "ready");
});

test("obscura: the PINNED version short-circuits without downloading", async () => {
  let installed = false;
  const res = await maybeInstallObscura(
    false,
    { platform: "win32", arch: "x64" },
    {
      probeVersion: async () => OBSCURA_VERSION,
      isRunnable: async () => true,
      installImpl: async () => {
        installed = true;
        return { status: "ready", binPath: "X" };
      }
    }
  );
  assert.equal(installed, false);
  assert.equal(res.status, "ready");
  assert.ok(res.binPath?.length, "must report the managed path, not null");
});

test("obscura: a FAILED upgrade keeps the working old binary instead of reporting failure", async () => {
  const res = await maybeInstallObscura(
    false,
    { platform: "win32", arch: "x64" },
    {
      probeVersion: async () => "0.0.9",
      isRunnable: async () => false,
      // Windows refuses to replace a mapped executable while an agent session holds it.
      installImpl: async () => ({ status: "failed", binPath: null })
    }
  );
  assert.equal(res.status, "ready", "a transient lock must not unwire a working obscura");
  assert.ok(res.binPath?.endsWith("obscura.exe"));
});

test("obscura: a failed FIRST install still reports failure (nothing to fall back to)", async () => {
  const res = await maybeInstallObscura(
    false,
    { platform: "win32", arch: "x64" },
    {
      probeVersion: async () => null,
      isRunnable: async () => false,
      installImpl: async () => ({ status: "failed", binPath: null })
    }
  );
  assert.equal(res.status, "failed");
});

test("codex hooks route through the launcher when one was installed", async () => {
  const home = tmp("vkm-codex-launcher-");
  const launcher = join(home, ".claude", "bin", "vkm-runhidden.exe");
  try {
    await configureCodexNative(home, join(home, "vault"), false, { lang: "en", launcher });
    const cfg = JSON.parse(readFileSync(join(home, ".codex", "hooks.json"), "utf8"));
    const commands = Object.values(cfg.hooks)
      .flat()
      .flatMap((group) => group.hooks.map((h) => h.command));
    assert.ok(commands.length >= 4, "all four managed Codex hooks must be wired");
    for (const cmd of commands) {
      assert.ok(
        cmd.startsWith(`"${launcher}"`),
        `Codex hook must start with the launcher, got: ${cmd}`
      );
      assert.ok(cmd.includes('"node"'), "node must still be the interpreter it launches");
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("codex hooks fall back to bare node when there is no launcher (unchanged wiring)", async () => {
  const home = tmp("vkm-codex-nolauncher-");
  try {
    await configureCodexNative(home, join(home, "vault"), false, { lang: "en" });
    const cfg = JSON.parse(readFileSync(join(home, ".codex", "hooks.json"), "utf8"));
    const first = Object.values(cfg.hooks).flat()[0].hooks[0].command;
    assert.ok(first.startsWith('"node"'), `expected bare node, got: ${first}`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("ollamaServing reports a DOWN daemon instead of assuming the CLI implies one", async () => {
  // A port that is bound-then-closed is guaranteed to refuse, unlike a hardcoded free port.
  const srv = createServer();
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const { port } = /** @type {import("node:net").AddressInfo} */ (srv.address());
  await new Promise((r) => srv.close(r));

  assert.equal(await ollamaServing(`http://127.0.0.1:${port}`), false);
});

test("close-ritual guard counts vault_append_file — the tool the rules prescribe", () => {
  const dir = tmp("vkm-stop-hook-");
  const fp = join(dir, "transcript.jsonl");
  const toolUse = (name) =>
    JSON.stringify({ message: { content: [{ type: "tool_use", name, input: {} }] } });
  try {
    writeFileSync(
      fp,
      [
        toolUse("Write"),
        toolUse("Edit"),
        toolUse("mcp__obsidian-memory-hybrid__vault_append_file")
      ].join("\n") + "\n"
    );
    const state = scanTranscript(fp);
    assert.equal(state.substantive, 2);
    assert.equal(state.vaultTouches, 1, "appending to SESSION_LOG.md IS touching the vault");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
