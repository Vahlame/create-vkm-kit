/**
 * writeCrawlExport (JSON + CSV) and the additive author/published frontmatter on persistResults
 * (ADR-0062). Real temp research root; asserts the machine-readable export shape + RFC-4180 quoting,
 * and that attribution fields appear ONLY when supplied so research notes stay byte-identical.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeCrawlExport, persistResults } from "../src/research-persist.mjs";

async function withRoot(fn) {
  const root = await mkdtemp(path.join(tmpdir(), "vkm-crawl-export-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("writeCrawlExport writes crawl.json (full rows) and crawl.csv (flat columns)", async () => {
  await withRoot(async (root) => {
    const rows = [
      {
        url: "https://foo.com/a",
        title: "Guide A",
        author: "Ada",
        date: "2026-01-01",
        depth: 0,
        seed: "https://foo.com/",
        status: "kept",
        assets: [{ url: "https://foo.com/a.pdf", kind: "pdf" }]
      },
      {
        url: "https://foo.com/b",
        title: "B",
        author: "",
        date: "",
        depth: 1,
        seed: "https://foo.com/",
        status: "kept"
      }
    ];
    const out = await writeCrawlExport({ topic: "t", rows, researchDir: root });
    assert.equal(out.rows, 2);

    const json = JSON.parse(await readFile(out.json, "utf8"));
    assert.equal(json.length, 2);
    assert.deepEqual(
      json[0].assets,
      [{ url: "https://foo.com/a.pdf", kind: "pdf" }],
      "JSON keeps the full row"
    );

    const csv = await readFile(out.csv, "utf8");
    const lines = csv.trimEnd().split("\r\n");
    assert.equal(lines[0], "url,title,author,date,depth,seed,status");
    assert.equal(
      lines[1],
      '"https://foo.com/a","Guide A","Ada","2026-01-01","0","https://foo.com/","kept"'
    );
    assert.equal(lines.length, 3);
  });
});

test("writeCrawlExport CSV escapes commas, quotes, and newlines (RFC 4180)", async () => {
  await withRoot(async (root) => {
    const rows = [
      {
        url: "https://foo.com/x",
        title: 'A "quoted", comma\nand newline',
        author: "",
        date: "",
        depth: 0,
        seed: "https://foo.com/",
        status: "kept"
      }
    ];
    const out = await writeCrawlExport({ topic: "t", rows, researchDir: root });
    const csv = await readFile(out.csv, "utf8");
    // Internal quotes doubled, whole field wrapped — the literal newline stays inside the quotes.
    assert.ok(csv.includes('"A ""quoted"", comma\nand newline"'));
  });
});

test("writeCrawlExport handles an empty crawl without a trailing blank data line", async () => {
  await withRoot(async (root) => {
    const out = await writeCrawlExport({ topic: "t", rows: [], researchDir: root });
    const csv = await readFile(out.csv, "utf8");
    assert.equal(csv, "url,title,author,date,depth,seed,status\r\n");
    assert.deepEqual(JSON.parse(await readFile(out.json, "utf8")), []);
  });
});

test("persistResults emits author/published ONLY when supplied (research notes stay byte-identical)", async () => {
  await withRoot(async (root) => {
    await persistResults({
      topic: "t",
      query: "q",
      results: [
        {
          url: "https://foo.com/withmeta",
          title: "M",
          author: "Ada Lovelace",
          published: "2026-02-03",
          snippet: "body"
        },
        { url: "https://foo.com/nometa", title: "N", snippet: "body" }
      ],
      researchDir: root
    });
    const dir = path.join(root, "t", "sources");
    const files = await readdir(dir);
    const readByMarker = async (marker) => {
      for (const f of files) {
        const txt = await readFile(path.join(dir, f), "utf8");
        if (txt.includes(marker)) return txt;
      }
      return "";
    };
    const withMeta = await readByMarker("withmeta");
    const noMeta = await readByMarker("nometa");
    assert.match(withMeta, /author: "Ada Lovelace"/);
    assert.match(withMeta, /published: "2026-02-03"/);
    assert.doesNotMatch(noMeta, /author:/, "a page with no author never grows an empty author key");
    assert.doesNotMatch(noMeta, /published:/);
  });
});
