/**
 * Lets the user actually look at and correct the compiled prompt before it's copied —
 * the user was explicit that they always want to review/fix it themselves. Opens
 * $VISUAL/$EDITOR on a temp file (same convention as `git commit`/`crontab -e`) when one
 * is configured; the temp file is removed afterward either way.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** @returns {string|null} */
export function editorCommand() {
  return process.env.VISUAL || process.env.EDITOR || null;
}

/**
 * @param {string} text
 * @returns {string} the (possibly edited) text; unchanged if no editor is configured or
 *   the editor exits non-zero (treated as "cancelled, keep the original").
 */
export function reviewInEditor(text) {
  const editor = editorCommand();
  if (!editor) return text;

  const tmp = path.join(os.tmpdir(), `obsidian-prompt-${process.pid}-${Date.now()}.xml`);
  fs.writeFileSync(tmp, text, "utf8");
  try {
    const [cmd, ...args] = editor.split(" ").filter(Boolean);
    const r = spawnSync(cmd, [...args, tmp], { stdio: "inherit" });
    if (r.error || r.status !== 0) return text; // editor failed/cancelled — keep the original
    return fs.readFileSync(tmp, "utf8");
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
