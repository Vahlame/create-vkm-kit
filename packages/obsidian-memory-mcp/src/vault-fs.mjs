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
import {
  readFile,
  writeFile,
  readdir,
  stat,
  mkdir,
  rename,
  realpath,
  unlink
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { withVaultLock } from "./vault-lock.mjs";
import { checkSchemaForWrite } from "./schema-config.mjs";
// Runtime-only circular import (vault-lint needs listMarkdownFiles): safe
// because both sides are hoisted function declarations used after init.
import { lintForWrite } from "./vault-lint.mjs";

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
          throw new Error(`path escapes vault: ${userPath}`, { cause: err });
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
    throw new Error(`could not resolve any ancestor of: ${userPath}`, { cause: err });
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
          `re-read (or omit ifMatch to create it)`,
        { cause: err }
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
  // The advisory lock makes the ifMatch-check→rename span atomic against other
  // sidecar processes on this host (see vault-lock.mjs for scope and stealing).
  return withVaultLock(vaultAbs, "vault_write_file", async () => {
    if (opts.ifMatch) await assertEtagMatches(fp, opts.ifMatch);
    let newNote = false;
    try {
      await stat(fp);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      newNote = true;
    }
    // Opt-in frontmatter schema check (memory-schema.json): throws under
    // enforce mode — before the tmp write, so a violation never lands on disk.
    // Write-time hygiene lint (categories, unresolved links, orphan-at-birth):
    // warns only, never blocks.
    const warnings = [
      ...(await checkSchemaForWrite(vaultAbs, relPath, content)),
      ...(await lintForWrite(vaultAbs, relPath, [content], { newNote }))
    ];
    await mkdir(dirname(fp), { recursive: true });
    const tmp = `${fp}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, content, "utf8");
    await rename(tmp, fp);
    const result = { path: fp, bytes: Buffer.byteLength(content, "utf8"), etag: fileEtag(content) };
    if (warnings.length) result.warnings = warnings;
    return result;
  });
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
/** Any `---\n...\n---\n` block starting at a line boundary, anywhere in the text. */
const FRONTMATTER_BLOCK_ANYWHERE_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n/gm;

function countFrontmatterLike(text) {
  return (text.match(FRONTMATTER_BLOCK_ANYWHERE_RE) || []).length;
}

function wouldSelfPasteFrontmatter(originalText, finalText) {
  const fm = originalText.match(FRONTMATTER_RE);
  if (!fm) return false;
  const block = fm[0];
  const countIn = (s) => s.split(block).length - 1;
  if (countIn(finalText) > countIn(originalText)) return true;
  // Generalized beyond an exact-byte duplicate: a DIFFERENT frontmatter-shaped block
  // (hallucinated/rebuilt YAML, not a copy) pasted into the body is the same corruption.
  // Compare block counts in the body only (post leading-frontmatter), not the whole text,
  // so a note that legitimately uses two "---" thematic breaks in its body isn't punished
  // for edits that never touch that region.
  const originalBody = originalText.slice(block.length);
  const finalBody = finalText.slice((finalText.match(FRONTMATTER_RE)?.[0] ?? "").length);
  return countFrontmatterLike(finalBody) > countFrontmatterLike(originalBody);
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
  // Locked from the read to the rename: the single-match check below is only a
  // same-content guarantee if no other process rewrites the file mid-edit.
  return withVaultLock(vaultAbs, "vault_edit_file", async () => {
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
    // Lint ONLY the text these edits introduce — never pre-existing lines.
    const warnings = [
      ...(await checkSchemaForWrite(vaultAbs, relPath, text)),
      ...(await lintForWrite(
        vaultAbs,
        relPath,
        edits.map((e) => e.newText)
      ))
    ];
    // Atomic write
    const tmp = `${fp}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, text, "utf8");
    await rename(tmp, fp);
    const result = { path: fp, editsApplied: applied.length, etag: fileEtag(text) };
    if (warnings.length) result.warnings = warnings;
    return result;
  });
}

/** Obsidian's built-in vault-trash folder ("Move to vault trash" setting). Soft
 * deletes land here so both Obsidian and vault_move_file can restore them. */
const TRASH_DIR = ".trash";

/** Core memory-protocol notes (vault root). Deleting or moving one of these
 * breaks the recall/close ritual every session depends on, so the write tools
 * hard-refuse them — a human can still do it deliberately in Obsidian. */
const PROTECTED_NOTES = new Set([
  "start_here.md",
  "memory.md",
  "session_log.md",
  "known_failures.md"
]);

/** Vault-relative path (forward slashes) for a canonical absolute path. */
async function toVaultRel(vaultAbs, canonicalFp) {
  const vaultReal = await realpath(vaultAbs);
  return relative(vaultReal, canonicalFp).split(sep).join("/");
}

function isProtectedNote(rel) {
  return PROTECTED_NOTES.has(rel.toLowerCase());
}

/** All .md files under the vault, as vault-relative forward-slash paths.
 * Skips dot-directories (.obsidian, .trash, .obsidian-memory-rag, …) and
 * node_modules — link references only live in real notes. Exported for
 * vault-lint.mjs (wikilink resolution against the live file set). */
export async function listMarkdownFiles(vaultReal, relDir = "") {
  return walkMarkdown(vaultReal, relDir);
}

async function walkMarkdown(vaultReal, relDir = "") {
  const out = [];
  const entries = await readdir(relDir ? join(vaultReal, relDir) : vaultReal, {
    withFileTypes: true
  });
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const rel = relDir ? `${relDir}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walkMarkdown(vaultReal, rel)));
    else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) out.push(rel);
  }
  return out;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The names a [[wikilink]] can use to reach `rel`: full path and bare
 * basename, extension stripped for .md notes (Obsidian's link forms). */
function wikilinkNames(rel) {
  const noExt = rel.toLowerCase().endsWith(".md") ? rel.slice(0, -3) : rel;
  return [...new Set([noExt, noExt.split("/").pop()])];
}

/**
 * Report which notes still [[link]] to a note being deleted/moved. Matches
 * `[[<name>` followed by `]`, `#` or `|` (plain links, heading links, aliases,
 * embeds) — a boundary check so `[[typescript-advanced]]` never counts for a
 * note named `typescript`. Read-only: callers surface the list so the agent
 * (or human) updates links deliberately; nothing is rewritten.
 * @param {string} vaultReal canonical vault root
 * @param {string} targetRel vault-relative path of the affected note
 * @param {string} [excludeRel] skip this note (e.g. the moved file itself)
 * @returns {Promise<Array<{path: string, refs: number}>>}
 */
async function findWikilinkRefs(vaultReal, targetRel, excludeRel) {
  const patterns = wikilinkNames(targetRel).map(
    (n) => new RegExp(`\\[\\[${escapeRegExp(n)}(?=[\\]#|])`, "gi")
  );
  const refs = [];
  for (const rel of await walkMarkdown(vaultReal)) {
    if (rel === excludeRel) continue;
    let text;
    try {
      text = await readFile(join(vaultReal, rel), "utf8");
    } catch {
      continue; // racing writer/rotation — a vanished note simply has no refs
    }
    let count = 0;
    for (const re of patterns) count += (text.match(re) || []).length;
    if (count > 0) refs.push({ path: rel, refs: count });
  }
  return refs;
}

/**
 * Report the notes that [[link]] to `relPath` (self-references excluded).
 * Read-only impact check before a delete/move — the target does not need to
 * exist (useful for auditing links to an already-removed note).
 * @param {string} vaultAbs
 * @param {string} relPath
 * @returns {Promise<{target: string, names: string[], backlinks: Array<{path: string, refs: number}>}>}
 */
export async function vaultBacklinks(vaultAbs, relPath) {
  const fp = await safeVaultPath(vaultAbs, relPath);
  const vaultReal = await realpath(vaultAbs);
  const rel = await toVaultRel(vaultAbs, fp);
  return {
    target: rel,
    names: wikilinkNames(rel),
    backlinks: await findWikilinkRefs(vaultReal, rel, rel)
  };
}

/**
 * Append text to a file inside the vault, creating it (and parent dirs) if
 * missing. The cheap path for the close ritual's SESSION_LOG one-liners: no
 * read + single-line-anchor edit round-trip. Newlines in `text` are normalized
 * to the file's existing EOL (CRLF-aware — this vault's notes are CRLF), a
 * separating newline is guaranteed when the file doesn't end with one, and the
 * appended chunk always ends with one. With `opts.ifMatch` the append only
 * proceeds if the file still hashes to that etag from a prior read.
 * @param {string} vaultAbs
 * @param {string} relPath
 * @param {string} text
 * @param {{ifMatch?: string}} [opts]
 */
export async function vaultAppendFile(vaultAbs, relPath, text, opts = {}) {
  if (typeof text !== "string" || text.length === 0) {
    throw new Error("content is required (non-empty string)");
  }
  const fp = await safeVaultPath(vaultAbs, relPath);
  return withVaultLock(vaultAbs, "vault_append_file", async () => {
    let original = null;
    try {
      original = await readFile(fp, "utf8");
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    if (opts.ifMatch) {
      if (original == null) {
        throw new Error(
          `precondition failed: file does not exist but ifMatch "${opts.ifMatch}" was given — ` +
            `re-read (or omit ifMatch to create it)`
        );
      }
      const now = fileEtag(original);
      if (now !== opts.ifMatch) {
        throw new Error(
          `precondition failed: file changed since read (etag ${now} ≠ expected ${opts.ifMatch}) — ` +
            `re-read the file and retry`
        );
      }
    }
    const eol = original != null && original.includes("\r\n") ? "\r\n" : "\n";
    let chunk = text.replace(/\r\n/g, "\n").split("\n").join(eol);
    if (!chunk.endsWith(eol)) chunk += eol;
    let finalText;
    const created = original == null;
    if (created) {
      finalText = chunk;
    } else if (original.length === 0 || original.endsWith("\n")) {
      finalText = original + chunk;
    } else {
      finalText = original + eol + chunk;
    }
    // Lint only the appended chunk — the existing body wasn't touched.
    const warnings = [
      ...(await checkSchemaForWrite(vaultAbs, relPath, finalText)),
      ...(await lintForWrite(vaultAbs, relPath, [chunk], { newNote: created }))
    ];
    await mkdir(dirname(fp), { recursive: true });
    const tmp = `${fp}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, finalText, "utf8");
    await rename(tmp, fp);
    const result = {
      path: fp,
      created,
      bytesAppended:
        Buffer.byteLength(finalText, "utf8") -
        (original == null ? 0 : Buffer.byteLength(original, "utf8")),
      etag: fileEtag(finalText)
    };
    if (warnings.length) result.warnings = warnings;
    return result;
  });
}

/** Top-level frontmatter keys only: a colon or space in a key would let a
 * single `set` entry smuggle extra YAML lines/structure into the block. */
const FM_KEY_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

/**
 * Render a scalar for a frontmatter `key: value` line. Booleans/numbers pass
 * through; strings stay plain only when YAML cannot misread them (no leading
 * symbol, no bool/null/number look-alikes, no surrounding whitespace) —
 * everything else is JSON-quoted, which is valid YAML double-quoting.
 * @param {string | number | boolean} v
 * @returns {string}
 */
function yamlScalar(v) {
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  const s = String(v);
  const plain =
    /^[A-Za-z0-9][A-Za-z0-9 _./-]*$/.test(s) &&
    s === s.trim() &&
    !/^(true|false|null|yes|no|on|off)$/i.test(s) &&
    !/^[0-9.+-]+$/.test(s);
  return plain ? s : JSON.stringify(s);
}

/**
 * Set and/or remove TOP-LEVEL scalar keys in a note's YAML frontmatter without
 * text-matching (the memoria-evolutiva path: `status: hypothesis→confirmed`,
 * `last_verified`). Creates the block when the note has none. Every other line
 * — body, comments, unknown keys — is preserved byte-for-byte, and a key whose
 * value continues on an indented next line (nested/multi-line YAML) is refused
 * rather than corrupted. Removing a key that isn't there is reported in
 * `notFound`, not an error. With `opts.ifMatch` the write only proceeds if the
 * file still hashes to that etag.
 * @param {string} vaultAbs
 * @param {string} relPath
 * @param {{set?: Record<string, string | number | boolean>, remove?: string[], ifMatch?: string}} [opts]
 */
export async function vaultFrontmatterSet(vaultAbs, relPath, opts = {}) {
  const set = opts.set ?? {};
  const remove = opts.remove ?? [];
  const setKeys = Object.keys(set);
  if (setKeys.length === 0 && remove.length === 0) {
    throw new Error("nothing to do: pass set (key → scalar) and/or remove (keys)");
  }
  for (const k of [...setKeys, ...remove]) {
    if (!FM_KEY_RE.test(k)) {
      throw new Error(`invalid frontmatter key "${k}" (top-level plain keys only)`);
    }
  }
  for (const k of setKeys) {
    const t = typeof set[k];
    if (t !== "string" && t !== "number" && t !== "boolean") {
      throw new Error(`key "${k}": value must be a scalar (string/number/boolean), got ${t}`);
    }
  }
  const fp = await safeVaultPath(vaultAbs, relPath);
  return withVaultLock(vaultAbs, "vault_frontmatter_set", async () => {
    const original = opts.ifMatch
      ? await assertEtagMatches(fp, opts.ifMatch)
      : await readFile(fp, "utf8");
    const eol = original.includes("\r\n") ? "\r\n" : "\n";
    const m = original.match(FRONTMATTER_RE);
    let lines;
    let bodyStart;
    if (m) {
      const raw = m[0].split(/\r?\n/);
      lines = raw.slice(1, raw.length - 2); // drop opening ---, closing --- and trailing ""
      bodyStart = m[0].length;
    } else {
      lines = [];
      bodyStart = 0;
    }
    // A top-level `key:` line whose NEXT line is indented carries a nested or
    // folded value — replacing/removing just the first line would corrupt it.
    const isNested = (idx) => idx + 1 < lines.length && /^[ \t]/.test(lines[idx + 1]);
    const findKey = (key) => lines.findIndex((ln) => ln === `${key}:` || ln.startsWith(`${key}:`));
    const applied = { set: [], removed: [], notFound: [] };
    for (const key of setKeys) {
      const idx = findKey(key);
      if (idx >= 0 && isNested(idx)) {
        throw new Error(
          `key "${key}" has a nested/multi-line value — edit it with vault_edit_file instead`
        );
      }
      const line = `${key}: ${yamlScalar(set[key])}`;
      if (idx >= 0) lines[idx] = line;
      else lines.push(line);
      applied.set.push(key);
    }
    for (const key of remove) {
      const idx = findKey(key);
      if (idx < 0) {
        applied.notFound.push(key);
        continue;
      }
      if (isNested(idx)) {
        throw new Error(
          `key "${key}" has a nested/multi-line value — edit it with vault_edit_file instead`
        );
      }
      lines.splice(idx, 1);
      applied.removed.push(key);
    }
    const newBlock = lines.length ? ["---", ...lines, "---", ""].join(eol) : "";
    const finalText = newBlock + original.slice(bodyStart);
    if (finalText === original) {
      return { path: fp, ...applied, etag: fileEtag(original), unchanged: true };
    }
    const warnings = await checkSchemaForWrite(vaultAbs, relPath, finalText);
    const tmp = `${fp}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, finalText, "utf8");
    await rename(tmp, fp);
    return {
      path: fp,
      ...applied,
      etag: fileEtag(finalText),
      ...(warnings.length ? { warnings } : {})
    };
  });
}

/**
 * Delete a file inside the vault. Default is a SOFT delete: the file moves to
 * `.trash/<same relative path>` (uniquified on collision), restorable with
 * {@link vaultMoveFile} or from Obsidian's trash UI. `opts.permanent` unlinks
 * for real — the only way to remove something already in `.trash/`. Refuses
 * directories and the core protocol notes ({@link PROTECTED_NOTES}). With
 * `opts.ifMatch` the delete only proceeds if the file still hashes to that
 * etag from a prior read. Returns which notes still [[link]] to the deleted
 * note so the caller can fix them deliberately.
 * @param {string} vaultAbs
 * @param {string} relPath
 * @param {{ifMatch?: string, permanent?: boolean}} [opts]
 */
export async function vaultDeleteFile(vaultAbs, relPath, opts = {}) {
  const fp = await safeVaultPath(vaultAbs, relPath);
  const vaultReal = await realpath(vaultAbs);
  const rel = await toVaultRel(vaultAbs, fp);
  if (isProtectedNote(rel)) {
    throw new Error(
      `refusing to delete core protocol note "${rel}" — it anchors the memory protocol. ` +
        `If this is truly intended, do it manually in Obsidian/the file manager.`
    );
  }
  return withVaultLock(vaultAbs, "vault_delete_file", async () => {
    let st;
    try {
      st = await stat(fp);
    } catch (err) {
      if (err.code === "ENOENT") throw new Error(`file not found: ${rel}`, { cause: err });
      throw err;
    }
    if (!st.isFile()) {
      throw new Error(`refusing to delete "${rel}": not a regular file (directories unsupported)`);
    }
    if (opts.ifMatch) await assertEtagMatches(fp, opts.ifMatch);

    const inTrash = rel === TRASH_DIR || rel.startsWith(`${TRASH_DIR}/`);
    if (inTrash && !opts.permanent) {
      throw new Error(
        `"${rel}" is already in ${TRASH_DIR}/ — pass permanent: true to remove it for good, ` +
          `or vault_move_file to restore it`
      );
    }

    if (opts.permanent) {
      await unlink(fp);
      const linkRefs = await findWikilinkRefs(vaultReal, rel);
      return { deleted: rel, mode: "permanent", linkRefs };
    }

    let trashRel = `${TRASH_DIR}/${rel}`;
    try {
      await stat(join(vaultReal, trashRel));
      // Name collision in trash: uniquify with a timestamp, before the
      // extension when there is one, so nothing already trashed is clobbered.
      const dot = trashRel.lastIndexOf(".");
      trashRel =
        dot > trashRel.lastIndexOf("/")
          ? `${trashRel.slice(0, dot)}-${Date.now()}${trashRel.slice(dot)}`
          : `${trashRel}-${Date.now()}`;
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    const dest = join(vaultReal, ...trashRel.split("/"));
    await mkdir(dirname(dest), { recursive: true });
    await rename(fp, dest);
    const linkRefs = await findWikilinkRefs(vaultReal, rel);
    return {
      deleted: rel,
      mode: "trash",
      trashedTo: trashRel,
      restoreHint: `vault_move_file from "${trashRel}" back to "${rel}" restores it`,
      linkRefs
    };
  });
}

/**
 * Move/rename a file inside the vault (both endpoints vault-locked). Creates
 * destination parent dirs; refuses to overwrite an existing destination unless
 * `opts.overwrite`. Refuses directories and touching the core protocol notes
 * ({@link PROTECTED_NOTES}) on either end. With `opts.ifMatch` the move only
 * proceeds if the source still hashes to that etag. Does NOT rewrite
 * [[wikilinks]] — `staleLinkRefs` lists the notes still referencing the old
 * name so the caller updates them deliberately.
 * @param {string} vaultAbs
 * @param {string} fromPath
 * @param {string} toPath
 * @param {{ifMatch?: string, overwrite?: boolean}} [opts]
 */
export async function vaultMoveFile(vaultAbs, fromPath, toPath, opts = {}) {
  const from = await safeVaultPath(vaultAbs, fromPath);
  const to = await safeVaultPath(vaultAbs, toPath);
  const vaultReal = await realpath(vaultAbs);
  const fromRel = await toVaultRel(vaultAbs, from);
  const toRel = await toVaultRel(vaultAbs, to);
  if (from === to) {
    throw new Error(`source and destination are the same file: "${fromRel}"`);
  }
  if (isProtectedNote(fromRel)) {
    throw new Error(
      `refusing to move core protocol note "${fromRel}" — it anchors the memory protocol ` +
        `(rotate SESSION_LOG via obsidian-memory-rag rotate-log instead)`
    );
  }
  if (isProtectedNote(toRel)) {
    throw new Error(
      `refusing to overwrite core protocol note "${toRel}" via move — ` +
        `edit it in place with vault_edit_file instead`
    );
  }
  return withVaultLock(vaultAbs, "vault_move_file", async () => {
    let st;
    try {
      st = await stat(from);
    } catch (err) {
      if (err.code === "ENOENT") throw new Error(`file not found: ${fromRel}`, { cause: err });
      throw err;
    }
    if (!st.isFile()) {
      throw new Error(
        `refusing to move "${fromRel}": not a regular file (directories unsupported)`
      );
    }
    if (opts.ifMatch) await assertEtagMatches(from, opts.ifMatch);

    let destSt = null;
    try {
      destSt = await stat(to);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    if (destSt) {
      if (destSt.isDirectory()) {
        throw new Error(
          `destination "${toRel}" is a directory — pass the full target file path instead`
        );
      }
      if (!opts.overwrite) {
        throw new Error(`destination exists: "${toRel}" — pass overwrite: true to replace it`);
      }
    }

    const content = await readFile(from, "utf8");
    // Destination-side schema check: a note moved under a schema-governed
    // pattern must satisfy it just like a fresh write there would.
    const warnings = await checkSchemaForWrite(vaultAbs, toRel, content);
    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
    const staleLinkRefs = await findWikilinkRefs(vaultReal, fromRel, toRel);
    const result = {
      from: fromRel,
      to: toRel,
      overwrote: Boolean(destSt),
      etag: fileEtag(content),
      staleLinkRefs
    };
    if (staleLinkRefs.length) {
      result.note =
        "links were NOT rewritten — update these [[wikilinks]] deliberately (or leave them if " +
        "Obsidian still resolves the bare basename)";
    }
    if (warnings.length) result.warnings = warnings;
    return result;
  });
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
