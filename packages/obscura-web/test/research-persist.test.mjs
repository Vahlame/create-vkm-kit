import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  persistResults,
  consolidateTopic,
  listCoveredHashes,
  resolveResearchRoot,
  ResearchPersistError
} from "../src/research-persist.mjs";
import { OllamaUnavailableError } from "../src/ollama-client.mjs";
import { hash8 } from "../src/url-identity.mjs";

async function freshRoot() {
  return mkdtemp(path.join(tmpdir(), "obscura-research-"));
}

const okResult = (over = {}) => ({
  url: "https://example.com/a",
  title: "A Great Article About Cats",
  snippet: "Cats are obligate carnivores.",
  extraction: "ollama",
  relevant: true,
  ...over
});

// ── persistResults ───────────────────────────────────────────────────────────────────────

test("persistResults: writes a source note with full frontmatter + verbatim extract", async () => {
  const root = await freshRoot();
  const res = await persistResults({
    topic: "cats",
    query: "cat diet",
    results: [okResult()],
    researchDir: root
  });
  assert.equal(res.written, 1);
  assert.equal(res.updated, 0);
  assert.equal(res.topic, "cats");

  const dir = path.join(root, "cats", "sources");
  const files = await readdir(dir);
  assert.equal(files.length, 1);
  assert.match(files[0], /^[0-9a-f]{8}-a-great-article-about-cats\.md$/);

  const text = await readFile(path.join(dir, files[0]), "utf8");
  assert.match(text, /^---\n/);
  assert.match(text, /url: "https:\/\/example\.com\/a"/);
  assert.match(text, /title: "A Great Article About Cats"/);
  assert.match(text, /query: "cat diet"/);
  assert.match(text, /extraction: "ollama"/);
  assert.match(text, /relevant: true/);
  assert.match(text, /origin: "web"/);
  assert.match(text, /status: "raw"/);
  assert.match(text, /retrieved: "20\d\d-/);
  assert.match(text, /Cats are obligate carnivores\.\s*$/);
});

test("persistResults: re-run on the same URL updates in place — no duplicate, retrieved refreshed, query logged", async () => {
  const root = await freshRoot();
  await persistResults({
    topic: "cats",
    query: "cat diet",
    results: [okResult()],
    researchDir: root
  });
  const dir = path.join(root, "cats", "sources");
  const before = await readdir(dir);
  const beforeText = await readFile(path.join(dir, before[0]), "utf8");

  await new Promise((r) => setTimeout(r, 5));
  const res2 = await persistResults({
    topic: "cats",
    query: "cat lifespan",
    results: [okResult({ snippet: "Cats are obligate carnivores AND live long." })],
    researchDir: root
  });
  assert.equal(res2.written, 0, "no new note created");
  assert.equal(res2.updated, 1, "the existing note was updated instead");

  const after = await readdir(dir);
  assert.equal(after.length, 1, "still exactly one note for that URL");
  assert.equal(after[0], before[0], "same filename reused, not a new hash-collision name");

  const afterText = await readFile(path.join(dir, after[0]), "utf8");
  assert.match(afterText, /live long/, "extract replaced since it changed");
  assert.notEqual(afterText, beforeText);
  assert.match(
    afterText,
    /query: "cat diet"/,
    "the note's own query field keeps the FIRST discovering query"
  );

  const hub = await readFile(path.join(root, "cats", "_index.md"), "utf8");
  assert.match(hub, /cat diet/, "first query logged in the hub");
  assert.match(hub, /cat lifespan/, "second query also logged, not overwritten");
});

test("persistResults: skips fetchFailed results (bare SERP snippet, not real page content)", async () => {
  const root = await freshRoot();
  const res = await persistResults({
    topic: "cats",
    query: "q",
    results: [
      okResult({ url: "https://good" }),
      okResult({ url: "https://bad", fetchFailed: true })
    ],
    researchDir: root
  });
  assert.equal(res.written, 1);
  const files = await readdir(path.join(root, "cats", "sources"));
  assert.equal(files.length, 1);
});

test("persistResults: updates the global _index.md topic table", async () => {
  const root = await freshRoot();
  await persistResults({ topic: "cats", query: "q", results: [okResult()], researchDir: root });
  const idx = await readFile(path.join(root, "_index.md"), "utf8");
  assert.match(idx, /\|\s*cats\s*\|\s*1\s*\|.*\|\s*no\s*\|/);

  // A second topic gets its OWN row; the first topic's row is left alone.
  await persistResults({
    topic: "dogs",
    query: "q2",
    results: [okResult({ url: "https://dogs.example" })],
    researchDir: root
  });
  const idx2 = await readFile(path.join(root, "_index.md"), "utf8");
  assert.match(idx2, /\|\s*cats\s*\|/);
  assert.match(idx2, /\|\s*dogs\s*\|/);
});

test("topic escape attempts are rejected with a typed error, before any write", async () => {
  const root = await freshRoot();
  for (const bad of ["../../MEMORY", "a/b", "..", ".hidden", "-leading-hyphen", "a\\b"]) {
    await assert.rejects(
      () => persistResults({ topic: bad, query: "q", results: [okResult()], researchDir: root }),
      (e) => e instanceof ResearchPersistError && e.code === "invalid_topic"
    );
  }
  const entries = await readdir(root).catch(() => []);
  assert.deepEqual(entries, [], "nothing was written for any rejected topic");
});

test("missing OBSCURA_RESEARCH_DIR + persist -> typed error, no default root assumed", async () => {
  const prev = process.env.OBSCURA_RESEARCH_DIR;
  delete process.env.OBSCURA_RESEARCH_DIR;
  try {
    assert.throws(
      () => resolveResearchRoot(),
      (e) => e instanceof ResearchPersistError && e.code === "missing_root"
    );
    await assert.rejects(
      () => persistResults({ topic: "cats", query: "q", results: [okResult()] }),
      (e) => e instanceof ResearchPersistError && e.code === "missing_root"
    );
  } finally {
    if (prev === undefined) delete process.env.OBSCURA_RESEARCH_DIR;
    else process.env.OBSCURA_RESEARCH_DIR = prev;
  }
});

// ── listCoveredHashes — the durable "seen" set behind cross-session mass research ───────

test("listCoveredHashes: empty for a topic that doesn't exist yet — not an error", async () => {
  const root = await freshRoot();
  const hashes = await listCoveredHashes("never-researched", root);
  assert.deepEqual([...hashes], []);
});

test("listCoveredHashes: returns the hash8 of every URL a previous call persisted", async () => {
  const root = await freshRoot();
  await persistResults({
    topic: "cats",
    query: "cat diet",
    results: [
      okResult({ url: "https://a.example/1" }),
      okResult({ url: "https://b.example/2", title: "Second Article" })
    ],
    researchDir: root
  });

  const hashes = await listCoveredHashes("cats", root);
  assert.equal(hashes.size, 2);
  assert.ok(hashes.has(hash8("https://a.example/1")));
  assert.ok(hashes.has(hash8("https://b.example/2")));
});

test("listCoveredHashes: a URL never persisted is NOT in the set", async () => {
  const root = await freshRoot();
  await persistResults({
    topic: "cats",
    query: "q",
    results: [okResult({ url: "https://a.example/1" })],
    researchDir: root
  });
  const hashes = await listCoveredHashes("cats", root);
  assert.ok(!hashes.has(hash8("https://never-seen.example/x")));
});

test("listCoveredHashes: reflects re-persisting the SAME URL as still one entry, not two", async () => {
  // persistResults dedupes by hash and updates in place — the covered-set must match that,
  // not double-count a URL that was "persisted" twice across two research calls.
  const root = await freshRoot();
  await persistResults({ topic: "cats", query: "q1", results: [okResult()], researchDir: root });
  await persistResults({ topic: "cats", query: "q2", results: [okResult()], researchDir: root });
  const hashes = await listCoveredHashes("cats", root);
  assert.equal(hashes.size, 1);
});

test("listCoveredHashes: does not cross-contaminate between topics", async () => {
  const root = await freshRoot();
  await persistResults({
    topic: "cats",
    query: "q",
    results: [okResult({ url: "https://a.example/1" })],
    researchDir: root
  });
  await persistResults({
    topic: "dogs",
    query: "q",
    results: [okResult({ url: "https://b.example/2" })],
    researchDir: root
  });
  const catHashes = await listCoveredHashes("cats", root);
  assert.equal(catHashes.size, 1);
  assert.ok(!catHashes.has(hash8("https://b.example/2")));
});

test("listCoveredHashes: ignores non-.md files and malformed filenames in sources/", async () => {
  const root = await freshRoot();
  const dir = path.join(root, "cats", "sources");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "12345678-real.md"), "x", "utf8");
  await writeFile(path.join(dir, ".gitkeep"), "", "utf8");
  await writeFile(path.join(dir, "not-a-hash-prefix.md"), "x", "utf8");
  const hashes = await listCoveredHashes("cats", root);
  assert.deepEqual([...hashes], ["12345678"]);
});

test("listCoveredHashes: propagates the typed missing_root error, same as persistResults", async () => {
  const prev = process.env.OBSCURA_RESEARCH_DIR;
  delete process.env.OBSCURA_RESEARCH_DIR;
  try {
    await assert.rejects(
      () => listCoveredHashes("cats"),
      (e) => e instanceof ResearchPersistError && e.code === "missing_root"
    );
  } finally {
    if (prev === undefined) delete process.env.OBSCURA_RESEARCH_DIR;
    else process.env.OBSCURA_RESEARCH_DIR = prev;
  }
});

// ── consolidateTopic ─────────────────────────────────────────────────────────────────────

async function seedSource(root, topic, filename, { url, title, body }) {
  const dir = path.join(root, topic, "sources");
  await mkdir(dir, { recursive: true });
  const fm =
    `---\nurl: "${url}"\ntitle: "${title}"\nretrieved: "2026-07-14T00:00:00.000Z"\n` +
    `query: "q"\nextraction: "heuristic"\nrelevant: true\norigin: "web"\nstatus: "raw"\n---\n`;
  await writeFile(path.join(dir, filename), `${fm}\n${body}\n`, "utf8");
}

test("consolidateTopic: empty sources/ -> typed error, nothing written", async () => {
  const root = await freshRoot();
  await assert.rejects(
    () => consolidateTopic({ topic: "cats", researchDir: root }),
    (e) => e instanceof ResearchPersistError && e.code === "no_sources"
  );
});

test("consolidateTopic: Ollama unavailable -> OllamaUnavailableError, no heuristic fallback", async () => {
  const root = await freshRoot();
  await seedSource(root, "cats", "aaaaaaaa-cats.md", {
    url: "https://a",
    title: "A",
    body: "Cats are great."
  });
  await assert.rejects(
    () =>
      consolidateTopic(
        { topic: "cats", researchDir: root },
        {
          checkOllamaImpl: async () => ({ ok: false, hasModel: false }),
          ensureOllamaImpl: async () => false
        }
      ),
    (e) => e instanceof OllamaUnavailableError
  );
});

test("consolidateTopic: status:consolidated summary is never overwritten, force or not", async () => {
  const root = await freshRoot();
  await seedSource(root, "cats", "aaaaaaaa-cats.md", {
    url: "https://a",
    title: "A",
    body: "Cats are great."
  });
  await mkdir(path.join(root, "cats"), { recursive: true });
  await writeFile(
    path.join(root, "cats", "summary.md"),
    '---\nstatus: "consolidated"\n---\n\nExisting Claude-authored summary.\n',
    "utf8"
  );
  for (const force of [false, true]) {
    let ranSummarize = false;
    await assert.rejects(
      () =>
        consolidateTopic(
          { topic: "cats", force, researchDir: root },
          {
            checkOllamaImpl: async () => ({ ok: true, hasModel: true }),
            summarizeImpl: async () => {
              ranSummarize = true;
              return { summary: "should never run" };
            }
          }
        ),
      (e) => e instanceof ResearchPersistError && e.code === "consolidated_locked"
    );
    assert.equal(ranSummarize, false, `force:${force} must not call the local model at all`);
  }
});

test("consolidateTopic: existing draft-local requires force to regenerate", async () => {
  const root = await freshRoot();
  await seedSource(root, "cats", "aaaaaaaa-cats.md", {
    url: "https://a",
    title: "A",
    body: "Cats are great."
  });
  await writeFile(
    path.join(root, "cats", "summary.md"),
    '---\nstatus: "draft-local"\ngenerated: "2026-01-01T00:00:00.000Z"\n---\n\nold draft\n',
    "utf8"
  );

  await assert.rejects(
    () =>
      consolidateTopic(
        { topic: "cats", researchDir: root },
        { checkOllamaImpl: async () => ({ ok: true, hasModel: true }) }
      ),
    (e) => e instanceof ResearchPersistError && e.code === "draft_exists"
  );

  let calls = 0;
  const res = await consolidateTopic(
    { topic: "cats", force: true, researchDir: root },
    {
      checkOllamaImpl: async () => ({ ok: true, hasModel: true }),
      summarizeImpl: async ({ notesText }) => {
        calls++;
        return { summary: `NEW SUMMARY citing: ${notesText.slice(0, 20)}` };
      }
    }
  );
  assert.equal(calls, 1);
  assert.equal(res.sources_read, 1);
  assert.equal(res.wrote, path.join(root, "cats", "summary.md"));
  const text = await readFile(res.wrote, "utf8");
  assert.match(text, /status: "draft-local"/);
  assert.match(text, /NEW SUMMARY/);
  assert.doesNotMatch(text, /old draft/);
});

test("consolidateTopic: map-reduce over sources exceeding maxInputChars, never splitting a note", async () => {
  const root = await freshRoot();
  for (let i = 0; i < 3; i++) {
    await seedSource(root, "cats", `${"a".repeat(7)}${i}-cats.md`, {
      url: `https://a${i}`,
      title: `Note ${i}`,
      body: "x".repeat(5000)
    });
  }
  let calls = 0;
  const res = await consolidateTopic(
    { topic: "cats", researchDir: root, maxInputChars: 12000 },
    {
      checkOllamaImpl: async () => ({ ok: true, hasModel: true }),
      summarizeImpl: async ({ notesText }) => {
        calls++;
        assert.ok(
          notesText.length <= 12000,
          `chunk of ${notesText.length} exceeds the 12000 budget`
        );
        return { summary: `partial-${calls}` };
      }
    }
  );
  assert.ok(calls >= 2, "map-reduce must take more than one call for >12k chars of sources");
  assert.equal(res.sources_read, 3);
  assert.equal(res.truncated, false, "each individual note fit under the budget on its own");
});

test("consolidateTopic: a single oversized note is truncated (reported), never split across calls", async () => {
  const root = await freshRoot();
  await seedSource(root, "cats", "aaaaaaaa-huge.md", {
    url: "https://huge",
    title: "Huge",
    body: "y".repeat(20000)
  });
  const res = await consolidateTopic(
    { topic: "cats", researchDir: root, maxInputChars: 12000 },
    {
      checkOllamaImpl: async () => ({ ok: true, hasModel: true }),
      summarizeImpl: async ({ notesText }) => {
        assert.ok(notesText.length <= 12000);
        return { summary: "ok" };
      }
    }
  );
  assert.equal(res.truncated, true);
});
