# Field guide — what makes each spec field good

One section per field: the job it does, the failure mode it prevents, and a weak vs
strong example. Read the section you're unsure about, not the whole file.

## system_role

**Job:** pins WHO executes, at what altitude — it sets the vocabulary and the defaults
for everything below. **Failure it prevents:** a spec written for "an AI assistant" that
mixes product-manager language with code-level requirements.

- Weak: `You are a helpful AI that writes good code.`
- Strong: `Go maintainer extending obsidian-memoryd's doctor subcommand; no new deps.`

## user_intent

**Job:** the outcome in the user's terms — what changes in the world when this ships,
for whom, why now. **Failure it prevents:** requirements that are individually sensible
but add up to the wrong feature.

- Weak: `Add export functionality.`
- Strong: `A user migrating away from the kit can export their whole vault index as one
JSON file, so leaving is as easy as joining — trust is the feature.`

## functional_requirements

**Job:** the contract, decomposed — each item is one observable behavior a test could
fail. 3–7 of them: fewer means the idea is still vague; more means you're writing the
implementation, not the spec. **Failure it prevents:** "done" arguments at review time.

- Weak: `2. Handle errors properly.`
- Strong: `2. On a malformed row, the importer skips it, logs path+line to stderr, and
exits 0 — a partial import is a success with a report, not a failure.`

Litmus test per item: can you name the input, the action, and the check? If the check is
missing, it belongs in `acceptance_criteria`; if the input is missing, it's still intent.

## constraints

**Job:** the walls — decisions already made, versions already pinned, rules already
paid for. Each cites its source so review can verify it still holds (memory ages).
**Failure it prevents:** re-litigating settled decisions mid-implementation, or building
on a "constraint" nobody actually imposed.

- Weak: `- Must be fast.`
- Strong: `- Search stays under the 8,000-char schema budget (source: docs/adr/0035-fixed-cost-diet-schema-budget.md)`
- Honest: `- Assume the daemon is not running during import (assumption)`

If Step 1 returned a note that imposes a constraint, cite the **note path** from the
bundle. Before citing, confirm the path still exists if anything suggests it moved.

## current_state

**Job:** the 30-second brief on what exists today — so an executor who has never seen
the repo doesn't re-derive it. ≤600 chars forces distillation. **Failure it prevents:**
the implementer "discovering" and rebuilding something that already works.

- Weak: pasting a directory listing.
- Strong: `The installer already scaffolds the vault (scaffoldNewVault, index.js) and
writes IDE configs. There is no export path: uninstall removes wiring but leaves the
vault. fts.sqlite holds the index; its schema is private to the Python package.`

## acceptance_criteria

**Job:** binary end-state checks — the demo script for "done". Every box is yes/no by
running something or looking at something specific. **Failure it prevents:** the drift
from "it works" to "it should work".

- Weak: `- [ ] Export works correctly.`
- Strong: `- [ ] Running vkm export --json /tmp/out.json on the seed vault produces a
file whose "notes" array has one entry per .md file (hidden dirs excluded).`

Two minimum. If a criterion can't be phrased as a check, it's intent — move it up.
