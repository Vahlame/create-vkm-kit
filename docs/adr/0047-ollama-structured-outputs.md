# ADR-0047: local LLM drafting via Ollama structured outputs, deterministic fallback as invariant

- **Status:** Accepted
- **Date:** 2026-07-10
- **Deciders:** maintainer

## Context

vkm-spec's GUI drafts a spec from a one-line idea plus assembled vault context (ADR-0045/0048) — a job for a local LLM: the data is private vault content, the workflow is asynchronous (a human reviews and edits the draft anyway), and a cloud call would be both a privacy step-down and a cost. Requirements: the draft must land as **valid structured data** (the `orchestration_package` schema feeds `compile-xml` directly — free-form prose is useless), the whole feature must be optional (many installs will never run a local model), and nothing in Claude's synchronous request path may ever wait on it.

## Decision

1. **Ollama over plain `fetch`** — no `ollama-js` dependency: the two endpoints needed (`/api/version`+`/api/tags` for the health probe, `/api/chat` for drafting) are trivial, and every failure mode collapses into one typed `OllamaUnavailableError` (with a machine-readable `reason`) so the pipeline has exactly one thing to catch.
2. **Structured outputs via `format: <JSON schema>`** on `/api/chat` — Ollama's constrained decoding guarantees schema-shaped output at the token level (requires ≥0.5.13; older daemons silently ignore `format`, so the client refuses up front with a clear reason instead of a confusing downstream validation failure). The result is still validated against the zod schema before use — constrained decoding guarantees shape, not sense.
3. **Model: `phi4-mini:3.8b-q4_K_M`** — MIT-licensed, ~2.3GB, strong instruction-following for its size. CPU-only throughput is ~7-12 tok/s: acceptable in the **asynchronous GUI** (a draft streams in over tens of seconds while the human watches), **forbidden in Claude's synchronous path** — the `/vkm-spec` skill (ADR-0049) has Claude fill the template itself, never waiting on Ollama.
4. **Deterministic fallback as a CI-pinned invariant, at every surface**: pipeline, CLI and GUI all produce a complete (template-filled) spec+xml when Ollama is absent, old, missing the model, or mid-request-failing — the GUI's degradation (`source: "fallback"` on the error frame, still carrying working output) is a CI gate, not a promise.
5. **Installer auto-setup only on explicit opt-in** (`--full` or `--ollama`): a bare install is never surprised with a 2.3GB download. On Windows: `winget install Ollama.Ollama --silent` + `ollama pull`, all best-effort/non-fatal. On other platforms the installer prints the manual command — it never pipes a remote script to a shell (`curl | sh`) on the user's behalf.

## Alternatives considered

- **`ollama-js` client library:** rejected — a dependency for two HTTP calls; the hand-rolled client also gives exact control over the single-error degradation contract, which is the feature's real spine.
- **Prompt-engineered JSON ("reply only with JSON") instead of constrained decoding:** rejected — small models leak prose around JSON routinely; `format` makes compliance a decoding property instead of a hope, and it's free.
- **A larger local model (7-14B):** rejected — doubles the download and halves CPU throughput for a drafting job whose output a human edits anyway; quality ceiling is the human review, not the model.
- **Cloud LLM for drafting:** rejected — sends private vault content off-machine to draft a document whose entire pipeline exists to keep context local; also adds a paid dependency to an optional feature.

## Consequences

- Positive: private, free drafting with schema-guaranteed output; the feature degrades to deterministic templates so no surface ever hard-depends on a local daemon; no new npm dependencies.
- Negative: Ollama version and model availability are external moving parts (probed and reported, never assumed); the winget path can leave a fresh install off-PATH until a new shell (reported as `restart-needed`, pull instructions printed).
- Neutral: model choice is a constant, not a contract — swapping models is a one-line change revalidated by the same schema tests; Ollama's default port 11434 enters the kit's port map (ADR-0048).

## References

- `packages/vkm-spec/src/ollama-client.mjs` (`OllamaUnavailableError`, `MIN_OLLAMA_VERSION`), `src/spec-schema.mjs`, `src/pipeline.mjs` (fallback), `packages/create-obsidian-memory/src/ollama-setup.mjs` (installer gating).
- ADR-0045 (context the draft consumes), ADR-0048 (GUI/SSE surface), ADR-0049 (the synchronous path that explicitly excludes Ollama).
