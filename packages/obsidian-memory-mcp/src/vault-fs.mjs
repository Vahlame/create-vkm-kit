/**
 * Vault-scoped filesystem helpers for the obsidian-memory-hybrid MCP.
 *
 * Why these exist: `@modelcontextprotocol/server-filesystem@2025.7.29+` uses
 * MCP Roots — when the client (Claude Code) advertises `roots` capability,
 * the server *replaces* its allowed-directories with the client's Roots.
 * That means the filesystem MCP always tracks the active project's cwd, not
 * the vault. These helpers give the hybrid MCP its own vault-locked
 * read/write/list/edit tools that ignore client Roots entirely — they read
 * `BASIC_MEMORY_HOME` from the env at startup and never leave it.
 *
 * Pure (no MCP dependency) so they can be unit-tested without spawning
 * StdioServerTransport.
 */
import { readFile, writeFile, readdir, stat, mkdir, rename, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";

/**
 * Resolve a relative-or-absolute vault path and refuse anything that escapes
 * the vault root (after symlink resolution). Mirrors the defense filesystem
 * MCP uses but locked to a single vault.
 *
 * @param {string} vaultAbs absolute path to the vault root (must exist)
 * @param {string} userPath either relative-to-vault or absolute under vault
 * @returns {Promise<string>} canonical absolute path inside the vault
 */
export async function safeVaultPath(vaultAbs, userPath) {
  if (typeof userPath !== "string" || userPath.length === 0) {
    throw new Error("path is required");
  }
  const vaultReal = await realpath(vaultAbs);
  const candidate = isAbsolute(userPath) ? normalize(userPath) : resolve(vaultReal, userPath);

  // If target exists, resolve its realpath (catches symlink escapes).
  // If not (e.g. a new file we're about to write, possibly in a not-yet-created
  // subdir like STACKS/rust.md when STACKS/ doesn't exist), walk upward until
  // we find an existing ancestor and validate that against the vault.
  let canonical;
  try {
    canonical = await realpath(candidate);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    let probe = dirname(candidate);
    // dirname(root) === root, so this loop terminates.
    while (probe !== dirname(probe)) {
      try {
        const probeReal = await realpath(probe);
        if (probeReal !== vaultReal && !probeReal.startsWith(vaultReal + sep)) {
          throw new Error(`path escapes vault: ${userPath}`);
        }
        // TOCTOU note: there is a theoretical window between validating this
        // existing ancestor and the caller's later write — a symlink swapped in
        // between could redirect the target. Irrelevant for the single-user,
        // local vault these tools serve (no adversarial concurrent writer); a
        // multi-tenant deployment would need an O_NOFOLLOW open at write time.
        return candidate;
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
        probe = dirname(probe);
      }
    }
    throw new Error(`could not resolve any ancestor of: ${userPath}`);
  }
  if (canonical !== vaultReal && !canonical.startsWith(vaultReal + sep)) {
    throw new Error(`path escapes vault (after symlink resolution): ${userPath}`);
  }
  return canonical;
}

/** Default cap on a whole-file read (no head/tail given). Generous enough for any
 * normal note (even this kit's own ~90KB SESSION_LOG.md), but bounds how many
 * tokens a single surprising giant file can dump into the conversation. */
const DEFAULT_MAX_READ_CHARS = 200_000;

/**
 * Read a file inside the vault. Optionally return only the first/last N lines.
 * With neither `head` nor `tail`, the read is capped at `maxChars` (default
 * {@link DEFAULT_MAX_READ_CHARS}) with a truncation notice appended — pass head/tail
 * to page through a file bigger than that instead of getting a silent partial read.
 * @param {string} vaultAbs
 * @param {string} relPath
 * @param {{head?: number, tail?: number, maxChars?: number}} [opts]
 */
export async function vaultReadFile(vaultAbs, relPath, opts = {}) {
  const fp = await safeVaultPath(vaultAbs, relPath);
  const text = await readFile(fp, "utf8");
  const head = opts.head;
  const tail = opts.tail;
  if (head == null && tail == null) {
    const maxChars = opts.maxChars ?? DEFAULT_MAX_READ_CHARS;
    if (text.length <= maxChars) return text;
    return (
      `${text.slice(0, maxChars)}\n\n` +
      `[...truncated: ${text.length} chars total, showing the first ${maxChars}. ` +
      `Pass head or tail to page through the rest instead of reading it whole.]`
    );
  }
  const lines = text.split(/\r?\n/);
  if (head != null && tail != null) {
    throw new Error("pass head OR tail, not both");
  }
  return head != null ? lines.slice(0, head).join("\n") : lines.slice(-tail).join("\n");
}

/**
 * Atomic write: temp file in the same dir + rename. Creates parent dirs if missing.
 * @param {string} vaultAbs
 * @param {string} relPath
 * @param {string} content
 */
export async function vaultWriteFile(vaultAbs, relPath, content) {
  const fp = await safeVaultPath(vaultAbs, relPath);
  await mkdir(dirname(fp), { recursive: true });
  const tmp = `${fp}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, fp);
  return { path: fp, bytes: Buffer.byteLength(content, "utf8") };
}

/**
 * Apply a sequence of {oldText, newText} edits to a file. Each edit must match
 * exactly once; otherwise the whole call fails and the file is untouched
 * (atomic via tmp+rename of the final content).
 * @param {string} vaultAbs
 * @param {string} relPath
 * @param {Array<{oldText: string, newText: string}>} edits
 */
export async function vaultEditFile(vaultAbs, relPath, edits) {
  if (!Array.isArray(edits) || edits.length === 0) {
    throw new Error("edits must be a non-empty array of {oldText, newText}");
  }
  const fp = await safeVaultPath(vaultAbs, relPath);
  let text = await readFile(fp, "utf8");
  const applied = [];
  for (const [i, edit] of edits.entries()) {
    if (typeof edit.oldText !== "string" || typeof edit.newText !== "string") {
      throw new Error(`edit ${i}: oldText and newText must be strings`);
    }
    const occurrences = text.split(edit.oldText).length - 1;
    if (occurrences === 0) {
      throw new Error(`edit ${i}: oldText not found in file`);
    }
    if (occurrences > 1) {
      throw new Error(
        `edit ${i}: oldText matches ${occurrences} times — provide more surrounding context to make it unique`
      );
    }
    text = text.replace(edit.oldText, edit.newText);
    applied.push(i);
  }
  // Atomic write
  const tmp = `${fp}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, fp);
  return { path: fp, editsApplied: applied.length };
}

/**
 * List one directory level inside the vault. Returns names + types + sizes.
 * @param {string} vaultAbs
 * @param {string} [relPath] defaults to vault root
 */
export async function vaultListDirectory(vaultAbs, relPath = ".") {
  const fp = await safeVaultPath(vaultAbs, relPath);
  const entries = await readdir(fp, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const child = join(fp, e.name);
    let size = null;
    try {
      const st = await stat(child);
      size = st.isFile() ? st.size : null;
    } catch {
      /* ignore stat failures */
    }
    out.push({
      name: e.name,
      type: e.isDirectory() ? "dir" : e.isFile() ? "file" : "other",
      size
    });
  }
  return out;
}
