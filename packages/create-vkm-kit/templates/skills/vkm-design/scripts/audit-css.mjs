#!/usr/bin/env node
// Static CSS token audit — zero dependencies, Node >= 18. Gives critique mode executable
// teeth: extracts declared colors (hex/oklch, resolving one file's var() chains), pairs
// color/background declared in the same rule, and checks contrast, type scale and spacing
// rhythm with the sibling checkers. Accepts .css files, or .html/.htm — for HTML only the
// <style> blocks + inline style="…" attributes are audited, never script/markup (see
// cssSourceFor). HONEST SCOPE: token-level static analysis only —
// inheritance, computed styles and rendered output are out of reach; the visual loop
// (modes/visual-loop.md) remains the real judge.
// Library:   import { extractCustomProps, resolveVars, extractPairs, countEmUsage, cssSourceFor } from "./audit-css.mjs"
// CLI:       node audit-css.mjs <file.css|file.html> [more…] [--base 4] [--tolerance 0.03]
// Exit codes: 0 = no failing findings · 1 = failing findings · 2 = usage error.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseColor, contrastRatio, rate } from "./contrast.mjs";
import { checkTypeScale, checkSpacing } from "./scale.mjs";

const HAIRLINE_MAX = 2; // px values <= this are treated as hairlines, exempt from the rhythm check

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, " ");
}

/**
 * Source text the audit should parse for a given input file: raw content for CSS; for
 * .html/.htm, ONLY the <style> block contents plus each inline style="…" attribute
 * (wrapped as a synthetic one-off rule so its declarations join the px/em extraction).
 * Before this, an HTML file's whole markup went through the rule regex — which happily
 * read a <script> theme-config object literal (`{ background: "#0e2846", … }`, a real
 * mermaid init block, 2026-07-18) as CSS declarations: one bare `color:` key away from
 * fabricated contrast pairs. Static scope, same honesty as the rest of this file: a
 * literal "</style>" inside a CSS string would end a block early — acceptable for
 * token-level auditing.
 * @returns {{ css: string, styleBlocks: number | null }} `styleBlocks` null = input was CSS
 */
export function cssSourceFor(fp, raw) {
  if (!/\.html?$/i.test(fp)) return { css: raw, styleBlocks: null };
  const blocks = [...raw.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((m) => m[1]);
  // (?<![\w-]) so `data-style=`/`map-style=` don't leak in — \b alone matches after a hyphen.
  const inline = [...raw.matchAll(/(?<![\w-])style\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map(
    (m, i) => `[inline-${i}] { ${m[1] ?? m[2]} }`
  );
  return { css: blocks.concat(inline).join("\n"), styleBlocks: blocks.length };
}

/** Collect `--name: value` custom-property definitions (last definition wins). */
export function extractCustomProps(css) {
  const props = new Map();
  for (const m of stripComments(css).matchAll(/--([\w-]+)\s*:\s*([^;{}]+)/g)) {
    props.set(`--${m[1]}`, m[2].trim());
  }
  return props;
}

/** Resolve var(--x) / var(--x, fallback) against a prop map, up to `depth` hops. */
export function resolveVars(value, props, depth = 5) {
  let out = value;
  for (let i = 0; i < depth && /var\(/.test(out); i++) {
    out = out.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]+))?\)/g, (_, name, fallback) => {
      return props.get(name) ?? (fallback !== undefined ? fallback.trim() : "");
    });
    out = out.trim();
  }
  return out;
}

function parseableColor(value) {
  try {
    parseColor(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Innermost rule blocks that declare BOTH a resolvable `color` and `background(-color)`.
 * Unresolvable values (named colors, rgb(), gradients) are skipped and counted.
 * @returns {{ pairs: {selector, fg, bg}[], skipped: number }}
 */
export function extractPairs(css, props) {
  const pairs = [];
  let skipped = 0;
  for (const m of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().split(/\s*,\s*/)[0];
    const body = m[2];
    const decl = (name) => {
      const dm = [...body.matchAll(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, "gi"))].map(
        (x) => x[1]
      );
      return dm.length
        ? resolveVars(dm[dm.length - 1].replace(/!important/i, "").trim(), props)
        : undefined;
    };
    const fg = decl("color");
    const bg = decl("background-color") ?? decl("background");
    if (fg === undefined || bg === undefined) continue;
    if (!parseableColor(fg) || !parseableColor(bg)) {
      skipped++;
      continue;
    }
    pairs.push({ selector, fg, bg });
  }
  return { pairs, skipped };
}

/**
 * px-equivalent values held in custom-prop DEFINITIONS whose name matches nameRe —
 * token-correct stylesheets keep sizes in props (`--step-1: 16.8px`), where a
 * property-name scan can't see them. rem counted at 16px.
 */
export function extractPropPx(props, nameRe) {
  const out = new Set();
  for (const [name, value] of props) {
    if (!nameRe.test(name)) continue;
    for (const v of value.matchAll(/(-?[\d.]+)(px|rem)\b/g)) {
      const px = v[2] === "rem" ? Number(v[1]) * 16 : Number(v[1]);
      if (px > 0) out.add(Number(px.toFixed(2)));
    }
  }
  return [...out];
}

/**
 * All px-equivalent values for a numeric property regex (rem counted at 16px).
 * Pass `props` to resolve `var()` chains first — token-correct stylesheets keep sizes
 * behind custom properties. Inside `clamp()` only the first and last lengths count
 * (the fluid middle term is not a scale member).
 */
export function extractPx(css, propPattern, props) {
  const out = new Set();
  const re = new RegExp(`(?:^|;|\\{)\\s*(?:${propPattern})\\s*:\\s*([^;}]+)`, "gi");
  for (const m of stripComments(css).matchAll(re)) {
    const value = props ? resolveVars(m[1], props) : m[1];
    let tokens = [...value.matchAll(/(-?[\d.]+)(px|rem)\b/g)].map((v) =>
      v[2] === "rem" ? Number(v[1]) * 16 : Number(v[1])
    );
    if (/clamp\(/i.test(value) && tokens.length > 2) {
      tokens = [tokens[0], tokens[tokens.length - 1]];
    }
    for (const px of tokens) if (px > 0) out.add(Number(px.toFixed(2)));
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Count numeric `em` usages inside declarations matching `propPattern` — informational only.
 * Unlike `rem` (always relative to the root, safe to count at 16px), `em` is relative to the
 * ELEMENT'S OWN computed font-size, which static analysis can't resolve — guessing a conversion
 * risks injecting a wrong value into the scale check, so this only reports that em was found and
 * excluded, the same honesty `extractPairs`'s `skipped` count already applies to unparseable colors.
 * @returns {number}
 */
export function countEmUsage(css, propPattern) {
  const re = new RegExp(`(?:^|;|\\{)\\s*(?:${propPattern})\\s*:\\s*([^;}]+)`, "gi");
  let count = 0;
  for (const m of stripComments(css).matchAll(re)) {
    count += [...m[1].matchAll(/(-?[\d.]+)em\b/gi)].length;
  }
  return count;
}

function usageError(msg) {
  console.error(`error: ${msg}`);
  console.error(
    "usage: node audit-css.mjs <file.css|file.html> [more…] [--base 4] [--tolerance 0.03]"
  );
  process.exit(2);
}

function main(argv) {
  const args = argv.slice(2);
  const flag = (f) => {
    const i = args.indexOf(f);
    return i === -1 ? undefined : args[i + 1];
  };
  const base = flag("--base") === undefined ? 4 : Number(flag("--base"));
  const tolerance = flag("--tolerance") === undefined ? 0.03 : Number(flag("--tolerance"));
  const files = args.filter(
    (a, i) => !a.startsWith("--") && args[i - 1] !== "--base" && args[i - 1] !== "--tolerance"
  );
  if (files.length === 0) return usageError("need at least one CSS file");
  let failed = false;
  for (const fp of files) {
    let raw;
    try {
      raw = readFileSync(fp, "utf8");
    } catch (e) {
      return usageError(`cannot read ${fp}: ${e.message}`);
    }
    console.log(`== ${fp}`);
    const { css, styleBlocks } = cssSourceFor(fp, raw);
    if (styleBlocks !== null) {
      console.log(
        `(html input: auditing ${styleBlocks} <style> block(s) + inline style attributes — script/markup excluded)`
      );
    }
    const props = extractCustomProps(css);
    const { pairs, skipped } = extractPairs(css, props);
    if (pairs.length === 0) {
      console.log("contrast: no same-rule color/background pairs found");
    }
    for (const p of pairs) {
      // Font size is unknown statically → judged at the strict 'normal' gate; a FAIL on
      // display-only text may still pass as 'large' — recheck with contrast.mjs --large.
      const r = rate(contrastRatio(p.fg, p.bg), "normal");
      if (!r.aa) failed = true;
      console.log(
        `${r.aa ? "PASS" : "FAIL"}  ${p.selector}  ${p.fg} on ${p.bg}  ${r.ratio.toFixed(2)}:1`
      );
    }
    if (skipped)
      console.log(`(skipped ${skipped} pair(s) with unparseable values — rgb()/named/gradient)`);

    const FONT_PROP_PATTERN = "font-size";
    const fontEm = countEmUsage(css, FONT_PROP_PATTERN);
    if (fontEm) {
      console.log(
        `(${fontEm} em-based font-size value(s) found, excluded — em is relative to computed ` +
          `font-size, not statically resolvable; use rem/px or check by hand)`
      );
    }
    const sizes = [
      ...new Set([
        ...extractPx(css, FONT_PROP_PATTERN, props),
        ...extractPropPx(props, /^--(font|text|step|size)/i)
      ])
    ].sort((a, b) => a - b);
    if (sizes.length >= 3) {
      const res = checkTypeScale(sizes, { tolerance });
      if (res.offenders.length) {
        failed = true;
        console.log(
          `TYPE  FAIL  ratio ${res.ratio} (inferred), base ${res.base} — off-scale: ${res.offenders.map((o) => o.value).join(", ")}`
        );
        console.log(
          "  (1.067 excluded from inference — pass --ratio 1.067 to scale.mjs if deliberate)"
        );
      } else {
        console.log(`TYPE  PASS  ratio ${res.ratio} (inferred) over ${sizes.length} sizes`);
      }
    } else {
      console.log(`type: ${sizes.length} px size(s) found — too few to infer a scale`);
    }

    const SPACE_PROP_PATTERN = "margin[\\w-]*|padding[\\w-]*|inset[\\w-]*|gap|row-gap|column-gap";
    const spaceEm = countEmUsage(css, SPACE_PROP_PATTERN);
    if (spaceEm) {
      console.log(
        `(${spaceEm} em-based spacing value(s) found, excluded — em is relative to computed ` +
          `font-size, not statically resolvable; use rem/px or check by hand)`
      );
    }
    const spacing = [
      ...new Set([
        ...extractPx(css, SPACE_PROP_PATTERN, props),
        ...extractPropPx(props, /^--(space|gap)/i)
      ])
    ]
      .sort((a, b) => a - b)
      .filter((v) => v > HAIRLINE_MAX);
    if (spacing.length) {
      const res = checkSpacing(spacing, { base });
      if (res.offenders.length) {
        failed = true;
        console.log(`SPACE FAIL  base ${base} — off-rhythm: ${res.offenders.join(", ")}`);
        if (res.halfGrid) {
          console.log(
            res.halfGrid.offenders.length === 0
              ? `  (half-grid ${res.halfGrid.base}px: ALL values align — a half-step rhythm or phase mix; judge intent before renumbering)`
              : `  (half-grid ${res.halfGrid.base}px: only ${res.halfGrid.offenders.join(", ")} stay off — the rest is a half-step rhythm; judge intent before renumbering)`
          );
        }
      } else {
        console.log(`SPACE PASS  base ${base} over ${spacing.length} value(s)`);
      }
    }
  }
  console.log("\nStatic token audit only — inherited/computed styles and rendered output are");
  console.log("not visible here; run the visual loop for the real verdict.");
  process.exit(failed ? 1 : 0);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main(process.argv);
