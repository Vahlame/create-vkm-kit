// Restrict a just-written config file (and its `.bak.*` copies) to the current user.
//
// `mcp.json` / `settings.json` may carry `env` blocks with API tokens (this kit's own
// writes don't add secrets, but we merge into and preserve whatever else the user already
// had in the file, which can). POSIX: chmod 0600. Windows has no chmod bits at all — the
// prior code just skipped the whole step there (`if (process.platform !== "win32")`), which
// on the platform this repo's own maintainer uses meant the protection never applied, and
// `.bak.*` copies accumulated with default (often broader) ACLs. This restricts the file to
// the current user via `icacls`, the Windows analogue of chmod 0600 (ADR-none; audit fix).
//
// Best-effort by design, on BOTH platforms: a permissions failure must never abort a write
// that otherwise succeeded (matches the existing chmod call sites' `catch { /* ignore */ }`
// precedent) — ACL manipulation in particular can be fragile across Windows configs (domain
// accounts, non-NTFS volumes, restricted environments), so failures here only warn.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import pc from "picocolors";

const execFileAsync = promisify(execFile);

/**
 * Best-effort: restrict `fp` to the current user only (POSIX: chmod 0600; Windows: icacls
 * ACL reset). Never throws — callers should NOT await-fail their write on this.
 * @param {string} fp
 */
export async function restrictFileToOwner(fp) {
  if (process.platform === "win32") {
    try {
      const username = process.env.USERNAME || os.userInfo().username;
      if (!username) return;
      // /inheritance:r drops inherited ACEs; /grant:r replaces the explicit grant list with
      // just the current user (Full control) — together, the closest Windows analogue of
      // POSIX chmod 0600. Passed as an argv array (no shell), so no quoting to get wrong.
      await execFileAsync("icacls", [fp, "/inheritance:r", "/grant:r", `${username}:F`], {
        windowsHide: true
      });
    } catch (e) {
      console.warn(
        pc.yellow("Could not restrict file permissions (icacls, best-effort):"),
        fp,
        e?.message || e
      );
    }
    return;
  }
  try {
    await fs.chmod(fp, 0o600);
  } catch {
    /* best-effort: not all filesystems support chmod */
  }
}
