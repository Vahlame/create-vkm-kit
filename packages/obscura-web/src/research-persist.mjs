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
import { hash8 } from "./url-identity.mjs";
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
  /** @type {Record<string, unknown>} */
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

// `normalizeUrl`/`hash8` now live in ./url-identity.mjs — one identity for the whole package
// instead of the three that had drifted apart (exact-match in serp.mjs and research.mjs, this
// normalizer here). Byte-identical behavior, asserted by url-identity.test.mjs's frozen digests:
// these name the notes already on disk under `sources/<hash8>-<slug>.md`, so they cannot move.

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
  // `data` is `Record<string, unknown>` (parseFrontmatter's honest return type — a round-tripped
  // frontmatter value could in principle be anything); in practice every value this module ever
  // writes is a scalar/string-array, matching renderFrontmatter's stricter input type.
  const scalarData = /** @type {Record<string, string|number|boolean|string[]>} */ (data);
  await atomicWrite(fp, renderFrontmatter(scalarData) + newBody);
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

  const header =
    "# Research index\n\n| Topic | Sources | Last run | Summary |\n|---|---|---|---|\n";
  await atomicWrite(fp, header + rows.join("\n") + "\n");
}

/**
 * Every URL hash already covered by a topic's `sources/` — the durable "seen" set behind
 * cross-session mass research.
 *
 * Scrapling's crawler checkpoints a `seen: set[hashed URLs]` to disk (pickle, atomic write,
 * `checkpoint.py`) specifically so a resumed crawl doesn't re-walk ground it already covered.
 * `RESEARCH/<topic>/sources/` already IS that durable seen-set — every file is named
 * `<hash8>-<slug>.md`, one per URL ever persisted for the topic — so this reuses it rather than
 * inventing a second, parallel bookkeeping file. `deepResearch` (via the MCP tool handler) reads
 * this before crawling and skips already-covered candidates, so a `persist:true` call spends its
 * `top_k` budget on genuinely NEW pages instead of re-fetching and re-curating ones a PREVIOUS
 * call (in a previous process, possibly days earlier) already put in the bank. That is what
 * turns "scan up to top_k pages" into a mass crawl that actually accumulates across many
 * invocations instead of covering the same top hits every time.
 *
 * Returns an empty set (never throws) when the topic doesn't exist yet — a first-ever research
 * call on a topic has nothing to skip, which is the correct behavior, not a degraded one.
 *
 * @param {string} topic
 * @param {string} [researchDir]
 * @returns {Promise<Set<string>>} 8-hex-char hashes, matching `url-identity.mjs#hash8`
 */
export async function listCoveredHashes(topic, researchDir) {
  const root = resolveResearchRoot(researchDir);
  const sourcesDir = safeResearchPath(root, topic, "sources");
  let entries;
  try {
    entries = await readdir(sourcesDir);
  } catch {
    return new Set();
  }
  const hashes = new Set();
  for (const f of entries) {
    const m = /^([0-9a-f]{8})-.+\.md$/.exec(f);
    if (m) hashes.add(m[1]);
  }
  return hashes;
}

/**
 * Persist `deepResearch`'s curated results (R1/R2/R3). Skips results whose fetch failed
 * (only a bare SERP snippet, never a page's actual verbatim content — not what a "source"
 * note is meant to hold). Dedup is by normalized-URL hash: a URL already in `sources/`
 * updates that same file in place (fresh `retrieved`, extract replaced if it changed) rather
 * than ever creating a second note for it.
 * @param {{ topic?: unknown, query?: string, results?: Array<{url:string,title?:string,
 *           author?:string,published?:string,snippet?:string,extraction?:string,
 *           relevant?:boolean,fetchFailed?:boolean}>,
 *           researchDir?: string }} [args] `topic` is `unknown`, not `string`: a missing/invalid
 *           topic is a caller error {@link validateTopic} rejects with a typed message, not a
 *           destructuring crash — so this must accept whatever a caller hands it, including {}.
 * @returns {Promise<{ topic: string, written: number, updated: number, dir: string }>}
 */
export async function persistResults({ topic, query, results, researchDir } = {}) {
  // A new binding, not a reassignment of `topic`: TS's control-flow narrowing does not carry an
  // `unknown` parameter's reassigned type through to later reads in checkJs (verified — a
  // `topic = validateTopic(topic)` reassignment still leaves `topic` typed `unknown` below).
  const topicSlug = validateTopic(topic);
  const root = resolveResearchRoot(researchDir);
  const topicDir = safeResearchPath(root, topicSlug);
  const sourcesDir = safeResearchPath(root, topicSlug, "sources");
  await mkdir(sourcesDir, { recursive: true });

  let written = 0;
  let updated = 0;
  const nowIso = new Date().toISOString();

  for (const r of results ?? []) {
    if (!r || !r.url || r.fetchFailed) continue;
    const h8 = hash8(r.url);
    const existingName = await findSourceByHash(sourcesDir, h8);
    const filename = existingName ?? `${h8}-${slugifyTitle(r.title)}.md`;
    const fp = safeResearchPath(root, topicSlug, "sources", filename);

    let prevData = {};
    if (existingName) {
      ({ data: prevData } = parseFrontmatter(await readFile(fp, "utf8")));
    }

    const fields = {
      url: r.url,
      title: r.title ?? "",
      // Attribution (ADR-0062): emitted ONLY when the caller supplies them (the seed-URL crawler
      // does; obscura_research does not), so a research note's frontmatter stays byte-identical to
      // the pre-ADR-0062 shape — no empty author/published keys appear on notes that never had them.
      ...(r.author ? { author: r.author } : {}),
      ...(r.published ? { published: r.published } : {}),
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

  await updateHub(root, topicSlug, query, await countSources(sourcesDir));
  await updateGlobalIndex(root, topicSlug);

  return { topic: topicSlug, written, updated, dir: topicDir };
}

// ── writeRunReport — deep-research job trace ────────────────────────────────────────────────

/** Filename shape `writeRunReport` accepts when a caller supplies one explicitly: must start
 * with a word char, then word chars/dots/hyphens only, and end in `.md`. That charset excludes
 * every path separator (`/`, `\`) and the leading-dot `..` traversal shape outright — see the
 * doc comment on {@link writeRunReport} for why this regex exists at all. */
const RUN_REPORT_FILENAME_RE = /^[\w][\w.-]*\.md$/;

/**
 * Write a background deep-research job's rendered run report to `<topic>/runs/<filename>`.
 *
 * Run reports are the durable trace of a background deep-research job (one file per run under
 * `<topic>/runs/`), append-only history — a new run never overwrites an old report because the
 * timestamped default filename (`new Date().toISOString()` with `:`/`.` swapped for `-`, so it
 * survives as a filename on every OS this kit targets) is unique per run. The filename regex
 * exists because `filename` is the ONE path segment a caller can influence here — `topic` is
 * already `validateTopic`-locked and `"runs"` is fixed by this function, unlike `persistResults`
 * where every segment is either regex-locked or derived by the module itself (hash8+slug); given
 * that, {@link safeResearchPath}'s root-containment check below is the second line of defense,
 * not the first.
 * @param {{ topic?: unknown, content?: string, filename?: string, researchDir?: string }} [args]
 *   `topic` is `unknown`, not `string` — see the same note on {@link persistResults}.
 * @returns {Promise<{ path: string, filename: string }>} the absolute path written and the
 *   filename actually used (echoes the generated default back when the caller didn't supply one).
 */
export async function writeRunReport({ topic, content, filename, researchDir } = {}) {
  const topicSlug = validateTopic(topic);
  const root = resolveResearchRoot(researchDir);
  const name = filename ?? `${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
  if (!RUN_REPORT_FILENAME_RE.test(name)) {
    throw new ResearchPersistError(
      `invalid run report filename "${name}" — must match ${RUN_REPORT_FILENAME_RE}`,
      "invalid_filename"
    );
  }
  const fp = safeResearchPath(root, topicSlug, "runs", name);
  await atomicWrite(fp, content ?? "");
  return { path: fp, filename: name };
}

// ── writeCrawlExport — seed-URL crawler machine-readable export (ADR-0062) ──────────────────

/** RFC 4180 field: always double-quoted, internal quotes doubled. Always-quoting is valid CSV and
 * removes every "does this value need escaping" edge case (commas, newlines, leading `=`/`+`). */
function csvField(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

/** The flat columns a crawl row projects to for CSV. JSON keeps the full row (assets, errors);
 * CSV is the spreadsheet-friendly subset a person skims. */
const CRAWL_CSV_COLUMNS = ["url", "title", "author", "date", "depth", "seed", "status"];

/**
 * Write a crawl's rows to `OBSCURA_RESEARCH_DIR/<topic>/crawl.json` and `crawl.csv` (requirement ②:
 * the durable, machine-readable record with per-fragment source attribution — URL/title/author/
 * date — that an attribution-preserving pipeline reads later). JSON carries the full rows (including
 * downloaded `assets` and any per-page `error`); CSV is the flat {@link CRAWL_CSV_COLUMNS} subset.
 * Both land via the module's atomic tmp+rename and are root-checked under the research root. Fixed
 * filenames (not timestamped): a crawl of a topic is a living record refreshed in place as the crawl
 * makes progress, mirroring how `sources/` dedups by URL rather than appending a new run each flush.
 *
 * @param {{ topic?: unknown, rows?: object[], researchDir?: string }} [args]
 * @returns {Promise<{ json: string, csv: string, rows: number }>}
 */
export async function writeCrawlExport({ topic, rows, researchDir } = {}) {
  const topicSlug = validateTopic(topic);
  const root = resolveResearchRoot(researchDir);
  const list = Array.isArray(rows) ? rows : [];

  const jsonPath = safeResearchPath(root, topicSlug, "crawl.json");
  const csvPath = safeResearchPath(root, topicSlug, "crawl.csv");

  await atomicWrite(jsonPath, `${JSON.stringify(list, null, 2)}\n`);

  const header = CRAWL_CSV_COLUMNS.join(",");
  const body = list
    .map((r) => CRAWL_CSV_COLUMNS.map((c) => csvField(/** @type {any} */ (r)[c])).join(","))
    .join("\r\n");
  await atomicWrite(csvPath, `${header}\r\n${body}${list.length ? "\r\n" : ""}`);

  return { json: jsonPath, csv: csvPath, rows: list.length };
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
 * @param {{ topic?: unknown, force?: boolean, researchDir?: string, maxInputChars?: number }} [args]
 *           `topic` is `unknown`, not `string` — see {@link persistResults}'s same choice.
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

  // A new binding, not a reassignment: see the same note in `persistResults`.
  const topicSlug = validateTopic(topic);
  const root = resolveResearchRoot(researchDir);
  const sourcesDir = safeResearchPath(root, topicSlug, "sources");
  const summaryPath = safeResearchPath(root, topicSlug, "summary.md");

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
    const { data, body } = parseFrontmatter(
      await readFile(safeResearchPath(root, topicSlug, "sources", f), "utf8")
    );
    notes.push({
      text: `## ${f}\nurl: ${data.url ?? ""}\ntitle: ${data.title ?? ""}\n\n${body.trim()}`
    });
  }

  const { summary, truncated } = await summarizeAll(notes, topicSlug, maxInputChars, summarizeImpl);

  const fm = renderFrontmatter({
    status: "draft-local",
    generated: new Date().toISOString(),
    model: DEFAULT_MODEL,
    sources: files
  });
  await atomicWrite(summaryPath, `${fm}\n${summary.trim()}\n`);
  await updateGlobalIndex(root, topicSlug);

  return { sources_read: files.length, truncated, model: DEFAULT_MODEL, wrote: summaryPath };
}
