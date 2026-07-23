/**
 * Main-content (boilerplate-stripped) extraction for the research/crawl curation pipeline.
 *
 * `sanitize.mjs#stripHiddenContent` removes INJECTED/hidden content (a security concern) but
 * still returns the whole `<body>` text — nav, sidebars, related-post rails, cookie banners,
 * footers included. That noise dilutes both Ollama curation (worse signal-to-noise in what the
 * model reads) and the no-Ollama `extractPassage` heuristic (a nav link's text can out-match the
 * query as easily as the real paragraph). `@mozilla/readability` (the engine behind Firefox's own
 * Reader View) isolates the main article instead of a hand-rolled density heuristic — chosen over
 * one because this pipeline's actual input is arbitrary, frequently non-semantic real-world HTML
 * (research candidates from any host, crawled docs/community sites), which is exactly the messy
 * case Readability was hardened against over years of production use. A bespoke heuristic risks
 * confidently picking the WRONG block, which is worse than picking none.
 *
 * An enhancement, never a dependency, matching every other stage in this pipeline's contract:
 * {@link extractMainContent} returns `null` (never throws) when Readability finds no
 * article-shaped content — common on non-article pages (search-result pages, docs indexes, a
 * forum with no single "main" block) or malformed HTML — and the caller falls back to
 * `stripHiddenContent`'s full-body text, so a page that used to be readable never goes silent.
 */
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { stripHiddenContentHtml } from "./sanitize.mjs";

// `Readability#parse()` does NOT itself enforce a minimum-content floor — verified live, not
// assumed: against a bare `<p>hi</p>` and a 3-item link list (no article anywhere on the page)
// it happily returned that scrap as "the article" instead of null. `charThreshold` only gates
// the separate `isProbablyReaderable()` helper, which this module doesn't call. Without this
// floor, a genuinely non-article page (a SERP, a docs index) would extract to a few words of
// noise instead of falling back to the full sanitized body — worse than doing nothing.
const MIN_CONTENT_LENGTH = 200;

/**
 * @param {string} html
 * @param {{ url?: string }} [opts] the page's URL — helps Readability resolve relative hrefs and
 *   is required by jsdom to be a valid absolute URL when supplied.
 * @returns {string|null} boilerplate-stripped article text, or null if no substantial article was
 *   found (below {@link MIN_CONTENT_LENGTH}, or a parse failure).
 */
export function extractMainContent(html, { url } = {}) {
  let article;
  try {
    const safeHtml = stripHiddenContentHtml(html);
    const dom = new JSDOM(safeHtml, url ? { url } : undefined);
    article = new Readability(dom.window.document).parse();
  } catch {
    return null; // malformed HTML, an invalid `url`, or a jsdom/Readability internal failure
  }
  const text = article?.textContent?.trim();
  if (!text || text.length < MIN_CONTENT_LENGTH) return null;
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
