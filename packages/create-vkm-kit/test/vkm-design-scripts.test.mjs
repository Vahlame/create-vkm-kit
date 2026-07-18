import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  parseHex,
  parseColor,
  oklchToRgb,
  rgbToOklch,
  contrastRatio,
  rate,
  evaluatePair
} from "../templates/skills/vkm-design/scripts/contrast.mjs";
import {
  checkTypeScale,
  checkSpacing,
  generateScale,
  CANDIDATE_RATIOS
} from "../templates/skills/vkm-design/scripts/scale.mjs";
import {
  buildNeutralRamp,
  buildAccentRamp,
  fitChroma,
  keyPairs,
  semanticTokens,
  SEMANTIC_HUES
} from "../templates/skills/vkm-design/scripts/palette.mjs";
import {
  extractCustomProps,
  resolveVars,
  extractPairs,
  extractPx,
  extractPropPx,
  countEmUsage,
  cssSourceFor
} from "../templates/skills/vkm-design/scripts/audit-css.mjs";
import { scan } from "../templates/skills/vkm-design/scripts/slop-check.mjs";

const scriptsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "templates",
  "skills",
  "vkm-design",
  "scripts"
);
const contrastCli = path.join(scriptsDir, "contrast.mjs");
const scaleCli = path.join(scriptsDir, "scale.mjs");
const paletteCli = path.join(scriptsDir, "palette.mjs");
const auditCli = path.join(scriptsDir, "audit-css.mjs");
const slopCli = path.join(scriptsDir, "slop-check.mjs");

/** Run a CLI and return its exit code (execFileSync throws on non-zero). */
function exitCode(script, args) {
  try {
    execFileSync(process.execPath, [script, ...args], { stdio: "pipe" });
    return 0;
  } catch (e) {
    return e.status;
  }
}

test("parseHex: 3/6-digit, case, optional #; rejects alpha and garbage", () => {
  assert.deepEqual(parseHex("#fff"), [255, 255, 255]);
  assert.deepEqual(parseHex("FFF"), [255, 255, 255]);
  assert.deepEqual(parseHex("#0080ff"), [0, 128, 255]);
  assert.throws(() => parseHex("#ffffffff"), /alpha/);
  assert.throws(() => parseHex("#ffff"), /alpha/);
  assert.throws(() => parseHex("red"), /not a/);
  assert.throws(() => parseHex(42), TypeError);
});

test("contrastRatio: known WCAG values", () => {
  assert.ok(Math.abs(contrastRatio("#000000", "#ffffff") - 21) < 1e-9, "black/white = 21:1");
  assert.ok(Math.abs(contrastRatio("#fff", "#fff") - 1) < 1e-9, "same color = 1:1");
  // #767676 on white is the canonical smallest AA-passing gray (~4.54:1)
  const passing = contrastRatio("#767676", "#ffffff");
  assert.ok(passing >= 4.5 && passing < 4.6, `got ${passing}`);
  // one step lighter fails AA normal (~4.48:1)
  const failing = contrastRatio("#777777", "#ffffff");
  assert.ok(failing < 4.5 && failing > 4.4, `got ${failing}`);
  // order independence
  assert.equal(contrastRatio("#123456", "#abcdef"), contrastRatio("#abcdef", "#123456"));
});

test("rate: per-usage gates, AAA n/a for ui", () => {
  const large = rate(contrastRatio("#949494", "#ffffff"), "large"); // ~3.03:1
  assert.equal(large.aa, true);
  const normal = rate(contrastRatio("#949494", "#ffffff"), "normal");
  assert.equal(normal.aa, false);
  assert.equal(rate(5, "ui").aaa, null);
  assert.throws(() => rate(5, "huge"), /usage/);
});

test("evaluatePair carries name and usage through", () => {
  const row = evaluatePair({ fg: "#000", bg: "#fff", usage: "normal", name: "body" });
  assert.equal(row.name, "body");
  assert.equal(row.aa, true);
  assert.equal(row.aaa, true);
});

test("contrast CLI: exit 0 pass, 1 fail, 2 usage error; --pairs batch", () => {
  assert.equal(exitCode(contrastCli, ["#000000", "#ffffff"]), 0);
  assert.equal(exitCode(contrastCli, ["#777777", "#ffffff"]), 1);
  assert.equal(exitCode(contrastCli, ["#949494", "#ffffff", "--large"]), 0);
  assert.equal(exitCode(contrastCli, ["#nothex", "#ffffff"]), 2);
  assert.equal(exitCode(contrastCli, ["#000000"]), 2);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-design-test-"));
  const good = path.join(dir, "good.json");
  fs.writeFileSync(
    good,
    JSON.stringify([
      { name: "body", fg: "#111111", bg: "#ffffff" },
      { name: "icon", fg: "#767676", bg: "#ffffff", usage: "ui" }
    ])
  );
  assert.equal(exitCode(contrastCli, ["--pairs", good]), 0);
  const bad = path.join(dir, "bad.json");
  fs.writeFileSync(bad, JSON.stringify([{ fg: "#aaaaaa", bg: "#ffffff", usage: "normal" }]));
  assert.equal(exitCode(contrastCli, ["--pairs", bad]), 1);
  assert.equal(exitCode(contrastCli, ["--pairs", path.join(dir, "missing.json")]), 2);
});

test("parseColor: OKLCH per CSS Color 4", () => {
  assert.deepEqual(parseColor("oklch(1 0 0)").rgb, [255, 255, 255]);
  assert.deepEqual(parseColor("oklch(100% 0 0)").rgb, [255, 255, 255]);
  assert.deepEqual(parseColor("oklch(0 0 0)").rgb, [0, 0, 0]);
  // canonical sRGB red in OKLCH; every channel within rounding distance
  const red = parseColor("oklch(0.62796 0.25768 29.234)").rgb;
  for (const [i, c] of [255, 0, 0].entries()) {
    assert.ok(Math.abs(red[i] - c) <= 3, `red ch${i}: ${red[i]}`);
  }
  assert.equal(parseColor("oklch(0.62796 0.25768 29.234deg)").clipped, false);
  assert.equal(parseColor("oklch(0.6 0.4 145)").clipped, true, "impossible chroma must clip");
  assert.equal(parseColor("#fff").clipped, false, "hex path still works");
  assert.throws(() => parseColor("oklch(1 0)"), /not a/);
  assert.throws(() => parseColor("oklch(1.5 0 0)"), /L must be/);
  assert.throws(() => parseColor("oklch(50% -1 0)"), /C must be/);
});

test("contrastRatio accepts oklch and hex interchangeably", () => {
  assert.ok(Math.abs(contrastRatio("oklch(0 0 0)", "#ffffff") - 21) < 1e-9);
  const viaOklch = contrastRatio("oklch(0.62796 0.25768 29.234)", "#ffffff");
  const viaHex = contrastRatio("#ff0000", "#ffffff");
  assert.ok(Math.abs(viaOklch - viaHex) < 0.05, `${viaOklch} vs ${viaHex}`);
  assert.equal(
    evaluatePair({ fg: "oklch(0.6 0.4 145)", bg: "#ffffff" }).clipped,
    true,
    "evaluatePair must surface gamut clipping"
  );
  assert.equal(exitCode(contrastCli, ["oklch(0 0 0)", "#ffffff"]), 0);
});

test("parseColor: oklch() with an alpha channel gets a targeted error, not a hex-shaped one", () => {
  assert.throws(() => parseColor("oklch(0.5 0.1 250 / 0.5)"), /alpha/);
});

test("rgbToOklch: round-trips oklchToRgb within tight tolerance (exact mathematical inverse)", () => {
  for (const [L, C, H] of [
    [0.55, 0.2, 25],
    [0.7, 0.15, 145],
    [0.3, 0.1, 280]
  ]) {
    const { rgb } = oklchToRgb(L, C, H);
    const back = rgbToOklch(rgb);
    assert.ok(Math.abs(back.L - L) < 0.01, `L: got ${back.L}`);
    assert.ok(Math.abs(back.C - C) < 0.01, `C: got ${back.C}`);
    let dH = Math.abs(back.H - H);
    if (dH > 180) dH = 360 - dH;
    assert.ok(dH < 2, `H: got ${back.H}`);
  }
});

test("rgbToOklch: Tailwind indigo-500 AND an unlisted near-miss both land in the violet band", () => {
  const indigo500 = rgbToOklch(parseHex("#6366f1"));
  assert.ok(indigo500.C >= 0.08 && indigo500.H >= 265 && indigo500.H <= 305, "canonical indigo");
  // #5b21b6 was never in slop-check's old hardcoded 11-item hex list — this is the gap it closed
  const nearMiss = rgbToOklch(parseHex("#5b21b6"));
  assert.ok(nearMiss.C >= 0.08 && nearMiss.H >= 265 && nearMiss.H <= 305, "unlisted near-miss");
});

test("checkTypeScale: explicit ratio flags off-scale values", () => {
  const ok = checkTypeScale([16, 20, 25, 31.25], { ratio: 1.25 });
  assert.equal(ok.offenders.length, 0);
  assert.equal(ok.inferred, false);
  const off = checkTypeScale([16, 20, 25, 30], { ratio: 1.25 });
  assert.deepEqual(
    off.offenders.map((o) => o.value),
    [30]
  );
  assert.equal(off.offenders[0].nearest, 31.25);
});

test("checkTypeScale: infers the best ratio (ties break on mean error)", () => {
  const res = checkTypeScale([16, 20, 25]);
  assert.equal(res.inferred, true);
  assert.equal(res.ratio, 1.25);
  assert.equal(res.offenders.length, 0);
  assert.ok(CANDIDATE_RATIOS.includes(res.ratio));
});

test("checkTypeScale: input validation", () => {
  assert.throws(() => checkTypeScale([]), /non-empty/);
  assert.throws(() => checkTypeScale([16, -1]), /positive/);
  assert.throws(() => checkTypeScale([16], { ratio: 0.9 }), /ratio/);
  assert.throws(() => checkTypeScale([16], { tolerance: 0 }), /tolerance/);
});

test("checkSpacing: base-unit rhythm", () => {
  assert.deepEqual(checkSpacing([4, 8, 12, 16]).offenders, []);
  assert.deepEqual(checkSpacing([4, 8, 10]).offenders, [10]);
  assert.deepEqual(checkSpacing([6, 12], { base: 6 }).offenders, []);
  assert.throws(() => checkSpacing([]), /non-empty/);
  assert.throws(() => checkSpacing([4], { base: 0 }), /base/);
});

test("checkTypeScale: inference never picks the degenerate 1.067 ratio (false-PASS trap)", () => {
  // 22 real ad-hoc sizes from a user session (rem×16). Under 1.067 at the default 3%
  // tolerance only ONE failed — a false PASS on an obviously incoherent set, because
  // 1.067's ±3% bands cover ~91% of the value space. Inference must expose the mess.
  const messy = [
    9.92, 10, 10.08, 10.24, 11.2, 11.9, 12, 12.48, 12.8, 13.6, 14, 14.4, 15, 15.2, 16, 16.8, 17,
    20.8, 25.6, 27.2, 30.4, 32
  ];
  const res = checkTypeScale(messy);
  assert.equal(res.inferred, true);
  assert.notEqual(res.ratio, 1.067);
  assert.ok(
    res.offenders.length >= 10,
    `expected the incoherence exposed, got ${res.offenders.length}`
  );
  // Explicit --ratio 1.067 still works: a genuine 1.067 scale passes when requested.
  const explicit = checkTypeScale([16, 17.07, 18.22], { ratio: 1.067 });
  assert.equal(explicit.offenders.length, 0);
  assert.ok(CANDIDATE_RATIOS.includes(1.067), "1.067 stays available for explicit use");
});

test("checkSpacing: half-grid diagnosis on mixed 4k/4k+2 sets; absent when clean or uninformative", () => {
  // Real case: a file interleaving 4k (4,8,12) and 4k+2 (6,10) paddings plus one true
  // outlier (3) — the old output ("off-rhythm: 3, 6, 10") sent a session on a manual
  // detour; the diagnosis names the 2px half-step rhythm and isolates the outlier.
  const mixed = checkSpacing([3, 4, 6, 8, 10, 12], { base: 4 });
  assert.deepEqual(mixed.offenders, [3, 6, 10]);
  assert.deepEqual(mixed.halfGrid, { base: 2, offenders: [3] });
  // clean set → no diagnosis field at all
  assert.equal(checkSpacing([4, 8, 12]).halfGrid, undefined);
  // all-odd offenders: the half-grid explains nothing → omitted
  assert.equal(checkSpacing([5, 9, 13], { base: 4 }).halfGrid, undefined);
  // base too small to halve meaningfully
  assert.equal(checkSpacing([3, 5], { base: 2 }).halfGrid, undefined);
});

test("scale CLI --space: prints the half-grid diagnosis and still exits 1", () => {
  let out = "";
  let status = 0;
  try {
    execFileSync(process.execPath, [scaleCli, "--space", "3,4,6,8,10,12"], { stdio: "pipe" });
  } catch (e) {
    status = e.status;
    out = e.stdout.toString();
  }
  assert.equal(status, 1, "half-grid diagnosis must not soften the FAIL exit");
  assert.match(out, /half-grid 2px: only 3 stay off/);
});

test("scale CLI --gen: named-flag form works and matches the packed form", () => {
  const packed = execFileSync(process.execPath, [scaleCli, "--gen", "16,1.25,6"], {
    stdio: "pipe"
  }).toString();
  const flags = execFileSync(
    process.execPath,
    [scaleCli, "--gen", "--base", "16", "--ratio", "1.25", "--steps", "6"],
    { stdio: "pipe" }
  ).toString();
  assert.equal(flags, packed);
  // the old parser swallowed `--base` as --gen's packed value and died confusingly
  assert.equal(exitCode(scaleCli, ["--gen", "--base", "16", "--ratio", "1.25"]), 2); // no --steps
  assert.equal(
    exitCode(scaleCli, ["--gen", "--base", "abc", "--ratio", "1.25", "--steps", "6"]),
    2
  );
});

test("audit-css: .html input audits only <style> + inline style attrs, never <script> contents", () => {
  const html = `<title>t</title>
<style>:root { --ink: #111111; } .ok { color: var(--ink); background: #ffffff; font-size: 16px; padding: 8px; }</style>
<div style="padding-left: 12px">x</div><span style='margin-top: 4px'>y</span>
<i data-style="margin: 99px">z</i>
<script type="module">const themeVariables = { color: "#aaaaaa", background: "#ffffff" };</script>`;
  const { css, styleBlocks } = cssSourceFor("page.html", html);
  assert.equal(styleBlocks, 1);
  assert.ok(!css.includes("themeVariables"), "script content must never reach the CSS parser");
  assert.ok(!css.includes("99px"), "data-style= is not a style attribute — must not leak in");
  const props = extractCustomProps(css);
  const { pairs } = extractPairs(css, props);
  assert.equal(pairs.length, 1, "only the real <style> rule pairs, not the script object");
  assert.equal(pairs[0].fg, "#111111");
  // inline style attributes (double- and single-quoted) join the numeric extraction
  assert.deepEqual(extractPx(css, "margin[\\w-]*|padding[\\w-]*|gap"), [4, 8, 12]);
  // non-HTML inputs pass through untouched
  assert.deepEqual(cssSourceFor("a.css", ".x{color:#000}"), {
    css: ".x{color:#000}",
    styleBlocks: null
  });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-audit-html-test-"));
  const fp = path.join(dir, "page.html");
  fs.writeFileSync(fp, html);
  const out = execFileSync(process.execPath, [auditCli, fp], { stdio: "pipe" }).toString();
  assert.match(out, /html input: auditing 1 <style> block/);
  assert.ok(!out.includes("#aaaaaa"), "script-object colors must not become contrast pairs");
});

test("scale CLI: exit codes", () => {
  assert.equal(exitCode(scaleCli, ["--type", "16,20,25", "--ratio", "1.25"]), 0);
  assert.equal(exitCode(scaleCli, ["--type", "16,20,25,30", "--ratio", "1.25"]), 1);
  assert.equal(exitCode(scaleCli, ["--space", "4,8,12"]), 0);
  assert.equal(exitCode(scaleCli, ["--space", "4,8,10"]), 1);
  assert.equal(exitCode(scaleCli, []), 2);
  assert.equal(exitCode(scaleCli, ["--type", "abc"]), 2);
});

test("generateScale: emits base + steps, validated", () => {
  assert.deepEqual(generateScale(16, 1.25, 4), [16, 20, 25, 31.25, 39.06]);
  assert.throws(() => generateScale(0, 1.25, 4), /base/);
  assert.throws(() => generateScale(16, 1, 4), /ratio/);
  assert.throws(() => generateScale(16, 1.25, 0), /steps/);
  assert.equal(exitCode(scaleCli, ["--gen", "16,1.25,6"]), 0);
  assert.equal(exitCode(scaleCli, ["--gen", "16,1.25"]), 2);
});

test("palette: ramps are complete, in-gamut, monotonic, with a hue cast", () => {
  const neutral = buildNeutralRamp(250);
  const accent = buildAccentRamp(250, 0.12);
  assert.equal(neutral.length, 11);
  assert.equal(accent.length, 11);
  for (const ramp of [neutral, accent]) {
    for (let i = 1; i < ramp.length; i++) {
      assert.ok(ramp[i].L < ramp[i - 1].L, "L must decrease down the ramp");
    }
    for (const s of ramp) {
      assert.match(s.hex, /^#[0-9a-f]{6}$/);
      assert.equal(oklchToRgb(s.L, s.C, s.H).clipped, false, `${s.css} must be in gamut`);
      assert.ok(s.C >= 0 && s.C <= 0.12 + 1e-9);
    }
  }
  assert.ok(
    neutral.every((s) => s.C > 0),
    "neutrals carry the brand-hue cast, never pure gray"
  );
});

test("palette: fitChroma respects the cap and the gamut", () => {
  assert.equal(fitChroma(0.5, 0.12, 250), 0.12, "mid-L blue holds full chroma");
  const nearWhite = fitChroma(0.99, 0.3, 250);
  assert.ok(nearWhite < 0.3, "near-white cannot hold high chroma");
  assert.equal(oklchToRgb(0.99, nearWhite, 250).clipped, false);
});

test("palette: the text key pairs pass AA by construction", () => {
  const neutral = buildNeutralRamp(145);
  const pairs = keyPairs(neutral, buildAccentRamp(145, 0.12));
  const text = pairs.filter((p) => p.name.startsWith("text/"));
  assert.equal(text.length, 2);
  for (const p of text) assert.ok(p.aa, `${p.name} ${p.ratio.toFixed(2)}:1 must pass`);
});

test("palette: semantic tokens pass AA on both surface extremes by construction", () => {
  const neutral = buildNeutralRamp(250);
  const sem = semanticTokens(neutral, 0.12);
  assert.deepEqual(Object.keys(sem).sort(), Object.keys(SEMANTIC_HUES).sort());
  const lightest = neutral[0].css;
  const darkest = neutral[neutral.length - 1].css;
  for (const [name, v] of Object.entries(sem)) {
    assert.ok(contrastRatio(v.onLight.css, lightest) >= 4.5, `${name}/onLight`);
    assert.ok(contrastRatio(v.onDark.css, darkest) >= 4.5, `${name}/onDark`);
    assert.match(v.onLight.hex, /^#[0-9a-f]{6}$/);
    assert.ok(v.onDark.ratio >= 4.5);
  }
});

test("audit-css: custom props, var() resolution with fallback", () => {
  const css = `/* c */ :root { --ink: oklch(0.2 0.01 270); --alias: var(--ink); }
    .a { color: var(--alias); background: var(--missing, #ffffff); }`;
  const props = extractCustomProps(css);
  assert.equal(props.get("--ink"), "oklch(0.2 0.01 270)");
  assert.equal(resolveVars("var(--alias)", props), "oklch(0.2 0.01 270)");
  assert.equal(resolveVars("var(--missing, #fff)", props), "#fff");
  const { pairs, skipped } = extractPairs(css, props);
  assert.equal(skipped, 0);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].fg, "oklch(0.2 0.01 270)");
  assert.equal(pairs[0].bg, "#ffffff");
});

test("audit-css: skips unparseable values, extracts px/rem, hairlines exempt via CLI", () => {
  const css = `.bad { color: rebeccapurple; background: linear-gradient(red, blue); }
    .t1 { font-size: 16px; padding: 8px 12px; } .t2 { font-size: 1.25rem; margin: 10px; }
    .hair { border-top: 1px solid; padding: 2px; }`;
  const { pairs, skipped } = extractPairs(css, new Map());
  assert.equal(pairs.length, 0);
  assert.equal(skipped, 1);
  assert.deepEqual(extractPx(css, "font-size"), [16, 20]);
  assert.deepEqual(extractPx(css, "margin[\\w-]*|padding[\\w-]*|gap"), [2, 8, 10, 12]);
});

test("audit-css: sizes hidden in custom-prop tokens are seen (extractPropPx)", () => {
  const css = `:root { --step-0: 14px; --step-1: 16.8px; --space-2: 0.5rem; --ink: #111; }`;
  const props = extractCustomProps(css);
  assert.deepEqual(extractPropPx(props, /^--step/).sort(), [14, 16.8]);
  assert.deepEqual(extractPropPx(props, /^--space/), [8]);
  assert.deepEqual(extractPropPx(props, /^--nope/), []);
});

test("audit-css: extractPx resolves var() and takes clamp() min/max only", () => {
  const css = `:root { --t1: 1rem; --h1: clamp(2.81rem, 2rem + 2vw, 4rem); }
    h1 { font-size: var(--h1); } p { font-size: var(--t1); } small { font-size: 14px; }`;
  const props = extractCustomProps(css);
  // clamp keeps 44.96 and 64 (min/max) but drops the fluid 2rem offset term
  assert.deepEqual(extractPx(css, "font-size", props), [14, 16, 44.96, 64]);
  // without props, var() declarations contribute nothing
  assert.deepEqual(extractPx(css.split("\n")[1], "font-size"), [14]);
});

test("audit-css: extractPx captures inset, including inset-inline/inset-block variants", () => {
  const css = `.a { inset: 12px; } .b { inset-inline: 8px; } .c { inset-block-start: 4px; }`;
  assert.deepEqual(extractPx(css, "margin[\\w-]*|padding[\\w-]*|inset[\\w-]*|gap"), [4, 8, 12]);
});

test("countEmUsage: reports em usage without attempting a risky conversion", () => {
  const css = `.a { font-size: 1.25em; } .b { font-size: 16px; } .c { padding: 0.5em; }`;
  assert.equal(countEmUsage(css, "font-size"), 1);
  assert.equal(countEmUsage(css, "padding[\\w-]*"), 1);
  assert.equal(countEmUsage(css, "margin[\\w-]*"), 0);
  // em values must NOT leak into the numeric px/rem extraction as if they were px
  assert.deepEqual(extractPx(css, "font-size"), [16]);
});

test("audit-css CLI: reports em usage as an excluded, non-guessed finding", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-audit-em-test-"));
  const file = path.join(dir, "em.css");
  fs.writeFileSync(
    file,
    `.a { color: #111111; background-color: #ffffff; font-size: 1.25em; padding: 0.5em; }`
  );
  const out = execFileSync(process.execPath, [auditCli, file], { stdio: "pipe" }).toString();
  assert.match(out, /em-based font-size value\(s\) found, excluded/);
  assert.match(out, /em-based spacing value\(s\) found, excluded/);
});

test("audit-css CLI: exit 1 on failing contrast, 0 on clean file, 2 on usage error", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-audit-test-"));
  const bad = path.join(dir, "bad.css");
  fs.writeFileSync(
    bad,
    `:root { --fg: #aaaaaa; } .low { color: var(--fg); background-color: #ffffff; padding: 10px; }`
  );
  const good = path.join(dir, "good.css");
  fs.writeFileSync(
    good,
    `.ok { color: #111111; background-color: #ffffff; font-size: 16px; padding: 8px; margin: 16px; }`
  );
  assert.equal(exitCode(auditCli, [bad]), 1);
  assert.equal(exitCode(auditCli, [good]), 0);
  assert.equal(exitCode(auditCli, []), 2);
  assert.equal(exitCode(auditCli, [path.join(dir, "missing.css")]), 2);
});

test("slop-check: detects each fingerprint class with evidence", () => {
  const slop = `<style>
    h1 { font-family: "Inter", sans-serif; background: linear-gradient(90deg,#6366f1,#8b5cf6);
         -webkit-background-clip: text; }
    .card { backdrop-filter: blur(12px); background: rgba(255,255,255,0.1);
            border-radius: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    .a{border-radius:12px}.b{border-radius:24px}.c{border-radius:16px}
    .violet { color: oklch(0.6 0.15 285); }
  </style><span>✨ New</span><i>🚀</i><i>💡</i>`;
  const ids = new Set(scan(slop).map((h) => h.id));
  for (const expected of [
    "font-default",
    "indigo-family",
    "gradient-text",
    "glassmorphism",
    "emoji-icons",
    "radius-uniform",
    "shadow-default",
    "sparkle-badge"
  ]) {
    assert.ok(ids.has(expected), `missing ${expected} (got: ${[...ids].join(", ")})`);
  }
});

test("slop-check: clean instrument-panel CSS produces zero hits", () => {
  const clean = `<style>
    :root { --surface: oklch(0.13 0.012 145); --text: oklch(0.87 0.02 145); }
    body { font-family: "JetBrains Mono", monospace; color: var(--text);
           background: var(--surface); }
    .row { border-radius: 0; padding: 8px; border-top: 1px solid oklch(0.24 0.012 145); }
    .accent { color: oklch(0.72 0.14 145); }
  </style><span>Estado: OK</span>`;
  assert.deepEqual(scan(clean), []);
});

test("slop-check: single emoji (content, not iconography) is tolerated", () => {
  assert.ok(!scan("<p>Gracias 🙂</p>").some((h) => h.id === "emoji-icons"));
});

test("slop-check: catches an indigo hex OUTSIDE the old hardcoded 11-item list", () => {
  // #5b21b6 (Tailwind violet-800) was never in the fixed list this checker used to rely on;
  // it's caught now because every hex found is converted to OKLCH and hue-tested, same as
  // literal oklch() strings already were.
  const hits = scan(`<style>.x { background: #5b21b6; }</style>`);
  assert.ok(hits.some((h) => h.id === "indigo-family" && h.evidence.includes("#5b21b6")));
});

test("slop-check: a non-indigo hex is not flagged (no false positive)", () => {
  assert.ok(
    !scan(`<style>.x { background: #22c55e; }</style>`).some((h) => h.id === "indigo-family")
  );
});

test("slop-check: an alpha hex (#rrggbbaa) is skipped, not mis-parsed as 6-digit", () => {
  assert.ok(
    !scan(`<style>.x { background: #6366f1aa; }</style>`).some((h) => h.id === "indigo-family")
  );
});

test("slop-check CLI: exit codes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-slop-test-"));
  const dirty = path.join(dir, "dirty.html");
  fs.writeFileSync(dirty, `<style>h1{font-family:Poppins;color:#6366f1}</style>`);
  const clean = path.join(dir, "clean.html");
  fs.writeFileSync(clean, `<style>h1{font-family:Georgia,serif;color:#1a1a1a}</style>`);
  assert.equal(exitCode(slopCli, [dirty]), 1);
  assert.equal(exitCode(slopCli, [clean]), 0);
  assert.equal(exitCode(slopCli, []), 2);
});

test("palette CLI: table, --json, usage errors", () => {
  assert.equal(exitCode(paletteCli, ["--hue", "250"]), 0);
  assert.equal(exitCode(paletteCli, []), 2);
  assert.equal(exitCode(paletteCli, ["--hue", "400"]), 2);
  assert.equal(exitCode(paletteCli, ["--hue", "250", "--chroma", "9"]), 2);
  const json = execFileSync(process.execPath, [paletteCli, "--hue", "250", "--json"], {
    stdio: "pipe"
  }).toString();
  const tokens = JSON.parse(json);
  assert.equal(tokens.color.neutral["99"].$type, "color");
  assert.match(tokens.color.accent["48"].$value, /^oklch\(/);
  assert.match(tokens.color.semantic.danger.onLight.$value, /^oklch\(/);
});
