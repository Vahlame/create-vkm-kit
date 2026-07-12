/**
 * Unit tests for context-assemble.mjs's pure helpers plus the path-traversal fix on
 * assembleContext's `project`-derived fallback read. Exercised directly (not through the
 * MCP tool layer / zod schema) so these prove the CONTAINMENT fix independent of the
 * defense-in-depth regex on the wire schema (covered separately in hybrid-mcp.test.mjs).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  anchorTerms,
  hitMatchesAnchors,
  applyBudget,
  assembleContext
} from "../src/context-assemble.mjs";

test("anchorTerms: a fully short/vague query still yields anchors (no silent gate bypass)", () => {
  const anchors = anchorTerms("fix bug");
  assert.ok(anchors.length > 0, "short-token queries must not produce an empty anchor list");
  assert.deepEqual(new Set(anchors), new Set(["fix", "bug"]));
});

test("anchorTerms: empty query yields no anchors (genuinely nothing to anchor on)", () => {
  assert.deepEqual(anchorTerms("   "), []);
});

test("hitMatchesAnchors: stemmed anchor does not substring-match an unrelated longer word", () => {
  const hit = { path: "x.md", snippet: "the statue was old" };
  assert.equal(hitMatchesAnchors(hit, ["statu"]), false);
});

test("hitMatchesAnchors: stemmed anchor still matches its own singular/plural forms", () => {
  // "reports" stems to "report" (stem() strips one trailing "s") — the fix must re-admit
  // exactly that plural via the `s?` suffix, not just the bare singular.
  const singular = { path: "x.md", snippet: "the report is done" };
  const plural = { path: "x.md", snippet: "the reports are done" };
  assert.equal(hitMatchesAnchors(singular, ["report"]), true);
  assert.equal(hitMatchesAnchors(plural, ["report"]), true);
});

test("applyBudget: trims passages before decisions", () => {
  const ctx = {
    historicalDecisions: ["d1", "d2"],
    activePatterns: ["p".repeat(50), "p".repeat(50)],
    techStack: ["t".repeat(50)],
    currentState: null
  };
  const out = applyBudget(ctx, 60);
  assert.ok(out.historicalDecisions.length > 0, "decisions must survive a tight budget");
});

async function makeVaultWithSecretOutside() {
  const outer = await mkdtemp(join(tmpdir(), "assemble-traversal-"));
  const vault = join(outer, "vault");
  await mkdir(join(vault, ".obsidian"), { recursive: true });
  await mkdir(join(vault, "PROJECTS"), { recursive: true });
  await writeFile(join(vault, "PROJECTS", "demo.md"), "# demo\n\nordinary project note\n", "utf8");
  // A file OUTSIDE the vault root that a traversal must never be able to read.
  await writeFile(join(outer, "secret.md"), "TOP SECRET CONTENT", "utf8");
  return { outer, vault };
}

test("assembleContext: a traversal-shaped project name cannot read outside the vault", async () => {
  const { outer, vault } = await makeVaultWithSecretOutside();
  try {
    const result = await assembleContext({
      vault,
      query: "irrelevant",
      projectName: "../secret" // -> PROJECTS/../secret.md -> <outer>/secret.md if unguarded
    });
    assert.equal(result.currentState, null, "traversal must not surface content outside the vault");
  } finally {
    await rm(outer, { recursive: true, force: true });
  }
});

test("assembleContext: a legitimate project falls back to a wrapped, in-vault excerpt", async () => {
  const { outer, vault } = await makeVaultWithSecretOutside();
  try {
    const result = await assembleContext({ vault, query: "irrelevant", projectName: "demo" });
    assert.ok(
      result.currentState,
      "an existing project note with no decisions should fall back to an excerpt"
    );
    assert.match(
      result.currentState,
      /VAULT DATA/,
      "the excerpt must be wrapped as untrusted data"
    );
    assert.ok(result.currentState.includes("ordinary project note"));
  } finally {
    await rm(outer, { recursive: true, force: true });
  }
});
