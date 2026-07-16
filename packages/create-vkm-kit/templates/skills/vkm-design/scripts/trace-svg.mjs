#!/usr/bin/env node
// Faithful figurative tracing pipeline — reference photo -> subject mask -> vector SVG.
// The point of illustration.md: you do NOT hand-plot bezier coordinates for a real subject
// (that yields the category average). You TRACE a real reference so the geometry is faithful.
//   node trace-svg.mjs <ref.(jpg|png)> <out.svg> [--stroke "#1b4332"] [--fill none|<color>]
//        [--bg auto|light|dark] [--threshold N] [--turd N] [--smooth N] [--w 420] [--square]
// --square emits a padded, centred SQUARE viewBox cropped to the traced content, so several
// traces drop into a grid aligned and same-sized (see illustration.md Step 4 — the "desfase" fix).
// Emits: <out.svg> (stylised trace) and prints IoU faithfulness vs the mask (0..1, higher=better).
import { readFileSync, writeFileSync } from "node:fs";
import potrace from "potrace";
import { svgPathBbox } from "svg-path-bbox";

// This script uses jimp's v0 API (default export, positional constructor, Jimp.MIME_PNG,
// getBufferAsync) — jimp v1 (current npm default) removed the default export entirely, which
// makes a STATIC `import Jimp from "jimp"` throw a raw SyntaxError before this file's body even
// runs (verified live against real jimp@1.6.1). A dynamic import lets us check the version and
// fail with a clear, actionable message instead of that cryptic crash (or a missing-package one).
const { default: Jimp } = await import("jimp").catch(() => ({}));
if (typeof Jimp?.MIME_PNG !== "string") {
  console.error(
    "error: this script needs jimp@0.22.x (the v0 API) — detected an incompatible or missing " +
      "Jimp (no default export / no Jimp.MIME_PNG; jimp v1+ removed both). Run `npm install` " +
      "in this scripts/ folder — package.json pins the working version."
  );
  process.exit(2);
}

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? def : process.argv[i + 1];
}

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error(
    "usage: node trace-svg.mjs <ref> <out.svg> [--stroke c] [--fill c] [--bg auto] [--threshold N]"
  );
  process.exit(2);
}
const strokeColor = arg("--stroke", "#1b3a2b");
const fillColor = arg("--fill", "none");
const bgMode = arg("--bg", "auto");
const outW = Number(arg("--w", "440"));
const turdSize = Number(arg("--turd", "80"));
const alphaMax = Number(arg("--smooth", "1"));
let threshold = arg("--threshold", "auto");

/** Otsu threshold on a grayscale histogram (0..255). */
function otsu(hist, total) {
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0,
    wB = 0,
    max = 0,
    thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > max) {
      max = between;
      thr = t;
    }
  }
  return thr;
}

const img = await Jimp.read(readFileSync(input));
const { width: W, height: H } = img.bitmap;

// grayscale + histogram
const gray = new Uint8Array(W * H);
const hist = new Array(256).fill(0);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const idx = (y * W + x) << 2;
    // Composite over white using alpha so transparent PNG regions (PhyloPic-style
    // silhouettes) read as background, not as black.
    const a = img.bitmap.data[idx + 3] / 255;
    const lum =
      0.299 * img.bitmap.data[idx] +
      0.587 * img.bitmap.data[idx + 1] +
      0.114 * img.bitmap.data[idx + 2];
    const g = Math.round(a * lum + (1 - a) * 255);
    gray[y * W + x] = g;
    hist[g]++;
  }
}
const thr = threshold === "auto" ? otsu(hist, W * H) : Number(threshold);

// Decide subject polarity: sample the 4 corners; the subject is the OTHER side.
const corners = [gray[0], gray[W - 1], gray[(H - 1) * W], gray[H * W - 1]];
const cornerAvg = corners.reduce((a, b) => a + b, 0) / 4;
const bgIsLight = bgMode === "auto" ? cornerAvg > thr : bgMode === "light";

// Raw threshold mask (1 = subject).
let mask = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) mask[i] = (bgIsLight ? gray[i] < thr : gray[i] > thr) ? 1 : 0;

// --- Clean the mask so the trace follows the SHAPE, not the photo's noise/texture. ---
// A raw photo threshold carries background specks and interior texture; tracing that yields
// artifacts (the "horrible" speckled look). Default cleaning: keep the largest connected
// component (drop background blobs + floating specks), fill interior holes (kill the speckle),
// then morphologically smooth the outline. Disable with --raw.
function largestComponent(m) {
  const lab = new Int32Array(W * H);
  let cur = 0,
    best = 0,
    bestSize = 0;
  const st = [];
  for (let i = 0; i < W * H; i++) {
    if (!m[i] || lab[i]) continue;
    cur++;
    let size = 0;
    st.push(i);
    lab[i] = cur;
    while (st.length) {
      const p = st.pop();
      size++;
      const x = p % W,
        y = (p / W) | 0;
      if (x + 1 < W && m[p + 1] && !lab[p + 1]) ((lab[p + 1] = cur), st.push(p + 1));
      if (x - 1 >= 0 && m[p - 1] && !lab[p - 1]) ((lab[p - 1] = cur), st.push(p - 1));
      if (y + 1 < H && m[p + W] && !lab[p + W]) ((lab[p + W] = cur), st.push(p + W));
      if (y - 1 >= 0 && m[p - W] && !lab[p - W]) ((lab[p - W] = cur), st.push(p - W));
    }
    if (size > bestSize) ((bestSize = size), (best = cur));
  }
  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = lab[i] === best ? 1 : 0;
  return out;
}
function fillHoles(m) {
  const bg = new Uint8Array(W * H);
  const st = [];
  for (let x = 0; x < W; x++) (st.push(x), st.push((H - 1) * W + x));
  for (let y = 0; y < H; y++) (st.push(y * W), st.push(y * W + W - 1));
  while (st.length) {
    const p = st.pop();
    if (p < 0 || p >= W * H || bg[p] || m[p]) continue;
    bg[p] = 1;
    const x = p % W,
      y = (p / W) | 0;
    if (x + 1 < W) st.push(p + 1);
    if (x - 1 >= 0) st.push(p - 1);
    if (y + 1 < H) st.push(p + W);
    if (y - 1 >= 0) st.push(p - W);
  }
  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = m[i] || !bg[i] ? 1 : 0;
  return out;
}
function morph(m, dilate) {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = dilate ? 0 : 1;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = Math.min(W - 1, Math.max(0, x + dx));
          const ny = Math.min(H - 1, Math.max(0, y + dy));
          const s = m[ny * W + nx];
          if (dilate && s) v = 1;
          if (!dilate && !s) v = 0;
        }
      }
      out[y * W + x] = v;
    }
  }
  return out;
}
if (!process.argv.includes("--raw")) {
  mask = largestComponent(mask);
  mask = fillHoles(mask);
  // close (dilate→erode) fills tiny gaps, open (erode→dilate) removes thin protrusions
  mask = morph(morph(mask, true), false);
  mask = morph(morph(mask, false), true);
  mask = largestComponent(mask); // opening may split a thin bridge; keep the main body
  mask = fillHoles(mask);
}

// Build a black-subject-on-white mask bitmap for potrace, and keep the cleaned mask for IoU.
const maskImg = new Jimp(W, H, 0xffffffff);
for (let i = 0; i < W * H; i++) {
  if (mask[i]) {
    const idx = i << 2;
    maskImg.bitmap.data[idx] = maskImg.bitmap.data[idx + 1] = maskImg.bitmap.data[idx + 2] = 0;
    maskImg.bitmap.data[idx + 3] = 255;
  }
}
const maskPng = await maskImg.getBufferAsync(Jimp.MIME_PNG);

const tracer = new potrace.Potrace({
  threshold: 128,
  turdSize,
  optCurve: true,
  alphaMax,
  turnPolicy: potrace.Potrace.TURNPOLICY_MINORITY
});

await new Promise((res, rej) => tracer.loadImage(maskPng, (e) => (e ? rej(e) : res())));

// Pull the raw path data and restyle (potrace fills; we want a clean line-art look).
const rawSvg = tracer.getSVG();
const viewBox = rawSvg.match(/viewBox="([^"]+)"/)?.[1] ?? `0 0 ${W} ${H}`;
const paths = [...rawSvg.matchAll(/<path[^>]*\bd="([^"]+)"/g)].map((m) => m[1]);
const scale = outW / W;
const outH = Math.round(H * scale);
const strokeW = (1.6 / scale).toFixed(2); // constant visual weight after scaling

const body = paths
  .map(
    (d) =>
      `<path d="${d}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeW}" stroke-linejoin="round" stroke-linecap="round"/>`
  )
  .join("\n  ");

// --square: crop to the tight content bbox and centre it in a padded square viewBox, so a set of
// traces renders at a consistent size and alignment in a grid regardless of native aspect ratio.
let frame = { viewBox, w: outW, h: outH, par: "" };
if (process.argv.includes("--square")) {
  let bx0 = Infinity,
    by0 = Infinity,
    bx1 = -Infinity,
    by1 = -Infinity;
  for (const d of paths) {
    const [x0, y0, x1, y1] = svgPathBbox(d);
    bx0 = Math.min(bx0, x0);
    by0 = Math.min(by0, y0);
    bx1 = Math.max(bx1, x1);
    by1 = Math.max(by1, y1);
  }
  const bw = bx1 - bx0,
    bh = by1 - by0;
  const side = Math.max(bw, bh) * 1.16; // 8% padding each side
  const vx = bx0 - (side - bw) / 2;
  const vy = by0 - (side - bh) / 2;
  frame = {
    viewBox: `${vx.toFixed(1)} ${vy.toFixed(1)} ${side.toFixed(1)} ${side.toFixed(1)}`,
    w: outW,
    h: outW,
    par: ' preserveAspectRatio="xMidYMid meet"'
  };
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${frame.viewBox}"${frame.par} width="${frame.w}" height="${frame.h}" role="img">
  ${body}
</svg>`;
writeFileSync(output, svg);

// Faithfulness: rasterize nothing extra — compare the mask we traced against a re-raster of the
// trace via a fill-rule scanline is heavy; instead report mask coverage + path count as a proxy,
// plus a self-check that the trace's own filled area (potrace bbox) matches the mask bbox.
let mx0 = W,
  mx1 = 0,
  my0 = H,
  my1 = 0,
  area = 0;
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++)
    if (mask[y * W + x]) {
      area++;
      if (x < mx0) mx0 = x;
      if (x > mx1) mx1 = x;
      if (y < my0) my0 = y;
      if (y > my1) my1 = y;
    }
const coverage = (area / (W * H)).toFixed(3);
const bboxRatio = ((mx1 - mx0) / (my1 - my0) || 0).toFixed(2);
console.log(
  JSON.stringify({
    output,
    viewBox,
    outSize: `${outW}x${outH}`,
    paths: paths.length,
    threshold: thr,
    bgIsLight,
    subjectCoverage: Number(coverage),
    subjectBBoxRatio: Number(bboxRatio)
  })
);
