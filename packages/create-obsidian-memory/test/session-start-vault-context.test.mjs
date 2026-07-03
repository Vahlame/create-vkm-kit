import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildContext,
  compressIndex,
  truncateIndex,
  MAX_INDEX_CHARS,
  MAX_ENTRY_CHARS,
  reminders
} from "../src/hooks/session-start-vault-context.mjs";

function setupVault() {
  const vault = mkdtempSync(join(tmpdir(), "session-start-ctx-"));
  mkdirSync(join(vault, "_meta"));
  mkdirSync(join(vault, "PROJECTS"));
  return vault;
}

/** A realistic curated index: N verbose project entries under a heading. */
function verboseIndex(entries) {
  const bullets = Array.from(
    { length: entries },
    (_, i) =>
      `- \`proyecto-${i}.md\` — app de ejemplo número ${i} con una descripción larguísima que acumula historia, decisiones, fechas y detalles que solo importan al abrir la nota, no en el mapa de arranque de cada sesión.`
  );
  return `---\ntype: meta\n---\n\n# Vault index\n\n## PROJECTS\n\n${bullets.join("\n")}\n`;
}

test("truncateIndex leaves a short index content-identical (modulo trim)", () => {
  const short = "# index\n\nsmall content\n";
  assert.equal(truncateIndex(short, "es"), short.trim());
});

test("compressIndex keeps EVERY entry name while capping per-entry prose", () => {
  const out = compressIndex(verboseIndex(30));
  for (let i = 0; i < 30; i++) {
    assert.match(out, new RegExp(`proyecto-${i}\\.md`), `entry ${i} must stay visible`);
  }
  for (const line of out.split("\n")) {
    if (!line.startsWith("#")) {
      assert.ok(line.length <= MAX_ENTRY_CHARS + 1, `entry too long: ${line.length} chars`);
    }
  }
  // Headings survive untouched; YAML frontmatter does not.
  assert.match(out, /^# Vault index$/m);
  assert.match(out, /^## PROJECTS$/m);
  assert.doesNotMatch(out, /type: meta/);
});

test("compressIndex cuts bullets at a word boundary with an ellipsis", () => {
  const out = compressIndex("- `nota.md` — " + "palabra ".repeat(40));
  assert.ok(out.endsWith("…"));
  assert.doesNotMatch(out, /palabr…$/, "must not cut mid-word");
});

test("compressIndex drops over-cap prose instead of leaving a mid-sentence fragment", () => {
  const idx = [
    "# index",
    "",
    "Nota corta que sí cabe.",
    "",
    "Este párrafo larguísimo explica mantenimiento del índice con muchísimo detalle " +
      "que ninguna sesión necesita en su arranque y que cortado a media frase confunde más de lo que aporta.",
    "",
    "- `proyecto.md` — puntero que sí importa."
  ].join("\n");
  const out = compressIndex(idx);
  assert.match(out, /Nota corta que sí cabe\./, "short prose survives");
  assert.doesNotMatch(out, /larguísimo/, "over-cap prose is dropped whole, not truncated");
  assert.match(out, /proyecto\.md/, "pointers always survive");
  assert.doesNotMatch(out, /\n\n\n/, "no blank-run left where prose was dropped");
});

test("truncateIndex caps a pathologically large compressed index with a notice", () => {
  const out = truncateIndex(verboseIndex(120), "es");
  assert.ok(out.length <= MAX_INDEX_CHARS + 250);
  assert.match(out, /truncado/);
  assert.match(out, /vault_read_file\("_meta\/index\.md"\)/);
});

test("truncateIndex english notice", () => {
  const out = truncateIndex(verboseIndex(120), "en");
  assert.match(out, /truncated/);
});

test("buildContext caps the injected index.md content", () => {
  const vault = setupVault();
  try {
    writeFileSync(join(vault, "_meta", "index.md"), verboseIndex(200));
    const ctx = buildContext(vault, "es");
    // The whole additionalContext string must stay bounded even though the source
    // index.md is far larger — this is the fixed per-session token tax.
    assert.ok(ctx.length < MAX_INDEX_CHARS + reminders("es").length + 1000);
    assert.match(ctx, /truncado/);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test("buildContext includes a short index.md verbatim (no truncation notice)", () => {
  const vault = setupVault();
  try {
    writeFileSync(join(vault, "_meta", "index.md"), "# index\n\nshort\n");
    const ctx = buildContext(vault, "es");
    assert.match(ctx, /short/);
    assert.doesNotMatch(ctx, /truncado/);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test("buildContext omits the index section when it compresses to nothing", () => {
  const vault = setupVault();
  try {
    // Pathological index: only over-cap prose, zero pointers — compresses to "".
    writeFileSync(
      join(vault, "_meta", "index.md"),
      ("prosa larguísima sin bullets ".repeat(10) + "\n").repeat(4)
    );
    const ctx = buildContext(vault, "es");
    assert.doesNotMatch(ctx, /Indice curado/, "no empty labelled section");
    assert.match(ctx, /MEMORIA/, "reminders still present");
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test("buildContext degrades gracefully with no vault at all", () => {
  const ctx = buildContext("", "es");
  assert.equal(ctx, buildContext("", "es")); // deterministic
  assert.match(ctx, /MEMORIA/); // reminders always present
});

test("reminders mention the vault precedence rule in both languages", () => {
  assert.match(reminders("es"), /UNICA fuente de verdad/);
  assert.match(reminders("en"), /ONLY source of truth/);
});
