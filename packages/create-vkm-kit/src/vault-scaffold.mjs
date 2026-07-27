/**
 * Finding an existing vault, and creating a starter one when there is none.
 *
 * # Why the starter vault is a template tree, not string literals
 *
 * The notes below used to live as ~206 lines of bilingual Markdown inside template
 * literals in `index.js`: every backtick, `${` and backslash in a vault document had to
 * be escaped to survive being JavaScript, and no editor rendered them as Markdown. They
 * are now real files under `templates/vault/{es,en}/`, which `files: ["templates"]`
 * already ships, so a change to a starter note is reviewable as a diff of prose.
 *
 * They are exempt from prettier and markdownlint (see both ignore files). That is not an
 * oversight: this tree is PAYLOAD written into the user's own directory, so what ships is
 * what they get byte for byte — and some of those bytes are load-bearing, e.g.
 * `SESSION_LOG.md` ends with a blank line because `vault_append_file` appends after it.
 * `test/vault-scaffold.test.mjs` is what guards the tree instead, including that both
 * languages ship the same file set.
 *
 * The one exception is the vault's `.gitignore`: **npm strips `.gitignore` from package
 * tarballs**, so a template file by that name would exist in the repo, pass every check,
 * and silently not be there for the user who installed from npm. It is written from
 * code below, with its content in one place.
 *
 * @module
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import fse from "fs-extra";
import pc from "picocolors";

/** The vault's own `.gitignore` — see the module note on why this is not a template file. */
const VAULT_GITIGNORE = ".obsidian-memory-rag/\n";

/** Cursor/VS Code workspace defaults: fewer `git` + `conhost` spikes on Windows (SCM polling). */
const VAULT_VSCODE_GIT_SETTINGS = {
  "git.autoRepositoryDetection": false,
  "git.autorefresh": false,
  "git.autofetch": false,
  "git.terminalAuthentication": false,
  "git.decorations.enabled": false,
  "git.timeline.enabled": false,
  "git.blame.editorDecoration.enabled": false,
  "git.blame.statusBarItem.enabled": false,
  "git.showProgress": false,
  "npm.autoDetect": "off",
  "files.watcherExclude": {
    "**/node_modules/**": true,
    "**/bin/**": true,
    "**/dist/**": true,
    "**/.cursor/**": true,
    "**/packages/**/node_modules/**": true,
    "**/.pytest_cache/**": true,
    "**/coverage/**": true,
    "**/.venv/**": true,
    "**/__pycache__/**": true,
    "**/.obsidian/**": true,
    "**/go.work.sum": true,
    "**/.git/objects/**": true,
    "**/.git/lfs/**": true
  }
};

/** The packaged starter tree for `lang`. @param {"es"|"en"} lang */
function templateRoot(lang) {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "templates", "vault", lang);
}

/**
 * The nearest ancestor of `cwd` that looks like a vault (contains `.obsidian`),
 * searching at most six levels up, then `~/Documents` itself as a last resort.
 *
 * The six-level bound is deliberate: an unbounded walk from a deeply nested
 * project directory can reach the drive root and adopt something the user never
 * meant as their vault. The `~/Documents` fallback is the directory itself, NOT
 * {@link defaultVaultPath} — a user who made `~/Documents` their vault is a real
 * case, and one the default path would miss.
 *
 * @param {string} cwd
 * @param {string} home
 * @returns {Promise<string|null>}
 */
export async function findVault(cwd, home) {
  let cur = cwd;
  for (let i = 0; i < 6; i++) {
    if (await fse.pathExists(path.join(cur, ".obsidian"))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  const h = path.join(home, "Documents");
  if (await fse.pathExists(path.join(h, ".obsidian"))) return h;
  return null;
}

/** Where a vault is created when the user names no path. @param {string} home */
export function defaultVaultPath(home) {
  return path.join(home, "Documents", "obsidian-memory-vault");
}

/**
 * Merge the workspace git/watcher defaults into `<vault>/.vscode/settings.json`,
 * preserving anything the user already set.
 * @param {string} vault
 * @param {boolean} dryRun
 */
export async function writeVaultGitWorkspaceSettings(vault, dryRun) {
  const fp = path.join(vault, ".vscode", "settings.json");
  if (dryRun) {
    console.log(pc.cyan("[dry-run] would merge"), fp);
    return;
  }
  await fse.ensureDir(path.dirname(fp));
  const existedBefore = await fse.pathExists(fp);
  /** @type {Record<string, any>} */
  let existing = {};
  if (existedBefore) {
    try {
      const raw = (await fse.readFile(fp, "utf8")).trim().replace(/^\uFEFF/, "");
      if (raw) existing = JSON.parse(raw);
    } catch {
      // The user's file, never ours to lose: back it up before starting from empty.
      const bak = `${fp}.bak.${Date.now()}`;
      await fse.copy(fp, bak);
      console.warn(pc.yellow("Invalid JSON in vault .vscode/settings.json; backed up to"), bak);
      existing = {};
    }
  }
  const merged = { ...existing };
  for (const [key, value] of Object.entries(VAULT_VSCODE_GIT_SETTINGS)) {
    if (key === "files.watcherExclude" && value && typeof value === "object") {
      const prev = /** @type {Record<string, boolean>} */ (
        existing[key] && typeof existing[key] === "object" ? existing[key] : {}
      );
      merged[key] = { ...prev, ...value };
    } else {
      merged[key] = value;
    }
  }
  // VS Code's bundled git can be missing or shadowed on Windows; pointing it at a real
  // install is what stops the SCM provider from retrying (and spawning conhost) forever.
  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files\\Git\\cmd\\git.exe",
      path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "cmd", "git.exe")
    ];
    const pf86 = process.env["ProgramFiles(x86)"];
    if (pf86) candidates.push(path.join(pf86, "Git", "cmd", "git.exe"));
    for (const g of candidates) {
      if (g && (await fse.pathExists(g))) {
        merged["git.path"] = g;
        break;
      }
    }
  }
  await fse.writeFile(fp, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  console.log(pc.green(existedBefore ? "Merged" : "Wrote"), fp);
}

/**
 * Create a starter vault at `vault` by copying the packaged tree for `lang`.
 *
 * The dry-run check lives HERE rather than at the call sites. It used to be a
 * parameter threaded 200 lines down and read once, on the last line, while the two
 * call sites disagreed about guarding it — so `--dry-run` wrote a full vault on the
 * default (interactive) path while the banner said nothing would be written. A guard
 * a caller can forget is not a guard.
 *
 * `overwrite: false` is load-bearing: this runs when `.obsidian` is absent, but the
 * directory itself may exist with the user's own files in it, and a starter template
 * must never clobber real notes.
 *
 * @param {string} vault absolute destination
 * @param {"es"|"en"} lang
 * @param {boolean} dryRun
 */
export async function scaffoldNewVault(vault, lang, dryRun) {
  if (dryRun) {
    console.log(pc.yellow("[dry-run] would scaffold a starter vault at"), vault);
    return;
  }
  await fse.ensureDir(path.join(vault, ".obsidian"));
  await fse.copy(templateRoot(lang), vault, { overwrite: false, errorOnExist: false });
  const gitignore = path.join(vault, ".gitignore");
  if (!(await fse.pathExists(gitignore))) {
    await fse.writeFile(gitignore, VAULT_GITIGNORE, "utf8");
  }
  await writeVaultGitWorkspaceSettings(vault, dryRun);
}
