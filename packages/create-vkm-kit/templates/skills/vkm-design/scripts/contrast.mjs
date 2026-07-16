#!/usr/bin/env node
// WCAG 2.x contrast checker — zero dependencies, Node >= 18.
// Accepts hex ("#rgb"/"#rrggbb") AND CSS "oklch(L C H)" colors (the token format
// foundations.md prescribes), converting OKLCH per CSS Color 4 with gamut clipping.
// Library:   import { contrastRatio, rate, parseColor, parseHex, rgbToOklch } from "./contrast.mjs"
// CLI:       node contrast.mjs <fg> <bg> [--large|--ui]
//            node contrast.mjs --pairs tokens.json
//   tokens.json: [{ "name": "body", "fg": "#333", "bg": "oklch(0.98 0.005 95)", "usage": "normal" }, ...]
// Exit codes: 0 = all pairs pass their AA gate · 1 = at least one fails · 2 = usage error.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const GATES = {
  normal: { aa: 4.5, aaa: 7 },
  large: { aa: 3, aaa: 4.5 },
  ui: { aa: 3, aaa: null } // WCAG defines no AAA gate for non-text/UI contrast
};

/**
 * Parse a hex color ("#rgb" or "#rrggbb", "#" optional, case-insensitive) to [r, g, b] 0–255.
 * 4/8-digit hex (alpha) is rejected on purpose: composite over the real background first —
 * a contrast ratio against a translucent color is not a defined quantity.
 * @param {string} input
 * @returns {[number, number, number]}
 */
export function parseHex(input) {
  if (typeof input !== "string") throw new TypeError("color must be a string");
  const hex = input.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return [...hex].map((c) => parseInt(c + c, 16));
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  }
  if (/^[0-9a-f]{4}$/i.test(hex) || /^[0-9a-f]{8}$/i.test(hex)) {
    throw new RangeError(
      `"${input}": alpha hex not supported — composite over the background first`
    );
  }
  throw new RangeError(`"${input}" is not a #rgb or #rrggbb color`);
}

// Signs allowed so a negative L/C reaches its specific range error (and negative hue is legal CSS).
const OKLCH_RE = /^oklch\(\s*(-?[\d.]+%?)\s+(-?[\d.]+)\s+(-?[\d.]+)(?:deg)?\s*\)$/i;

/**
 * Convert OKLCH to sRGB 0–255 (CSS Color 4 math: OKLab → LMS → linear sRGB).
 * Out-of-gamut channels are clamped to [0, 1] and reported via `clipped`.
 * @param {number} L 0–1
 * @param {number} C >= 0
 * @param {number} H degrees
 * @returns {{ rgb: [number, number, number], clipped: boolean }}
 */
export function oklchToRgb(L, C, H) {
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ];
  let clipped = false;
  const rgb = lin.map((c) => {
    // 5e-4 linear tolerance: far below one 8-bit step, so rounded boundary colors
    // (e.g. pure sRGB red expressed in OKLCH) don't get flagged as out-of-gamut.
    if (c < -5e-4 || c > 1 + 5e-4) clipped = true;
    const cl = Math.min(1, Math.max(0, c));
    const gamma = cl <= 0.0031308 ? cl * 12.92 : 1.055 * cl ** (1 / 2.4) - 0.055;
    return Math.round(gamma * 255);
  });
  return { rgb: /** @type {[number, number, number]} */ (rgb), clipped };
}

/**
 * Convert sRGB 0–255 to OKLCH (CSS Color 4 math: gamma-decode → linear sRGB → LMS' → OKLab →
 * OKLCH). The exact mathematical inverse of `oklchToRgb` above — same standard OKLab matrices,
 * run backwards; `Math.cbrt` (not `**(1/3)`) because intermediate LMS' values can be negative.
 * @param {[number, number, number]} rgb channels 0–255
 * @returns {{ L: number, C: number, H: number }} H in degrees, 0–360
 */
export function rgbToOklch([r, g, b]) {
  const toLinear = (c8) => {
    const c = c8 / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [lr, lg, lb] = [r, g, b].map(toLinear);
  const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const C = Math.sqrt(a * a + bb * bb);
  let H = (Math.atan2(bb, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L, C, H };
}

/**
 * Parse a color string — hex or "oklch(L C H)" (L may be a percentage, H may carry "deg").
 * @param {string} input
 * @returns {{ rgb: [number, number, number], clipped: boolean }}
 */
export function parseColor(input) {
  if (typeof input !== "string") throw new TypeError("color must be a string");
  const trimmed = input.trim();
  const m = trimmed.match(OKLCH_RE);
  if (!m) {
    if (/^oklch\(/i.test(trimmed)) {
      throw new RangeError(
        `"${input}": not a supported oklch() form — expected "oklch(L C H)" (percentage L and ` +
          `"deg" hue are fine); alpha ("/ A") isn't supported here — composite over the ` +
          `background first, same as alpha hex.`
      );
    }
    return { rgb: parseHex(input), clipped: false };
  }
  const L = m[1].endsWith("%") ? Number(m[1].slice(0, -1)) / 100 : Number(m[1]);
  const C = Number(m[2]);
  const H = Number(m[3]);
  if (!(L >= 0 && L <= 1)) throw new RangeError(`"${input}": L must be 0–1 (or 0–100%)`);
  if (!(C >= 0)) throw new RangeError(`"${input}": C must be >= 0`);
  if (!Number.isFinite(H)) throw new RangeError(`"${input}": bad hue`);
  return oklchToRgb(L, C, H);
}

/**
 * WCAG relative luminance of an sRGB color.
 * @param {[number, number, number]} rgb channels 0–255
 */
export function relativeLuminance([r, g, b]) {
  const lin = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/**
 * Contrast ratio between two hex colors, 1–21 (order-independent).
 * @param {string} fg
 * @param {string} bg
 */
export function contrastRatio(fg, bg) {
  const l1 = relativeLuminance(parseColor(fg).rgb);
  const l2 = relativeLuminance(parseColor(bg).rgb);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Rate a ratio against the WCAG gates for a usage.
 * @param {number} ratio
 * @param {"normal"|"large"|"ui"} [usage]
 * @returns {{ ratio: number, usage: string, aa: boolean, aaa: boolean|null }}
 */
export function rate(ratio, usage = "normal") {
  const gate = GATES[usage];
  if (!gate) throw new RangeError(`usage must be one of: ${Object.keys(GATES).join(", ")}`);
  return { ratio, usage, aa: ratio >= gate.aa, aaa: gate.aaa === null ? null : ratio >= gate.aaa };
}

/** Evaluate one {fg, bg, usage?, name?} pair into a printable result row. */
export function evaluatePair({ fg, bg, usage = "normal", name = "" }) {
  const clipped = parseColor(fg).clipped || parseColor(bg).clipped;
  const r = rate(contrastRatio(fg, bg), usage);
  return { name, fg, bg, clipped, ...r };
}

function printRow({ name, fg, bg, ratio, usage, aa, aaa, clipped }) {
  const label = name ? `${name}: ` : "";
  const aaaTxt = aaa === null ? "n/a" : aaa ? "pass" : "fail";
  console.log(
    `${aa ? "PASS" : "FAIL"}  ${label}${fg} on ${bg}  ${ratio.toFixed(2)}:1  ` +
      `(${usage}: AA ${aa ? "pass" : "fail"} >= ${GATES[usage].aa}:1, AAA ${aaaTxt})` +
      (clipped ? "  [gamut-clipped]" : "")
  );
}

function usageError(msg) {
  console.error(`error: ${msg}`);
  console.error(
    "usage: node contrast.mjs <fg> <bg> [--large|--ui] | node contrast.mjs --pairs <file.json>"
  );
  process.exit(2);
}

function main(argv) {
  const args = argv.slice(2);
  try {
    if (args.includes("--pairs")) {
      const fp = args[args.indexOf("--pairs") + 1];
      if (!fp) return usageError("--pairs needs a JSON file path");
      let pairs;
      try {
        pairs = JSON.parse(readFileSync(fp, "utf8"));
      } catch (e) {
        return usageError(`cannot read ${fp}: ${e.message}`);
      }
      if (!Array.isArray(pairs) || pairs.length === 0) {
        return usageError(`${fp} must be a non-empty JSON array of {fg, bg, usage?, name?}`);
      }
      const results = pairs.map(evaluatePair);
      for (const row of results) printRow(row);
      const failed = results.filter((r) => !r.aa).length;
      console.log(`${results.length - failed}/${results.length} pairs pass AA`);
      process.exit(failed ? 1 : 0);
    }
    const positional = args.filter((a) => !a.startsWith("--"));
    if (positional.length !== 2) return usageError("expected exactly <fg> <bg>");
    const usage = args.includes("--large") ? "large" : args.includes("--ui") ? "ui" : "normal";
    const row = evaluatePair({ fg: positional[0], bg: positional[1], usage });
    printRow(row);
    process.exit(row.aa ? 0 : 1);
  } catch (e) {
    return usageError(e.message);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main(process.argv);
