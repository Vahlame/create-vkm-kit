#!/usr/bin/env node
// Static on-page SEO audit — the executable half of vkm-seo. Fetches a URL (or reads a
// local HTML file) and runs deterministic checks over the DELIVERED HTML: metadata,
// heading structure, structured data, social cards, hreflang, robots directives, link
// hygiene. Output is report.json + a severity-ordered finding list, so the optimization
// loop is measure -> fix -> re-measure, never "this should rank better now".
//
// HONEST SCOPE: static HTML only. No crawling, no JS rendering, no rankings, no search
// volumes, no Core Web Vitals field data. Network checks (robots.txt, sitemap) run only
// for http(s) targets and are reported NOT RUN otherwise — never faked.
//
// Usage:  node seo-audit.mjs <url-or-file.html> [--out DIR] [--max-findings N]
// Exit:   0 = no findings · 1 = findings · 2 = usage error · 3 = target unreachable.
import fs from "node:fs";
import path from "node:path";

function usage(msg) {
  if (msg) console.error(`seo-audit: ${msg}`);
  console.error("usage: node seo-audit.mjs <url-or-file.html> [--out DIR] [--max-findings N]");
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { target: null, out: "./seo-audit", maxFindings: 60 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") opts.out = argv[++i];
    else if (a === "--max-findings") opts.maxFindings = Number(argv[++i]) || 60;
    else if (a.startsWith("--")) usage(`unknown flag ${a}`);
    else if (!opts.target) opts.target = a;
    else usage(`unexpected argument ${a}`);
  }
  if (!opts.target) usage("missing target");
  return opts;
}

/** All <tag ...> occurrences with their attribute string; regex-parsed on purpose (zero deps). */
function tags(html, name) {
  const re = new RegExp(`<${name}\\b([^>]*)>`, "gis");
  const out = [];
  let m;
  while ((m = re.exec(html))) out.push(m[1] ?? "");
  return out;
}

function attr(attrs, name) {
  const m = attrs.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[2] ?? m[3] ?? m[4] ?? "").trim() : null;
}

function inner(html, name) {
  const m = html.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

function blocks(html, name) {
  const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "gi");
  const out = [];
  let m;
  while ((m = re.exec(html))) out.push(m[0]);
  return out;
}

const F = (check, severity, detail) => ({ check, severity, detail });

/**
 * Every static check, over one HTML document. Pure: html + baseUrl in, findings out.
 * Length windows follow the vkm-seo references (titles ~50-60 chars shown in SERPs,
 * descriptions ~70-160): outside the window is a warn, missing entirely is an error.
 */
export function auditHtml(html, { baseUrl = null } = {}) {
  const findings = [];
  const push = (f) => f && findings.push(f);

  // ---- <head> metadata ---------------------------------------------------------------
  const title = inner(html, "title");
  if (!title) push(F("title", "error", "no <title>"));
  else if (title.length > 60)
    push(F("title", "warn", `title is ${title.length} chars (>60 gets truncated in SERPs)`));
  else if (title.length < 15) push(F("title", "warn", `title is ${title.length} chars (thin)`));

  const metas = tags(html, "meta");
  const metaOf = (n) =>
    metas
      .filter((a) => (attr(a, "name") ?? attr(a, "property"))?.toLowerCase() === n)
      .map((a) => attr(a, "content") ?? "");
  const desc = metaOf("description")[0];
  if (desc === undefined) push(F("meta-description", "error", "no meta description"));
  else if (desc.length < 50 || desc.length > 160)
    push(F("meta-description", "warn", `description is ${desc.length} chars (window 50-160)`));

  const robotsMeta = metaOf("robots").join(",").toLowerCase();
  if (/noindex/.test(robotsMeta))
    push(
      F("noindex", "error", `meta robots contains noindex ("${robotsMeta}") — page cannot rank`)
    );
  if (!tags(html, "meta").some((a) => (attr(a, "name") ?? "").toLowerCase() === "viewport"))
    push(F("viewport-meta", "warn", 'no <meta name="viewport"> — mobile-first indexing suffers'));

  const canonicals = tags(html, "link").filter(
    (a) => (attr(a, "rel") ?? "").toLowerCase() === "canonical"
  );
  if (canonicals.length === 0) push(F("canonical", "warn", "no rel=canonical link"));
  else if (canonicals.length > 1)
    push(F("canonical", "error", `${canonicals.length} canonical links — pick one`));
  else {
    const href = attr(canonicals[0], "href") ?? "";
    if (!/^https?:\/\//i.test(href))
      push(F("canonical", "warn", `canonical is not an absolute URL ("${href}")`));
  }

  const langAttr = attr(tags(html, "html")[0] ?? "", "lang");
  if (!langAttr) push(F("lang", "warn", "<html> has no lang attribute"));

  // ---- headings ----------------------------------------------------------------------
  const h1s = blocks(html, "h1");
  if (h1s.length === 0) push(F("h1", "error", "no <h1>"));
  else if (h1s.length > 1)
    push(F("h1", "warn", `${h1s.length} <h1> elements — one topic per page`));
  const levels = [...html.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] > levels[i - 1] + 1) {
      push(
        F(
          "heading-order",
          "warn",
          `heading level jumps h${levels[i - 1]} -> h${levels[i]} (position ${i + 1})`
        )
      );
      break; // one report is enough to signal the pattern
    }
  }

  // ---- images ------------------------------------------------------------------------
  const imgs = tags(html, "img");
  const noAlt = imgs.filter((a) => attr(a, "alt") === null).length;
  if (imgs.length && noAlt)
    push(F("img-alt", "warn", `${noAlt}/${imgs.length} images have no alt attribute`));

  // ---- structured data ---------------------------------------------------------------
  const ldBlocks = blocks(html, "script").filter((b) =>
    /type\s*=\s*["']?application\/ld\+json/i.test(b)
  );
  if (ldBlocks.length === 0) {
    push(F("json-ld", "warn", "no JSON-LD structured data"));
  } else {
    for (const b of ldBlocks) {
      const body = b.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, "");
      try {
        const parsed = JSON.parse(body.trim());
        const types = [parsed].flat().flatMap((n) => (n && n["@type"] ? [n["@type"]].flat() : []));
        if (!types.length) push(F("json-ld", "warn", "JSON-LD block without @type"));
      } catch {
        push(F("json-ld", "error", "JSON-LD block is not valid JSON"));
      }
    }
  }

  // ---- social cards ------------------------------------------------------------------
  for (const p of ["og:title", "og:description", "og:image"]) {
    if (!metaOf(p).length) push(F("open-graph", "warn", `missing ${p}`));
  }
  if (!metaOf("twitter:card").length) push(F("twitter-card", "warn", "missing twitter:card"));

  // ---- hreflang ----------------------------------------------------------------------
  const hreflangs = tags(html, "link").filter(
    (a) => (attr(a, "rel") ?? "").toLowerCase() === "alternate" && attr(a, "hreflang")
  );
  if (hreflangs.length) {
    const codes = hreflangs.map((a) => (attr(a, "hreflang") ?? "").toLowerCase());
    if (!codes.includes("x-default"))
      push(F("hreflang", "warn", `hreflang set (${codes.join(", ")}) has no x-default`));
  }

  // ---- links -------------------------------------------------------------------------
  const anchors = tags(html, "a");
  const hrefs = anchors.map((a) => attr(a, "href") ?? "");
  const internal = hrefs.filter((h) => h && !/^(https?:)?\/\//i.test(h) && !h.startsWith("#"));
  const empty = [...html.matchAll(/<a\b[^>]*>(\s*)<\/a>/gi)].length;
  if (anchors.length && internal.length === 0)
    push(F("internal-links", "warn", "no internal links found — orphan-page smell"));
  if (empty) push(F("empty-anchor", "warn", `${empty} <a> elements with empty anchor text`));
  if (baseUrl && baseUrl.startsWith("https://")) {
    const mixed = hrefs
      .concat(imgs.map((a) => attr(a, "src") ?? ""))
      .filter((u) => /^http:\/\//i.test(u)).length;
    if (mixed)
      push(F("mixed-content", "warn", `${mixed} plain http:// references on an https page`));
  }

  return findings;
}

/** robots.txt + sitemap reachability — http(s) targets only. */
async function networkChecks(url) {
  const findings = [];
  const notRun = [];
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    return { findings, notRun: ["robots-txt", "sitemap"] };
  }
  try {
    const r = await fetch(`${origin}/robots.txt`, { redirect: "follow" });
    if (!r.ok) {
      findings.push(F("robots-txt", "warn", `robots.txt -> HTTP ${r.status}`));
    } else {
      const text = await r.text();
      if (!/^\s*sitemap\s*:/im.test(text))
        findings.push(F("sitemap", "warn", "robots.txt has no Sitemap: line"));
      const pathName = new URL(url).pathname;
      if (/^\s*disallow\s*:\s*\/\s*$/im.test(text))
        findings.push(
          F(
            "robots-txt",
            "error",
            `robots.txt has "Disallow: /" (site-wide block; check it covers ${pathName} intentionally)`
          )
        );
    }
  } catch {
    notRun.push("robots-txt", "sitemap");
  }
  return { findings, notRun };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const isUrl = /^https?:\/\//i.test(opts.target);
  let html;
  let baseUrl = null;
  if (isUrl) {
    baseUrl = opts.target;
    try {
      const r = await fetch(opts.target, { redirect: "follow" });
      if (!r.ok) {
        console.error(`seo-audit: ${opts.target} -> HTTP ${r.status}`);
        process.exit(3);
      }
      html = await r.text();
    } catch (e) {
      console.error(`seo-audit: could not fetch ${opts.target}: ${e?.message ?? e}`);
      process.exit(3);
    }
  } else {
    try {
      html = fs.readFileSync(opts.target, "utf8");
    } catch (e) {
      console.error(`seo-audit: could not read ${opts.target}: ${e?.message ?? e}`);
      process.exit(3);
    }
  }

  const findings = auditHtml(html, { baseUrl });
  let notRun = ["robots-txt", "sitemap"];
  if (isUrl) {
    const net = await networkChecks(opts.target);
    findings.push(...net.findings);
    notRun = net.notRun;
  }
  // The mixed-content check only evaluates on https targets — the NOT RUN guarantee in
  // SKILL.md is load-bearing, so anything else must say so instead of silently passing.
  if (!baseUrl || !baseUrl.startsWith("https://")) notRun = [...notRun, "mixed-content"];

  const rank = { error: 0, warn: 1 };
  findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
  const kept = findings.slice(0, opts.maxFindings);
  const summary = {
    target: opts.target,
    errors: kept.filter((f) => f.severity === "error").length,
    warnings: kept.filter((f) => f.severity === "warn").length,
    dropped: Math.max(0, findings.length - kept.length),
    notRun
  };
  fs.mkdirSync(opts.out, { recursive: true });
  fs.writeFileSync(
    path.join(opts.out, "report.json"),
    JSON.stringify({ summary, findings: kept }, null, 2)
  );

  console.error(
    `seo-audit: ${summary.errors} error(s), ${summary.warnings} warning(s)` +
      (summary.notRun.length ? ` (NOT RUN: ${summary.notRun.join(", ")})` : "") +
      ` -> ${path.join(opts.out, "report.json")}`
  );
  for (const f of kept.slice(0, 12)) console.error(`  [${f.severity}] ${f.check} — ${f.detail}`);
  process.exit(kept.length ? 1 : 0);
}

import { pathToFileURL } from "node:url";
const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((e) => {
    console.error(`seo-audit: ${e?.stack || e}`);
    process.exit(2);
  });
}
