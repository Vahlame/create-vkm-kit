/**
 * Pure helpers for the `memory_extract_candidates` MCP tool.
 *
 * Lives in its own module (not hybrid-mcp.mjs) so unit tests can import
 * `extractBullets` / `pickQueryTerms` without triggering hybrid-mcp.mjs's
 * top-level `main()` which spawns a StdioServerTransport that waits on
 * stdin forever — that turned CI's `test-node` job into an infinite hang.
 */

/**
 * Pull bullet lines out of free-form summary text. Recognizes "- ..." and "* ..." list items;
 * if none, falls back to sentence splitting. Trims and skips trivial entries.
 * @param {string} text
 * @returns {string[]}
 */
export function extractBullets(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("- ") || line.startsWith("* ")) {
      const body = line.replace(/^[-*]\s+/, "").trim();
      if (body.length >= 8) out.push(body);
    }
  }
  if (out.length > 0) return out;
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 16);
}

/**
 * Pick up to 3 meaningful query terms from a bullet for BM25 lookup.
 * Drops short / stopword-ish tokens, keeps alphanumeric/identifier-shaped words.
 * @param {string} bullet
 */
export function pickQueryTerms(bullet) {
  const tokens = bullet
    .split(/\s+/)
    .map((w) => w.replace(/[.,;:!?()`"']+$/g, "").replace(/^[.,;:!?()`"']+/g, ""))
    .filter((w) => w.length >= 4 && /^[\w][\w-]*$/.test(w));
  return tokens.slice(0, 3).join(" ");
}

/**
 * Classify a candidate bullet by kind so the close ritual can route it to the
 * right note and the failure-learning loop (ADR-0038) can structure lessons.
 * Deterministic keyword/shape heuristics, bilingual (EN/ES like the rest of the
 * kit), checked in priority order — a bullet naming a failure AND a fix is a
 * failure (the more actionable kind wins). Pure so it unit-tests trivially.
 * @param {string} bullet
 * @returns {"failure"|"gotcha"|"preference"|"decision"|"fact"}
 */
const FAILURE_RE =
  /(fail(ed|s|ure)|\berror(s|ed)?\b|crash|broke\b|broken|regress(ion|ed)|\bbugs?\b|root cause|fall(ó|aba|an|a al)|errores|romp(ió|ieron)|se cay(ó|e)|regresi(ón|on)|causa ra(í|i)z)/;
const FIX_AFTER_RE = /fix(ed|es)?\b.*\b(after|because|when)|arregl(ado|é|amos).*(tras|porque|cuando)/;
const GOTCHA_RE =
  /(watch out|careful|beware|gotcha|pitfall|only works? (if|when|with)|silently|counterintuitive|cuidado|\bojo\b|trampa|solo funciona (si|cuando|con)|silenciosamente)/;
const PREFERENCE_RE =
  /(\bprefers?\b|preferred|always use|never use|\bi (like|want|use)\b|prefier(o|e)|siempre (usa|usar|uso)|nunca (uses|usar|uso)|me gusta|quiero que)/;
const DECISION_RE =
  /(decided|decision\b|\bchose\b|chosen|agreed|settled on|we (use|will use)|decidi(mos|do|ó)|decisi(ón|on)|elegimos|acordamos|optamos)/;

export function classifyBullet(bullet) {
  const b = bullet.toLowerCase();
  // Priority order: a bullet naming both a failure and a decision is a failure —
  // the more actionable kind wins.
  if (FAILURE_RE.test(b) || FIX_AFTER_RE.test(b)) return "failure";
  if (GOTCHA_RE.test(b)) return "gotcha";
  if (PREFERENCE_RE.test(b)) return "preference";
  if (DECISION_RE.test(b)) return "decision";
  return "fact";
}

/**
 * Suggested target note for a candidate of the given kind — the write stays
 * human-approved; this is a routing hint the close ritual shows alongside the
 * candidate (KNOWN_FAILURES entries follow the structured format in the rules:
 * `- [failure] symptom #tag` / `- [root_cause] …` / `- [fix] …`).
 * @param {"failure"|"gotcha"|"preference"|"decision"|"fact"} kind
 * @returns {string}
 */
export function routeForKind(kind) {
  switch (kind) {
    case "failure":
      return "KNOWN_FAILURES.md";
    case "gotcha":
      return "STACKS/<tech>.md or PRACTICES/observations.md";
    case "preference":
      return "MEMORY.md";
    case "decision":
      return "PROJECTS/<project>.md or MEMORY.md";
    default:
      return "MEMORY.md";
  }
}
