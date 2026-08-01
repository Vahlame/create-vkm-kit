#!/usr/bin/env node
// Rendered-page UI audit — the executable half of vkm-ui-judge. Renders a URL or local
// HTML file across viewports x color schemes in headless Chromium and reports the defects
// a model cannot reliably "see" from source: WCAG contrast of the text actually painted,
// invisible text after a theme flip, horizontal overflow at mobile widths, sub-44px tap
// targets. Deterministic output (report.json + screenshots) so the fix loop is
// measure -> fix -> re-measure, never "looks right to me".
//
// Usage:  node ui-audit.mjs <url-or-file.html> [--out DIR] [--viewports 360x740,768x1024,1440x900]
//                           [--schemes light,dark] [--no-screenshots] [--max-findings N]
// Needs:  `playwright` or `playwright-core` resolvable from the audited project or globally,
//         plus a Chromium (PLAYWRIGHT_BROWSERS_PATH honored; PW_CHROMIUM_PATH overrides).
// Exit:   0 = no findings · 1 = findings · 2 = usage error · 3 = browser unavailable.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_VIEWPORTS = "360x740,768x1024,1440x900";
const DEFAULT_SCHEMES = "light,dark";

function usage(msg) {
  if (msg) console.error(`ui-audit: ${msg}`);
  console.error(
    "usage: node ui-audit.mjs <url-or-file.html> [--out DIR] [--viewports WxH,...] " +
      "[--schemes light,dark] [--no-screenshots] [--max-findings N]"
  );
  process.exit(2);
}

function parseArgs(argv) {
  const opts = {
    target: null,
    out: "./ui-audit",
    viewports: DEFAULT_VIEWPORTS,
    schemes: DEFAULT_SCHEMES,
    screenshots: true,
    maxFindings: 40
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") opts.out = argv[++i];
    else if (a === "--viewports") opts.viewports = argv[++i];
    else if (a === "--schemes") opts.schemes = argv[++i];
    else if (a === "--no-screenshots") opts.screenshots = false;
    else if (a === "--max-findings") opts.maxFindings = Number(argv[++i]) || 40;
    else if (a.startsWith("--")) usage(`unknown flag ${a}`);
    else if (!opts.target) opts.target = a;
    else usage(`unexpected argument ${a}`);
  }
  if (!opts.target) usage("missing target");
  const vps = opts.viewports.split(",").map((v) => {
    const m = v.trim().match(/^(\d+)x(\d+)$/);
    if (!m) usage(`bad viewport "${v}" (expected WxH)`);
    return { width: Number(m[1]), height: Number(m[2]) };
  });
  const schemes = opts.schemes.split(",").map((s) => s.trim());
  for (const s of schemes) if (s !== "light" && s !== "dark") usage(`bad scheme "${s}"`);
  return { ...opts, vps, schemeList: schemes };
}

/**
 * Resolve playwright from the AUDITED PROJECT (cwd) first — this script is installed under
 * `~/.claude/skills/`, so a bare import would never see the project's node_modules — then
 * from anywhere Node can resolve it.
 */
async function loadChromium() {
  const specs = [];
  const req = createRequire(path.join(process.cwd(), "noop.js"));
  for (const name of ["playwright", "playwright-core"]) {
    try {
      specs.push(pathToFileURL(req.resolve(name)).href);
    } catch {
      /* not installed in the audited project */
    }
    specs.push(name);
  }
  for (const spec of specs) {
    try {
      const mod = await import(spec);
      // CJS interop: a file-URL import of playwright's CJS entry hangs the API off `default`.
      const chromium = mod?.chromium ?? mod?.default?.chromium;
      if (chromium) return chromium;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

/**
 * Everything measured INSIDE the page, in one evaluate call. Self-contained on purpose —
 * it is serialized into the browser, so no imports; WCAG relative-luminance math inline.
 * Returns raw findings for one (viewport, scheme) context.
 */
/* global window, document, getComputedStyle, matchMedia, NodeFilter */
function pageAudit() {
  const vw = window.innerWidth;
  const findings = [];

  const lum = ([r, g, b]) => {
    const f = (c) => {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const parseRgb = (s) => {
    const m = String(s).match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    return m ? { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] } : null;
  };
  const composite = (fg, bg) => fg.rgb.map((c, i) => Math.round(c * fg.a + bg[i] * (1 - fg.a)));

  // Effective background: walk up until a non-transparent background-color, compositing
  // translucent layers; default to the root's scheme color (white/black) at the top.
  const rootBg = (() => {
    const c = parseRgb(getComputedStyle(document.documentElement).backgroundColor);
    const base = matchMedia("(prefers-color-scheme: dark)").matches ? [0, 0, 0] : [255, 255, 255];
    return c && c.a > 0 ? composite(c, base) : base;
  })();
  const effBg = (el) => {
    const layers = [];
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const c = parseRgb(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a >= 1) break;
      }
    }
    let bg = rootBg;
    for (let i = layers.length - 1; i >= 0; i--) bg = composite(layers[i], bg);
    return bg;
  };

  const cssPath = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && parts.length < 4; n = n.parentElement) {
      let p = n.tagName.toLowerCase();
      if (n.id) {
        parts.unshift(`${p}#${n.id}`);
        break;
      }
      const cls = [...n.classList].slice(0, 2).join(".");
      if (cls) p += `.${cls}`;
      parts.unshift(p);
    }
    return parts.join(" > ");
  };
  const visible = (el, st, r) =>
    r.width > 0 &&
    r.height > 0 &&
    st.visibility !== "hidden" &&
    st.display !== "none" &&
    Number(st.opacity) > 0.05;

  // ---- viewport meta -----------------------------------------------------------------
  if (!document.querySelector('meta[name="viewport"]')) {
    findings.push({
      check: "viewport-meta",
      severity: "error",
      selector: "head",
      detail: 'no <meta name="viewport">'
    });
  }

  // ---- text contrast / invisibility ---------------------------------------------------
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (t) =>
      t.textContent.trim().length > 2 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
  });
  const seen = new Set();
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const el = t.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    const st = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (!visible(el, st, r)) continue;
    const fg = parseRgb(st.color);
    if (!fg) continue;
    const bg = effBg(el);
    const rr = ratio(composite(fg, bg), bg);
    const size = parseFloat(st.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(st.fontWeight) >= 700);
    const gate = large ? 3 : 4.5;
    const text = t.textContent.trim().slice(0, 60);
    if (rr < 1.5) {
      findings.push({
        check: "invisible",
        severity: "error",
        selector: cssPath(el),
        detail: `ratio ${rr.toFixed(2)}:1 — "${text}"`,
        ratio: +rr.toFixed(2)
      });
    } else if (rr < gate) {
      findings.push({
        check: "contrast",
        severity: "error",
        selector: cssPath(el),
        detail: `ratio ${rr.toFixed(2)}:1 < ${gate}:1 (${large ? "large" : "normal"} text) — "${text}"`,
        ratio: +rr.toFixed(2)
      });
    }
  }

  // ---- horizontal overflow ------------------------------------------------------------
  const doc = document.scrollingElement || document.documentElement;
  if (doc.scrollWidth > vw + 1) {
    findings.push({
      check: "overflow-x",
      severity: "error",
      selector: "html",
      detail: `page scrollWidth ${doc.scrollWidth}px > viewport ${vw}px`
    });
    let reported = 0;
    for (const el of document.body.querySelectorAll("*")) {
      if (reported >= 8) break;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > vw + 4 || r.left < -4)) {
        const st = getComputedStyle(el);
        if (!visible(el, st, r) || st.position === "fixed") continue;
        if (el.querySelector("*") && r.width < vw * 1.05) continue; // prefer leaf offenders
        findings.push({
          check: "overflow-x",
          severity: "error",
          selector: cssPath(el),
          detail: `element spans ${Math.round(r.left)}..${Math.round(r.right)}px (viewport ${vw}px)`
        });
        reported++;
      }
    }
  }

  // ---- tap targets (mobile widths only) ----------------------------------------------
  if (vw <= 480) {
    for (const el of document.querySelectorAll(
      "a[href], button, [role=button], input:not([type=hidden]), select, textarea"
    )) {
      const st = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (!visible(el, st, r)) continue;
      if (r.width < 44 || r.height < 44) {
        if (r.width >= 44 && el.closest("p, li, td")) continue; // inline text links are exempt-ish
        findings.push({
          check: "tap-target",
          severity: "warn",
          selector: cssPath(el),
          detail: `${Math.round(r.width)}x${Math.round(r.height)}px < 44x44`
        });
      }
    }
  }

  // ---- images wider than the viewport -------------------------------------------------
  for (const img of document.images) {
    const r = img.getBoundingClientRect();
    if (r.width > vw + 4) {
      findings.push({
        check: "img-overflow",
        severity: "warn",
        selector: cssPath(img),
        detail: `image ${Math.round(r.width)}px wide (viewport ${vw}px)`
      });
    }
  }

  return findings;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const chromium = await loadChromium();
  if (!chromium) {
    console.error(
      "ui-audit: playwright not found. Install it in the audited project (`npm i -D playwright`)\n" +
        "or ensure `playwright-core` + a Chromium are resolvable (PLAYWRIGHT_BROWSERS_PATH honored).\n" +
        "Static fallback: /vkm-design scripts/audit-css.mjs (declared pairs only — say so)."
    );
    process.exit(3);
  }

  const url = /^https?:\/\//.test(opts.target)
    ? opts.target
    : pathToFileURL(path.resolve(opts.target)).href;
  fs.mkdirSync(opts.out, { recursive: true });

  const launch = { headless: true };
  if (process.env.PW_CHROMIUM_PATH) launch.executablePath = process.env.PW_CHROMIUM_PATH;
  const browser = await chromium.launch(launch).catch((e) => {
    console.error(`ui-audit: could not launch Chromium: ${e.message}`);
    process.exit(3);
  });

  const byKey = new Map(); // dedup: same (check, selector, detail-class) across contexts
  const contexts = [];
  try {
    for (const vp of opts.vps) {
      for (const scheme of opts.schemeList) {
        const ctxName = `${vp.width}x${vp.height}-${scheme}`;
        const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme });
        const page = await ctx.newPage();
        await page.goto(url, { waitUntil: "load", timeout: 30000 });
        await page.waitForTimeout(400); // let fonts/transitions settle
        const raw = await page.evaluate(pageAudit);
        if (opts.screenshots) {
          await page.screenshot({ path: path.join(opts.out, `${ctxName}.png`), fullPage: true });
        }
        for (const f of raw) {
          const key = `${f.check}|${f.selector}|${f.detail.replace(/[\d.]+/g, "#")}`;
          const prev = byKey.get(key);
          if (prev) prev.contexts.push(ctxName);
          else byKey.set(key, { ...f, contexts: [ctxName] });
        }
        contexts.push(ctxName);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }

  const severityRank = { error: 0, warn: 1 };
  const findings = [...byKey.values()]
    .sort(
      (a, b) =>
        severityRank[a.severity] - severityRank[b.severity] || (a.ratio ?? 99) - (b.ratio ?? 99)
    )
    .slice(0, opts.maxFindings);
  const dropped = byKey.size - findings.length;
  const summary = {
    target: opts.target,
    contexts,
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warn").length,
    dropped: dropped > 0 ? dropped : 0
  };
  const report = { summary, findings };
  fs.writeFileSync(path.join(opts.out, "report.json"), JSON.stringify(report, null, 2));

  console.error(
    `ui-audit: ${summary.errors} error(s), ${summary.warnings} warning(s) across ${contexts.length} contexts` +
      (dropped > 0 ? ` (+${dropped} deduped findings over --max-findings, see report.json)` : "") +
      ` -> ${path.join(opts.out, "report.json")}`
  );
  for (const f of findings.slice(0, 10)) {
    console.error(
      `  [${f.severity}] ${f.check} ${f.selector} — ${f.detail} (${f.contexts.length} ctx)`
    );
  }
  process.exit(findings.length ? 1 : 0);
}

main().catch((e) => {
  console.error(`ui-audit: ${e?.stack || e}`);
  process.exit(2);
});
