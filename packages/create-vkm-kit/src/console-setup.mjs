// vkm-kit console builder: compiles the Go vkm-console TUI (a live view over the
// pg-service: activity, graph, search) into `<kitRoot>/bin/`. BEST-EFFORT by contract —
// a machine without Go gets a "manual" status and the exact command to run later, never
// a failed install. Built with a hidden window (ADR-0078): `go build` may shell out to
// console-subsystem children, and nothing an installer runs may take the foreground.
import path from "node:path";
import { execa } from "execa";
import fse from "fs-extra";
import pc from "picocolors";

/**
 * @typedef {{ status: "ready"|"skipped"|"manual"|"failed", binPath: string|null }}
 *   ConsoleBuildResult
 */

/** Where the built binary lands: `<kitRoot>/bin/vkm-console(.exe)`. */
export function consoleBinPath(kitRoot, platform = process.platform) {
  return path.join(kitRoot, "bin", platform === "win32" ? "vkm-console.exe" : "vkm-console");
}

/**
 * Build vkm-console when asked to. Never throws; returns a status the summary prints.
 * Dependency-injected so it is unit-testable without a Go toolchain.
 * @param {{ enable: boolean, dryRun: boolean, kitRoot: string|null,
 *   launcher?: string|null }} opts
 * @param {{ execaImpl?: typeof execa, pathExists?: (p: string) => Promise<boolean>,
 *   platform?: NodeJS.Platform }} [deps]
 * @returns {Promise<ConsoleBuildResult>}
 */
export async function maybeBuildConsole({ enable, dryRun, kitRoot, launcher = null }, deps = {}) {
  const {
    execaImpl = execa,
    pathExists = (p) => fse.pathExists(p),
    platform = process.platform
  } = deps;
  try {
    if (!enable || !kitRoot) return { status: "skipped", binPath: null };
    const binPath = consoleBinPath(kitRoot, platform);
    if (dryRun) {
      console.log(
        pc.cyan("[dry-run] would build vkm-console:"),
        pc.dim(`go build -o ${binPath} ./cmd/vkm-console`)
      );
      return { status: "skipped", binPath };
    }
    if (!(await pathExists(path.join(kitRoot, "cmd", "vkm-console")))) {
      console.warn(
        pc.yellow("vkm-console: source not found in the kit clone (cmd/vkm-console) — skipped.")
      );
      return { status: "manual", binPath: null };
    }
    // Probe Go ONCE, before the build: "not installed" and "installed but the build broke"
    // need different answers — the first gets an install hint, the second the build error.
    // `go build` is a PARENT: it fans out to the compiler and linker, all console-subsystem
    // binaries. CREATE_NO_WINDOW on it is the ADR-0078 anti-pattern — Windows would give each
    // of those children its own VISIBLE console. Route through the launcher when the install
    // has one (it owns a single hidden console the tree inherits); otherwise let the build
    // inherit the installer's console, which the user is already watching.
    const viaLauncher = (/** @type {string[]} */ argv) =>
      launcher ? [launcher, argv] : [argv[0], argv.slice(1)];
    const [probeCmd, probeArgs] = viaLauncher(["go", "version"]);
    const probe = await execaImpl(probeCmd, probeArgs, {
      reject: false,
      timeout: 15_000,
      windowsHide: false
    }).catch(() => null);
    if (!probe || probe.exitCode !== 0) {
      console.warn(pc.yellow("vkm-console: Go is not installed — build it later:"));
      console.log(`  npm run build:console   ${pc.dim("(needs Go: https://go.dev/dl)")}`);
      return { status: "manual", binPath: null };
    }
    const [buildCmd, buildArgs] = viaLauncher(["go", "build", "-o", binPath, "./cmd/vkm-console"]);
    const r = await execaImpl(buildCmd, buildArgs, {
      cwd: kitRoot,
      reject: false,
      timeout: 120_000,
      windowsHide: false
    });
    if (r.exitCode === 0) {
      console.log(pc.green("vkm-console built:"), pc.dim(binPath));
      return { status: "ready", binPath };
    }
    console.warn(pc.yellow("vkm-console build failed — run it manually: npm run build:console"));
    const lastLine = String(r.stderr || r.stdout || "")
      .trim()
      .split(/\r?\n/)
      .at(-1);
    if (lastLine) console.log(pc.dim("  " + lastLine));
    return { status: "failed", binPath: null };
  } catch (e) {
    console.warn(pc.yellow("vkm-console build skipped:"), e?.message || e);
    return { status: "failed", binPath: null };
  }
}
