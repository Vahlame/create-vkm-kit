#!/usr/bin/env node
// Forwarding shim (ADR-0041/0050): `@vkmikc/create-obsidian-memory` was renamed to
// `@vkmikc/create-vkm-kit` at 4.0.0. npm has no package redirects, so this shim keeps the
// old `npx` invocation working forever: it prints a one-line pointer and delegates the
// FULL argv to the new package via `npx --yes`, exit code passed through. No feature code
// lives here and none ever will — update your scripts to `npx @vkmikc/create-vkm-kit`.
import { execa } from "execa";
import pc from "picocolors";

const forwarded = process.argv.slice(2);
console.error(
  pc.yellow("@vkmikc/create-obsidian-memory is now @vkmikc/create-vkm-kit — forwarding.")
);
console.error(pc.dim("  Update your scripts: npx @vkmikc/create-vkm-kit " + forwarded.join(" ")));

try {
  const res = await execa("npx", ["--yes", "@vkmikc/create-vkm-kit@latest", ...forwarded], {
    stdio: "inherit",
    reject: false,
    // npx is npm's own launcher; on Windows it's npx.cmd, which requires a shell.
    shell: process.platform === "win32"
  });
  process.exit(res.exitCode ?? 1);
} catch (e) {
  console.error(pc.red("Could not forward to @vkmikc/create-vkm-kit:"), e?.message || e);
  console.error(pc.dim("Run it directly: npx @vkmikc/create-vkm-kit " + forwarded.join(" ")));
  process.exit(1);
}
