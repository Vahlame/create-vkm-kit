// Raster helpers shared by trace-svg.mjs and treat-photo.mjs.
//
// Both scripts isolate a subject from a photo before doing their own thing with it
// (trace it to vectors / style it as a treatment), so both had grown a private copy of
// the same four operations: Otsu thresholding, largest-connected-component, hole filling
// and morphology. The copies were the same algorithm with different variable names and
// bounds-check spellings, which is the worst kind of duplication — a fix to one is
// invisible to the other.
//
// Everything here is a PURE function over a flat Uint8Array mask plus explicit `W`/`H`.
// The originals closed over module-level `W`/`H`, which is why neither could be tested:
// importing the file ran the whole pipeline. Now the geometry is testable and the scripts
// keep only what is genuinely theirs.
//
// Zero deps at import time — `loadJimp()` is a function, not a top-level await, so a test
// can import this module on a machine with no jimp installed.

/**
 * Read `--flag value` from an argv array.
 * @param {string} flag
 * @param {string} [def]
 * @param {string[]} [argv]
 * @returns {string|undefined}
 */
export function arg(flag, def, argv = process.argv) {
  const i = argv.indexOf(flag);
  return i === -1 ? def : argv[i + 1];
}

/**
 * Load jimp's v0 API, or throw with an actionable message.
 *
 * These scripts use jimp v0 (default export, positional constructor, `Jimp.MIME_PNG`,
 * `Jimp.AUTO`, `getBufferAsync`). jimp v1 — the current npm default — removed the default
 * export, so a static `import Jimp from "jimp"` throws a raw SyntaxError before the
 * importing file's body runs at all (verified against jimp@1.6.1). A dynamic import lets
 * us detect that and say what to do about it.
 *
 * @returns {Promise<any>} the jimp v0 default export
 */
export async function loadJimp() {
  const { default: Jimp } = await import("jimp").catch(() => ({}));
  if (typeof Jimp?.MIME_PNG !== "string") {
    throw new Error(
      "this script needs jimp@0.22.x (the v0 API) — detected an incompatible or missing " +
        "Jimp (no default export / no Jimp.MIME_PNG; jimp v1+ removed both). Run " +
        "`npm install` in this scripts/ folder — package.json pins the working version."
    );
  }
  return Jimp;
}

/**
 * Otsu's threshold over a 256-bin grayscale histogram: the cut that maximises
 * between-class variance. Returns 127 for a degenerate (single-value) histogram rather
 * than throwing — a flat image has no meaningful threshold and the caller wants a number.
 *
 * @param {ArrayLike<number>} hist 256 bins
 * @param {number} total pixel count
 * @returns {number} 0–255
 */
export function otsu(hist, total) {
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let max = 0;
  let thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > max) {
      max = between;
      thr = t;
    }
  }
  return thr;
}

/**
 * Keep only the largest 4-connected component of a binary mask. Iterative flood fill —
 * recursion would blow the stack on a megapixel image.
 *
 * An empty mask returns an empty mask. Both original copies of this function returned a
 * FULL mask instead: with nothing to label, `best` stayed 0 and the final `label[i] ===
 * best` test read `0 === 0` for every background pixel. A threshold that found no subject
 * therefore reported the entire frame as the subject — and downstream, `--cutout` would
 * keep everything and `isolateSubject` would hand back a solid rectangle.
 *
 * @param {Uint8Array} mask
 * @param {number} W
 * @param {number} H
 * @returns {Uint8Array} a new mask
 */
export function largestComponent(mask, W, H) {
  const n = W * H;
  const label = new Int32Array(n);
  let current = 0;
  let best = 0;
  let bestSize = 0;
  /** @type {number[]} */
  const stack = [];
  for (let i = 0; i < n; i++) {
    if (!mask[i] || label[i]) continue;
    current++;
    let size = 0;
    stack.push(i);
    label[i] = current;
    while (stack.length) {
      const p = stack.pop();
      size++;
      const x = p % W;
      if (x + 1 < W && mask[p + 1] && !label[p + 1]) {
        label[p + 1] = current;
        stack.push(p + 1);
      }
      if (x - 1 >= 0 && mask[p - 1] && !label[p - 1]) {
        label[p - 1] = current;
        stack.push(p - 1);
      }
      if (p + W < n && mask[p + W] && !label[p + W]) {
        label[p + W] = current;
        stack.push(p + W);
      }
      if (p - W >= 0 && mask[p - W] && !label[p - W]) {
        label[p - W] = current;
        stack.push(p - W);
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = current;
    }
  }
  const out = new Uint8Array(n);
  if (!best) return out; // nothing was labelled — see the note above
  for (let i = 0; i < n; i++) out[i] = label[i] === best ? 1 : 0;
  return out;
}

/**
 * Fill enclosed holes: flood the background inward from the border, then everything the
 * flood could not reach is interior and becomes subject. An eye or a gap between wings
 * would otherwise punch a hole through the traced silhouette.
 *
 * @param {Uint8Array} mask
 * @param {number} W
 * @param {number} H
 * @returns {Uint8Array} a new mask
 */
export function fillHoles(mask, W, H) {
  const n = W * H;
  const bg = new Uint8Array(n);
  /** @type {number[]} */
  const stack = [];
  for (let x = 0; x < W; x++) {
    stack.push(x);
    stack.push((H - 1) * W + x);
  }
  for (let y = 0; y < H; y++) {
    stack.push(y * W);
    stack.push(y * W + W - 1);
  }
  while (stack.length) {
    const p = stack.pop();
    if (p < 0 || p >= n || bg[p] || mask[p]) continue;
    bg[p] = 1;
    const x = p % W;
    if (x + 1 < W) stack.push(p + 1);
    if (x - 1 >= 0) stack.push(p - 1);
    if (p + W < n) stack.push(p + W);
    if (p - W >= 0) stack.push(p - W);
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = mask[i] || !bg[i] ? 1 : 0;
  return out;
}

/**
 * One pass of 8-connected (3×3 box) morphology, edge-clamped.
 *
 * Kept distinct from {@link erode4}/{@link dilate4} because the neighbourhood is not the
 * same: a 3×3 box also travels diagonally, so it closes a staircase gap a 4-neighbour
 * pass leaves open. trace-svg wants that (a smoother outline to hand to potrace);
 * treat-photo does not (a diagonal dilation fattens a cutout's edge visibly).
 *
 * @param {Uint8Array} mask
 * @param {number} W
 * @param {number} H
 * @param {boolean} dilate true to dilate, false to erode
 * @returns {Uint8Array} a new mask
 */
export function morph8(mask, W, H, dilate) {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = dilate ? 0 : 1;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = Math.min(W - 1, Math.max(0, x + dx));
          const ny = Math.min(H - 1, Math.max(0, y + dy));
          const s = mask[ny * W + nx];
          if (dilate && s) v = 1;
          if (!dilate && !s) v = 0;
        }
      }
      out[y * W + x] = v;
    }
  }
  return out;
}

/**
 * 4-neighbour erosion, `iterations` passes. Out-of-bounds neighbours count as set, so the
 * image border does not erode inward.
 *
 * Erosion is what breaks the thin bridges — a leaf's petiole, a twig — that attach
 * satellite fragments to the main subject.
 *
 * @param {Uint8Array} mask
 * @param {number} W
 * @param {number} H
 * @param {number} iterations
 * @returns {Uint8Array}
 */
export function erode4(mask, W, H, iterations) {
  const n = W * H;
  let m = mask;
  for (let k = 0; k < iterations; k++) {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (!m[i]) continue;
      const x = i % W;
      out[i] =
        (x + 1 >= W || m[i + 1]) &&
        (x - 1 < 0 || m[i - 1]) &&
        (i + W >= n || m[i + W]) &&
        (i - W < 0 || m[i - W])
          ? 1
          : 0;
    }
    m = out;
  }
  return m;
}

/**
 * 4-neighbour dilation, `iterations` passes — the inverse of {@link erode4}, used to
 * restore a mask to its original size after an erosion.
 *
 * @param {Uint8Array} mask
 * @param {number} W
 * @param {number} H
 * @param {number} iterations
 * @returns {Uint8Array}
 */
export function dilate4(mask, W, H, iterations) {
  const n = W * H;
  let m = mask;
  for (let k = 0; k < iterations; k++) {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const x = i % W;
      out[i] =
        m[i] ||
        (x + 1 < W && m[i + 1]) ||
        (x - 1 >= 0 && m[i - 1]) ||
        (i + W < n && m[i + W]) ||
        (i - W >= 0 && m[i - W])
          ? 1
          : 0;
    }
    m = out;
  }
  return m;
}

/**
 * Meticulous subject isolation:
 * largest component → (erode → largest → dilate) → fill holes.
 *
 * The erode/dilate pair is a morphological OPENING: it drops anything only thinly
 * connected to the main body before the second component search, so a stray twig no
 * longer carries half the background along with the subject, and the dilation returns
 * the survivor to roughly its original size.
 *
 * The leading `largestComponent` is NOT redundant with the one after the erosion.
 * Eroding first can dissolve a large-but-thin structure entirely, leaving a smaller
 * compact blob as the winner — a different subject. Picking the largest component of the
 * raw mask first decides the subject on the full evidence, then opens it.
 *
 * There is no fourth pass after the dilation: 4-neighbour dilation of a connected set is
 * connected (every added pixel is adjacent to a set pixel), so one component in is one
 * component out and the search would return its input.
 *
 * @param {Uint8Array} mask
 * @param {number} W
 * @param {number} H
 * @param {number} [isolate] erosion/dilation iterations; 0 skips the opening entirely
 * @returns {Uint8Array}
 */
export function isolateSubject(mask, W, H, isolate = 0) {
  let m = largestComponent(mask, W, H);
  if (isolate > 0) {
    m = largestComponent(erode4(m, W, H, isolate), W, H);
    m = dilate4(m, W, H, isolate);
  }
  return fillHoles(m, W, H);
}

/**
 * Bounding box of the set pixels, or null when the mask is empty.
 * @param {Uint8Array} mask
 * @param {number} W
 * @param {number} H
 * @returns {{x0: number, y0: number, x1: number, y1: number}|null}
 */
export function maskBounds(mask, W, H) {
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}
