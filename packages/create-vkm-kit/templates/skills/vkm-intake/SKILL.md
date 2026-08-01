---
name: vkm-intake
description: Task intake BEFORE non-trivial execution. Restate objective, deliverable and non-goals in 3 lines, one closed question max on ambiguity, inventory what attached images actually show, assemble minimal context, then execute exactly that scope. NOT for one-line edits or tasks already scoped.
user-invocable: true
---

# vkm-intake — read the task right, then do only that

Installed by create-vkm-kit (vkm-kit). One job: **kill the three cheapest ways a session wastes
tokens and quality — misreading the prompt, misreading the attachments, and over-assembling
context** — by spending ~10 lines before the first tool call instead of thousands after it.

The failure this prevents (observed in field use of this kit): on simple tasks the model
goes off on tangents, misinterprets the prompt or the images, or assembles the wrong
context — and the result is slow AND mediocre. Interpretation errors compound; everything downstream of a wrong
restatement is waste.

## The move — before the first tool call

**1. Restate the task in ≤3 lines** (this is the contract for the rest of the session):

```text
Objective:    <what changes in the world when this is done — not the steps>
Deliverable:  <the artifact the user receives: file, diff, answer, decision>
Not doing:    <the adjacent things this task does NOT include>
```

Write it to the user verbatim. If the task is genuinely trivial (one obvious edit), the
restatement IS one line and you skip the rest of this skill.

**2. Ambiguity gate — one closed question, or a stated default.** If two readings of the
prompt produce _different deliverables_, ask ONE closed question (options, not an essay) and
stop until answered. If the readings differ only in detail, pick the most reasonable default,
**name it in one line** ("Assuming X; say so if not"), and proceed. Never ask about things the
codebase or the vault can answer — look them up.

**3. Images and screenshots: inventory before interpreting.** When the prompt includes an
image, list what is _actually visible_ before drawing any conclusion: the elements, verbatim
only the text the task turns on (error messages, labels the user points at — mark illegible
text as illegible, never guess it; summarize the rest by element), the state shown (error?
empty? hover?), and what the user is pointing at. The inventory stays inside the ~10-line
intake budget. Interpretation comes only from that inventory. A
screenshot of a UI bug names the _symptom_; the inventory keeps you from fixing a different
one.

**4. Assemble the MINIMUM context.** In vkm-wired projects: one `assemble_context` call (it is
budgeted) or `vault_hybrid_search("<topic>")` with `limit` 3–5 — answer from the returned
sections. In any project: read the files the restatement names, not the neighborhood; open a
file whole only when a section genuinely isn't enough. Verify a path/flag quoted by the user
or by a note exists before building on it. STOP assembling the moment you can act — context
you did not read is tokens you did not pay.

**5. Execute exactly the restated scope.** The restatement from step 1 is the fence: work that
does not serve the Objective is a tangent, however interesting. If mid-task you discover the
restatement was wrong, say so in one line, fix the restatement, and continue — silently
drifting is the failure mode. For non-trivial code, hand execution to `/vkm-discipline`
(dense code at full quality + executed evidence); this skill's job ends when the scope is
pinned and the context is loaded.

## Anti-patterns this skill exists to stop

- Restating the task as a plan of 12 steps. The restatement is 3 lines; plans come later if
  the task is genuinely large.
- "While I'm here" edits outside the fence — improvements the user didn't ask for cost tokens
  and review time, and are where regressions hide.
- Reading `SESSION_LOG`/whole `PROJECTS` notes "for background". Passage-first, always.
- Asking an open question ("what do you want me to do?") when a closed one ("A or B?") — or a
  stated default — would unblock immediately.
- Trusting a remembered file path, flag, or API without checking it still exists.

## Cheap by construction

The whole intake costs ~10 output lines and 0–1 extra turns. Its value is the multiplier on
everything after it: a wrong deliverable caught at line 3 costs 3 lines; caught after the
implementation, it costs the implementation.
