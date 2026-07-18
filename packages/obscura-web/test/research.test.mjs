import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  tokenize,
  rankCandidates,
  extractPassage,
  deepResearch,
  clearSearxngCache,
  clearFetchCache
} from "../src/research.mjs";
import { hash8 } from "../src/url-identity.mjs";

// The SearXNG cache is module-global state (that is the point — it spans research calls to keep
// duplicate queries off the upstream engines that ban by IP). Tests must therefore be hermetic
// by construction: without this, a test asserting "one upstream call" silently passes on a
// cache hit left by whichever test ran before it.
beforeEach(() => {
  clearSearxngCache();
  clearFetchCache();
});

// Every existing deepResearch test predates Ollama curation and must stay hermetic — inject a
// "no Ollama here" health check so behavior never depends on whether the host machine actually
// has a local Ollama running.
const noOllama = {
  checkOllamaImpl: async () => ({ ok: false, hasModel: false }),
  checkRobotsImpl: async () => ({ allowed: true, checked: false }),
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

test("deepResearch: one host flooding the pool is capped to the tail, not dropped (ADR-0057 fourth addendum)", async () => {
  // A SEO farm/doc mirror contributing most of a page's results must not eat the whole
  // maxCandidates budget at every OTHER host's expense — `capPerHost` REORDERS (overflow moves to
  // the tail), it never rejects, matching the pipeline's one hard rule that only the curator does.
  const searxngImpl = async (q, { page }) =>
    page === 1
      ? [
          ...Array.from({ length: 5 }, (_, i) => ({
            title: `Farm ${i}`,
            url: `https://farm.example/${i}`,
            snippet: "cats",
            score: 10 - i
          })),
          { title: "Diverse", url: "https://diverse.example/a", snippet: "cats", score: 4 }
        ]
      : [];
  const out = await deepResearch(
    "cats",
    { maxCandidates: 4, topK: 4, expand: false },
    { searxngImpl, fetchImpl: async () => ({ content: "cats content" }), ...noOllama }
  );
  // With HOST_CAP=3 (default), only 3 of farm.example's 5 candidates fit in the maxCandidates:4
  // head — the 4th slot must go to the diverse host instead of a 4th farm.example result.
  const hosts = out.results.map((r) => new URL(r.url).hostname);
  assert.ok(hosts.includes("diverse.example"), "the diverse host must survive the cap into top 4");
  assert.equal(
    hosts.filter((h) => h === "farm.example").length,
    3,
    "farm.example is capped at 3 in the head, not all 5"
  );
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
    return { relevant: true, relevance: 9, excerpt: `curated: ${markdown}`, truncated: false };
  };
  const out = await deepResearch(
    "cats",
    { maxCandidates: 10, topK: 2 },
    {
      searxngImpl,
      fetchImpl,
      curateImpl,
      checkOllamaImpl: async () => ({ ok: true, hasModel: true }),
      checkRobotsImpl: async () => ({ allowed: true, checked: false }),
      ensureOllamaImpl: async () => true
    }
  );
  assert.equal(seenAtCurateTime.length, 2);
  assert.ok(out.results.every((r) => r.extraction === "ollama"));
  assert.equal(out.results[0].snippet, "curated: full raw content of https://a");
  assert.equal(out.results[1].snippet, "curated: full raw content of https://b");
});

test("deepResearch: curator saying not-relevant reports `extraction:heuristic`, never a false `ollama`", async () => {
  // Rewritten for ADR-0057: a not-relevant verdict is DROPPED by default now (see "drops pages
  // the curator scored as off-topic" below) — this test's original name described the pre-ADR-0057
  // behavior that was deliberately reversed. What is still real and worth its own test: `extraction`
  // names what actually produced `snippet`, not which path was attempted. The curator returned no
  // excerpt here, so the text below came from extractPassage — reporting "ollama" (as this
  // assertion used to, before that bug was fixed) made the one field an agent has for auditing a
  // passage's provenance report the opposite of the truth. `includeRejected` is what surfaces the
  // dropped result at all, so this can still be observed post-drop.
  const searxngImpl = async (q, { page }) =>
    page === 1 ? [{ title: "A", url: "https://a", snippet: "cats general info" }] : [];
  const fetchImpl = async () => ({ content: "page about something else entirely" });
  const curateImpl = async () => ({ relevant: false, relevance: 1, excerpt: "", truncated: false });
  const out = await deepResearch(
    "cats",
    { maxCandidates: 10, topK: 1, includeRejected: true },
    {
      searxngImpl,
      fetchImpl,
      curateImpl,
      checkOllamaImpl: async () => ({ ok: true, hasModel: true }),
      checkRobotsImpl: async () => ({ allowed: true, checked: false }),
      ensureOllamaImpl: async () => true
    }
  );
  assert.equal(out.results[0].relevant, false);
  assert.equal(out.results[0].extraction, "heuristic");
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
    return { relevant: true, relevance: 9, excerpt: "curated ok", truncated: false };
  };
  const out = await deepResearch(
    "cats",
    { maxCandidates: 10, topK: 2 },
    {
      searxngImpl,
      fetchImpl,
      curateImpl,
      checkOllamaImpl: async () => ({ ok: true, hasModel: true }),
      checkRobotsImpl: async () => ({ allowed: true, checked: false }),
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
      checkRobotsImpl: async () => ({ allowed: true, checked: false }),
      ensureOllamaImpl: async () => false
    }
  );
  assert.equal(curateCalls, 0, "curatePage must never be called when Ollama isn't available");
  assert.equal(out.results[0].extraction, "heuristic");
});

test("deepResearch: the curator's score reorders what the engines ranked, because it read the page", async () => {
  // The engines put the off-topic page first — SearXNG's consensus is about the query's words,
  // and a page can win that while being useless. The curator is the only stage that has read the
  // text, so its verdict is strictly better informed and gets the final say. (This test used to
  // be framed against BM25; BM25 no longer ranks anything, so the premise is now the engines'
  // order — but the property under test is the same one, and it still matters.)
  const searxngImpl = async (q, { page }) =>
    page === 1
      ? [
          {
            title: "Bees bees bees",
            url: "https://engines-love-it",
            snippet: "bees bees",
            score: 9
          },
          { title: "Bee biology", url: "https://actually-useful", snippet: "bees", score: 1 }
        ]
      : [];
  const fetchImpl = async (url) => ({ content: `content for ${url}` });
  const curateImpl = async ({ markdown }) => {
    if (markdown.includes("engines-love-it")) {
      return { relevance: 1, reason: "keyword-stuffed, off topic", excerpt: "", relevant: false };
    }
    return {
      relevance: 9,
      reason: "authoritative on bee biology",
      excerpt: "the actual useful passage about bee biology",
      relevant: true
    };
  };
  const out = await deepResearch(
    "bees",
    { maxCandidates: 10, topK: 2, includeRejected: true },
    {
      searxngImpl,
      fetchImpl,
      curateImpl,
      checkOllamaImpl: async () => ({ ok: true, hasModel: true }),
      checkRobotsImpl: async () => ({ allowed: true, checked: false }),
      ensureOllamaImpl: async () => true
    }
  );
  assert.equal(out.results[0].url, "https://actually-useful");
  assert.equal(out.results[0].relevance, 9);
  assert.equal(out.results[1].url, "https://engines-love-it");
});

// ── ADR-0057: the curator actually removes the garbage ─────────────────────────────────

test("deepResearch: drops pages the curator scored as off-topic, and says how many", async () => {
  // Reverses ADR-0055 §6 ("relevant:false still returns a result, not silence"), which meant the
  // entity that exists to remove the garbage never removed any — the agent paid tokens for
  // Instagram reels so it could reject them itself.
  const searxngImpl = async (q, { page }) =>
    page === 1
      ? [
          { title: "junk", url: "https://junk", snippet: "s", score: 9 },
          { title: "good", url: "https://good", snippet: "s", score: 1 }
        ]
      : [];
  const curateImpl = async ({ markdown }) =>
    markdown.includes("junk")
      ? { relevance: 0, reason: "instagram reel", excerpt: "", relevant: false }
      : { relevance: 8, reason: "official docs", excerpt: "the good bit", relevant: true };
  const deps = {
    searxngImpl,
    fetchImpl: async (url) => ({ content: `content for ${url}` }),
    curateImpl,
    checkOllamaImpl: async () => ({ ok: true, hasModel: true }),
    checkRobotsImpl: async () => ({ allowed: true, checked: false }),
    ensureOllamaImpl: async () => true
  };

  const out = await deepResearch("q", { maxCandidates: 10, topK: 2 }, deps);
  assert.deepEqual(
    out.results.map((r) => r.url),
    ["https://good"]
  );
  assert.equal(out.dropped, 1, "the count is reported — dropping is never silent");
  assert.equal(out.fetched, 2, "`fetched` still reports the real crawl depth, not the kept count");

  // The escape hatch: the agent can always audit the curator's calls.
  const audited = await deepResearch(
    "q",
    { maxCandidates: 10, topK: 2, includeRejected: true },
    deps
  );
  assert.equal(audited.results.length, 2);
  assert.equal(audited.dropped, undefined);
  const junk = audited.results.find((r) => r.url === "https://junk");
  assert.equal(junk.relevance, 0);
  assert.equal(junk.reason, "instagram reel", "the curator says WHY, so a bad drop is reviewable");
});

test("deepResearch: a page with no curator verdict is never dropped", async () => {
  // Ollama absent, or one page's curation threw: those results carry no score. Dropping them
  // would silently delete pages nothing ever judged — the drop is the CURATOR's decision, and
  // where there is no curator there is no decision.
  const searxngImpl = async (q, { page }) =>
    page === 1 ? [{ title: "T", url: "https://t", snippet: "s", score: 1 }] : [];
  const out = await deepResearch(
    "q",
    { maxCandidates: 10, topK: 1 },
    {
      searxngImpl,
      fetchImpl: async () => ({ content: "some page text" }),
      checkOllamaImpl: async () => ({ ok: false, hasModel: false }),
      checkRobotsImpl: async () => ({ allowed: true, checked: false })
    }
  );
  assert.equal(out.results.length, 1);
  assert.equal(out.dropped, undefined);
});

// ── ADR-0057: SearXNG's delivered order is the ranking ─────────────────────────────────

test("deepResearch: does NOT re-rank — SearXNG's delivered order picks what gets fetched", async () => {
  // B is keyword-stuffed for the query and would win BM25 over title+snippet; A is what the
  // engines actually agreed on. Before ADR-0057 the pipeline fetched B first. The measured
  // finding is that the engines are right and BM25 is not (evals/research: +0.115 nDCG@10).
  const searxngImpl = async (q, { page }) =>
    page === 1
      ? [
          { title: "A", url: "https://a", snippet: "official reference", score: 4 },
          { title: "cats cats cats", url: "https://b", snippet: "cats cats cats cats", score: 0.2 }
        ]
      : [];
  const fetched = [];
  const fetchImpl = async (url) => {
    fetched.push(url);
    return { content: "some page" };
  };
  const out = await deepResearch(
    "cats",
    { maxCandidates: 10, topK: 1 },
    {
      searxngImpl,
      fetchImpl,
      checkOllamaImpl: async () => ({ ok: false, hasModel: false }),
      checkRobotsImpl: async () => ({ allowed: true, checked: false })
    }
  );
  assert.deepEqual(fetched, ["https://a"], "the engines' top result is fetched, not BM25's");
  assert.equal(out.results[0].url, "https://a");
});

test("deepResearch: asks SearXNG for the whole page instead of slicing it to 10", async () => {
  // The old code hardcoded `limit: PAGE_SIZE = 10` and threw the rest of an already-merged
  // page away, paying a round-trip per 10 candidates it kept.
  const seen = [];
  const searxngImpl = async (q, { limit, page }) => {
    seen.push({ limit, page });
    return page === 1
      ? Array.from({ length: 25 }, (_, i) => ({
          title: `T${i}`,
          url: `https://u${i}`,
          snippet: "s",
          score: 25 - i
        }))
      : [];
  };
  await deepResearch(
    "q",
    { maxCandidates: 25, topK: 1 },
    {
      searxngImpl,
      fetchImpl: async () => ({ content: "x" }),
      checkOllamaImpl: async () => ({ ok: false, hasModel: false }),
      checkRobotsImpl: async () => ({ allowed: true, checked: false })
    }
  );
  assert.equal(seen[0].limit, 25, "asks for every candidate it wants, not a fixed page of 10");
  assert.equal(seen.length, 1, "one round-trip when the first page already satisfies the budget");
});

test("deepResearch: fetches pages concurrently but preserves candidate order", async () => {
  const searxngImpl = async (q, { page }) =>
    page === 1
      ? Array.from({ length: 4 }, (_, i) => ({
          title: `T${i}`,
          url: `https://u${i}`,
          snippet: "s",
          score: 4 - i
        }))
      : [];
  let inFlight = 0;
  let peak = 0;
  const fetchImpl = async (url) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    // Reverse the completion order relative to the input order: the slowest is first.
    await new Promise((r) => setTimeout(r, url === "https://u0" ? 25 : 1));
    inFlight--;
    return { content: `body of ${url}` };
  };
  const out = await deepResearch(
    "q",
    { maxCandidates: 10, topK: 4, concurrency: 4 },
    {
      searxngImpl,
      fetchImpl,
      checkOllamaImpl: async () => ({ ok: false, hasModel: false }),
      checkRobotsImpl: async () => ({ allowed: true, checked: false })
    }
  );
  assert.ok(peak > 1, `expected concurrent fetches, saw peak=${peak}`);
  assert.deepEqual(
    out.results.map((r) => r.url),
    ["https://u0", "https://u1", "https://u2", "https://u3"],
    "output follows candidate order, not completion order"
  );
});

test("deepResearch: a fetch failure carries no verdict and cannot outrank a curated page", async () => {
  const searxngImpl = async (q, { page }) =>
    page === 1
      ? [
          { title: "dead", url: "https://dead", snippet: "serp text", score: 9 },
          { title: "live", url: "https://live", snippet: "s", score: 1 }
        ]
      : [];
  const fetchImpl = async (url) => {
    if (url === "https://dead") throw new Error("ENOTFOUND");
    return { content: "real content" };
  };
  const out = await deepResearch(
    "q",
    { maxCandidates: 10, topK: 2 },
    {
      searxngImpl,
      fetchImpl,
      curateImpl: async () => ({
        relevant: true,
        relevance: 9,
        excerpt: "the good bit",
        truncated: false
      }),
      checkOllamaImpl: async () => ({ ok: true, hasModel: true }),
      checkRobotsImpl: async () => ({ allowed: true, checked: false }),
      ensureOllamaImpl: async () => true
    }
  );
  // The unreadable page used to hardcode `relevant: true` and, ranked first by SearXNG, sorted
  // above a page the model had actually read and confirmed.
  assert.equal(out.results[0].url, "https://live");
  const dead = out.results.find((r) => r.url === "https://dead");
  assert.equal(dead.relevant, null, "never read => no verdict, not a positive one");
  assert.equal(dead.extraction, "none");
  assert.equal(dead.fetchFailed, true);
});

test("deepResearch: a result's `relevant` respects THIS call's dropBelow, not curatePage's own fixed default", async () => {
  // curatePage has no `dropBelow` param — it derives its `relevant` from the module-level
  // DEFAULT_DROP_BELOW (3). A caller using a different threshold used to get a `relevant` that
  // silently disagreed with its own `kept` filter: relevance 5 with dropBelow:7 was reported
  // `relevant:true` (5 >= curatePage's baked-in 3) even though `kept` correctly drops it (5 < 7).
  const searxngImpl = async (q, { page }) =>
    page === 1 ? [{ title: "T", url: "https://t", snippet: "s", score: 1 }] : [];
  const out = await deepResearch(
    "q",
    { maxCandidates: 10, topK: 1, dropBelow: 7, includeRejected: true },
    {
      searxngImpl,
      fetchImpl: async () => ({ content: "real content" }),
      // curatePage's own hardcoded logic would call this relevant (5 >= its fixed default of 3).
      curateImpl: async () => ({
        relevant: true,
        relevance: 5,
        excerpt: "borderline",
        truncated: false
      }),
      checkOllamaImpl: async () => ({ ok: true, hasModel: true }),
      checkRobotsImpl: async () => ({ allowed: true, checked: false }),
      ensureOllamaImpl: async () => true
    }
  );
  assert.equal(out.results[0].relevance, 5);
  assert.equal(
    out.results[0].relevant,
    false,
    "5 < this call's dropBelow:7 -> not relevant, regardless of curatePage's own fixed threshold"
  );
  assert.equal(
    out.results[0].extraction,
    "heuristic",
    "an actually-rejected page falls back, never shows the curated excerpt"
  );
});

test("deepResearch: propagates `truncated` instead of silently dropping it", async () => {
  const searxngImpl = async (q, { page }) =>
    page === 1 ? [{ title: "T", url: "https://t", snippet: "s", score: 1 }] : [];
  const out = await deepResearch(
    "q",
    { maxCandidates: 10, topK: 1 },
    {
      searxngImpl,
      fetchImpl: async () => ({ content: "x".repeat(50_000) }),
      curateImpl: async () => ({ relevant: true, relevance: 9, excerpt: "kept", truncated: true }),
      checkOllamaImpl: async () => ({ ok: true, hasModel: true }),
      checkRobotsImpl: async () => ({ allowed: true, checked: false }),
      ensureOllamaImpl: async () => true
    }
  );
  // ADR-0055 §2 promised truncation is "never silent"; curatePage reported it and
  // deepResearch dropped it on the floor, so a 100k page curated on its first 12k looked whole.
  assert.equal(out.results[0].truncated, true);
});

// ── ADR-0057 (mass research follow-up): excludeHashes skips already-covered candidates ──
//
// Scrapling's crawler persists a `seen` URL-hash set to disk (checkpoint.py) so a resumed
// crawl doesn't re-walk ground it already covered. RESEARCH/<topic>/sources/ already IS that
// durable seen-set (one file per URL, named by hash8) — `excludeHashes` is deepResearch's half
// of reusing it: skip candidates whose hash8 the MCP handler already found on disk, so top_k is
// spent on genuinely new pages across repeated persist:true calls, not the same top hits.

test("deepResearch: excludeHashes skips already-covered candidates and reports the count", async () => {
  const searxngImpl = async (q, { page }) =>
    page === 1
      ? [
          { title: "Old", url: "https://old.example/1", snippet: "s", score: 4 },
          { title: "New", url: "https://new.example/2", snippet: "s", score: 3 }
        ]
      : [];
  const fetched = [];
  const out = await deepResearch(
    "q",
    { maxCandidates: 10, topK: 2, excludeHashes: new Set([hash8("https://old.example/1")]) },
    {
      searxngImpl,
      fetchImpl: async (url) => {
        fetched.push(url);
        return { content: "body" };
      },
      checkOllamaImpl: async () => ({ ok: false, hasModel: false }),
      checkRobotsImpl: async () => ({ allowed: true, checked: false })
    }
  );
  assert.deepEqual(fetched, ["https://new.example/2"], "the covered candidate was never fetched");
  assert.equal(out.alreadyCovered, 1);
  assert.equal(out.results.length, 1);
});

test("deepResearch: excludeHashes absent/empty changes nothing (the default, unaffected path)", async () => {
  const searxngImpl = async (q, { page }) =>
    page === 1 ? [{ title: "A", url: "https://a", snippet: "s", score: 1 }] : [];
  const out = await deepResearch(
    "q",
    { maxCandidates: 10, topK: 1 },
    {
      searxngImpl,
      fetchImpl: async () => ({ content: "body" }),
      checkOllamaImpl: async () => ({ ok: false, hasModel: false }),
      checkRobotsImpl: async () => ({ allowed: true, checked: false })
    }
  );
  assert.equal(out.alreadyCovered, undefined, "must not cry wolf when nothing was excluded");
  assert.equal(out.results.length, 1);
});

test("deepResearch: `scanned` reports true crawl depth, not the post-exclusion count", async () => {
  // A well-covered topic must not misreport itself as barely searched: scanned counts what was
  // actually crawled and considered, independent of how much of it was already on disk.
  const searxngImpl = async (q, { page }) =>
    page === 1
      ? [
          { title: "Old", url: "https://old.example/1", snippet: "s", score: 4 },
          { title: "New", url: "https://new.example/2", snippet: "s", score: 3 }
        ]
      : [];
  const out = await deepResearch(
    "q",
    { maxCandidates: 10, topK: 2, excludeHashes: new Set([hash8("https://old.example/1")]) },
    {
      searxngImpl,
      fetchImpl: async () => ({ content: "body" }),
      checkOllamaImpl: async () => ({ ok: false, hasModel: false }),
      checkRobotsImpl: async () => ({ allowed: true, checked: false })
    }
  );
  assert.equal(out.scanned, 2, "both candidates were scanned, even though one was excluded");
  assert.equal(out.alreadyCovered, 1);
});

test("deepResearch: excludeHashes lets a well-covered topic's crawl reach further into the pool", async () => {
  // The point of the whole feature: candidates that would have been cut off by topK are reached
  // once the ones ahead of them are excluded as already-covered.
  const searxngImpl = async (q, { page }) =>
    page === 1
      ? [
          { title: "Old1", url: "https://old.example/1", snippet: "s", score: 5 },
          { title: "Old2", url: "https://old.example/2", snippet: "s", score: 4 },
          { title: "Fresh", url: "https://fresh.example/3", snippet: "s", score: 3 }
        ]
      : [];
  const fetched = [];
  await deepResearch(
    "q",
    {
      maxCandidates: 10,
      topK: 1, // without exclusion this would only ever reach "Old1"
      excludeHashes: new Set([hash8("https://old.example/1"), hash8("https://old.example/2")])
    },
    {
      searxngImpl,
      fetchImpl: async (url) => {
        fetched.push(url);
        return { content: "body" };
      },
      checkOllamaImpl: async () => ({ ok: false, hasModel: false }),
      checkRobotsImpl: async () => ({ allowed: true, checked: false })
    }
  );
  assert.deepEqual(fetched, ["https://fresh.example/3"]);
});

// ── ADR-0057 fourth phase: opt-in near-dup removal + MMR diversification ────────────────

const twoPage = async (q, { page }) =>
  page === 1
    ? [
        { title: "A", url: "https://a.example", snippet: "cats content A", score: 9 },
        { title: "B", url: "https://b.example", snippet: "cats content B", score: 8 }
      ]
    : [];

test("dedupeSimilar: default false never calls embedImpl (zero extra cost, byte-identical path)", async () => {
  let embedCalls = 0;
  const out = await deepResearch(
    "cats",
    { maxCandidates: 10, topK: 2, expand: false },
    {
      searxngImpl: twoPage,
      fetchImpl: async () => ({ content: "cats content" }),
      embedImpl: async () => {
        embedCalls++;
        return [];
      },
      ...noOllama
    }
  );
  assert.equal(embedCalls, 0);
  assert.equal(out.results.length, 2);
  assert.equal(out.dedupedSimilar, undefined);
});

test("dedupeSimilar: removes a near-duplicate, keeping the higher-ranked copy, and reports the count", async () => {
  const out = await deepResearch(
    "cats",
    { maxCandidates: 10, topK: 2, expand: false, dedupeSimilar: true },
    {
      searxngImpl: twoPage,
      fetchImpl: async () => ({ content: "cats content" }),
      // Same vector for both -> cosine 1.0, well above NEAR_DUP_THRESHOLD.
      embedImpl: async ({ texts }) => texts.map(() => [1, 0, 0]),
      ...noOllama
    }
  );
  assert.equal(out.results.length, 1, "one of the two near-duplicates is removed");
  assert.equal(out.results[0].url, "https://a.example", "the higher-ranked (A) copy survives");
  assert.equal(out.dedupedSimilar, 1);
});

test("dedupeSimilar: genuinely distinct pages are both kept", async () => {
  const out = await deepResearch(
    "cats",
    { maxCandidates: 10, topK: 2, expand: false, dedupeSimilar: true },
    {
      searxngImpl: twoPage,
      fetchImpl: async () => ({ content: "cats content" }),
      embedImpl: async ({ texts }) => texts.map((_, i) => (i === 0 ? [1, 0] : [0, 1])),
      ...noOllama
    }
  );
  assert.equal(out.results.length, 2);
  assert.equal(out.dedupedSimilar, undefined);
});

test("diversify: reorders the kept set via MMR instead of raw curator score alone", async () => {
  // Three pages: A is top-scored, B is a near-duplicate of A, C is lower-scored but distinct.
  // At a low lambda (diversity-weighted), MMR must place C ahead of the redundant B.
  const threePage = async (q, { page }) =>
    page === 1
      ? [
          { title: "A", url: "https://a.example", snippet: "s", score: 9 },
          { title: "B", url: "https://b.example", snippet: "s", score: 8 },
          { title: "C", url: "https://c.example", snippet: "s", score: 6 }
        ]
      : [];
  const out = await deepResearch(
    "cats",
    { maxCandidates: 10, topK: 3, expand: false, diversify: true, mmrLambda: 0.3 },
    {
      searxngImpl: threePage,
      fetchImpl: async (url) => ({ content: `content for ${url}` }),
      embedImpl: async ({ texts }) => texts.map((t) => (t.includes("c.example") ? [0, 1] : [1, 0])),
      ...noOllama
    }
  );
  const order = out.results.map((r) => r.url);
  assert.equal(order[0], "https://a.example", "top-scored item still picked first");
  assert.equal(order[1], "https://c.example", "diverse item beats a near-duplicate of #1");
});

test("dedupeSimilar/diversify: an embedImpl failure degrades to the plain curated order, never throws", async () => {
  const out = await deepResearch(
    "cats",
    { maxCandidates: 10, topK: 2, expand: false, dedupeSimilar: true, diversify: true },
    {
      searxngImpl: twoPage,
      fetchImpl: async () => ({ content: "cats content" }),
      embedImpl: async () => {
        throw new Error("embed model not pulled");
      },
      ...noOllama
    }
  );
  assert.equal(out.results.length, 2, "degrades to the un-deduped, un-diversified order");
  assert.equal(out.dedupedSimilar, undefined);
});

test("dedupeSimilar/diversify: skipped when too little deadline remains, not attempted at all", async () => {
  let embedCalls = 0;
  let clock = 0;
  const out = await deepResearch(
    "cats",
    {
      maxCandidates: 10,
      topK: 2,
      expand: false,
      dedupeSimilar: true,
      deadlineMs: 1000,
      now: () => clock
    },
    {
      searxngImpl: twoPage,
      fetchImpl: async () => {
        clock += 999; // leaves under MIN_MS_FOR_EMBED_PASS (2000ms) of budget
        return { content: "cats content" };
      },
      embedImpl: async () => {
        embedCalls++;
        return [];
      },
      ...noOllama
    }
  );
  assert.equal(embedCalls, 0, "the embed pass must not run this close to the deadline");
  assert.equal(out.results.length, 2);
});
