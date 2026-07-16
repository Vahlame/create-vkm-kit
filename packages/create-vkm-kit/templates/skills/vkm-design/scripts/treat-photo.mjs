#!/usr/bin/env node
// Photo treatment — the "treat a photo" branch of illustration.md's technique table.
// When a subject has NO clean line-traceable reference (a busy-background photo, fine texture,
// a portrait), you don't trace it — you STYLE the real photo so it stays faithful (it IS the
// real thing) but reads as one designed system. Modes: duotone, dither, halftone, cutout.
//   node treat-photo.mjs <in.(jpg|png)> <out.png> --mode duotone|dither|halftone|cutout
//        [--shadow "#14210f"] [--highlight "#eef0e0"] [--field none|<hex>] [--cutout]
//        [--w 1400] [--dot 6] [--gamma 1] [--isolate 3] [--no-trim]
//        [--preset photo|detail|portrait|dramatic|flat] [--sharpen 90] [--scurve .4] [--clarity 10]
// Preprocessing (sharpen + s-curve + local contrast, per preset) is what makes a treatment look
// pro instead of flat — detail bites, midtones open. And "DPI" = pixel resolution: render at
// ≥ 2× the display size (--w 1400 for a hero) or you get coarse dots. Both learned from the
// laser-engraving presets in Vahlame/image-transformation-for-laser.
// --mode dither = blue-noise ordered dither (void-and-cluster, Ulichney 1993): a high-frequency,
//   cluster-free stipple that reads like a fine engraving — the polished alternative to the
//   regular-grid --mode halftone. --cutout removes the background so a busy scene becomes clean.
import { readFileSync, writeFileSync } from "node:fs";

// This script uses jimp's v0 API (default export, positional constructor, Jimp.MIME_PNG,
// Jimp.AUTO, getBufferAsync) — jimp v1 (current npm default) removed the default export
// entirely, which makes a STATIC `import Jimp from "jimp"` throw a raw SyntaxError before this
// file's body even runs (verified live against real jimp@1.6.1). A dynamic import lets us check
// the version and fail with a clear, actionable message instead of that cryptic crash (or a
// missing-package one).
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
  console.error("usage: node treat-photo.mjs <in> <out.png> --mode duotone|halftone|cutout [...]");
  process.exit(2);
}
// --- Blue-noise threshold matrix (void-and-cluster, Ulichney 1993) for --mode dither. ---
// A blue-noise ordered-dither screen distributes ink at high frequency with almost no low-freq
// energy → a smooth, cluster-free stipple (engraving/laser quality), unlike a regular grid.
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussWrap(src, S, sigma) {
  const rad = Math.max(1, Math.ceil(3 * sigma));
  const k = [];
  let ks = 0;
  for (let d = -rad; d <= rad; d++) {
    const v = Math.exp(-(d * d) / (2 * sigma * sigma));
    k.push(v);
    ks += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= ks;
  const tmp = new Float64Array(S * S);
  const out = new Float64Array(S * S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let a = 0;
      for (let d = -rad; d <= rad; d++) a += src[y * S + ((x + d + S) % S)] * k[d + rad];
      tmp[y * S + x] = a;
    }
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let a = 0;
      for (let d = -rad; d <= rad; d++) a += tmp[((y + d + S) % S) * S + x] * k[d + rad];
      out[y * S + x] = a;
    }
  return out;
}
function pickWhere(arr, mask, wantMax) {
  let bi = -1,
    bv = wantMax ? -Infinity : Infinity;
  for (let i = 0; i < arr.length; i++) {
    if (!mask[i]) continue;
    if (wantMax ? arr[i] > bv : arr[i] < bv) ((bv = arr[i]), (bi = i));
  }
  return bi;
}
function blueNoise(size, sigma = 1.5, fillFrac = 0.1, seed = 12345) {
  const S = size,
    n = S * S,
    rng = mulberry32(seed);
  const nOnes = Math.max(1, Math.round(n * fillFrac));
  const M = new Int8Array(n);
  const idx = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  for (let i = 0; i < nOnes; i++) M[idx[i]] = 1;
  for (let it = 0; it < 4000; it++) {
    const c = pickWhere(gaussWrap(M, S, sigma), M, true);
    M[c] = 0;
    const zeros = new Int8Array(n);
    for (let i = 0; i < n; i++) zeros[i] = M[i] ? 0 : 1;
    const v = pickWhere(gaussWrap(M, S, sigma), zeros, false);
    if (v === c) {
      M[c] = 1;
      break;
    }
    M[v] = 1;
  }
  const rank = new Int32Array(n).fill(-1);
  const M1 = Int8Array.from(M);
  for (let r = nOnes - 1; r >= 0; r--) {
    const c = pickWhere(gaussWrap(M1, S, sigma), M1, true);
    rank[c] = r;
    M1[c] = 0;
  }
  const M2 = Int8Array.from(M);
  for (let r = nOnes; r < n; r++) {
    const zeros = new Int8Array(n);
    for (let i = 0; i < n; i++) zeros[i] = M2[i] ? 0 : 1;
    const v = pickWhere(gaussWrap(M2, S, sigma), zeros, false);
    rank[v] = r;
    M2[v] = 1;
  }
  const T = new Float64Array(n);
  for (let i = 0; i < n; i++) T[i] = (rank[i] + 0.5) / n;
  return { T, S };
}

const mode = arg("--mode", "duotone");
const shadow = hexRgb(arg("--shadow", "#14210f"));
const highlight = hexRgb(arg("--highlight", "#eef0e0"));
const field = arg("--field", "none");
const cutout = process.argv.includes("--cutout") || mode === "cutout";
const outW = Number(arg("--w", "900"));
const dot = Number(arg("--dot", "6"));
const gamma = Number(arg("--gamma", "1"));

function hexRgb(h) {
  const m = h.replace("#", "");
  const n =
    m.length === 3
      ? m
          .split("")
          .map((c) => c + c)
          .join("")
      : m;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}
const lerp = (a, b, t) => Math.round(a + (b - a) * t);

const img = await Jimp.read(readFileSync(input));
if (img.bitmap.width > outW) img.resize(outW, Jimp.AUTO);
const W = img.bitmap.width,
  H = img.bitmap.height,
  D = img.bitmap.data;

// luminance + histogram (alpha-composited over white)
const lumArr = new Float32Array(W * H);
const hist = new Array(256).fill(0);
for (let i = 0; i < W * H; i++) {
  const a = D[i * 4 + 3] / 255;
  const l = 0.299 * D[i * 4] + 0.587 * D[i * 4 + 1] + 0.114 * D[i * 4 + 2];
  const g = a * l + (1 - a) * 255;
  lumArr[i] = g;
  hist[Math.round(g)]++;
}
function otsu() {
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0,
    wB = 0,
    max = 0,
    thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = W * H - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > max) ((max = between), (thr = t));
  }
  return thr;
}

function largest(m) {
  const lab = new Int32Array(W * H);
  let cur = 0,
    best = 0,
    bestN = 0;
  const st = [];
  for (let i = 0; i < W * H; i++) {
    if (!m[i] || lab[i]) continue;
    cur++;
    let n = 0;
    st.push(i);
    lab[i] = cur;
    while (st.length) {
      const p = st.pop();
      n++;
      const x = p % W;
      if (x + 1 < W && m[p + 1] && !lab[p + 1]) ((lab[p + 1] = cur), st.push(p + 1));
      if (x - 1 >= 0 && m[p - 1] && !lab[p - 1]) ((lab[p - 1] = cur), st.push(p - 1));
      if (p + W < W * H && m[p + W] && !lab[p + W]) ((lab[p + W] = cur), st.push(p + W));
      if (p - W >= 0 && m[p - W] && !lab[p - W]) ((lab[p - W] = cur), st.push(p - W));
    }
    if (n > bestN) ((bestN = n), (best = cur));
  }
  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = lab[i] === best ? 1 : 0;
  return out;
}
function fill(m) {
  const bg = new Uint8Array(W * H);
  const s = [];
  for (let x = 0; x < W; x++) (s.push(x), s.push((H - 1) * W + x));
  for (let y = 0; y < H; y++) (s.push(y * W), s.push(y * W + W - 1));
  while (s.length) {
    const p = s.pop();
    if (p < 0 || p >= W * H || bg[p] || m[p]) continue;
    bg[p] = 1;
    const x = p % W;
    if (x + 1 < W) s.push(p + 1);
    if (x - 1 >= 0) s.push(p - 1);
    if (p + W < W * H) s.push(p + W);
    if (p - W >= 0) s.push(p - W);
  }
  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = m[i] || !bg[i] ? 1 : 0;
  return out;
}
// erode/dilate by `it` iterations (4-neighbour). Erosion breaks thin bridges (a leaf's petiole,
// a twig) that connect satellite fragments to the main subject; a matching dilation restores size.
function erode(m, it) {
  for (let k = 0; k < it; k++) {
    const o = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      if (!m[i]) continue;
      const x = i % W;
      o[i] =
        m[i] &&
        (x + 1 >= W || m[i + 1]) &&
        (x - 1 < 0 || m[i - 1]) &&
        (i + W >= W * H || m[i + W]) &&
        (i - W < 0 || m[i - W])
          ? 1
          : 0;
    }
    m = o;
  }
  return m;
}
function dilate(m, it) {
  for (let k = 0; k < it; k++) {
    const o = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const x = i % W;
      o[i] =
        m[i] ||
        (x + 1 < W && m[i + 1]) ||
        (x - 1 >= 0 && m[i - 1]) ||
        (i + W < W * H && m[i + W]) ||
        (i - W >= 0 && m[i - W])
          ? 1
          : 0;
    }
    m = o;
  }
  return m;
}

// Meticulous subject isolation: threshold → OPENING (erode `iso` → keep largest → dilate `iso`)
// so thin-bridged satellites (other leaves on the branch, stray specks) fall away and only the
// main compact subject survives → fill holes → clean single silhouette.
function subjectMask() {
  const thr = otsu();
  const corners = [lumArr[0], lumArr[W - 1], lumArr[(H - 1) * W], lumArr[W * H - 1]];
  const bgLight = corners.reduce((a, b) => a + b, 0) / 4 > thr;
  let m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) m[i] = (bgLight ? lumArr[i] < thr : lumArr[i] > thr) ? 1 : 0;
  const iso = Number(arg("--isolate", "3"));
  m = largest(m);
  if (iso > 0) {
    m = erode(m, iso);
    m = largest(m);
    m = dilate(m, iso);
    m = largest(m);
  }
  return fill(m);
}

const mask = cutout ? subjectMask() : null;
// Contrast-stretch luminance to the 2nd–98th percentile (within the subject if cut out). A
// mid-gray subject on white otherwise maps to muddy mid-tones — after stretch, highlights read
// clean and shadows read dark, which is what makes duotone/halftone legible at a glance.
(function stretch() {
  const vals = [];
  for (let i = 0; i < W * H; i++) if (!mask || mask[i]) vals.push(lumArr[i]);
  if (vals.length < 16) return;
  vals.sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length * 0.02)];
  const hi = vals[Math.floor(vals.length * 0.98)];
  if (hi - lo < 8) return;
  for (let i = 0; i < W * H; i++)
    lumArr[i] = Math.min(255, Math.max(0, ((lumArr[i] - lo) / (hi - lo)) * 255));
})();

// --- Preprocessing stack (informed by the laser-engraving presets: s-curve + local contrast +
// unsharp). This is what makes a treated photo look "incredible" instead of flat — detail pops,
// midtones open up, edges bite. Presets bundle sane defaults per image class; flags override. ---
const PRESETS = {
  photo: { sharpen: 70, scurve: 0.35, clarity: 8 },
  detail: { sharpen: 90, scurve: 0.4, clarity: 10 },
  portrait: { sharpen: 90, scurve: 0.3, clarity: 6 },
  dramatic: { sharpen: 120, scurve: 0.5, clarity: 14 },
  flat: { sharpen: 0, scurve: 0, clarity: 0 }
};
const preset = PRESETS[arg("--preset", "detail")] || PRESETS.detail;
const pSharpen = Number(arg("--sharpen", preset.sharpen));
const pScurve = Number(arg("--scurve", preset.scurve));
const pClarity = Number(arg("--clarity", preset.clarity));

function blurImg(src, radius) {
  const rad = Math.max(1, Math.round(radius));
  const sig = rad / 2;
  const k = [];
  let ks = 0;
  for (let d = -rad; d <= rad; d++) {
    const v = Math.exp(-(d * d) / (2 * sig * sig));
    k.push(v);
    ks += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= ks;
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let a = 0;
      for (let d = -rad; d <= rad; d++)
        a += src[y * W + Math.min(W - 1, Math.max(0, x + d))] * k[d + rad];
      tmp[y * W + x] = a;
    }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let a = 0;
      for (let d = -rad; d <= rad; d++)
        a += tmp[Math.min(H - 1, Math.max(0, y + d)) * W + x] * k[d + rad];
      out[y * W + x] = a;
    }
  return out;
}
// local contrast / clarity: add back the high-pass over a LARGE radius
if (pClarity > 0) {
  const big = blurImg(lumArr, Math.max(8, Math.round(Math.max(W, H) / 40)));
  const amt = pClarity / 100;
  for (let i = 0; i < W * H; i++)
    lumArr[i] = Math.min(255, Math.max(0, lumArr[i] + amt * (lumArr[i] - big[i])));
}
// S-curve: blend toward smoothstep — opens midtones, deepens shadows (photoreal punch)
if (pScurve > 0) {
  for (let i = 0; i < W * H; i++) {
    const t = lumArr[i] / 255;
    const s = t * t * (3 - 2 * t);
    lumArr[i] = (t + (s - t) * pScurve) * 255;
  }
}
// Unsharp mask: high-pass over a SMALL radius → crisp detail/edges (the biggest "wow" lever)
if (pSharpen > 0) {
  const r = Math.max(1, Math.round(Math.max(W, H) / 600));
  const small = blurImg(lumArr, r);
  const amt = pSharpen / 100;
  for (let i = 0; i < W * H; i++)
    lumArr[i] = Math.min(255, Math.max(0, lumArr[i] + amt * (lumArr[i] - small[i])));
}

// Silhouette edge: a subject pixel with a non-subject 4-neighbour. A crisp outline lets the shape
// read even when the interior is dots.
function isEdge(i) {
  if (!mask || !mask[i]) return false;
  const x = i % W;
  return (
    (x + 1 < W && !mask[i + 1]) ||
    (x - 1 >= 0 && !mask[i - 1]) ||
    (i + W < W * H && !mask[i + W]) ||
    (i - W >= 0 && !mask[i - W])
  );
}

const fieldRgb = field === "none" ? null : hexRgb(field);
const out = new Jimp(W, H, 0x00000000);

function setPx(i, r, g, b, a = 255) {
  out.bitmap.data[i * 4] = r;
  out.bitmap.data[i * 4 + 1] = g;
  out.bitmap.data[i * 4 + 2] = b;
  out.bitmap.data[i * 4 + 3] = a;
}
function bgPx(i) {
  if (fieldRgb) setPx(i, fieldRgb[0], fieldRgb[1], fieldRgb[2], 255);
  else setPx(i, 0, 0, 0, 0);
}

if (mode === "cutout") {
  for (let i = 0; i < W * H; i++) {
    if (mask[i]) setPx(i, D[i * 4], D[i * 4 + 1], D[i * 4 + 2], 255);
    else bgPx(i);
  }
} else if (mode === "dither") {
  // blue-noise ordered dither: ink a pixel when its tone falls below the local threshold.
  const { T, S } = blueNoise(Number(arg("--screen", "32")));
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (cutout && !mask[i]) {
        bgPx(i);
        continue;
      }
      const t = Math.pow(Math.min(1, Math.max(0, lumArr[i] / 255)), gamma); // 0 dark..1 light
      const ink = t < T[(y % S) * S + (x % S)];
      if (ink) setPx(i, shadow[0], shadow[1], shadow[2], 255);
      else setPx(i, highlight[0], highlight[1], highlight[2], 255);
    }
  if (cutout)
    for (let i = 0; i < W * H; i++)
      if (isEdge(i)) {
        setPx(i, shadow[0], shadow[1], shadow[2], 255);
        const x = i % W;
        if (x + 1 < W) setPx(i + 1, shadow[0], shadow[1], shadow[2], 255);
        if (i + W < W * H) setPx(i + W, shadow[0], shadow[1], shadow[2], 255);
      }
} else if (mode === "duotone") {
  for (let i = 0; i < W * H; i++) {
    if (cutout && !mask[i]) {
      bgPx(i);
      continue;
    }
    const t = Math.pow(Math.min(1, Math.max(0, lumArr[i] / 255)), gamma);
    setPx(
      i,
      lerp(shadow[0], highlight[0], t),
      lerp(shadow[1], highlight[1], t),
      lerp(shadow[2], highlight[2], t)
    );
  }
} else if (mode === "halftone") {
  // fill background first
  for (let i = 0; i < W * H; i++) {
    if (cutout && !mask[i]) bgPx(i);
    else setPx(i, highlight[0], highlight[1], highlight[2], 255);
  }
  // stamp dots on a grid; radius grows with darkness of the cell average
  for (let cy = 0; cy < H; cy += dot) {
    for (let cx = 0; cx < W; cx += dot) {
      let sum = 0,
        cnt = 0,
        inMask = false;
      for (let y = cy; y < Math.min(H, cy + dot); y++)
        for (let x = cx; x < Math.min(W, cx + dot); x++) {
          const i = y * W + x;
          if (cutout && !mask[i]) continue;
          sum += lumArr[i];
          cnt++;
          inMask = true;
        }
      if (!cnt || !inMask) continue;
      const darkness = 1 - Math.pow(sum / cnt / 255, gamma);
      // radius up to ~0.72×pitch so the darkest dots nearly touch (reads as solid shadow),
      // and a floor so mid-tones still show a visible dot instead of vanishing to mud.
      const r = darkness < 0.08 ? 0 : (Math.min(1, darkness * 1.15) * dot * 0.72) / 2;
      const ccx = cx + dot / 2,
        ccy = cy + dot / 2;
      for (let y = Math.floor(ccy - r); y <= ccy + r; y++)
        for (let x = Math.floor(ccx - r); x <= ccx + r; x++) {
          if (x < 0 || x >= W || y < 0 || y >= H) continue;
          const i = y * W + x;
          if (cutout && !mask[i]) continue;
          if ((x - ccx) ** 2 + (y - ccy) ** 2 <= r * r)
            setPx(i, shadow[0], shadow[1], shadow[2], 255);
        }
    }
  }
  // crisp silhouette outline so the shape reads over the dot texture
  if (cutout) {
    for (let i = 0; i < W * H; i++)
      if (isEdge(i)) {
        setPx(i, shadow[0], shadow[1], shadow[2], 255);
        const x = i % W;
        if (x + 1 < W) setPx(i + 1, shadow[0], shadow[1], shadow[2], 255);
        if (i + W < W * H) setPx(i + W, shadow[0], shadow[1], shadow[2], 255);
      }
  }
}

// Auto-trim a cutout to the subject's tight bbox (+ small even padding) so the asset carries no
// dead margin — it drops into ANY container and scales cleanly, like the traces' --square. Off
// with --no-trim; padding via --pad (fraction of the longer side, default 0.04).
let trimInfo = null;
if (mask && !process.argv.includes("--no-trim")) {
  let x0 = W,
    x1 = -1,
    y0 = H,
    y1 = -1;
  for (let i = 0; i < W * H; i++)
    if (mask[i]) {
      const x = i % W,
        y = (i / W) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  if (x1 >= x0 && y1 >= y0) {
    const bw = x1 - x0 + 1,
      bh = y1 - y0 + 1;
    const pad = Math.round(Math.max(bw, bh) * Number(arg("--pad", "0.04")));
    const cx = Math.max(0, x0 - pad),
      cy = Math.max(0, y0 - pad);
    const cw = Math.min(W - cx, bw + pad * 2),
      ch = Math.min(H - cy, bh + pad * 2);
    out.crop(cx, cy, cw, ch);
    trimInfo = `${cw}x${ch}`;
  }
}

writeFileSync(output, await out.getBufferAsync(Jimp.MIME_PNG));
let area = 0;
if (mask) for (let i = 0; i < W * H; i++) area += mask[i];
console.log(
  JSON.stringify({
    output,
    mode,
    size: `${W}x${H}`,
    trimmedTo: trimInfo,
    cutout,
    subjectCoverage: mask ? +(area / (W * H)).toFixed(3) : null
  })
);
