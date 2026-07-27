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
import fse from "fs-extra";
import pc from "picocolors";

export const RUNHIDDEN_BASENAME = "vkm-runhidden.exe";

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
 * @returns {Promise<string | null>} the installed path, or null when there is nothing to install
 */
export async function installRunHidden(home, dryRun) {
  // Nothing to suppress off Windows: no console is allocated for a child there in the first place.
  if (process.platform !== "win32") return null;

  const src = packagedRunHidden();
  const dest = installedRunHidden(home);

  if (!(await fse.pathExists(src))) {
    console.log(
      pc.dim("Hook launcher not packaged in this build — hooks will run through plain `node`."),
      pc.dim("(source checkout: `npm run build:runhidden` needs Go)")
    );
    return null;
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
    // An existing copy is still a working interpreter — only report a hard absence as a downgrade.
    if (await fse.pathExists(dest)) return dest;
    console.warn(
      pc.yellow("Could not install the hook launcher (hooks will use plain `node`):"),
      e?.message || e
    );
    return null;
  }
}
