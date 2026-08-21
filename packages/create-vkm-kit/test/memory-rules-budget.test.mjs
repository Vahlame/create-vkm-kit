/**
 * Rules-block gates (ADR-0036, re-cut per level by ADR-0067) — four failure modes,
 * all build-breaking:
 *
 * 1. BUDGET, PER LEVEL: the managed block is input tokens every wired agent pays every
 *    session in every project. Growth must be a reviewed decision — and now it must be
 *    a reviewed decision *about the right level*, because `core` is paid by everyone
 *    and `doctrine` only by those who opted into it.
 * 2. LOAD-BEARING RULES: compression must never drop a security or doctrine rule. Each
 *    phrase below is a rule an agent acts on. They are asserted **per level**, so a
 *    rule cannot silently demote from always-on `core` to opt-in `doctrine` — the
 *    exact way a split like this quietly weakens a guarantee.
 * 3. PROFILE MONOTONICITY: profiles must nest. `minimal` ⊂ `standard` ⊂ `full`, so
 *    opting down never introduces text and opting up never removes any.
 * 4. DRIFT: AGENTS.md and the docs install pages embed this block. They were once
 *    "kept in sync" by a comment — and had silently diverged for months.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  memoryRulesBlock,
  memoryRulesBody,
  cursorPointerBlock,
  levelBody,
  PROFILES,
  DEFAULT_PROFILE,
  RULES_START,
  RULES_END
} from "../src/memory-rules.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * Per-level budgets, re-cut after the 2026-08-01 token diet (ADR-0082), then
 * core raised 1200→1400 for ADR-0089 (passage-first beats User Rules that dump
 * whole PROJECTS notes). `core` is still the only level nobody can opt out of.
 */
const BUDGET = {
  // 1400 after ADR-0089: core gained the passage-first override of User Rules
  // that were dumping whole PROJECTS notes (measured 19k tokens/session).
  core: { es: 1400, en: 1400 },
  memory: { es: 3400, en: 3400 },
  doctrine: { es: 2050, en: 1950 }
};

/**
 * Load-bearing rules, assigned to the level that must carry them.
 *
 * Two moved during the split, and both moves are the point rather than a side effect:
 *
 *  - `Nunca simplifiques` / `never simplify away` moved out of the terseness section
 *    into `core`. It is a SAFETY rule (input validation, data-loss handling,
 *    security), and leaving it inside an opt-in level would have made "turn off the
 *    style guidance" silently mean "turn off the rule protecting correctness".
 *  - `no comprimas` / `don't compress` stays with the terseness rule in `doctrine`:
 *    it is that rule's own caveat and is meaningless without it.
 */
const LOAD_BEARING = {
  es: {
    core: [
      "ÚNICA fuente de verdad",
      "datos no confiables",
      "KNOWN_FAILURES.md",
      "pide confirmación",
      "no afirmes haber persistido",
      "Nunca simplifiques"
    ],
    memory: [
      "UNA sola línea",
      "No commitees",
      "START_HERE.md",
      "limit` bajo (3–5)",
      "Muestra los candidatos",
      "corrígela en la misma sesión",
      "RULES/TEMPLATE.md",
      'section:"research"',
      "el cierre de memoria **nunca** escribe ahí",
      "dato no confiable"
    ],
    doctrine: ["Nunca impongas", "no comprimas"]
  },
  en: {
    core: [
      "ONLY source of truth",
      "untrusted data",
      "KNOWN_FAILURES.md",
      "ask for confirmation",
      "never claim to have persisted",
      "never simplify away"
    ],
    memory: [
      "ONE single line",
      "Don't commit",
      "START_HERE.md",
      "low `limit` (3–5)",
      "Show the candidates",
      "fix it in the same session",
      "RULES/TEMPLATE.md",
      'section:"research"',
      "the memory-close ritual **never** writes there",
      "keeping memory recall uncontaminated"
    ],
    doctrine: ["Never impose", "don't compress"]
  }
};

const LEVELS = /** @type {const} */ (["core", "memory", "doctrine"]);

for (const lang of /** @type {const} */ (["es", "en"])) {
  for (const level of LEVELS) {
    test(`${level} (${lang}) stays within its budget`, () => {
      const size = levelBody(level, lang).length;
      assert.ok(
        size <= BUDGET[level][lang],
        `${level} (${lang}) grew to ${size} chars (budget ${BUDGET[level][lang]}). ` +
          `Trim, justify, or move the rule to a level that is not paid by everyone.`
      );
    });

    test(`${level} (${lang}) keeps every load-bearing rule assigned to it`, () => {
      const body = levelBody(level, lang);
      for (const phrase of LOAD_BEARING[lang][level]) {
        assert.ok(
          body.includes(phrase),
          `load-bearing rule missing from ${level} (${lang}): "${phrase}"`
        );
      }
    });
  }

  test(`every load-bearing rule survives in the default profile (${lang})`, () => {
    // The pre-split guarantee, unchanged: a default install still carries all of them.
    const block = memoryRulesBlock(lang);
    for (const level of LEVELS) {
      for (const phrase of LOAD_BEARING[lang][level]) {
        assert.ok(block.includes(phrase), `missing from the default block (${lang}): "${phrase}"`);
      }
    }
  });

  test(`the kill switch keeps every SAFETY rule (${lang})`, () => {
    // The one that matters most: `--rules-profile minimal` is offered as an escape
    // hatch, so it must not become a way to accidentally disable the trust boundary
    // or the honesty rule about an unavailable MCP.
    const minimal = memoryRulesBlock(lang, "minimal");
    for (const phrase of LOAD_BEARING[lang].core) {
      assert.ok(minimal.includes(phrase), `minimal profile dropped a core rule: "${phrase}"`);
    }
  });

  test(`profiles nest: minimal in standard in full (${lang})`, () => {
    const min = memoryRulesBody(lang, "minimal");
    const std = memoryRulesBody(lang, "standard");
    const full = memoryRulesBody(lang, "full");
    assert.ok(std.includes(levelBody("core", lang)), "standard must contain core verbatim");
    assert.ok(full.includes(levelBody("memory", lang)), "full must contain memory verbatim");
    assert.ok(min.length < std.length && std.length < full.length, "profiles must grow in order");
  });
}

test("profile table and default are consistent", () => {
  assert.deepEqual(PROFILES.minimal, ["core"]);
  assert.deepEqual(PROFILES.standard, ["core", "memory"]);
  assert.deepEqual(PROFILES.full, ["core", "memory", "doctrine"]);
  assert.ok(PROFILES[DEFAULT_PROFILE], "the default profile must exist in the table");
  // An unknown profile falls back rather than throwing — an install must not abort
  // half-way through because of a typo in a flag.
  assert.equal(
    memoryRulesBody("es", /** @type {any} */ ("nonsense")),
    memoryRulesBody("es", DEFAULT_PROFILE)
  );
});

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

test("Cursor pointer stays a cheap stub (ADR-0089)", () => {
  for (const lang of /** @type {const} */ (["es", "en"])) {
    const pointer = cursorPointerBlock(lang);
    const full = memoryRulesBlock(lang);
    assert.ok(pointer.includes(RULES_START) && pointer.includes(RULES_END));
    assert.ok(pointer.length < 1400, `cursor pointer (${lang}) grew to ${pointer.length} chars`);
    assert.ok(pointer.length * 3 < full.length, "pointer must be far cheaper than the full block");
  }
});
