#!/usr/bin/env node
/**
 * Build `vkm-runhidden.exe` into the npm package, from any host OS.
 *
 * A Node wrapper rather than the one-line `go build` this replaces, for one reason: the binary is
 * ALWAYS a Windows binary, including when it is built on the ubuntu runner that publishes the
 * package, so `GOOS`/`GOARCH` have to be forced. `GOOS=windows go build ...` in an npm script
 * works in bash and is a syntax error in cmd.exe — which is the shell npm uses on the maintainer's
 * own machine. Setting them in `env` here is the version that behaves the same everywhere.
 *
 * `-H windowsgui` is the load-bearing linker flag: it marks the image GUI-subsystem, so the
 * Windows loader never allocates a console for it. Without that, this binary flashes exactly like
 * the `node.exe` it was written to replace. `-s -w` strip the symbol table and DWARF (~40% off a
 * file that ships in every tarball); nothing here is ever debugged from a stack trace.
 *
 *   node scripts/build-runhidden.mjs
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(repoRoot, "packages", "create-vkm-kit", "bin", "vkm-runhidden.exe");

mkdirSync(path.dirname(out), { recursive: true });

// `-trimpath` + `-buildvcs=false` are what make two builds of the same source byte-identical.
// That is not cosmetic here: `uninstallRunHidden` only deletes a launcher that matches the
// packaged copy byte for byte (so it never removes one the user built or replaced), and since
// the installer now BUILDS this file on clone installs, a non-reproducible build would leave
// every clone user's launcher behind on `--uninstall`. Measured before the flags: two
// consecutive builds of identical source produced different SHA-256s.
const res = spawnSync(
  "go",
  [
    "build",
    "-trimpath",
    "-buildvcs=false",
    "-ldflags=-H windowsgui -s -w -buildid=",
    "-o",
    out,
    "./cmd/vkm-runhidden"
  ],
  {
    cwd: repoRoot,
    stdio: "inherit",
    // CGO off so the cross-compile needs no Windows toolchain: this command uses syscall only.
    env: { ...process.env, GOOS: "windows", GOARCH: "amd64", CGO_ENABLED: "0" },
    // Deliberately NOT `shell: true`. cmd.exe re-splits arguments on spaces, which turns the single
    // `-ldflags=-H windowsgui -s -w` argument into four broken import paths.
    shell: false
  }
);

if (res.error) {
  console.error(`build-runhidden: could not run go — ${res.error.message}`);
  console.error("Install Go (https://go.dev/dl/) or skip: the kit falls back to plain `node`.");
  process.exit(1);
}
if (res.status !== 0) process.exit(res.status ?? 1);

console.log(`build-runhidden: ${path.relative(repoRoot, out)} (${statSync(out).size} bytes)`);
