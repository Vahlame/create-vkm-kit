import test from "node:test";
import assert from "node:assert/strict";
import { tokenize, rankCandidates, extractPassage, deepResearch } from "../src/research.mjs";

// Every existing deepResearch test predates Ollama curation and must stay hermetic — inject a
// "no Ollama here" health check so behavior never depends on whether the host machine actually
// has a local Ollama running.
const noOllama = {
  checkOllamaImpl: async () => ({ ok: false, hasModel: false }),
  ensureOllamaImpl: async () => false
};

test("tokenize lowercases, strips punctuation, drops stopwords and 1-char tokens", () => {
  assert.deepEqual(tokenize("The Cats & Dogs, a study."), ["cats", "dogs", "study"]);
  assert.deepEqual(tokenize("¿Qué tal el rendimiento?"), ["qué", "tal", "rendimiento"]);
  assert.deepEqual(tokenize(""), []);
});

test("rankCandidates: BM25 ranks the higher term-frequency doc first", () => {
  const candidates = [
    { title: "Cats and Dogs", url: "https://a", snippet: "general pets article" },
    { title: "Advanced Cats", url: "https://b", snippet: "cats cats cats deep dive" }
  ];
  const ranked = rankCandidates(candidates, "cats");
  assert.equal(ranked[0].url, "https://b");
  assert.ok(ranked[0].score > ranked[1].score);
});

test("rankCandidates: empty query or empty pool returns zero scores without throwing", () => {
  const candidates = [{ title: "X", url: "https://a", snippet: "y" }];
  assert.deepEqual(
    rankCandidates(candidates, "").map((c) => c.score),
    [0]
  );
  assert.deepEqual(rankCandidates([], "anything"), []);
});

test("extractPassage picks the query-relevant paragraph, not the whole page", () => {
  const markdown = [
    "Intro paragraph with nothing relevant here at all, just filler text.",
    "Second paragraph mentions cats and their behavior extensively, cats are great pets.",
    "Third paragraph is only about dogs."
  ].join("\n\n");
  const out = extractPassage(markdown, "cats", { maxChars: 200 });
  assert.match(out, /cats/);
  assert.doesNotMatch(out, /Intro paragraph/);
});

test("extractPassage keeps the paragraph AFTER a match too (elaboration rarely repeats the term)", () => {
  const markdown = [
    "Filler paragraph, nothing to do with anything.",
    "The study covers cats.",
    "It found that indoor lifespan averages fifteen years, far more than outdoor populations."
  ].join("\n\n");
  const out = extractPassage(markdown, "cats", { maxChars: 300 });
  assert.match(out, /cats/);
  assert.match(out, /fifteen years/, "the follow-up paragraph, which never says 'cats', is kept");
});

test("extractPassage falls back to the leading paragraphs when nothing matches", () => {
  const markdown = "First paragraph.\n\nSecond paragraph.";
  const out = extractPassage(markdown, "xyzzy-no-match", { maxChars: 200 });
  assert.equal(out, "First paragraph.\n\nSecond paragraph.");
});

test("extractPassage respects maxChars", () => {
  const markdown = "cats " + "x".repeat(2000);
  const out = extractPassage(markdown, "cats", { maxChars: 50 });
  assert.ok(out.length <= 51); // 50 + the truncation ellipsis char
});

test("deepResearch: empty query throws", async () => {
  await assert.rejects(() => deepResearch("  ", {}, noOllama), /empty query/);
});

test("deepResearch: walks SearXNG pageno until exhaustion, ranks, fetches only topK", async () => {
  const pages = {
    1: [
      { title: "Cats deep dive", url: "https://a", snippet: "cats cats cats" },
      { title: "Unrelated", url: "https://b", snippet: "nothing to do with the query" }
    ],
    2: [{ title: "More cats", url: "https://c", snippet: "cats again" }],
    3: [] // exhausted
  };
  const searxngImpl = async (q, { page }) => pages[page] ?? null;
  const fetchCalls = [];
  const fetchImpl = async (url) => {
    fetchCalls.push(url);
    return { content: `# ${url}\n\ncats content for ${url}` };
  };

  const out = await deepResearch(
    "cats",
    { maxCandidates: 25, topK: 2 },
    { searxngImpl, fetchImpl, ...noOllama }
  );

  assert.equal(out.source, "searxng");
  assert.equal(out.scanned, 3, "all three candidates across two pages counted");
  assert.equal(out.fetched, 2, "only topK pages actually fetched");
  assert.equal(fetchCalls.length, 2);
  assert.ok(out.results[0].score >= out.results[1].score, "results sorted by rank");
  assert.ok(
    out.results.every((r) => r.extraction === "heuristic" && r.relevant === true),
    "no Ollama available -> every result falls back to the heuristic extractor"
  );
});

test("deepResearch: dedupes candidates across pages by URL", async () => {
  const searxngImpl = async (q, { page }) =>
    page === 1 ? [{ title: "Dup", url: "https://dup", snippet: "cats" }] : [];
  const fetchImpl = async (url) => ({ content: `cats page ${url}` });
  const out = await deepResearch(
    "cats",
    { maxCandidates: 10, topK: 5 },
    { searxngImpl, fetchImpl, ...noOllama }
  );
  assert.equal(out.scanned, 1);
});

test("deepResearch: no SearXNG (searxngUrl empty) degrades to the scrape-chain fallback", async () => {
  const searxngImpl = async () => {
    throw new Error("must not be called when searxngUrl is empty");
  };
  const searchImpl = async (q, opts) => ({
    source: "duckduckgo",
    results: [{ title: "DDG result", url: "https://ddg-a", snippet: "cats via ddg" }]
  });
  const fetchImpl = async (url) => ({ content: `cats content ${url}` });
  const out = await deepResearch(
    "cats",
    { maxCandidates: 10, topK: 3, searxngUrl: "" },
    { searxngImpl, searchImpl, fetchImpl, ...noOllama }
  );
  assert.equal(out.source, "duckduckgo");
  assert.equal(out.scanned, 1);
  assert.equal(out.results[0].url, "https://ddg-a");
});

test("deepResearch: a single page fetch failure doesn't sink the whole call", async () => {
  const searxngImpl = async (q, { page }) =>
    page === 1
      ? [
          { title: "Good", url: "https://good", snippet: "cats good" },
          { title: "Broken", url: "https://broken", snippet: "cats broken" }
        ]
      : [];
  const fetchImpl = async (url) => {
    if (url === "https://broken") throw new Error("navigation timeout");
    return { content: "cats content" };
  };
  const out = await deepResearch(
    "cats",
    { maxCandidates: 10, topK: 2 },
    { searxngImpl, fetchImpl, ...noOllama }
  );
  assert.equal(out.results.length, 2);
  const broken = out.results.find((r) => r.url === "https://broken");
  assert.equal(broken.fetchFailed, true);
  assert.equal(broken.snippet, "cats broken", "falls back to the SERP snippet");
});

test("deepResearch: every source failing throws a native-fallback message", async () => {
  const searxngImpl = async () => null;
  const searchImpl = async () => {
    throw new Error("obscura_search: every source failed. Fall back to the native WebSearch tool.");
  };
  await assert.rejects(
    () => deepResearch("cats", { searxngUrl: "" }, { searxngImpl, searchImpl, ...noOllama }),
    /obscura_research:/
  );
});

// ── Ollama curation path ────────────────────────────────────────────────────

test("deepResearch: curates each fetched page via Ollama, one page at a time", async () => {
  const searxngImpl = async (q, { page }) =>
    page === 1
      ? [
          { title: "A", url: "https://a", snippet: "cats" },
          { title: "B", url: "https://b", snippet: "cats" }
        ]
      : [];
  const seenAtCurateTime = [];
  const fetchImpl = async (url) => ({ content: `full raw content of ${url}` });
  const curateImpl = async ({ markdown }) => {
    // Assert pages are curated strictly one at a time: only the CURRENT page's raw content
    // should ever be "in flight" when a curation call happens.
    seenAtCurateTime.push(markdown);
    return { relevant: true, excerpt: `curated: ${markdown}`, truncated: false };
  };
  const out = await deepResearch(
    "cats",
    { maxCandidates: 10, topK: 2 },
    {
      searxngImpl,
      fetchImpl,
      curateImpl,
      checkOllamaImpl: async () => ({ ok: true, hasModel: true }),
      ensureOllamaImpl: async () => true
    }
  );
  assert.equal(seenAtCurateTime.length, 2);
  assert.ok(out.results.every((r) => r.extraction === "ollama"));
  assert.equal(out.results[0].snippet, "curated: full raw content of https://a");
  assert.equal(out.results[1].snippet, "curated: full raw content of https://b");
});

test("deepResearch: curator saying not-relevant still returns a result, flagged", async () => {
  const searxngImpl = async (q, { page }) =>
    page === 1 ? [{ title: "A", url: "https://a", snippet: "cats general info" }] : [];
  const fetchImpl = async () => ({ content: "page about something else entirely" });
  const curateImpl = async () => ({ relevant: false, excerpt: "", truncated: false });
  const out = await deepResearch(
    "cats",
    { maxCandidates: 10, topK: 1 },
    {
      searxngImpl,
      fetchImpl,
      curateImpl,
      checkOllamaImpl: async () => ({ ok: true, hasModel: true }),
      ensureOllamaImpl: async () => true
    }
  );
  assert.equal(out.results[0].relevant, false);
  assert.equal(out.results[0].extraction, "ollama");
  assert.ok(out.results[0].snippet.length > 0, "still falls back to a non-empty heuristic excerpt");
});

test("deepResearch: a single curation failure degrades only that page to the heuristic", async () => {
  const searxngImpl = async (q, { page }) =>
    page === 1
      ? [
          { title: "Good", url: "https://good", snippet: "cats" },
          { title: "Flaky", url: "https://flaky", snippet: "cats" }
        ]
      : [];
  const fetchImpl = async (url) => ({ content: `cats content for ${url}` });
  const curateImpl = async ({ markdown }) => {
    if (markdown.includes("flaky")) throw new Error("model timeout");
    return { relevant: true, excerpt: "curated ok", truncated: false };
  };
  const out = await deepResearch(
    "cats",
    { maxCandidates: 10, topK: 2 },
    {
      searxngImpl,
      fetchImpl,
      curateImpl,
      checkOllamaImpl: async () => ({ ok: true, hasModel: true }),
      ensureOllamaImpl: async () => true
    }
  );
  const good = out.results.find((r) => r.url === "https://good");
  const flaky = out.results.find((r) => r.url === "https://flaky");
  assert.equal(good.extraction, "ollama");
  assert.equal(flaky.extraction, "heuristic");
});

test("deepResearch: Ollama unavailable (checkOllamaImpl reports not ok) uses the heuristic throughout", async () => {
  const searxngImpl = async (q, { page }) =>
    page === 1 ? [{ title: "A", url: "https://a", snippet: "cats" }] : [];
  const fetchImpl = async () => ({ content: "cats content" });
  let curateCalls = 0;
  const curateImpl = async () => {
    curateCalls++;
    return { relevant: true, excerpt: "should not be used" };
  };
  const out = await deepResearch(
    "cats",
    { maxCandidates: 10, topK: 1 },
    {
      searxngImpl,
      fetchImpl,
      curateImpl,
      checkOllamaImpl: async () => ({ ok: false, hasModel: false }),
      ensureOllamaImpl: async () => false
    }
  );
  assert.equal(curateCalls, 0, "curatePage must never be called when Ollama isn't available");
  assert.equal(out.results[0].extraction, "heuristic");
});

test("deepResearch: Ollama-confirmed-relevant results outrank Ollama-rejected ones, even against a higher BM25 score", async () => {
  const searxngImpl = async (q, { page }) =>
    page === 1
      ? [
          // "bees" appears 3x here vs. once in the other -> ranks first by BM25 alone.
          {
            title: "Bees bees bees",
            url: "https://high-bm25-off-topic",
            snippet: "bees bees bees"
          },
          { title: "Bee biology", url: "https://low-bm25-on-topic", snippet: "bees" }
        ]
      : [];
  const fetchImpl = async (url) => ({ content: `content for ${url}` });
  const curateImpl = async ({ markdown }) => {
    // The high-BM25 page is actually keyword-stuffed and off-topic; the lower-BM25 one is the
    // real find. Ollama, which actually read both, gets this right where BM25 alone can't.
    if (markdown.includes("high-bm25")) return { relevant: false, excerpt: "" };
    return { relevant: true, excerpt: "the actual useful passage about bee biology" };
  };
  const out = await deepResearch(
    "bees",
    { maxCandidates: 10, topK: 2 },
    {
      searxngImpl,
      fetchImpl,
      curateImpl,
      checkOllamaImpl: async () => ({ ok: true, hasModel: true }),
      ensureOllamaImpl: async () => true
    }
  );
  // Confirm the premise: BM25 alone ranked the off-topic page first.
  assert.equal(out.results.find((r) => r.url === "https://high-bm25-off-topic").relevant, false);
  // But the FINAL order puts the Ollama-confirmed-relevant page first regardless.
  assert.equal(out.results[0].url, "https://low-bm25-on-topic");
  assert.equal(out.results[0].relevant, true);
  assert.equal(out.results[1].url, "https://high-bm25-off-topic");
});
