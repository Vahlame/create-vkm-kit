# ADR-0015: Keep privacy guidance generic in public docs

- **Status:** Accepted
- **Date:** 2026-05-13
- **Deciders:** maintainer

## Context

People use Markdown vaults for notes that may include **sensitive or personal** information. Optional telemetry (OpenTelemetry, Langfuse) and MCP tooling can accidentally widen the blast radius if prompts, tokens, or identifiers end up in logs or traces. The public repo should document **practical guardrails** (redaction, retention, opt-in telemetry) without pretending to be legal advice or tying the project to any one customer, regulator, or geography.

## Decision

Document **short, jurisdiction-neutral** guidance in `docs/observability.md`, `SECURITY.md`, and related files: minimize what gets logged, prefer opaque IDs in traces, keep encryption (for example `age`) optional, and tell readers to run their own security and privacy review where their situation requires it.

## Consequences

- **Positive:** Useful for typical users; stays maintainable and avoids over-specific narratives in the repo.
- **Negative:** Teams with strict regulatory needs must still involve their own experts.
- **Neutral:** Optional stacks (`compose.observability.yml`) remain examples only.

## Alternatives considered

- **Long, customer-specific compliance write-ups in this repo:** Rejected — hard to maintain and easy to misread as official legal guidance.

## References

- `docs/observability.md`
- `SECURITY.md`
