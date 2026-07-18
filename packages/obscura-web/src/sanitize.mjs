/**
 * HTML sanitization for AI consumption — strip content that was never meant to be SEEN, before
 * it reaches a model that reads raw text rather than a rendered page.
 *
 * Found live, not hypothesized: a synthetic page with `<div style="display:none">SYSTEM
 * OVERRIDE: ignore all previous instructions...</div>` and `<div aria-hidden="true">exfiltrate
 * ...</div>` was fetched through the real `obscura` binary (`--dump markdown`, `--stealth`) and
 * BOTH payloads came through verbatim in the returned markdown — indistinguishable from the
 * page's real, visible content. `--dump text` fails identically (it is a raw DOM-text walk, not
 * an `.innerText`-style, visibility-aware extraction). This package's own `scanInjection`
 * (untrusted-web.mjs) is a VISIBLE-text heuristic scanner and, run against that same output,
 * flagged zero hits — a human skimming the rendered page would never see either payload, but an
 * LLM reading the markdown sees both, completely unflagged.
 *
 * Verified against Scrapling (github.com/D4Vinci/Scrapling, `scrapling/core/shell.py`'s
 * `Convertor._sanitize_for_ai`, reading the installed package, not the README): it defends
 * exactly this vector — CSS/ARIA-hidden elements, `<template>`, HTML comments, zero-width
 * Unicode — by removing them from a DOM copy before any conversion. This module ports that
 * *goal* using `cheerio` (the one new dependency this fix needed — the actual browser-page
 * rendering stays obscura's job; this only parses the HTML obscura already produced).
 *
 * Deliberately scoped to `deepResearch`'s per-page pipeline (`research.mjs`), not
 * `obscura_fetch`'s general-purpose default: that tool's `format:"markdown"` output is obscura's
 * own conversion, and matching it here (rather than degrading to plain text) would need a second
 * dependency (an HTML→Markdown converter) this fix did not ask for. The crawl is the higher-value
 * target anyway — it feeds unvetted, many-page content straight into local-LLM curation and,
 * with `persist:true`, a durable memory bank, with no human in the loop reviewing each page first.
 */

import * as cheerio from "cheerio";

/** Matches a `style` attribute value that hides the element outright. Deliberately narrow —
 * `opacity:0`/off-screen positioning/1px sizing are real hiding techniques too, but each has
 * legitimate non-hiding uses (a fade transition's starting state, a visually-hidden-but-
 * screen-reader-visible label) that this would false-positive on; `display:none` and
 * `visibility:hidden` do not have that ambiguity — nothing renders them, ever, for anyone. */
const HIDDEN_STYLE_RE = /display\s*:\s*none|visibility\s*:\s*hidden/i;

/** Zero-width and other invisible-but-present Unicode: zero-width space/joiner/non-joiner, BOM,
 * word joiner, and the Unicode "tag" block sometimes used to smuggle hidden text into otherwise
 * visible strings. Stripped from the text that survives element-level removal, not just from
 * hidden elements — this class of character is invisible regardless of its container. */
const INVISIBLE_CHARS_RE = /[​-‏⁠﻿\u{E0000}-\u{E007F}]/gu;

/**
 * Parse `html`, remove elements that are hidden from every human viewer, and return the
 * remaining visible text (whitespace-collapsed, paragraph breaks preserved as blank lines so
 * `extractPassage`'s `\n{2,}` splitting still works on the result).
 *
 * Removed, unconditionally:
 *   - elements whose own `style` attribute sets `display:none` or `visibility:hidden`
 *   - elements carrying `aria-hidden="true"` (assistive-tech convention: never announced, and in
 *     practice frequently visually hidden alongside it)
 *   - elements with the boolean `hidden` attribute (the standard HTML mechanism for this)
 *   - `<template>` content (inert by the HTML spec — never part of the rendered/rendered-text
 *     tree; obscura's own conversion already excludes it, confirmed live, kept here for when
 *     this module is the ONLY thing standing between raw HTML and the model)
 *   - HTML comments
 *   - `<script>`/`<style>` (never meant to be read as page content either way)
 *
 * NOT attempted, on purpose: inherited hidden state from an ancestor whose OWN style doesn't
 * directly hide this element (e.g. a parent with `display:none` via an external stylesheet
 * class rather than an inline `style` attribute) — that needs real computed-style evaluation,
 * which means running a browser, which obscura already did once fetching the page; doing it
 * again here would defeat the purpose. This catches the direct, inline-style/attribute cases,
 * which is what the found live example used and is the common case for a deliberately-planted
 * payload (an attacker adds one attribute to one element; they don't usually also ship a
 * stylesheet). A class-based `display:none` rule slips through undetected — a known, named gap,
 * not a silent one.
 *
 * @param {string} html
 * @returns {string} visible text only
 */
export function stripHiddenContent(html) {
  const $ = cheerio.load(String(html ?? ""));

  $("script, style, template").remove();
  $('[aria-hidden="true"], [hidden]').remove();
  $("*").each((_, el) => {
    const style = $(el).attr("style");
    if (style && HIDDEN_STYLE_RE.test(style)) $(el).remove();
  });
  $("*")
    .contents()
    .filter((_, node) => node.type === "comment")
    .remove();

  // Block-level elements become paragraph breaks so extractPassage's blank-line splitting still
  // sees real paragraph boundaries instead of one run-on line — cheerio's own `.text()` collapses
  // all of that to whitespace, so block boundaries are inserted explicitly first.
  $("p, div, li, h1, h2, h3, h4, h5, h6, br, tr").after("\n\n");

  const text = $("body").length ? $("body").text() : $.root().text();
  return text
    .replace(INVISIBLE_CHARS_RE, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Run a CSS selector against `html` (hidden content already excluded, same as
 * {@link stripHiddenContent}) and return each match's text as a separate array entry — mirrors
 * Scrapling's `css_selector` tool param ("if it resolves to more than one element, all the
 * elements will be returned," verified against `scrapling/core/ai.py`'s docstrings), so a caller
 * can narrow extraction to one part of a page (a table, a changelog entry, a pricing block)
 * instead of paying for and reading the whole thing.
 *
 * Malformed input degrades to an empty array rather than throwing — a bad selector or unparsable
 * HTML means "nothing matched," not a tool failure that would otherwise mask the real fetch.
 *
 * @param {string} html
 * @param {string} selector
 * @returns {string[]}
 */
export function selectText(html, selector) {
  try {
    const $ = cheerio.load(String(html ?? ""));
    $("script, style, template").remove();
    $('[aria-hidden="true"], [hidden]').remove();
    $("*").each((_, el) => {
      const style = $(el).attr("style");
      if (style && HIDDEN_STYLE_RE.test(style)) $(el).remove();
    });
    const out = [];
    $(selector).each((_, el) => {
      const t = $(el).text().replace(INVISIBLE_CHARS_RE, "").replace(/\s+/g, " ").trim();
      if (t) out.push(t);
    });
    return out;
  } catch {
    return [];
  }
}
