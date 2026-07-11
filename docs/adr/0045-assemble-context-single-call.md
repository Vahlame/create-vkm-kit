# ADR-0045: `assemble_context` — single-call, budgeted context assembly

- **Status:** Accepted
- **Date:** 2026-07-10
- **Deciders:** maintainer

## Context

Gathering task context from the vault is the kit's most common access pattern, and agents do it as a chain: hybrid search → read the project note → observations query → maybe a stack lookup — 3-6 round-trips, each paying its own wire envelope, each an opportunity to over-read. Meanwhile the prompt-compiler package had already solved the retrieval side well (`context-search.mjs`: parallel hybrid + observations passes classified into decisions/patterns/stack buckets) but aimed it at the wrong consumer (ADR-0046). Constraints: the MCP schema budget gate is ≤8000 chars (ADR-0035), so a new tool must fit without a bump; and every RAG tool's security posture post-ADR-0040 forbids a caller-supplied `vault` path on the wire.

## Decision

Register one new MCP tool, **`assemble_context`**, whose engine is the compiler's retrieval **relocated** into `obsidian-memory-mcp/src/context-assemble.mjs`: a `json-hybrid-search` pass (limit 6, `--graph` and a project-qualified query when a project is given) in **parallel** with two `json-observations` passes (typed `[decision]`s + patterns from `PROJECTS/<name>.md`, `#stack` facts), plus a raw-note fallback excerpt when a project has no typed decisions yet. The contract:

- **`budget_chars` cap** (default 6000): the assembled payload is trimmed **passages-first** — broader passages drop before stack facts, stack facts before decisions, and `currentState` is truncated last — so decisions survive longest and wire cost is bounded regardless of vault size.
- **No wire `vault` param**: the vault resolves server-side from env only, pinned by test (ADR-0040 posture).
- Output is wrapped in the **`_trust` untrusted-data envelope** with injection flagging, like every RAG tool.
- The tool's schema text fit inside the existing **≤8000-char budget** — no bump needed.
- A rejected bridge call and a legitimately empty vault never collapse into the same shape (`backendError` vs empty buckets).

The claim is measured, not asserted: a new `bench-assemble` CI gate (methodology of ADR-0032's bench-tokens, deterministic HashingEmbedder) compares the assembled bundle against an _honest_ naive arm that issues the same retrieval discretely and reads the project note whole — **median 68% fewer wire tokens at 100% completeness** on the labelled fixture (10,867 vs 30,816 tokens aggregate; cross-cutting queries 45%, project tasks 68%), gated at `--assert-savings 0.60 --assert-answered 0.90`. The naive arm pays no discovery cost, so these savings are **floors**.

## Alternatives considered

- **Doctrine only ("chain your calls efficiently"):** rejected — ADR-0018/0034 experience shows behavioral guidance decays; a mechanism that makes the cheap path the easy path does not.
- **One new tool per bucket (decisions, stack, state):** rejected — multiplies schema cost against the ADR-0035 budget and reproduces the round-trip problem the tool exists to kill.
- **Server-side LLM summarization of the bundle:** rejected — nondeterministic, unbenchable, and the wrong layer; trimming by typed priority is deterministic and test-pinnable.
- **Keeping the engine in the compiler package and calling across:** rejected — the compiler is being deleted (ADR-0046); the MCP server is where the security envelope, vault resolution and wire measurement already live.

## Consequences

- Positive: one round-trip replaces 3-6; a 68%-median wire saving locked by CI as a regression gate; the budget contract makes worst-case cost a constant, not a function of vault growth; multi-agent fan-outs (each subagent one `assemble_context`) get cheaper linearly.
- Negative: bucket classification is opinionated — an agent needing something the assembler deprioritized must fall back to discrete tools (which all still exist); the bench replicates the .mjs constants in Python, a deliberate, comment-marked duplication that can drift a few tokens (the gate, not the mirror, catches real divergence).
- Neutral: `budget_chars` (500–20000) lets callers trade completeness for cost per call; the default answers the bench.

## References

- `packages/obsidian-memory-mcp/src/context-assemble.mjs` (engine, `applyBudget` priority order), `src/hybrid-mcp.mjs` (registration), `packages/obsidian-memory-rag/src/obsidian_memory_rag/bench_assemble.py`, `.github/workflows/ci.yml` (bench-assemble gate).
- ADR-0018 (data envelope), ADR-0032/0034 (wire-measured method), ADR-0035 (schema budget), ADR-0040 (no wire vault param), ADR-0046 (source of the relocated engine).
