import test from "node:test";
import assert from "node:assert/strict";
import { compileOrchestrationPackage } from "../src/compile-xml.mjs";

const base = {
  systemRole: "Sos un ingeniero senior.",
  userIntent: "agregar X"
};

test("compileOrchestrationPackage emits all six required sections", () => {
  const xml = compileOrchestrationPackage(base);
  for (const tag of [
    "system_role",
    "project_environment",
    "knowledge_base_context",
    "execution_spec",
    "guardrails",
    "output_format_instructions"
  ]) {
    assert.match(xml, new RegExp(`<${tag}>`), `missing <${tag}>`);
    assert.match(xml, new RegExp(`</${tag}>`), `missing </${tag}>`);
  }
  assert.match(xml, /<orchestration_package>/);
  assert.match(xml, /<\/orchestration_package>/);
});

test("empty lists render the 'no history' fallback, not an empty CDATA", () => {
  const xml = compileOrchestrationPackage(base);
  assert.match(xml, /<historical_decisions><!\[CDATA\[No histórico registrado/);
  assert.match(xml, /<active_patterns><!\[CDATA\[No histórico registrado/);
  assert.match(xml, /<tech_stack><!\[CDATA\[No histórico registrado/);
  // fallback is a status message, not a list item — no stray bullet prefix
  assert.doesNotMatch(xml, /<historical_decisions><!\[CDATA\[- No histórico/);
});

test("non-empty lists render as bullets / numbered items, not the fallback", () => {
  const xml = compileOrchestrationPackage({
    ...base,
    historicalDecisions: ["usamos SQLite"],
    activePatterns: ["[gotcha] algo"],
    functionalRequirements: ["debe loguear", "debe validar"]
  });
  assert.match(xml, /<historical_decisions><!\[CDATA\[- usamos SQLite\]\]>/);
  assert.match(xml, /<active_patterns><!\[CDATA\[- \[gotcha\] algo\]\]>/);
  assert.match(xml, /1\. debe loguear\n2\. debe validar/);
});

test("optional tags (format/example/note) are omitted entirely when not given", () => {
  const xml = compileOrchestrationPackage(base);
  assert.doesNotMatch(xml, /<format>/);
  assert.doesNotMatch(xml, /<example>/);
  assert.doesNotMatch(xml, /<note>/);
});

test("optional tags are included when given", () => {
  const xml = compileOrchestrationPackage({
    ...base,
    format: "responde en JSON",
    example: "input -> output",
    note: "el contexto es automático, verificalo"
  });
  assert.match(xml, /<format><!\[CDATA\[responde en JSON\]\]><\/format>/);
  assert.match(xml, /<example><!\[CDATA\[input -> output\]\]><\/example>/);
  assert.match(xml, /<note><!\[CDATA\[el contexto es automático, verificalo\]\]><\/note>/);
});

test("guardrails renders only the leaves that were given, omitting the rest", () => {
  const xml = compileOrchestrationPackage({ ...base, forbidden: ["no usar any"] });
  assert.match(xml, /<forbidden><!\[CDATA\[- no usar any\]\]><\/forbidden>/);
  assert.doesNotMatch(xml, /<constraints>/);
  assert.doesNotMatch(xml, /<must_include>/);
});

test("CDATA escapes a literal ']]>' so it can't break out of the section", () => {
  const xml = compileOrchestrationPackage({ ...base, userIntent: "algo con ]]> adentro" });
  assert.match(xml, /algo con \]\]\]\]><!\[CDATA\[> adentro/);
  // the escaped form must not contain a literal, unescaped "]]>" closing sequence early
  const opened = xml.indexOf("<user_intent><![CDATA[");
  const closed = xml.indexOf("]]></user_intent>");
  assert.ok(opened > -1 && closed > opened);
});

test("angle brackets and ampersands pass through CDATA unescaped (human-readable)", () => {
  const xml = compileOrchestrationPackage({ ...base, userIntent: "if (a < b && c > d)" });
  assert.match(xml, /<user_intent><!\[CDATA\[if \(a < b && c > d\)\]\]><\/user_intent>/);
});

test("multi-line CDATA content keeps its original line breaks, never reindented", () => {
  const xml = compileOrchestrationPackage({
    ...base,
    historicalDecisions: ["primero", "segundo"],
    functionalRequirements: ["uno", "dos", "tres"]
  });
  assert.match(xml, /<historical_decisions><!\[CDATA\[- primero\n- segundo\]\]>/);
  assert.match(xml, /<functional_requirements><!\[CDATA\[1\. uno\n2\. dos\n3\. tres\]\]>/);
});

test("lang:en uses the English fallback and token-budget copy", () => {
  const xml = compileOrchestrationPackage({ ...base, lang: "en" });
  assert.match(xml, /No history on record/);
  assert.match(xml, /Answer directly, no preamble/);
  assert.doesNotMatch(xml, /No histórico registrado/);
});
