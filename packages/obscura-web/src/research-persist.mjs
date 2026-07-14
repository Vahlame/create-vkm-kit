/**
 * Opt-in persistence for `obscura_research` (ADR-0056): turn curated passages from an
 * otherwise-ephemeral research call into a small, dedicated Markdown bank under
 * `OBSCURA_RESEARCH_DIR/<topic>/`, plus the "local" half of dual consolidation
 * (`obscura_consolidate` — the other half is Claude's own `/vkm-research` skill).
 *
 * Vault-agnostic by design (D2): plain `.md` files, no dependency on obsidian-memory-mcp/RAG —
 * obscura-web stays independently runnable. Every write is root-checked against the resolved
 * `OBSCURA_RESEARCH_DIR` (same defense-in-depth class as ADR-0040's vault root-lock, scoped
 * down to this package's own filesystem surface) and lands via tmp+rename, matching the rest
 * of the kit's atomic-write convention (see obsidian-memory-mcp/src/vault-fs.mjs).
 *
 * Layout (D1'):
 *   <root>/_index.md                 — global topic table (sources, last run, summary?)
 *   <root>/<topic>/_index.md         — hub: query log (pipeline-owned) + huecos (user-owned)
 *   <root>/<topic>/summary.md        — status: draft-local (this module) | consolidated (Claude)
 *   <root>/<topic>/sources/<hash8>-<slug>.md — one verbatim extract per source URL
 */
import { readFile, writeFile, mkdir, rename, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  checkOllama,
  ensureOllamaServer,
  summarizeNotes,
  OllamaUnavailableError,
  DEFAULT_MODEL,
  DEFAULT_MAX_INPUT_CHARS
} from "./ollama-client.mjs";

/** The one error type every validation/root-safety failure in this module collapses into —
 * same convention as {@link OllamaUnavailableError}: a `code` the caller (or a test) can match
 * on, a message safe to surface to the agent verbatim. */
export class ResearchPersistError extends Error {
  /** @param {string} message @param {string} code */
  constructor(message, code) {
    super(message);
    this.name = "ResearchPersistError";
    this.code = code;
  }
}

/** R1/acceptance criteria's exact slug shape: must start with a word char, then word chars or
 * hyphens only — already rejects path separators, `..`, and non-ASCII escape tricks outright. */
export const TOPIC_RE = /^[\w][\w-]*$/;

/** @param {unknown} topic @returns {string} */
export function validateTopic(topic) {
  if (typeof topic !== "string" || !TOPIC_RE.test(topic)) {
    throw new ResearchPersistError(
      `invalid topic "${topic}" — must match ${TOPIC_RE} (letters/digits/underscore/hyphen, ` +
        `starting with a letter/digit/underscore)`,
      "invalid_topic"
    );
  }
  return topic;
}

/**
 * Resolve the one writable root — no default is ever invented (R3): a missing env is a typed
 * error, not a silent fallback into some guessed directory.
 * @param {string} [override] mainly for tests; production callers rely on the env var
 * @returns {string} absolute, `path.resolve`d root
 */
export function resolveResearchRoot(override) {
  const dir = override ?? process.env.OBSCURA_RESEARCH_DIR;
  if (!dir) {
    throw new ResearchPersistError(
      "OBSCURA_RESEARCH_DIR is not set — persist:true (and obscura_consolidate) require a " +
        "configured research root; set the env var, no default is assumed.",
      "missing_root"
    );
  }
  return path.resolve(dir);
}

/**
 * Join path segments under `root` and refuse anything that resolves outside it — the
 * ROOT-CHECK the spec calls non-negotiable. Segments here are always either the regex-locked
 * `topic` or filenames this module itself derives (hash8+slug, fixed names), never raw
 * user text, but the check runs unconditionally rather than trusting that invariant silently.
 * @param {string} root already-resolved research root
 * @param {...string} segments
 * @returns {string}
 */
export function safeResearchPath(root, ...segments) {
  const candidate = path.resolve(root, ...segments);
  if (candidate !== root && !candidate.startsWith(root + path.sep)) {
    throw new ResearchPersistError(
      `path escapes research root: ${segments.join("/")}`,
      "path_escape"
    );
  }
  return candidate;
}

async function atomicWrite(fp, content) {
  await mkdir(path.dirname(fp), { recursive: true });
  const tmp = `${fp}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, fp);
}

async function fileExists(fp) {
  try {
    await stat(fp);
    return true;
  } catch {
    return false;
  }
}

// ── Minimal, self-authored YAML-frontmatter subset ─────────────────────────────────────────
// Only needs to round-trip what THIS module writes (scalars + one-level string arrays) — not
// a general YAML parser. Strings always double-quote (valid YAML, no ambiguity with `:`/`#`).

function yamlScalarLine(key, value) {
  if (Array.isArray(value)) {
    if (!value.length) return `${key}: []`;
    return [`${key}:`, ...value.map((v) => `  - ${JSON.stringify(String(v))}`)].join("\n");
  }
  if (typeof value === "boolean" || typeof value === "number") return `${key}: ${value}`;
  return `${key}: ${JSON.stringify(String(value))}`;
}

/** @param {Record<string, string|number|boolean|string[]>} fields */
function renderFrontmatter(fields) {
  const lines = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => yamlScalarLine(k, v));
  return `---\n${lines.join("\n")}\n---\n`;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** @param {string} text @returns {{ data: Record<string, unknown>, body: string }} */
function parseFrontmatter(text) {
  const m = text.match(FRONTMATTER_RE);
  if (!m) return { data: {}, body: text };
  const body = text.slice(m[0].length);
  const raw = m[1].split(/\r?\n/);
  const data = {};
  for (let i = 0; i < raw.length; i++) {
    const km = raw[i].match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!km) continue;
    const [, key, valRaw] = km;
    if (valRaw === "" && raw[i + 1] !== undefined && /^\s+-\s/.test(raw[i + 1])) {
      const arr = [];
      let j = i + 1;
      while (j < raw.length && /^\s+-\s/.test(raw[j])) {
        arr.push(coerceScalar(raw[j].replace(/^\s+-\s/, "")));
        j++;
      }
      data[key] = arr;
      i = j - 1;
      continue;
    }
    data[key] = coerceScalar(valRaw);
  }
  return { data, body };
}

function coerceScalar(v) {
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^".*"$/.test(v)) {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

// ── URL/title -> stable filename ────────────────────────────────────────────────────────────

/** Normalize a URL for dedup hashing only (not a general canonicalizer): lowercase host,
 * drop the fragment, drop a bare trailing `/`. Falls back to a trimmed lowercase string for
 * anything `URL` can't parse rather than throwing — dedup degrades, it never blocks a write. */
function normalizeUrl(raw) {
  try {
    const u = new URL(String(raw));
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    let s = u.toString();
    if (s.endsWith("/") && u.pathname === "/" && !u.search) s = s.slice(0, -1);
    return s;
  } catch {
    return String(raw ?? "").trim().toLowerCase();
  }
}

function hash8(url) {
  return createHash("sha256").update(normalizeUrl(url), "utf8").digest("hex").slice(0, 8);
}

/** Lowercase, transliterate accents away, keep `[a-z0-9-]` only, cap at ~40 chars. */
export function slugifyTitle(title, maxLen = 40) {
  const s = String(title ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, maxLen).replace(/-+$/g, "") || "untitled";
}

async function findSourceByHash(sourcesDir, h8) {
  let entries;
  try {
    entries = await readdir(sourcesDir);
  } catch {
    return null;
  }
  return entries.find((f) => f.startsWith(`${h8}-`) && f.endsWith(".md")) ?? null;
}

/** Append `- line` as the last bullet of a `## heading` section, never touching any other
 * section (the Huecos section stays exactly as the user left it). Creates the heading (with
 * the new line as its only bullet) if the body doesn't have it yet. */
function appendUnderHeading(body, heading, line) {
  const lines = body.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.trim() === heading);
  if (idx === -1) return `${body}\n${heading}\n\n- ${line}\n`;
  let end = lines.length;
  for (let i = idx + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  let insertAt = end;
  while (insertAt > idx + 1 && lines[insertAt - 1].trim() === "") insertAt--;
  lines.splice(insertAt, 0, `- ${line}`);
  return lines.join("\n");
}

async function countSources(sourcesDir) {
  try {
    return (await readdir(sourcesDir)).filter((f) => f.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

/** Create-or-update `<root>/<topic>/_index.md`: log the query (pipeline-owned section),
 * refresh the source counter, leave everything else (notably "Huecos / preguntas abiertas")
 * untouched. */
async function updateHub(root, topic, query, sourceCount) {
  const fp = safeResearchPath(root, topic, "_index.md");
  const nowIso = new Date().toISOString();
  let text;
  try {
    text = await readFile(fp, "utf8");
  } catch {
    text =
      renderFrontmatter({ topic, created: nowIso, sources: sourceCount }) +
      `\n# Research: ${topic}\n\n## Queries\n\n## Huecos / preguntas abiertas\n\n`;
  }
  const { data, body } = parseFrontmatter(text);
  data.sources = sourceCount;
  const newBody = appendUnderHeading(body, "## Queries", `${nowIso} — ${query}`);
  await atomicWrite(fp, renderFrontmatter(data) + newBody);
}

/** Rewrite `<root>/_index.md`'s one row for `topic` (create the table if this is the first
 * topic ever persisted). Fully pipeline-owned — regenerated from directory state each call,
 * unlike the per-topic hub's user-editable Huecos section. */
async function updateGlobalIndex(root, topic) {
  const fp = safeResearchPath(root, "_index.md");
  const sourceCount = await countSources(safeResearchPath(root, topic, "sources"));
  const hasSummary = await fileExists(safeResearchPath(root, topic, "summary.md"));
  const nowIso = new Date().toISOString();

  let rows = [];
  try {
    const lines = (await readFile(fp, "utf8")).split(/\r?\n/);
    const sep = lines.findIndex((l) => l.startsWith("|---"));
    if (sep !== -1) rows = lines.slice(sep + 1).filter((l) => l.trim().startsWith("|"));
  } catch {
    /* first-ever topic — start fresh */
  }
  const newRow = `| ${topic} | ${sourceCount} | ${nowIso} | ${hasSummary ? "yes" : "no"} |`;
  const idx = rows.findIndex((r) => r.split("|")[1]?.trim() === topic);
  if (idx >= 0) rows[idx] = newRow;
  else rows.push(newRow);

  const header = "# Research index\n\n| Topic | Sources | Last run | Summary |\n|---|---|---|---|\n";
  await atomicWrite(fp, header + rows.join("\n") + "\n");
}

/**
 * Persist `deepResearch`'s curated results (R1/R2/R3). Skips results whose fetch failed
 * (only a bare SERP snippet, never a page's actual verbatim content — not what a "source"
 * note is meant to hold). Dedup is by normalized-URL hash: a URL already in `sources/`
 * updates that same file in place (fresh `retrieved`, extract replaced if it changed) rather
 * than ever creating a second note for it.
 * @param {{ topic: string, query: string, results: Array<{url:string,title?:string,
 *           snippet?:string,extraction?:string,relevant?:boolean,fetchFailed?:boolean}>,
 *           researchDir?: string }} args
 * @returns {Promise<{ topic: string, written: number, updated: number, dir: string }>}
 */
export async function persistResults({ topic, query, results, researchDir } = {}) {
  validateTopic(topic);
  const root = resolveResearchRoot(researchDir);
  const topicDir = safeResearchPath(root, topic);
  const sourcesDir = safeResearchPath(root, topic, "sources");
  await mkdir(sourcesDir, { recursive: true });

  let written = 0;
  let updated = 0;
  const nowIso = new Date().toISOString();

  for (const r of results ?? []) {
    if (!r || !r.url || r.fetchFailed) continue;
    const h8 = hash8(r.url);
    const existingName = await findSourceByHash(sourcesDir, h8);
    const filename = existingName ?? `${h8}-${slugifyTitle(r.title)}.md`;
    const fp = safeResearchPath(root, topic, "sources", filename);

    let prevData = {};
    if (existingName) {
      ({ data: prevData } = parseFrontmatter(await readFile(fp, "utf8")));
    }

    const fields = {
      url: r.url,
      title: r.title ?? "",
      retrieved: nowIso,
      query: prevData.query ?? query,
      extraction: r.extraction ?? "heuristic",
      relevant: r.relevant !== false,
      origin: "web",
      status: prevData.status ?? "raw"
    };
    const body = String(r.snippet ?? "").trim();
    await atomicWrite(fp, `${renderFrontmatter(fields)}\n${body}\n`);
    if (existingName) updated++;
    else written++;
  }

  await updateHub(root, topic, query, await countSources(sourcesDir));
  await updateGlobalIndex(root, topic);

  return { topic, written, updated, dir: topicDir };
}

// ── obscura_consolidate (R7'/R8): local map-reduce draft summary ───────────────────────────

/** Chunk pre-formatted note texts so no chunk's joined text exceeds `maxChars` — a note is
 * never split across chunks (each item was already truncated to fit alone, if needed, by the
 * caller). */
function chunkNotes(items, maxChars) {
  const chunks = [];
  let cur = [];
  let curLen = 0;
  for (const item of items) {
    if (cur.length && curLen + item.text.length > maxChars) {
      chunks.push(cur);
      cur = [];
      curLen = 0;
    }
    cur.push(item);
    curLen += item.text.length;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/**
 * Map-reduce a list of note texts into one summary, each Ollama call bounded at `maxChars`.
 * One map pass over `notes` (batched, never splitting a note); if that yields more than one
 * batch, its partial summaries are reduced the same way, recursively, until a single call
 * produces the final summary.
 */
async function summarizeAll(notes, topic, maxChars, summarizeImpl) {
  let truncated = false;
  let level = notes.map((n) => {
    if (n.text.length <= maxChars) return n;
    truncated = true;
    return { text: n.text.slice(0, maxChars) };
  });

  // A lone over-length note (truncated above) can still equal maxChars exactly; chunkNotes
  // never splits it further, it just rides alone in its own chunk.
  for (;;) {
    const chunks = chunkNotes(level, maxChars);
    const summaries = [];
    for (const chunk of chunks) {
      const notesText = chunk.map((n) => n.text).join("\n\n---\n\n");
      const { summary } = await summarizeImpl({ topic, notesText });
      summaries.push({ text: summary });
    }
    if (chunks.length === 1) return { summary: summaries[0].text, truncated };
    level = summaries;
  }
}

/**
 * Local (Ollama) consolidation of a topic's `sources/` into `summary.md`, `status: draft-local`
 * (R7' modes: this is the "local" mode; `/vkm-research` is the Claude mode). Never touches a
 * `status: consolidated` summary — that is Claude-authored and the local model must not
 * overwrite it, `force` or not. No heuristic fallback: without Ollama this throws
 * {@link OllamaUnavailableError} outright (a summary a small model didn't actually write would
 * be worse than none).
 * @param {{ topic: string, force?: boolean, researchDir?: string, maxInputChars?: number }} args
 * @param {{ checkOllamaImpl?: typeof checkOllama, ensureOllamaImpl?: typeof ensureOllamaServer,
 *           summarizeImpl?: typeof summarizeNotes }} [deps]
 * @returns {Promise<{ sources_read: number, truncated: boolean, model: string, wrote: string }>}
 */
export async function consolidateTopic(
  { topic, force = false, researchDir, maxInputChars = DEFAULT_MAX_INPUT_CHARS } = {},
  deps = {}
) {
  const {
    checkOllamaImpl = checkOllama,
    ensureOllamaImpl = ensureOllamaServer,
    summarizeImpl = summarizeNotes
  } = deps;

  validateTopic(topic);
  const root = resolveResearchRoot(researchDir);
  const sourcesDir = safeResearchPath(root, topic, "sources");
  const summaryPath = safeResearchPath(root, topic, "summary.md");

  let files;
  try {
    files = (await readdir(sourcesDir)).filter((f) => f.endsWith(".md")).sort();
  } catch {
    files = [];
  }
  if (!files.length) {
    throw new ResearchPersistError(
      `no sources found under ${topic}/sources/ — nothing to consolidate`,
      "no_sources"
    );
  }

  let existingStatus = null;
  try {
    existingStatus = parseFrontmatter(await readFile(summaryPath, "utf8")).data.status ?? null;
  } catch {
    /* no existing summary.md — fresh write */
  }
  if (existingStatus === "consolidated") {
    throw new ResearchPersistError(
      `summary.md for "${topic}" is status:consolidated (Claude-authored) — the local model ` +
        `never overwrites it, regardless of force`,
      "consolidated_locked"
    );
  }
  if (existingStatus && !force) {
    throw new ResearchPersistError(
      `summary.md for "${topic}" already exists (status:${existingStatus}) — pass force:true to regenerate`,
      "draft_exists"
    );
  }

  if (process.env.OBSCURA_RESEARCH_OLLAMA !== "0") {
    await ensureOllamaImpl().catch(() => false);
  }
  const health = await checkOllamaImpl().catch(() => ({ ok: false, hasModel: false }));
  if (!health.ok || !health.hasModel) {
    throw new OllamaUnavailableError(
      "Ollama is unavailable (or the model isn't pulled) — obscura_consolidate has no " +
        "heuristic fallback for summaries.",
      health.ok ? "model_missing" : "unavailable"
    );
  }

  const notes = [];
  for (const f of files) {
    const { data, body } = parseFrontmatter(await readFile(safeResearchPath(root, topic, "sources", f), "utf8"));
    notes.push({
      text: `## ${f}\nurl: ${data.url ?? ""}\ntitle: ${data.title ?? ""}\n\n${body.trim()}`
    });
  }

  const { summary, truncated } = await summarizeAll(notes, topic, maxInputChars, summarizeImpl);

  const fm = renderFrontmatter({
    status: "draft-local",
    generated: new Date().toISOString(),
    model: DEFAULT_MODEL,
    sources: files
  });
  await atomicWrite(summaryPath, `${fm}\n${summary.trim()}\n`);
  await updateGlobalIndex(root, topic);

  return { sources_read: files.length, truncated, model: DEFAULT_MODEL, wrote: summaryPath };
}
