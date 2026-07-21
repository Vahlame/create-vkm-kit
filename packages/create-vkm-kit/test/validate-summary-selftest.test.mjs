/**
 * Self-test of the vkm-research summary validator (the research-bench grader):
 * pins both directions — a reference consolidation passes clean, and each seeded
 * defect (including the exact seams the local map-reduce draft produces) is caught
 * by name. Mutation-style, same doctrine as validate-spec-selftest.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { validateSummary } from "../templates/skills/vkm-research/scripts/validate_summary.mjs";

const GOOD = `---
status: consolidated
consolidated: 2026-07-21
sources: [a.md, b.md, c.md]
---

# topic — consolidated

The crossover moved to ~200k vectors, confirming the deferred-acceleration stance in
[[STACKS/sqlite]] and contradicting the GPU assumption in [[PROJECTS/vkm-kit]].

## Key claims

- Index pays only past ~200k vectors; below that build time dominates.
- CPU reranking runs 80–120ms for 50 passages — GPU-free is viable at vault scale.

## Contradictions & supersessions

- supersedes [[RESEARCH/topic/summary]] — the ~50k crossover claim is overturned.

## Open questions

- Memory overhead measured pre-quantization; re-check.
`;

test("reference consolidation passes with zero errors", () => {
  const r = validateSummary(GOOD);
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
  assert.ok(r.counts.wikilinks >= 2);
  assert.equal(r.counts.supersedes, 1);
});

const MUTATIONS = [
  {
    name: "draft-local status (promoted draft)",
    mutate: (s) => s.replace("status: consolidated", "status: draft-local"),
    expect: /status is "draft-local"/
  },
  {
    name: "missing frontmatter entirely",
    mutate: (s) => s.replace(/^---[\s\S]*?---\n/, ""),
    expect: /no YAML frontmatter/
  },
  {
    name: "zero wikilinks",
    mutate: (s) => s.replaceAll(/\[\[[^\]]+\]\]/g, "the vault note"),
    expect: /zero \[\[wikilinks\]\]/
  },
  {
    name: "map-reduce chunk separator seam",
    mutate: (s) => s.replace("## Key claims", "---\n\n## Key claims"),
    expect: /`---` chunk separators/
  },
  {
    name: "per-source heading seam",
    mutate: (s) => s.replace("## Key claims", "## a1b2c3d4-benchmark.md"),
    expect: /"## <file>\.md" heading/
  },
  {
    name: "leaked url line seam",
    mutate: (s) => s.replace("## Key claims", "url: https://example.dev/x\n\n## Key claims"),
    expect: /leaked `url:`\/`title:` line/
  },
  {
    name: "malformed supersedes",
    mutate: (s) =>
      s.replace(
        "- supersedes [[RESEARCH/topic/summary]] — the ~50k crossover claim is overturned.",
        "- supersedes the old summary about crossover."
      ),
    expect: /malformed supersedes relation/
  },
  {
    name: "body vanished",
    mutate: (s) => s.replace(/# topic[\s\S]*$/, "Done."),
    expect: /summary body is \d+ chars/
  }
];

for (const { name, mutate, expect } of MUTATIONS) {
  test(`mutation caught: ${name}`, () => {
    const r = validateSummary(mutate(GOOD));
    assert.equal(r.ok, false, `mutant "${name}" was not rejected`);
    assert.ok(
      r.errors.some((e) => expect.test(e)),
      `no error matched ${expect} — got:\n${r.errors.join("\n")}`
    );
  });
}

test("transcription detector fires on oversized summaries (with big-enough sources)", () => {
  const sources = "x".repeat(5000);
  const fat = GOOD.replace("re-check.", "re-check. " + "padding words here ".repeat(200));
  const r = validateSummary(fat, { sourcesText: sources });
  assert.ok(
    r.errors.some((e) => /that's transcription, not synthesis/.test(e)),
    r.errors.join("\n")
  );
  // And the ratio check stays quiet below the 2k-source floor (tiny fixtures).
  const tiny = validateSummary(GOOD, { sourcesText: "short source" });
  assert.equal(tiny.counts.compressionRatio, null);
});
