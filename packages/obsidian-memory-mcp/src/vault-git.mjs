/**
 * Read-only git history for vault files.
 *
 * The sync daemon (`obsidian-memoryd`) commits every vault change, which makes
 * the repo a free time machine: `vault_git_history` lists a note's commits and
 * can return the note's content at a given rev — recovery even after a
 * `vault_delete_file permanent: true` (as long as the delete was pushed at
 * least once, git still has the blob).
 *
 * Deliberately read-only: no checkout, no reset, no restore — recovering a
 * version is "read the old content, write it back through the normal
 * vault-locked write tools", so every recovery goes through the same schema
 * checks and locking as any other write.
 *
 * Pure helper module (no MCP dependency), same rationale as vault-fs.mjs.
 */
import { execa } from "execa";
import { realpath } from "node:fs/promises";
import { relative, sep } from "node:path";
import { safeVaultPath } from "./vault-fs.mjs";

/** Commit-ish forms we accept: abbreviated/full hashes and HEAD~N/HEAD^N. A
 * strict allowlist (not a denylist) so a rev can never be parsed by git as an
 * option or an arbitrary refspec — history output supplies hashes anyway. */
const REV_RE = /^(?:[0-9a-f]{4,40}|HEAD(?:[~^]\d*)*)$/i;

/** Local repo reads are near-instant; anything slower is a wedged git (lock
 * contention with the daemon, antivirus scan) and must not hang the MCP call. */
const GIT_TIMEOUT_MS = 15_000;

/**
 * Run git against the vault repo and return stdout. Turns the usual failure
 * modes (git missing, not a repo, unknown rev/path) into actionable errors.
 * @param {string} vaultReal canonical vault root
 * @param {string[]} args
 * @returns {Promise<string>}
 */
async function runGit(vaultReal, args) {
  let r;
  try {
    r = await execa("git", ["-C", vaultReal, ...args], {
      reject: false,
      stripFinalNewline: true,
      timeout: GIT_TIMEOUT_MS
    });
  } catch (e) {
    if (e && e.code === "ENOENT") {
      throw new Error("git executable not found on PATH — vault_git_history needs git installed", {
        cause: e
      });
    }
    throw e;
  }
  if (r.timedOut) {
    throw new Error(`git timed out after ${GIT_TIMEOUT_MS}ms — repo busy or wedged, retry shortly`);
  }
  if (r.exitCode !== 0) {
    if (r.code === "ENOENT" || /\bENOENT\b/.test(r.shortMessage || "")) {
      throw new Error("git executable not found on PATH — vault_git_history needs git installed");
    }
    const detail = (r.stderr || r.stdout || "").split(/\r?\n/)[0] || `exit ${r.exitCode}`;
    if (/not a git repository/i.test(detail)) {
      throw new Error(
        "the vault is not a git repository — vault_git_history needs the sync repo " +
          "(obsidian-memoryd) or a manual `git init` in the vault"
      );
    }
    throw new Error(`git failed: ${detail}`);
  }
  return r.stdout;
}

/** Cap on a single old-version read, mirroring vault_read_file's whole-file cap. */
const MAX_SHOW_CHARS = 200_000;

/**
 * Without `opts.rev`: list the file's recent commits (`hash`, `date`,
 * `subject`), newest first, following renames. With `opts.rev`: return the
 * file's full content at that commit (`content`), capped at
 * {@link MAX_SHOW_CHARS} with a truncation notice.
 * @param {string} vaultAbs
 * @param {string} relPath
 * @param {{limit?: number, rev?: string}} [opts]
 */
export async function vaultGitHistory(vaultAbs, relPath, opts = {}) {
  const fp = await safeVaultPath(vaultAbs, relPath);
  const vaultReal = await realpath(vaultAbs);
  const rel = relative(vaultReal, fp).split(sep).join("/");

  if (opts.rev != null) {
    if (!REV_RE.test(opts.rev)) {
      throw new Error(
        `invalid rev "${opts.rev}" — pass a commit hash (or HEAD~N) from the history listing`
      );
    }
    const text = await runGit(vaultReal, ["show", `${opts.rev}:${rel}`]);
    const content =
      text.length > MAX_SHOW_CHARS
        ? `${text.slice(0, MAX_SHOW_CHARS)}\n\n[...truncated: ${text.length} chars total]`
        : text;
    return { path: rel, rev: opts.rev, content };
  }

  const limit = opts.limit ?? 10;
  const out = await runGit(vaultReal, [
    "log",
    "--follow",
    "-n",
    String(limit),
    "--date=iso-strict",
    "--format=%h%x09%ad%x09%s",
    "--",
    rel
  ]);
  const commits = out
    ? out
        .split(/\r?\n/)
        .filter(Boolean)
        .map((ln) => {
          const [hash, date, ...subject] = ln.split("\t");
          return { hash, date, subject: subject.join("\t") };
        })
    : [];
  return { path: rel, commits };
}
