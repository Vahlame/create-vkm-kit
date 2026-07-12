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
 * Splits an $EDITOR/$VISUAL value into {cmd, args}. Honors a leading double-quoted
 * command (e.g. `"C:\Program Files\Microsoft VS Code\Code.exe" --wait`, common on
 * Windows) instead of naively splitting on every space, which tears such a path into
 * unusable fragments and sends a bogus `cmd` to spawnSync.
 * @param {string} editor
 * @returns {{cmd: string, args: string[]}}
 */
export function parseEditorCommand(editor) {
  const trimmed = editor.trim();
  if (trimmed.startsWith('"')) {
    const end = trimmed.indexOf('"', 1);
    if (end !== -1) {
      return {
        cmd: trimmed.slice(1, end),
        args: trimmed
          .slice(end + 1)
          .trim()
          .split(" ")
          .filter(Boolean)
      };
    }
  }
  const [cmd, ...args] = trimmed.split(" ").filter(Boolean);
  return { cmd, args };
}

/**
 * @param {string} text
 * @returns {string} the (possibly edited) text; unchanged if no editor is configured or
 *   the editor exits non-zero (treated as "cancelled, keep the original").
 */
export function reviewInEditor(text) {
  const editor = editorCommand();
  if (!editor) return text;

  const tmp = path.join(os.tmpdir(), `vkm-spec-${process.pid}-${Date.now()}.xml`);
  fs.writeFileSync(tmp, text, "utf8");
  try {
    const { cmd, args } = parseEditorCommand(editor);
    const r = spawnSync(cmd, [...args, tmp], { stdio: "inherit" });
    if (r.error || r.status !== 0) {
      // Silently falling back here previously hid a misconfigured $EDITOR/$VISUAL
      // entirely — surface it so it's discoverable instead of just "nothing happened".
      console.error(
        `vkm-spec: could not run $EDITOR/$VISUAL (${editor}) — ` +
          `${r.error?.message || `exit ${r.status}`}; keeping the original text.`
      );
      return text;
    }
    return fs.readFileSync(tmp, "utf8");
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
