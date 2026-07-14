#!/usr/bin/env node
// Mechanical slop-fingerprint scanner — zero dependencies, Node >= 18. Makes the
// direction.md fingerprint COMPUTABLE: scans HTML/CSS text for the banned-by-default
// markers and reports each hit with evidence. A hit is not automatically a bug — the
// contract is "banned as a DEFAULT": every hit must be either justified from the brief
// in one written line, or replaced. HONEST SCOPE: text heuristics; it cannot see rendered
// composition (centered-hero-ness, card-grid-ness) — the critique rubric judges those.
// Library:   import { scan } from "./slop-check.mjs"
// CLI:       node slop-check.mjs <file.html|file.css> [more…]
// Exit codes: 0 = no hits · 1 = hits found (justify or replace) · 2 = usage error.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** The indigo/violet default family (hex, lowercase) — Tailwind-era indigo/violet/purple 400–700. */
const INDIGO_HEX = [
  "#6366f1",
  "#4f46e5",
  "#4338ca",
  "#818cf8",
  "#8b5cf6",
  "#7c3aed",
  "#6d28d9",
  "#a78bfa",
  "#a855f7",
  "#9333ea",
  "#c084fc"
];

// Deliberately excludes U+2600–27BF (dingbats: ✓ ✂ ✈) — checkmarks as list markers are
// typography, not emoji iconography; the slop signal lives in the 1F300+ pictographs.
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2B00}-\u{2BFF}]/gu;

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

function findAll(text, re, makeHit) {
  const hits = [];
  for (const m of text.matchAll(re)) {
    const hit = makeHit(m);
    if (hit) hits.push({ ...hit, line: lineOf(text, m.index) });
  }
  return hits;
}

/**
 * Scan one file's text for slop-fingerprint markers.
 * @param {string} text HTML or CSS source
 * @returns {{ id: string, evidence: string, line: number }[]}
 */
export function scan(text) {
  const hits = [];

  // 1. Default-typeface slop: Inter/Poppins declared as a font-family.
  hits.push(
    ...findAll(text, /font-family[^;:]*:\s*([^;}{"']*(?:"[^"]*"|'[^']*'|[^;}])*)/gi, (m) =>
      /\b(inter|poppins)\b/i.test(m[1])
        ? { id: "font-default", evidence: `font-family: ${m[1].trim().slice(0, 60)}` }
        : null
    )
  );

  // 2. Indigo/violet family colors (hex, exact set) and high-chroma violet oklch hues.
  for (const hex of INDIGO_HEX) {
    hits.push(
      ...findAll(text, new RegExp(hex, "gi"), () => ({ id: "indigo-family", evidence: hex }))
    );
  }
  hits.push(
    ...findAll(text, /oklch\(\s*[\d.]+%?\s+([\d.]+)\s+([\d.]+)/gi, (m) => {
      const C = Number(m[1]);
      const H = Number(m[2]);
      return C >= 0.08 && H >= 265 && H <= 305
        ? { id: "indigo-family", evidence: `oklch chroma ${C} hue ${H}` }
        : null;
    })
  );

  // 3. Gradient text (background-clip: text) — the gradient-headline default.
  hits.push(
    ...findAll(text, /background-clip\s*:\s*text|-webkit-background-clip\s*:\s*text/gi, () => ({
      id: "gradient-text",
      evidence: "background-clip: text"
    }))
  );

  // 4. Glassmorphism: backdrop blur + translucent white/black fill anywhere in the file.
  if (
    /backdrop-filter\s*:[^;}]*blur/i.test(text) &&
    /rgba?\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0?\.\d+\s*\)|rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0?\.\d+\s*\)/i.test(
      text
    )
  ) {
    hits.push({
      id: "glassmorphism",
      evidence: "backdrop-filter blur + translucent fill",
      line: 0
    });
  }

  // 5. Emoji used as UI (2+ emoji in markup/CSS content — one may be content, a set is iconography).
  const emoji = [...text.matchAll(EMOJI_RE)];
  if (emoji.length >= 2) {
    hits.push({
      id: "emoji-icons",
      evidence: `${emoji.length} emoji found (${emoji
        .slice(0, 4)
        .map((m) => m[0])
        .join(" ")}…)`,
      line: lineOf(text, emoji[0].index)
    });
  }

  // 6. Uniform large radius: 4+ border-radius declarations, all >= 12px.
  const radii = [...text.matchAll(/border-radius\s*:\s*([\d.]+)px/gi)].map((m) => Number(m[1]));
  if (radii.length >= 4 && Math.min(...radii) >= 12) {
    hits.push({
      id: "radius-uniform",
      evidence: `${radii.length} radii, all >= 12px (${[...new Set(radii)].join(", ")})`,
      line: 0
    });
  }

  // 7. The stock Tailwind-md shadow copied everywhere.
  hits.push(
    ...findAll(text, /0\s+4px\s+6px\s+rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0?\.1\s*\)/gi, () => ({
      id: "shadow-default",
      evidence: "0 4px 6px rgba(0,0,0,0.1)"
    }))
  );

  // 8. The "✨ badge" hero opener.
  hits.push(...findAll(text, /✨/gu, () => ({ id: "sparkle-badge", evidence: "✨" })));

  return hits;
}

function usageError(msg) {
  console.error(`error: ${msg}`);
  console.error("usage: node slop-check.mjs <file.html|file.css> [more…]");
  process.exit(2);
}

function main(argv) {
  const files = argv.slice(2).filter((a) => !a.startsWith("--"));
  if (files.length === 0) return usageError("need at least one file");
  let total = 0;
  for (const fp of files) {
    let text;
    try {
      text = readFileSync(fp, "utf8");
    } catch (e) {
      return usageError(`cannot read ${fp}: ${e.message}`);
    }
    const hits = scan(text);
    total += hits.length;
    console.log(`== ${fp}: ${hits.length} fingerprint hit(s)`);
    for (const h of hits) console.log(`  [${h.id}] line ${h.line || "?"} — ${h.evidence}`);
  }
  if (total) {
    console.log("\nA hit is banned AS A DEFAULT (direction.md): justify each one from the brief");
    console.log("in one written line, or replace it. Composition-level slop (centered hero,");
    console.log("3-card grid) is judged by the critique rubric, not this scanner.");
  }
  process.exit(total ? 1 : 0);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main(process.argv);
