/**
 * Puts `vkm-runhidden.exe` where the hook entries point at it.
 *
 * # Why the installer owns this file
 *
 * `hookInterpreter()` writes an ABSOLUTE path into `~/.claude/settings.json`, and a hook whose
 * `command` does not exist is a hook that never runs — which for a `PreToolUse` guard is
 * indistinguishable from one that approved the call. Probing for a binary somebody else might
 * have built is how that path gets baked in optimistically and invalidated later.
 *
 * So the installer does not probe: it PUTS the launcher there, from the copy shipped inside the
 * npm package, and only then does `hookInterpreter()` resolve. Every re-run re-heals a deleted or
 * stale copy, which makes `npx create-vkm-kit` the documented repair for a broken interpreter.
 *
 * A git checkout has no packaged copy until `npm run build:runhidden` produces one (Go). That is
 * not an error: {@link installRunHidden} says so once and returns null, `hookInterpreter()` falls
 * back to plain `node`, and the hooks behave identically — they just flash like they used to.
 *
 * @module
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import fse from "fs-extra";
import pc from "picocolors";

export const RUNHIDDEN_BASENAME = "vkm-runhidden.exe";

/**
 * Build the launcher from the checkout that is running this installer.
 *
 * `bin/` is gitignored and `files:["bin"]` only fills it in the published tarball, so an
 * install from a CLONE — the documented path for `--full`, since the hybrid MCP needs one —
 * reached `installRunHidden` with nothing to copy and wired every hook AND all four MCP
 * servers to bare `node`. That is the exact flashing-console config ADR-0078/v5 exists to
 * prevent, reintroduced for the users most likely to hit it: the ones running from source.
 *
 * Best-effort by the same contract as its caller: no Go, no toolchain, a compile error — all
 * degrade to the pre-existing `node` fallback with one actionable line, never an abort.
 *
 * @param {string} repoRoot
 * @returns {Promise<boolean>} whether a launcher now exists at {@link packagedRunHidden}
 */
async function buildFromCheckout(repoRoot) {
  const script = path.join(repoRoot, "scripts", "build-runhidden.mjs");
  if (!(await fse.pathExists(script))) return false;

  // No `windowsHide` on either spawn below, deliberately (ADR-0078): the build shells out to
  // `go`, so CREATE_NO_WINDOW on its parent would hand that console-subsystem grandchild a
  // brand new VISIBLE console — the exact inversion this whole subsystem exists to avoid. Both
  // run in the terminal the user is already watching an install in, and inherit its console.
  const go = await execa("go", ["version"], { reject: false }).catch(() => null);
  if (!go || go.failed || go.exitCode !== 0) {
    console.log(
      pc.dim("Hook launcher not packaged in this build and Go is not installed —"),
      pc.dim(
        "hooks and MCP servers will run through plain `node` (they flash a console on Windows)."
      )
    );
    console.log(pc.dim("  Fix: install Go (https://go.dev/dl/), then re-run this installer."));
    return false;
  }

  console.log(pc.cyan("Building the windowless hook launcher from this checkout (Go) …"));
  const built = await execa(process.execPath, [script], {
    cwd: repoRoot,
    reject: false
  }).catch((e) => ({ failed: true, exitCode: 1, stderr: e?.message || String(e) }));

  if (built.failed || built.exitCode !== 0) {
    console.warn(
      pc.yellow("Could not build the hook launcher (falling back to plain `node`):"),
      pc.dim(
        String(built.stderr || "")
          .trim()
          .split(/\r?\n/)
          .at(-1) || `exit ${built.exitCode}`
      )
    );
    return false;
  }
  return fse.pathExists(packagedRunHidden());
}

/** The copy inside this package (`files: ["bin"]` ships it; a checkout builds it). */
export function packagedRunHidden() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", RUNHIDDEN_BASENAME);
}

/** Where hook entries expect it, for a given install home. */
export function installedRunHidden(home) {
  return path.join(home, ".claude", "bin", RUNHIDDEN_BASENAME);
}

async function sha256(fp) {
  return createHash("sha256")
    .update(await fse.readFile(fp))
    .digest("hex");
}

/**
 * Copy the packaged launcher into `<home>/.claude/bin/`.
 *
 * Best-effort and never throws: a failure here must degrade to `node` (a flashing hook), never
 * abort an install or leave settings.json pointing at a file that is not there.
 *
 * @param {string} home
 * @param {boolean} dryRun
 * @param {{ repoRoot?: string|null }} [opts] - when the install is running from a kit CLONE,
 *   the launcher is absent from `bin/` (gitignored) and is BUILT here instead of silently
 *   degrading the whole install to `node`. See {@link buildFromCheckout}.
 * @returns {Promise<string | null>} the installed path, or null when there is nothing to install
 */
export async function installRunHidden(home, dryRun, { repoRoot = null } = {}) {
  // Nothing to suppress off Windows: no console is allocated for a child there in the first place.
  if (process.platform !== "win32") return null;

  const src = packagedRunHidden();
  const dest = installedRunHidden(home);

  if (!(await fse.pathExists(src))) {
    if (dryRun) {
      console.log(
        pc.cyan("[dry-run] would build the windowless hook launcher from this checkout (Go)")
      );
      return null;
    }
    if (!repoRoot || !(await buildFromCheckout(repoRoot))) {
      console.log(
        pc.dim("Hook launcher not packaged in this build — hooks will run through plain `node`."),
        pc.dim("(source checkout: `npm run build:runhidden` needs Go)")
      );
      return null;
    }
  }

  if (dryRun) {
    console.log(pc.cyan("[dry-run] would install the windowless hook launcher"), pc.dim(dest));
    return dest;
  }

  try {
    // Skip an identical copy rather than overwrite it. Re-running the installer while an agent
    // session is live would otherwise hit EBUSY on Windows: the file IS the running interpreter
    // of every hook, and Windows refuses to replace a mapped executable.
    if (await fse.pathExists(dest)) {
      if ((await sha256(src)) === (await sha256(dest))) return dest;
    }
    await fse.ensureDir(path.dirname(dest));
    await fse.copy(src, dest, { overwrite: true });
    console.log(pc.green("Windowless hook launcher:"), pc.dim(dest));
    return dest;
  } catch (e) {
    // An existing copy is still a working interpreter — only a hard absence is a downgrade.
    //
    // But it may be a STALE one, and staying quiet about that is how a fix appears to have
    // been applied when it was not. The overwhelmingly common cause is Windows refusing to
    // replace a mapped executable: the file IS the interpreter of every live hook and the
    // launcher of every MCP server, so with an editor session open the copy fails with
    // EBUSY and the user keeps whatever they had. That is exactly when they most need to
    // be told, because they just ran the installer expecting the new behaviour.
    if (await fse.pathExists(dest)) {
      console.warn(
        pc.yellow("Kept the EXISTING hook launcher — could not replace it:"),
        e?.message || e
      );
      console.warn(
        pc.dim(
          "  Windows refuses to overwrite a running executable. Close every editor/agent " +
            "session and re-run this installer to pick up the new launcher."
        )
      );
      return dest;
    }
    console.warn(
      pc.yellow("Could not install the hook launcher (hooks will use plain `node`):"),
      e?.message || e
    );
    return null;
  }
}

/**
 * Remove the launcher `installRunHidden` put in `<home>/.claude/bin/`.
 *
 * `--uninstall` removed the hook entries, the hook scripts, the skills and the output
 * style, and left this executable behind — the one piece of the teardown that was
 * missing, and the newest one. Same never-delete-on-doubt policy as the hook scripts:
 * only a byte-for-byte match against the copy this package ships is ours to remove, so
 * a launcher the user built or replaced themselves survives. Never throws.
 *
 * @param {string} home
 * @param {boolean} dryRun
 * @returns {Promise<boolean>} whether the file was (or would be) removed
 */
export async function uninstallRunHidden(home, dryRun) {
  const dest = installedRunHidden(home);
  try {
    if (!(await fse.pathExists(dest))) return false;
    const src = packagedRunHidden();
    if (!(await fse.pathExists(src)) || (await sha256(src)) !== (await sha256(dest))) {
      console.log(
        pc.yellow("Left in place (not recognized as this kit's launcher):"),
        pc.dim(dest)
      );
      return false;
    }
    if (dryRun) {
      console.log(pc.cyan("[dry-run] would remove the windowless hook launcher"), pc.dim(dest));
      return true;
    }
    await fse.remove(dest);
    console.log(pc.green("Removed the windowless hook launcher:"), pc.dim(dest));
    return true;
  } catch (e) {
    // A launcher still on disk after `--uninstall` is inert once its hook entries are
    // gone (nothing invokes it), so a failure here is worth reporting, not throwing.
    console.warn(pc.yellow("Could not remove the hook launcher:"), e?.message || e);
    return false;
  }
}
