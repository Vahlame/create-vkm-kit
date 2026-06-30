/**
 * Builds the <orchestration_package> XML from captured input + vault context.
 *
 * Reduced from the original 35-tag generic prompt-engineering catalog down to the
 * leaves that earn their place for THIS use case (coding task + project context):
 * guardrails/{constraints,forbidden,must_include}, format, example, note. Dropped
 * <thinking>/<reflect>/<self_critique>/<check>/<verify> — boilerplate self-check tags
 * don't reliably change behavior and, when the destination is Claude with the vault's
 * MCP wired, duplicate doctrine that's already in its CLAUDE.md.
 *
 * All free text goes through CDATA (not entity-escaping) so vault passages and code
 * snippets containing `<`/`>`/`&` stay human-readable instead of turning into `&lt;`
 * soup — the output is meant to be read and pasted, not parsed by an XML parser.
 *
 * Each leaf's indent is applied ONCE, at the start of its own `<tag>` — never recursed
 * into the CDATA payload's own internal newlines (a multi-line bullet list or pasted code
 * snippet keeps its original line breaks exactly, instead of getting silently reindented).
 */

function cdata(text) {
  const safe = String(text ?? "").replaceAll("]]>", "]]]]><![CDATA[>");
  return `<![CDATA[${safe}]]>`;
}

function pad(depth) {
  return "  ".repeat(depth);
}

/** A single `<tag>CDATA</tag>` line, indented at `depth` — content's own newlines untouched. */
function leaf(name, text, depth) {
  return `${pad(depth)}<${name}>${cdata(text)}</${name}>`;
}

function bulletBlock(items, fallback) {
  if (!items || items.length === 0) return fallback;
  return items.map((item) => `- ${item}`).join("\n");
}

function numberedBlock(items, fallback) {
  if (!items || items.length === 0) return fallback;
  return items.map((item, i) => `${i + 1}. ${item}`).join("\n");
}

const NO_HISTORY = {
  es: "No histórico registrado, proceder con estándares del stack.",
  en: "No history on record, proceed with stack defaults."
};
const NO_REQUIREMENT = {
  es: "Sin requisitos adicionales especificados.",
  en: "No additional requirements specified."
};

/**
 * @param {object} input
 * @param {"es"|"en"} [input.lang]
 * @param {string} input.systemRole
 * @param {string[]} [input.techStack]
 * @param {string[]} [input.activeFiles]
 * @param {string} [input.currentState]
 * @param {string[]} [input.historicalDecisions]
 * @param {string[]} [input.activePatterns]
 * @param {string} input.userIntent
 * @param {string[]} [input.functionalRequirements]
 * @param {string[]} [input.constraints]
 * @param {string[]} [input.forbidden]
 * @param {string[]} [input.mustInclude]
 * @param {string} [input.format] - omitted entirely when not given
 * @param {string} [input.example] - omitted entirely when not given
 * @param {string} [input.note] - omitted entirely when not given
 * @param {string} [input.tokenBudget] - one-line output-brevity rule; has a sane default
 * @returns {string}
 */
export function compileOrchestrationPackage(input) {
  const lang = input.lang === "en" ? "en" : "es";
  const noHistory = NO_HISTORY[lang];
  const noRequirement = NO_REQUIREMENT[lang];
  const defaultBudget =
    lang === "en"
      ? "Answer directly, no preamble, no restating the request — just the solution and the minimum explanation needed."
      : "Responde directo, sin preámbulo, sin repetir la consigna — solo la solución y la explicación mínima necesaria.";

  const guardrailLeaves = [
    input.constraints?.length ? leaf("constraints", bulletBlock(input.constraints), 2) : null,
    input.forbidden?.length ? leaf("forbidden", bulletBlock(input.forbidden), 2) : null,
    input.mustInclude?.length ? leaf("must_include", bulletBlock(input.mustInclude), 2) : null
  ].filter(Boolean);
  const guardrailsBody = guardrailLeaves.length ? guardrailLeaves.join("\n") : leaf("constraints", noHistory, 2);

  const sections = [
    leaf("system_role", input.systemRole, 1),
    `${pad(1)}<project_environment>`,
    leaf("tech_stack", bulletBlock(input.techStack, noHistory), 2),
    leaf("active_files", bulletBlock(input.activeFiles, noHistory), 2),
    leaf("current_state", input.currentState || noHistory, 2),
    `${pad(1)}</project_environment>`,
    `${pad(1)}<knowledge_base_context>`,
    leaf("historical_decisions", bulletBlock(input.historicalDecisions, noHistory), 2),
    leaf("active_patterns", bulletBlock(input.activePatterns, noHistory), 2),
    `${pad(1)}</knowledge_base_context>`,
    `${pad(1)}<execution_spec>`,
    leaf("user_intent", input.userIntent, 2),
    leaf("functional_requirements", numberedBlock(input.functionalRequirements, noRequirement), 2),
    `${pad(1)}</execution_spec>`,
    `${pad(1)}<guardrails>`,
    guardrailsBody,
    `${pad(1)}</guardrails>`,
    input.format ? leaf("format", input.format, 1) : null,
    input.example ? leaf("example", input.example, 1) : null,
    input.note ? leaf("note", input.note, 1) : null,
    `${pad(1)}<output_format_instructions>`,
    leaf("token_budget", input.tokenBudget || defaultBudget, 2),
    `${pad(1)}</output_format_instructions>`
  ].filter(Boolean);

  return `<orchestration_package>\n${sections.join("\n")}\n</orchestration_package>\n`;
}
