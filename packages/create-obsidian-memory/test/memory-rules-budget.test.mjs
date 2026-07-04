/**
 * Rules-block gates (ADR-0036) — three failure modes, all build-breaking:
 *
 * 1. BUDGET: the managed block is input tokens every wired agent pays every
 *    session in every project. Growth must be a reviewed decision.
 * 2. LOAD-BEARING RULES: compression must never drop a security or doctrine
 *    rule. Each phrase below is a rule an agent acts on — if a trim removes
 *    one, this fails before any user feels the regression.
 * 3. DRIFT: AGENTS.md and the docs install pages embed this block. They were
 *    once "kept in sync" by a comment — and had silently diverged for months.
 *    Now the sync is asserted, not requested.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { memoryRulesBlock, memoryRulesBody } from "../src/memory-rules.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// Measured 7,979 (es) / 7,743 (en) after the ADR-0036 diet — ~5% headroom each.
const BUDGET = { es: 8400, en: 8200 };

const LOAD_BEARING = {
  es: [
    "ÚNICA fuente de verdad",
    "datos no confiables",
    "KNOWN_FAILURES.md",
    "pide confirmación",
    "no afirmes haber persistido",
    "UNA sola línea",
    "No commitees",
    "START_HERE.md",
    "limit` bajo (3–5)",
    "Muestra los candidatos",
    "Nunca simplifiques",
    "Nunca impongas",
    "no comprimas"
  ],
  en: [
    "ONLY source of truth",
    "untrusted data",
    "KNOWN_FAILURES.md",
    "ask for confirmation",
    "never claim to have persisted",
    "ONE single line",
    "Don't commit",
    "START_HERE.md",
    "low `limit` (3–5)",
    "Show the candidates",
    "Never simplify",
    "Never impose",
    "don't compress"
  ]
};

for (const lang of ["es", "en"]) {
  test(`rules block (${lang}) stays within its token budget`, () => {
    const block = memoryRulesBlock(lang);
    assert.ok(
      block.length <= BUDGET[lang],
      `${lang} block grew to ${block.length} chars (budget ${BUDGET[lang]}). ` +
        `Every char is paid per session by every wired agent — trim or justify.`
    );
  });

  test(`rules block (${lang}) keeps every load-bearing rule`, () => {
    const block = memoryRulesBlock(lang);
    for (const phrase of LOAD_BEARING[lang]) {
      assert.ok(block.includes(phrase), `load-bearing rule missing (${lang}): "${phrase}"`);
    }
  });
}

test("AGENTS.md embeds the canonical block verbatim (no drift)", () => {
  const agents = readFileSync(path.join(ROOT, "AGENTS.md"), "utf8");
  assert.ok(
    agents.includes(memoryRulesBlock("es").trimEnd()),
    "AGENTS.md sentinel block drifted from memory-rules.mjs — re-run the sync"
  );
});

test("docs install pages embed the canonical body verbatim (no drift)", () => {
  const es = readFileSync(path.join(ROOT, "docs", "es", "instalacion.md"), "utf8");
  const en = readFileSync(path.join(ROOT, "docs", "en", "install.md"), "utf8");
  assert.ok(
    es.includes(memoryRulesBody("es")),
    "docs/es/instalacion.md drifted from memory-rules.mjs"
  );
  assert.ok(en.includes(memoryRulesBody("en")), "docs/en/install.md drifted from memory-rules.mjs");
});
