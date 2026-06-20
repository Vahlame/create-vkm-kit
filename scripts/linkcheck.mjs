#!/usr/bin/env node
// Offline relative-link checker for Markdown docs (complements the lychee CI job,
// which also covers external URLs). Resolves every `](path)` and `[ref]: path`
// target that is a relative file path and reports any that do not exist on disk.
// Skips http(s)/mailto/tel and pure #anchors. When a target is a local .md file,
// its #fragment is validated against the file's GitHub-style heading slugs.
//
// Usage: node scripts/linkcheck.mjs [rootDir]   (defaults to repo root ".")
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname, extname, relative } from "node:path";

const ROOT = resolve(process.argv[2] ?? ".");
const IGNORE_DIRS = new Set([".git", "node_modules", ".pytest_cache", "bin"]);

/** Recursively collect *.md files under ROOT, skipping ignored dirs. */
function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue;
      out.push(...walk(join(dir, e.name)));
    } else if (extname(e.name) === ".md") {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

const LINK_RE = /\]\(([^)]+)\)/g; // inline links/images
const REF_RE = /^\s*\[[^\]]+\]:\s+(\S+)/gm; // reference definitions

/** Build the set of GitHub-style heading slugs for a markdown file. */
function slugsFor(file) {
  const slugs = new Set();
  const txt = readFileSync(file, "utf8");
  for (const line of txt.split(/\r?\n/)) {
    const m = /^#{1,6}\s+(.*)$/.exec(line);
    if (!m) continue;
    const slug = m[1]
      .toLowerCase()
      .replace(/[`*_~]/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/[^\w\s-]/g, "")
      .trim()
      // GitHub maps each whitespace char to one hyphen and does NOT collapse
      // runs, so "Step 4 — Paste" (space–emdash–space) slugifies with a double
      // hyphen once the em-dash is stripped. Match that exactly.
      .replace(/\s/g, "-");
    slugs.add(slug);
  }
  return slugs;
}

const files = walk(ROOT);
const problems = [];

for (const file of files) {
  const txt = readFileSync(file, "utf8");
  const targets = [];
  let m;
  while ((m = LINK_RE.exec(txt))) targets.push(m[1].trim());
  while ((m = REF_RE.exec(txt))) targets.push(m[1].trim());

  for (const raw of targets) {
    const t = raw.replace(/^<|>$/g, "");
    if (/^(https?:|mailto:|tel:|#)/i.test(t)) continue; // external / same-page anchor
    const [pathPart, anchor] = t.split("#");
    if (!pathPart) continue;
    const abs = resolve(dirname(file), pathPart);
    if (!existsSync(abs)) {
      problems.push(`${relative(ROOT, file)} -> ${raw}  (missing file)`);
      continue;
    }
    if (anchor && extname(abs) === ".md" && statSync(abs).isFile()) {
      const slugs = slugsFor(abs);
      if (!slugs.has(anchor.toLowerCase())) {
        problems.push(`${relative(ROOT, file)} -> ${raw}  (missing anchor #${anchor})`);
      }
    }
  }
}

if (problems.length) {
  console.error(`linkcheck: ${problems.length} problem(s):`);
  for (const p of problems) console.error("  " + p);
  process.exit(1);
} else {
  console.log(
    `linkcheck: OK (${files.length} files scanned, all relative links + anchors resolve)`
  );
}
