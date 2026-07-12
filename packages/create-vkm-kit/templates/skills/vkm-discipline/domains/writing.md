# Domain: technical & scientific writing

Load this when the deliverable IS text — docs, a report, a manual, a README, a spec, a paper —
including the figures, tables and references that ride with it.

## Deliver a better result

1. **Every factual claim is traceable:** a citation you actually opened and read, your own measured
   datum with its method, or a declared `[ASSUMPTION]`. No orphan claims, no second-hand citations.
2. **Every instruction is executed before you ship it.** Follow each procedure step by step in a clean
   environment, exactly as written; where it fails or needs unstated context, fix it.
3. **Recompute numbers, don't transcribe them** — from the source, with explicit units. A figure you
   can't verify is dropped or marked an estimate.
4. **Structure for the reader's question in the order they'll ask it** (what it is → how to use it →
   details → exceptions), not the author's chronology. Define every acronym at first use.
5. **One concept = one term** throughout — no decorative synonyms for the same thing.
6. **Cut anything that fails the negation test:** if its opposite is absurd ("quality is not
   important"), it says nothing — replace it with the datum, threshold, or step.

## Edge cases (cover or mark out of scope)

- Reader with no prior context → cold-reader test: can they act on this section alone?
- The procedure hits an error → document the failure branch, not just the happy path.
- Another platform/version → say what you tested and on which; the untested is stated as such.
- Data validity → date the claim ("as of 2026-07, …"); an undated fact ages silently.
- Partial reading → titles and tables stand on their own out of context.

## Anti-patterns

- ❌ Writing to show knowledge instead of for the reader → cold-reader pass, define jargon in place.
- ❌ Filler generalities → replace with a concrete number, threshold, or procedure.
- ❌ Shipping without a consistency pass → check every link, version and example against reality; date it.
