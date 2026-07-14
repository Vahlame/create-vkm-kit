#!/usr/bin/env node
// OKLCH palette generator — zero dependencies, Node >= 18. Builds the token layer
// generate.md asks for: a neutral ramp with a brand-hue cast + a gamut-aware accent ramp,
// with the critical contrast pairs computed up front (foundations.md recipe).
// Library:   import { buildNeutralRamp, buildAccentRamp } from "./palette.mjs"
// CLI:       node palette.mjs --hue 250 [--chroma 0.12] [--json]
//   --json emits a W3C DTCG token group instead of the human table.
// Exit codes: 0 = generated · 2 = usage error.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { oklchToRgb, contrastRatio, rate } from "./contrast.mjs";

/** Lightness steps, named by L*100 (self-documenting: neutral-99 is the lightest). */
const NEUTRAL_L = [0.99, 0.95, 0.9, 0.82, 0.7, 0.55, 0.42, 0.32, 0.24, 0.18, 0.13];
const ACCENT_L = [0.95, 0.88, 0.8, 0.72, 0.64, 0.56, 0.48, 0.4, 0.33, 0.26, 0.2];
const NEUTRAL_CAST = 0.012; // subtle hue cast — pure gray reads as unfinished

function toHex([r, g, b]) {
  return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
}

/** Largest chroma <= wanted that stays inside sRGB gamut at this L/H (step 0.005). */
export function fitChroma(L, wanted, H) {
  for (let c = wanted; c >= 0; c -= 0.005) {
    if (!oklchToRgb(L, c, H).clipped) return Number(c.toFixed(3));
  }
  return 0;
}

function step(L, C, H) {
  const c = fitChroma(L, C, H);
  const css = `oklch(${L} ${c} ${H})`;
  return {
    name: String(Math.round(L * 100)),
    L,
    C: c,
    H,
    css,
    hex: toHex(oklchToRgb(L, c, H).rgb)
  };
}

/**
 * Neutral ramp: 11 steps, chroma NEUTRAL_CAST toward the brand hue.
 * @param {number} hue degrees
 */
export function buildNeutralRamp(hue) {
  return NEUTRAL_L.map((L) => step(L, NEUTRAL_CAST, hue));
}

/**
 * Accent ramp: 11 steps at the requested chroma, reduced per-step to stay in gamut.
 * @param {number} hue degrees
 * @param {number} [chroma]
 */
export function buildAccentRamp(hue, chroma = 0.12) {
  return ACCENT_L.map((L) => step(L, chroma, hue));
}

/** Semantic hues per foundations.md — success/warn/danger, chroma-matched to the accent. */
export const SEMANTIC_HUES = { ok: 145, warn: 85, danger: 25 };

function fitToContrast(hue, chroma, bg, from, dir) {
  for (let L = from; L >= 0.15 && L <= 0.97; L += dir * 0.01) {
    const Lr = Number(L.toFixed(2));
    const c = fitChroma(Lr, chroma, hue);
    const css = `oklch(${Lr} ${c} ${hue})`;
    const ratio = contrastRatio(css, bg);
    if (ratio >= 4.5) {
      return { css, hex: toHex(oklchToRgb(Lr, c, hue).rgb), ratio: Number(ratio.toFixed(2)) };
    }
  }
  // Defensive: the loop bounds always reach a passing extreme first, but never return nothing.
  const Lr = dir < 0 ? 0.15 : 0.97;
  const c = fitChroma(Lr, chroma, hue);
  const css = `oklch(${Lr} ${c} ${hue})`;
  return {
    css,
    hex: toHex(oklchToRgb(Lr, c, hue).rgb),
    ratio: Number(contrastRatio(css, bg).toFixed(2))
  };
}

/**
 * Semantic tokens guaranteed >= 4.5:1 (AA normal) against BOTH surface extremes:
 * `onLight` is the most-chromatic step that passes on the lightest neutral, `onDark`
 * the one that passes on the darkest. Never hue alone — pair with text/icon in the UI.
 * @param {ReturnType<typeof buildNeutralRamp>} neutral
 * @param {number} [chroma]
 */
export function semanticTokens(neutral, chroma = 0.12) {
  const lightest = neutral[0].css;
  const darkest = neutral[neutral.length - 1].css;
  return Object.fromEntries(
    Object.entries(SEMANTIC_HUES).map(([name, hue]) => [
      name,
      {
        onLight: fitToContrast(hue, chroma, lightest, 0.75, -1),
        onDark: fitToContrast(hue, chroma, darkest, 0.45, +1)
      }
    ])
  );
}

/** The pairs that decide whether the palette works, per theme. */
export function keyPairs(neutral, accent) {
  const lightest = neutral[0];
  const darkest = neutral[neutral.length - 1];
  const pick = (ramp, name) => ramp.find((s) => s.name === name) ?? ramp[0];
  return [
    { name: "text/light-surface", fg: darkest.css, bg: lightest.css, usage: "normal" },
    { name: "text/dark-surface", fg: lightest.css, bg: darkest.css, usage: "normal" },
    { name: "accent-text/light", fg: pick(accent, "48").css, bg: lightest.css, usage: "normal" },
    { name: "accent-ui/light", fg: pick(accent, "56").css, bg: lightest.css, usage: "ui" },
    { name: "accent-text/dark", fg: pick(accent, "72").css, bg: darkest.css, usage: "normal" },
    { name: "accent-ui/dark", fg: pick(accent, "64").css, bg: darkest.css, usage: "ui" }
  ].map((p) => {
    const r = rate(contrastRatio(p.fg, p.bg), p.usage);
    return { ...p, ratio: r.ratio, aa: r.aa };
  });
}

function toTokens(neutral, accent, semantic) {
  const group = (ramp) =>
    Object.fromEntries(ramp.map((s) => [s.name, { $type: "color", $value: s.css }]));
  const sem = Object.fromEntries(
    Object.entries(semantic).map(([name, v]) => [
      name,
      {
        onLight: { $type: "color", $value: v.onLight.css },
        onDark: { $type: "color", $value: v.onDark.css }
      }
    ])
  );
  return { color: { neutral: group(neutral), accent: group(accent), semantic: sem } };
}

function usageError(msg) {
  console.error(`error: ${msg}`);
  console.error("usage: node palette.mjs --hue <0-360> [--chroma 0.12] [--json]");
  process.exit(2);
}

function main(argv) {
  const args = argv.slice(2);
  const flag = (f) => {
    const i = args.indexOf(f);
    return i === -1 ? undefined : args[i + 1];
  };
  const hue = Number(flag("--hue"));
  if (!Number.isFinite(hue) || hue < 0 || hue > 360) return usageError("--hue must be 0–360");
  const chromaArg = flag("--chroma");
  const chroma = chromaArg === undefined ? 0.12 : Number(chromaArg);
  if (!Number.isFinite(chroma) || chroma <= 0 || chroma > 0.4) {
    return usageError("--chroma must be in (0, 0.4]");
  }
  const neutral = buildNeutralRamp(hue);
  const accent = buildAccentRamp(hue, chroma);
  const semantic = semanticTokens(neutral, chroma);
  if (args.includes("--json")) {
    console.log(JSON.stringify(toTokens(neutral, accent, semantic), null, 2));
    process.exit(0);
  }
  for (const [label, ramp] of [
    ["neutral", neutral],
    ["accent", accent]
  ]) {
    for (const s of ramp) console.log(`${label}-${s.name}  ${s.css}  ${s.hex}`);
  }
  console.log("\nsemantic (AA-normal guaranteed on both surface extremes):");
  for (const [name, v] of Object.entries(semantic)) {
    console.log(`${name}/on-light  ${v.onLight.css}  ${v.onLight.hex}  ${v.onLight.ratio}:1`);
    console.log(`${name}/on-dark   ${v.onDark.css}  ${v.onDark.hex}  ${v.onDark.ratio}:1`);
  }
  console.log("\nkey pairs:");
  for (const p of keyPairs(neutral, accent)) {
    console.log(`${p.aa ? "PASS" : "FAIL"}  ${p.name}  ${p.ratio.toFixed(2)}:1 (${p.usage})`);
  }
  console.log("\nNote: FAIL rows mean 'pick a darker/lighter step for that role', not a bug —");
  console.log("re-run contrast.mjs --pairs on the pairs your UI actually uses.");
  process.exit(0);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main(process.argv);
