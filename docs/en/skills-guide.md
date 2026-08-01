# Skills guide: which one, when, and when not

The kit installs **five skills** into `~/.claude/skills/`. Each fires on its own when its
`description` matches what you asked for, and each can be invoked by hand (`/vkm-spec`,
`/vkm-design`, …). This guide exists because the expensive question is not "what does each
one do" but **which one applies right now** — and above all which one does **not**, since a
skill that fires where it doesn't belong makes the result worse, not better.

Ground rule: **a skill never overrides your judgment or the model's**. If you scoped the ask,
that scope wins (the arbitration rule).

## The map, one line each

| Skill             | Use it when…                                                                                | You get                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `/vkm-spec`       | the idea is still vague and **writing code would be guessing**                              | a testable spec, anchored to the vault, machine-validated                 |
| `/vkm-discipline` | you know what to do and it has to be **done well**: code, data, infra, docs, PR, postmortem | the work, plus executed evidence that it holds                            |
| `/vkm-design`     | something will be **looked at**: UI, screen, component, chart, brand, diagram               | a named design direction, computed checks, a visual loop                  |
| `/vkm-verify`     | something came back **green** and you are about to believe it                               | a verdict: PROVEN · VACUOUS · DIRTY                                       |
| `/vkm-research`   | a `RESEARCH/<topic>` bank has sources that were never consolidated                          | a `summary.md` with wikilinks, supersession, marked sources               |
| `/vkm-intake`     | the task is **non-trivial** and a bad start would be expensive: prompt/images/context       | objective/deliverable/non-goals in 3 lines + minimal context loaded       |
| `/vkm-ui-judge`   | a GUI **looks wrong** (web, Flutter or native): contrast, dark mode, responsive             | measured defects (audit/tests/real screenshots) + a fix with before/after |

## The natural order of real work

```text
vague idea ──/vkm-spec──▶ spec ──/vkm-discipline──▶ implementation ──/vkm-verify──▶ a defensible "done"
                                       │
                                       └── if a UI is involved ──/vkm-design──▶ direction + checks
```

`/vkm-research` runs alongside all of it: it feeds the vault the consolidated material that
`/vkm-spec` later pulls as context in a single `assemble_context` call.

## When NOT to use each

This half matters more than the other.

**`/vkm-spec`** — not for a one-line change, not for a bug whose cause you already know, and
not when you brought the scope written down. Specifying the obvious is pure cost.

**`/vkm-discipline`** — not for a typo, a rename or a version bump; not for questions,
explainers or chat recaps; and not when you asked for "two options, I'll pick" (you set the
scope there). Its own `description` excludes those on purpose: a skill that fires on
everything makes the model worse, not better.

**`/vkm-design`** — not for logic with no visible surface, not for "make this bold". Yes for
anything a person will _look at_, even if you never say the word "design".

**`/vkm-verify`** — not for writing new tests (that is `/vkm-discipline`), and not for
debugging something **already red**: there the problem is visible and the job is to fix it.
This is for suspicious green, not for red.

**`/vkm-research`** — not for searching the web (those are the `obscura_*` tools) and not for
summarizing a single document. It is specifically the **consolidation** step over a bank that
already has persisted sources.

## The three that get confused

- **`/vkm-discipline` vs `/vkm-verify`.** `discipline` ends in executed evidence: it runs the
  project's own checks and reports. `verify` asks the next question — _can that check fail?_
  Reach for it when the green arrived too easily, when a guard has never once fired, or when
  the symptom you reported is still there despite the pass.
- **`/vkm-spec` vs `/vkm-discipline`.** If the question is "what should be built", that is
  `spec`. If it is "how do I build this well", that is `discipline`. A plan for something
  already decided is ceremony.
- **`/vkm-design` vs `/vkm-discipline`.** If the result is judged with eyes, `design` leads;
  if it is judged by a test, `discipline` does. A real screen usually wants both: `design`
  sets the direction, `discipline` implements and proves it.

## Concrete calls

| What you ask                                  | Skill             | Why                                              |
| --------------------------------------------- | ----------------- | ------------------------------------------------ |
| "the app should warn me when stock runs low"  | `/vkm-spec`       | no scope yet; coding would be guessing           |
| "implement the restock endpoint per the spec" | `/vkm-discipline` | scope is closed, it needs doing with evidence    |
| "the dashboard looks generic"                 | `/vkm-design`     | the judgment is visual                           |
| "tests pass — shall we merge?"                | `/vkm-verify`     | a green to confirm before an irreversible action |
| "consolidate the pricing research"            | `/vkm-research`   | a `RESEARCH/` bank with unmerged sources         |
| "fix the typo in the README"                  | none              | one line; a skill here is cost with no return    |
| "why is this test failing?" (already red)     | `/vkm-discipline` | that is debugging, not verifying a green         |

## Cost

Every skill's `description` is **always** in context (which is why the kit keeps them short,
with a hard cap enforced in CI); the body loads **only** when the skill fires. Five installed
skills are not five bodies per session — they are five descriptions and, at most, one body
when it is needed.

If a skill's style is in the way for a particular job, just say so: your instruction in the
chat outranks any skill.
