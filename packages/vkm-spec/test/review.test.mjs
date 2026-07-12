import test from "node:test";
import assert from "node:assert/strict";
import { parseEditorCommand, reviewInEditor } from "../src/review.mjs";

test("parseEditorCommand: plain space-separated command", () => {
  assert.deepEqual(parseEditorCommand("vim --wait"), { cmd: "vim", args: ["--wait"] });
});

test("parseEditorCommand: quoted path with spaces (Windows) is not torn apart", () => {
  const editor = '"C:\\Program Files\\Microsoft VS Code\\Code.exe" --wait';
  assert.deepEqual(parseEditorCommand(editor), {
    cmd: "C:\\Program Files\\Microsoft VS Code\\Code.exe",
    args: ["--wait"]
  });
});

test("parseEditorCommand: quoted path with no trailing args", () => {
  assert.deepEqual(parseEditorCommand('"C:\\Program Files\\Editor.exe"'), {
    cmd: "C:\\Program Files\\Editor.exe",
    args: []
  });
});

test("reviewInEditor: a broken $EDITOR keeps original text without throwing", () => {
  const prevEditor = process.env.EDITOR;
  const prevVisual = process.env.VISUAL;
  process.env.EDITOR = '"C:\\this\\path\\does\\not\\exist\\editor.exe" --wait';
  delete process.env.VISUAL;
  try {
    const result = reviewInEditor("original text");
    assert.equal(result, "original text");
  } finally {
    if (prevEditor === undefined) delete process.env.EDITOR;
    else process.env.EDITOR = prevEditor;
    if (prevVisual === undefined) delete process.env.VISUAL;
    else process.env.VISUAL = prevVisual;
  }
});
