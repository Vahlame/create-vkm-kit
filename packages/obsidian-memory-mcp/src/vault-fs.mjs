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
import { createHash } from "node:crypto";
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
 * Content etag for optimistic concurrency: first 12 hex chars of sha256 over the
 * exact file text. Content-addressed (not mtime-based) so the tmp+rename write
 * path and filesystem timestamp granularity can't produce false mismatches.
 * @param {string} text
 * @returns {string}
 */
export function fileEtag(text) {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12);
}

/**
 * Render a raw file text according to head/tail/maxChars read options.
 * @param {string} text
 * @param {{head?: number, tail?: number, maxChars?: number}} opts
 * @returns {string}
 */
function renderRead(text, opts) {
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
  if (head != null && tail != null) {
    throw new Error("pass head OR tail, not both");
  }
  const lines = text.split(/\r?\n/);
  return head != null ? lines.slice(0, head).join("\n") : lines.slice(-tail).join("\n");
}

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
  return renderRead(text, opts);
}

/**
 * Like {@link vaultReadFile} but also returns the whole-file etag (computed over
 * the full content even when head/tail/maxChars narrow the returned text — the
 * etag identifies the file version, not the excerpt) and the mtime.
 * @param {string} vaultAbs
 * @param {string} relPath
 * @param {{head?: number, tail?: number, maxChars?: number}} [opts]
 * @returns {Promise<{text: string, etag: string, mtimeMs: number}>}
 */
export async function vaultReadFileWithMeta(vaultAbs, relPath, opts = {}) {
  const fp = await safeVaultPath(vaultAbs, relPath);
  const raw = await readFile(fp, "utf8");
  const st = await stat(fp);
  return { text: renderRead(raw, opts), etag: fileEtag(raw), mtimeMs: st.mtimeMs };
}

/**
 * Enforce an optimistic-concurrency precondition: the file's current content
 * must hash to `ifMatch` (an etag from a prior read). Throws a retryable
 * "precondition failed" error on mismatch or when the file is missing.
 * NOTE: check-then-rename is not one atomic step — without the advisory write
 * lock the race window shrinks from "since the agent's read" to milliseconds;
 * with the lock (vault-lock.mjs) it is closed on a single host.
 * @param {string} fp canonical absolute path
 * @param {string} ifMatch expected etag
 * @returns {Promise<string>} the current content (so edit flows can reuse it)
 */
async function assertEtagMatches(fp, ifMatch) {
  let current;
  try {
    current = await readFile(fp, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(
        `precondition failed: file does not exist but ifMatch "${ifMatch}" was given — ` +
          `re-read (or omit ifMatch to create it)`
      );
    }
    throw err;
  }
  const now = fileEtag(current);
  if (now !== ifMatch) {
    throw new Error(
      `precondition failed: file changed since read (etag ${now} ≠ expected ${ifMatch}) — ` +
        `re-read the file and retry`
    );
  }
  return current;
}

/**
 * Atomic write: temp file in the same dir + rename. Creates parent dirs if missing.
 * With `opts.ifMatch` (an etag from a prior read) the write only proceeds if the
 * file still hashes to it — the caller's view is current, no lost update.
 * @param {string} vaultAbs
 * @param {string} relPath
 * @param {string} content
 * @param {{ifMatch?: string}} [opts]
 */
export async function vaultWriteFile(vaultAbs, relPath, content, opts = {}) {
  const fp = await safeVaultPath(vaultAbs, relPath);
  if (opts.ifMatch) await assertEtagMatches(fp, opts.ifMatch);
  await mkdir(dirname(fp), { recursive: true });
  const tmp = `${fp}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, fp);
  return { path: fp, bytes: Buffer.byteLength(content, "utf8"), etag: fileEtag(content) };
}

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;

/**
 * Detect the self-paste corruption pattern found and fixed 2026-07-02 in
 * `cursor-obsidian-memory-guide.md`: an edit whose `newText` re-inserts the
 * note's own YAML frontmatter block into its body, duplicating the note
 * inside itself (a triplicated ~53KB note went undetected until a manual
 * audit). Cheap, deterministic, no false positives on ordinary edits — it
 * only fires when the frontmatter block's occurrence count would increase
 * beyond what the file already had.
 * @param {string} originalText file content before any edits in this call
 * @param {string} finalText file content after all edits in this call
 * @returns {boolean}
 */
function wouldSelfPasteFrontmatter(originalText, finalText) {
  const fm = originalText.match(FRONTMATTER_RE);
  if (!fm) return false;
  const block = fm[0];
  const countIn = (s) => s.split(block).length - 1;
  return countIn(finalText) > countIn(originalText);
}

/**
 * Apply a sequence of {oldText, newText} edits to a file. Each edit must match
 * exactly once; otherwise the whole call fails and the file is untouched
 * (atomic via tmp+rename of the final content). Also rejects an edit that
 * would duplicate the note's own frontmatter into its body (see
 * {@link wouldSelfPasteFrontmatter}). With `opts.ifMatch` the edit only
 * proceeds if the file still hashes to that etag from a prior read.
 * @param {string} vaultAbs
 * @param {string} relPath
 * @param {Array<{oldText: string, newText: string}>} edits
 * @param {{ifMatch?: string}} [opts]
 */
export async function vaultEditFile(vaultAbs, relPath, edits, opts = {}) {
  if (!Array.isArray(edits) || edits.length === 0) {
    throw new Error("edits must be a non-empty array of {oldText, newText}");
  }
  const fp = await safeVaultPath(vaultAbs, relPath);
  const original = opts.ifMatch
    ? await assertEtagMatches(fp, opts.ifMatch)
    : await readFile(fp, "utf8");
  let text = original;
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
  if (wouldSelfPasteFrontmatter(original, text)) {
    throw new Error(
      "edit rejected: newText re-inserts this note's own frontmatter block, which would " +
        "duplicate the note inside itself. If that is genuinely intended, use vault_write_file instead."
    );
  }
  // Atomic write
  const tmp = `${fp}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, fp);
  return { path: fp, editsApplied: applied.length, etag: fileEtag(text) };
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
