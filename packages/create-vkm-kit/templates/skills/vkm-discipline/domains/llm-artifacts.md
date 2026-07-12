# Domain: AI/LLM-generated artifacts

Load this whenever a model produces or transforms part of the deliverable (code, text, analysis,
design), or external content passes through a model. Combine it with the artifact's own domain
(generated code → `coding.md`; generated text → `writing.md`). Ruling principle: **the model proposes,
the evidence decides** — the acceptance criteria don't relax because an AI wrote it.

## Deliver a better result

1. **An LLM's output is UNTRUSTED input until verified.** Run the artifact through its domain's real
   verification (tests for code, opened-and-read citations for text, recomputed numbers) with executed
   evidence. "The model said so" is evidence of nothing — every import checked against the real package,
   every API against real docs, every citation opened.
2. **Plausibility RAISES the verification bar, it doesn't lower it** — a good model hallucinates fluently
   (an API that compiles but doesn't exist, a perfectly-formatted citation that isn't real).
3. **Write the binary acceptance criterion BEFORE the first generation.** If N bounded attempts don't
   pass it, the spec or the tool choice is the problem — re-specify, don't re-roll the dice.
4. **Record model + version + prompt/template + params** next to the artifact (LLMs aren't
   deterministic; the record buys auditability, not identical output). Re-verify critical artifacts when
   the model version changes.
5. **Data boundary:** before sending a prompt to an external service, confirm no secrets/PII/sensitive
   material rides along without an agreement covering it.
6. **The model's opinion proposes options, it's never the justification** for a real trade-off — cite
   verifiable evidence (benchmarks, docs, your own test).

## Anti-patterns

- ❌ Copying output because it's plausible → full domain verification, no sampling.
- ❌ Blind re-generation until something "looks right" → write the criterion first; re-specify after N fails.
- ❌ "The AI recommended X, so X" on a real trade-off → decide on verifiable evidence, record it.
