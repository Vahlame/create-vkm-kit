import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
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

test("execa call never enables shell:true (command-injection guard)", () => {
  // `forwarded` (full user/caller-controlled argv) is spliced straight into the execa
  // call — `shell: true` would let cmd.exe interpret &/|/>/etc. in ANY forwarded arg,
  // verified as a real, working injection in a live repro before this fix. Confirmed
  // separately that npx.cmd resolves fine on Windows WITHOUT a shell (execa's bundled
  // cross-spawn handles it), so there is no legitimate reason to ever re-add this.
  const src = fs.readFileSync(path.join(root, "src", "index.js"), "utf8");
  const code = src
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  assert.ok(!/shell\s*:/.test(code), `shell option must not appear in the execa call:\n${src}`);
});

test("a forwarded arg with shell metacharacters is never interpreted as a second command", () => {
  // Intercepts the real `npx` lookup with a fake one earlier on PATH that just dumps its
  // raw argv to a file — proves, behaviorally (not just by grepping the source), that a
  // malicious forwarded value can no longer break out into a second shell command. Live
  // repro before the fix: the exact same input created a stray file via the injected
  // `echo ... > injected.txt`; this must never happen now.
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-npx-"));
  const capturedArgsFile = path.join(binDir, "captured-args.txt");
  const injectedFile = path.join(binDir, "injected.txt");
  const isWin = process.platform === "win32";
  const npxName = isWin ? "npx.cmd" : "npx";
  fs.writeFileSync(
    path.join(binDir, npxName),
    isWin
      ? `@echo off\r\necho %*>"${capturedArgsFile}"\r\n`
      : `#!/bin/sh\necho "$*" > "${capturedArgsFile}"\n`,
    { mode: 0o755 }
  );

  const maliciousArg = `dummy & echo INJECTED>"${injectedFile}" & echo`;
  const r = spawnSync(process.execPath, [path.join(root, "src", "index.js"), maliciousArg], {
    encoding: "utf8",
    env: { ...process.env, PATH: binDir + path.delimiter + process.env.PATH }
  });

  assert.ok(
    !fs.existsSync(injectedFile),
    `shell metacharacters were interpreted:\n${r.stdout}\n${r.stderr}`
  );
  assert.ok(fs.existsSync(capturedArgsFile), "the fake npx should still have been invoked");
});
