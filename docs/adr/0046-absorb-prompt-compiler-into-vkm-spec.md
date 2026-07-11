# ADR-0046: absorb `obsidian-prompt-compiler` into vkm-spec and delete the package

- **Status:** Accepted
- **Date:** 2026-07-10
- **Deciders:** maintainer

## Context

`obsidian-prompt-compiler` was a v1 sidecar: search the vault for context, compile a deep XML prompt from manual form inputs, serve a small GUI. A honest post-mortem for the 4.0.0 train found the diagnosis is **sound modules, mis-aimed product**:

1. It was built for the "run an AI that does _not_ have the vault MCP wired" workflow — which the maintainer almost never uses; the actual daily driver is Claude Code with the hybrid MCP server attached, where the compiler's whole context-injection premise is redundant.
2. Its inputs were manual (the human typed role/constraints/steps into a form) where the 4.0.0 pipeline wants them drafted — by a local LLM asynchronously (ADR-0047) or by Claude itself in-session (ADR-0049's `/vkm-spec` skill).
3. Its deep-XML output format was never measured against anything, in a repo whose standard is claims-become-CI-gates (ADR-0020/0032).

Meanwhile its individual modules — XML compilation, prompt defaults, project resolution, clipboard, review flow, and above all the parallel retrieval in `context-search.mjs` — were well-built and tested. It was also the sole holder of the independent-versioning precedent (ADR-0042).

## Decision

Absorb, don't keep: the compiler's **pure modules move to `vkm-spec`** essentially verbatim, with their tests (`compile-xml.mjs`, `prompt-defaults.mjs`, `project-resolve.mjs`, `clipboard.mjs`, `review.mjs`); its **retrieval engine relocates to the MCP server** as `context-assemble.mjs`, becoming the `assemble_context` tool (ADR-0045) — the layer where the security envelope and wire measurement already live; its GUI shell pattern (`node:http` + vanilla JS, no framework) is reused by the vkm-spec server on a new port (ADR-0048). Then **`packages/obsidian-prompt-compiler/` is deleted** in the 4.0.0 train, with a reference sweep; during the transition `context-search.mjs` survives only as a re-export shim. Status is Proposed because the deletion is gated on vkm-spec fully landing in the train (ADR-0050) — the absorption targets, not the funeral, are the reviewable part.

## Alternatives considered

- **Keep the compiler as a maintained sibling of vkm-spec:** rejected — two packages compiling prompts from vault context is a user-facing "which one?" with no good answer, double maintenance, and the weaker one wins confusion by seniority.
- **Rewrite vkm-spec from scratch, archive the compiler untouched:** rejected — the compiler's modules are the best-tested prompt-assembly code in the repo; rewriting working code to avoid a `git mv` is waste.
- **Deprecate-but-ship (publish one final version, freeze):** rejected — the package was never published independently to npm in a way users depend on; freezing dead code in the workspace costs CI time and reader attention forever.

## Consequences

- Positive: one spec pipeline instead of a redundant pair; the retrieval engine lands where it benefits every agent through `assemble_context`, not just GUI users; the workspace loses its only version-line exception (ADR-0042); LICENSE/test surface shrinks.
- Negative: anyone who did use the standalone compiler loses its entry points at 4.0.0 — a breaking change, which is exactly why the deletion rides the major (ADR-0050) with migration notes; the git history of the moved modules now spans a package rename (mitigated: moves were kept as verbatim as possible).
- Neutral: the deep-XML output format itself survives in `compile-xml.mjs` — what died is the package boundary and the manual-input product framing, not the format (which vkm-spec can now actually measure).

## References

- `packages/vkm-spec/src/` (lifted modules), `packages/obsidian-memory-mcp/src/context-assemble.mjs` (relocated retrieval, see its header comment).
- ADR-0042 (versioning precedent reversed), ADR-0045 (retrieval's new home), ADR-0047/0048 (the drafting layer and GUI that replace the manual form), ADR-0050 (deletion scheduled in the 4.0.0 train).
