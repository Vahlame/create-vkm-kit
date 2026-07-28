#!/usr/bin/env node
/**
 * Negative control for a check: break the code on purpose, and see whether the check
 * notices.
 *
 * A green tells you two indistinguishable things — "the code is right" and "nothing was
 * examined". This separates them the only way they can be separated: by making the code
 * wrong and looking at the colour.
 *
 *   node prove-it.mjs --file src/thing.mjs --cmd "npm test"
 *
 * Verdicts:
 *   PROVEN   pass → fail → pass. The check watches this file; its green is evidence.
 *   VACUOUS  the check passed with the file broken. Its green means nothing for this change.
 *   DIRTY    the restore did not come back green. Stop and fix the tree.
 *
 * Safety, because this edits your working tree:
 *   - the original bytes are held in memory AND written to a sibling `.vkm-proveit.bak`
 *     before anything is touched; the file is restored on every exit path, including
 *     SIGINT and an unexpected throw;
 *   - the restore is verified by SHA-256 against the original, not assumed — a harness
 *     that mutates and restores has left a whole suite red before, which is why the third
 *     run exists at all;
 *   - it refuses a file with unstaged changes unless `--allow-dirty` is passed, so a failed
 *     restore can always be undone with git.
 *
 * Installed by create-vkm-kit (vkm-kit) as part of the vkm-verify skill.
 */
import { createHash } from "node:crypto";
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

export function parseArgs(argv) {
  const out = { file: null, cmd: null, allowDirty: false, timeoutMs: 600_000 };
  for (let i = 0; i < argv.length; i++) {
    const next = argv[i + 1];
    if (argv[i] === "--file" && next) out.file = next;
    else if (argv[i] === "--cmd" && next) out.cmd = next;
    else if (argv[i] === "--allow-dirty") out.allowDirty = true;
    else if (argv[i] === "--timeout" && next) out.timeoutMs = Number(next) * 1000;
  }
  return out;
}

/**
 * How to make `file` wrong in a way any real check must notice.
 *
 * For a test file, corrupting the syntax would only prove the RUNNER loads it, which is
 * not the question — so an assertion is inverted instead, which a real suite must catch
 * and a vacuous one will not. For everything else, unparseable source is the strongest
 * possible break: if a check tolerates that, it is not reading the file.
 *
 * @returns {{text: string, how: string} | null} null when nothing safe to mutate was found
 */
export function mutate(source, file) {
  const isTest = /\.(test|spec)\.[cm]?[jt]sx?$|(^|[/\\])tests?[/\\]|_test\.(py|go)$/i.test(file);

  if (isTest) {
    const flips = [
      [/assert\.equal\(/g, "assert.notEqual("],
      [/assert\.deepEqual\(/g, "assert.notDeepEqual("],
      [/assert\.ok\(/g, "assert.ok(!"],
      [/expect\((.+?)\)\.toBe\(/g, "expect($1).not.toBe("],
      [/assertEqual\(/g, "assertNotEqual("]
    ];
    for (const [re, to] of flips) {
      if (re.test(source)) {
        return { text: source.replace(re, to), how: `inverted every ${re.source} in the file` };
      }
    }
  }

  const ext = path.extname(file).toLowerCase();
  if ([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".go", ".rs", ".java", ".cs"].includes(ext)) {
    return {
      text: `${source}\n\nthis line is not valid ${ext.slice(1)} — vkm-verify\n`,
      how: "appended a syntax error"
    };
  }
  if ([".py"].includes(ext)) {
    return {
      text: `${source}\n\n  this line is not valid python — vkm-verify\n`,
      how: "appended a syntax error"
    };
  }
  if ([".json"].includes(ext)) return { text: `${source}\n{{`, how: "made the JSON unparseable" };
  return null;
}

function run(cmd, timeoutMs) {
  const r = spawnSync(cmd, { shell: true, encoding: "utf8", timeout: timeoutMs });
  return { ok: r.status === 0, status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function isTracked(file) {
  try {
    execSync(`git ls-files --error-unmatch "${file}"`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function isDirty(file) {
  try {
    return execSync(`git status --porcelain -- "${file}"`, { encoding: "utf8" }).trim().length > 0;
  } catch {
    return false;
  }
}

function main() {
  const { file, cmd, allowDirty, timeoutMs } = parseArgs(process.argv.slice(2));
  if (!file || !cmd) {
    console.error('usage: prove-it.mjs --file <path> --cmd "<check command>" [--allow-dirty]');
    process.exit(2);
  }
  if (!fs.existsSync(file)) {
    console.error(`prove-it: no such file: ${file}`);
    process.exit(2);
  }
  if (!allowDirty && isTracked(file) && isDirty(file)) {
    console.error(
      `prove-it: ${file} has uncommitted changes. Commit or stash them first so a failed\n` +
        "restore is recoverable with git, or pass --allow-dirty to accept that risk."
    );
    process.exit(2);
  }

  const original = fs.readFileSync(file);
  const originalHash = sha(original);
  const backup = `${file}.vkm-proveit.bak`;
  fs.writeFileSync(backup, original);

  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    try {
      fs.writeFileSync(file, original);
      if (sha(fs.readFileSync(file)) === originalHash) fs.rmSync(backup, { force: true });
      else console.error(`prove-it: RESTORE MISMATCH — original bytes are in ${backup}`);
    } catch (e) {
      console.error(`prove-it: could not restore ${file}: ${e?.message}. Backup: ${backup}`);
    }
  };
  process.on("SIGINT", () => {
    restore();
    process.exit(130);
  });

  try {
    const mutation = mutate(original.toString("utf8"), file);
    if (!mutation) {
      console.error(`prove-it: no safe mutation known for ${path.extname(file) || file}.`);
      console.error("Break it by hand instead, run the check, and confirm it goes red.");
      restore();
      process.exit(2);
    }

    process.stdout.write(`prove-it: ${file}\n  1/3 baseline … `);
    const before = run(cmd, timeoutMs);
    if (!before.ok) {
      console.log("FAILED");
      console.log(before.out.trim().split("\n").slice(-15).join("\n"));
      console.log("\nVerdict: INCONCLUSIVE — the check is already red. Fix that first.");
      restore();
      process.exit(1);
    }
    console.log("pass");

    fs.writeFileSync(file, mutation.text);
    process.stdout.write(`  2/3 broken on purpose (${mutation.how}) … `);
    const broken = run(cmd, timeoutMs);
    console.log(broken.ok ? "still passed" : "failed (good)");

    restore();
    process.stdout.write("  3/3 restored … ");
    const after = run(cmd, timeoutMs);
    console.log(after.ok ? "pass" : "FAILED");

    if (!after.ok) {
      console.log(
        "\nVerdict: DIRTY — the tree did not come back green after restoring.\n" +
          "Stop here and fix that: the check's own result is not trustworthy until it does."
      );
      process.exit(1);
    }
    if (broken.ok) {
      console.log(
        `\nVerdict: VACUOUS — "${cmd}" passed with ${file} broken.\n` +
          "It does not exercise this change: its green is not evidence for anything you did."
      );
      process.exit(1);
    }
    console.log(
      `\nVerdict: PROVEN — "${cmd}" fails when ${file} is wrong, and passes when it is not.`
    );
  } catch (e) {
    restore();
    console.error(`prove-it: ${e?.message || e}`);
    process.exit(2);
  }
}

// `file://` + argv[1] never matches on Windows (backslashes, no /C:/ prefix), which would
// make this whole script a silent no-op there — the exact failure class it exists to catch.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
