#!/usr/bin/env node
// Pure geometry gates for vkm-ui-judge. Input is a first-viewport dump of boxes
// (selector, rect, padding, role flags) collected in-page; output is the same
// finding shape as ui-audit.mjs (check, severity, selector, detail).
//
// Why this file exists: contrast/overflow/tap-target can all be green while the
// page still looks "AI-made" because text kisses the viewport, cards have 4px
// padding, sibling sections sit 2px apart, and three buttons disagree on size.
// Those defects are RECTANGLES, not taste — measure them.
//
// Screen-edge floors follow Material 3 compact/medium margins (16 / 24 CSS px)
// as a *default* for product UI. A direction that earns a full-bleed crop
// (hung wordmark, editorial overlap) is exempted when the box hangs PAST the
// viewport (x < -8 or right > vw+8); touching-from-inside is not a crop, it
// is a missing gutter.
//
// Library:   import { auditGeometry } from "./layout-checks.mjs"
// CLI:       none — ui-audit.mjs is the entry point.

/**
 * @typedef {{
 *   selector: string,
 *   tag?: string,
 *   role?: string,
 *   x: number, y: number, w: number, h: number,
 *   padT?: number, padR?: number, padB?: number, padL?: number,
 *   fontSize?: number, fontWeight?: number, radius?: number,
 *   text?: boolean,
 *   interactive?: boolean,
 *   card?: boolean,
 *   position?: string
 * }} Box
 *
 * @typedef {{ check: string, severity: "error" | "warn", selector: string, detail: string }} Finding
 */

/** Compact (phone) vs medium+ (tablet/desktop) content inset, M3-aligned. */
export function viewportGutter(vw) {
  return vw <= 600 ? 16 : 24;
}

function area(a, b) {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return x * y;
}

function contains(outer, inner) {
  return (
    inner.x >= outer.x - 1 &&
    inner.y >= outer.y - 1 &&
    inner.x + inner.w <= outer.x + outer.w + 1 &&
    inner.y + inner.h <= outer.y + outer.h + 1
  );
}

function minPad(b) {
  return Math.min(b.padT ?? 99, b.padR ?? 99, b.padB ?? 99, b.padL ?? 99);
}

function contentInset(b, vw) {
  return Math.min(b.x, vw - (b.x + b.w));
}

function isTiny(b) {
  return b.w < 16 || b.h < 12;
}

function hangsOffViewport(b, vw) {
  return b.x < -8 || b.x + b.w > vw + 8;
}

function isFullBleedChrome(b, vw) {
  const pos = b.position || "static";
  return (pos === "fixed" || pos === "sticky") && b.w >= vw - 8 && !b.text;
}

/**
 * Text/controls too close to the viewport L/R edge.
 * Error: < 4px (kissing the glass). Warn: inside the M3 gutter.
 * Intentional crops (hanging past the edge) are skipped.
 */
export function checkEdgeFlush(vw, boxes) {
  const gutter = viewportGutter(vw);
  const findings = [];
  for (const b of boxes) {
    if (!b.text && !b.interactive) continue;
    if (isTiny(b) || hangsOffViewport(b, vw) || isFullBleedChrome(b, vw)) continue;
    const inset = contentInset(b, vw);
    if (!Number.isFinite(inset)) continue;
    if (inset < 4) {
      findings.push({
        check: "edge-flush",
        severity: "error",
        selector: b.selector,
        detail: `content ${Math.round(inset)}px from viewport edge (need ≥4px, gutter ${gutter}px)`
      });
    } else if (inset < gutter) {
      findings.push({
        check: "edge-flush",
        severity: "warn",
        selector: b.selector,
        detail: `content ${Math.round(inset)}px from viewport edge (gutter ${gutter}px at ${vw}px)`
      });
    }
  }
  return findings;
}

/**
 * Card/section padding collapsed. Product surfaces need ≥8px inner air;
 * <4px is an error (text on the stroke).
 */
export function checkTightPadding(boxes) {
  const findings = [];
  for (const b of boxes) {
    if (!b.card && b.tag !== "section" && b.tag !== "article" && b.tag !== "aside") continue;
    if (b.w < 80 || b.h < 48) continue;
    const pad = minPad(b);
    if (pad < 4) {
      findings.push({
        check: "tight-padding",
        severity: "error",
        selector: b.selector,
        detail: `inner padding ${Math.round(pad)}px < 4px`
      });
    } else if (pad < 8) {
      findings.push({
        check: "tight-padding",
        severity: "warn",
        selector: b.selector,
        detail: `inner padding ${Math.round(pad)}px < 8px`
      });
    }
  }
  return findings;
}

/**
 * Two content boxes share pixels and neither contains the other.
 * Decorative full-bleed vs nested text is geometric containment, not overlap.
 */
export function checkOverlap(boxes) {
  const candidates = boxes.filter((b) => (b.text || b.interactive) && !isTiny(b));
  const findings = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      if (contains(a, b) || contains(b, a)) continue;
      const px = area(a, b);
      if (px < 8) continue;
      findings.push({
        check: "overlap",
        severity: "error",
        selector: `${a.selector} ∩ ${b.selector}`,
        detail: `${Math.round(px)}px² intersection of content boxes`
      });
    }
  }
  return findings;
}

function groupKey(b) {
  if (b.tag === "button" || b.role === "button") return "button";
  if (b.tag === "input" || b.tag === "select" || b.tag === "textarea") return "field";
  if (b.card) return "card";
  return null;
}

function uniqRounded(values, step) {
  const s = new Set();
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    s.add(Math.round(v / step) * step);
  }
  return s;
}

/**
 * Same control type, disagreeing metrics. Three buttons with three font sizes
 * or three paddings is not a system — it is drift.
 */
export function checkComponentDrift(boxes) {
  const groups = new Map();
  for (const b of boxes) {
    const k = groupKey(b);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(b);
  }
  const findings = [];
  for (const [kind, members] of groups) {
    if (members.length < 3) continue;
    const fonts = uniqRounded(
      members.map((b) => b.fontSize),
      1
    );
    const radii = uniqRounded(
      members.map((b) => b.radius),
      2
    );
    const padY = uniqRounded(
      members.map((b) => (b.padT ?? 0) + (b.padB ?? 0)),
      2
    );
    const offenders = [];
    if (fonts.size >= 3) offenders.push(`${fonts.size} font sizes`);
    if (radii.size >= 3) offenders.push(`${radii.size} radii`);
    if (padY.size >= 3) offenders.push(`${padY.size} vertical paddings`);
    if (!offenders.length) continue;
    findings.push({
      check: "component-drift",
      severity: "warn",
      selector: members[0].selector,
      detail: `${members.length} ${kind}s disagree: ${offenders.join(", ")}`
    });
  }
  return findings;
}

/**
 * Successive large stacked blocks with < 8px of air between them.
 * Side-by-side columns are ignored (need horizontal overlap).
 */
export function checkCrampedStack(vw, boxes) {
  const minW = Math.max(80, vw * 0.35);
  const blocks = boxes
    .filter((b) => b.h >= 64 && b.w >= minW)
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const findings = [];
  for (let i = 0; i < blocks.length - 1; i++) {
    const a = blocks[i];
    const b = blocks[i + 1];
    if (contains(a, b) || contains(b, a)) continue;
    const overlapX = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const narrower = Math.min(a.w, b.w);
    if (overlapX < narrower * 0.4) continue;
    const gap = b.y - (a.y + a.h);
    if (gap < 0) continue; // overlap() owns collisions
    if (gap < 8) {
      findings.push({
        check: "cramped-stack",
        severity: "warn",
        selector: `${a.selector} → ${b.selector}`,
        detail: `${Math.round(gap)}px between stacked blocks (need ≥8px)`
      });
    }
  }
  return findings;
}

export function summarizeGeometry(geom) {
  const boxes = geom.boxes || [];
  const vw = geom.vw || 0;
  const text = boxes.filter((b) => b.text);
  const insets = text.map((b) => contentInset(b, vw)).filter((n) => Number.isFinite(n));
  return {
    boxCount: boxes.length,
    textCount: text.length,
    minTextInset: insets.length ? Math.round(Math.min(...insets) * 10) / 10 : null,
    gutter: viewportGutter(vw)
  };
}

/**
 * @param {{ vw: number, vh?: number, boxes: Box[] }} geom
 * @returns {Finding[]}
 */
export function auditGeometry(geom) {
  const vw = geom.vw;
  const boxes = geom.boxes || [];
  if (!Number.isFinite(vw) || vw <= 0) return [];
  return [
    ...checkEdgeFlush(vw, boxes),
    ...checkTightPadding(boxes),
    ...checkOverlap(boxes),
    ...checkComponentDrift(boxes),
    ...checkCrampedStack(vw, boxes)
  ];
}
