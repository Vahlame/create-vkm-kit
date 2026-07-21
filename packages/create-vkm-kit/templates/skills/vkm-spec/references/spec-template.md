# The spec template

Copy the block below and fill every field. The validator (`scripts/validate_spec.mjs`)
parses exactly this shape — keep the headings verbatim.

```markdown
# Spec: <short title>

## system_role

<ONE line: who the executor is for THIS task — e.g. "Node CLI maintainer adding a flag to an existing installer">

## user_intent

<The idea restated sharply: what outcome, for whom, why now. 2–4 sentences, no filler.>

## functional_requirements

1. <Concrete, individually testable requirement.>
2. <Another. Between 3 and 7 total.>
3. <Each one names an observable behavior — input, action, expected effect.>

## constraints

- <Hard limit the solution must respect> (source: <vault note path or repo file>)
- <Stack version, prior decision, rule — each with its source> (source: <path>)

## current_state

<≤600 characters distilled from the context bundle: what exists today that this touches.
Plain prose, no headings.>

## acceptance_criteria

- [ ] <Binary check that defines "done" — runnable or directly observable.>
- [ ] <Another. Every box must be checkable yes/no, no "works well".>
```

## Validation rules (what the script enforces)

1. All six `##` sections present, in any order, exactly these names.
2. `system_role` is a single non-empty line.
3. `functional_requirements`: 3–7 numbered items (`1.` … `7.`), none empty.
4. `constraints`: at least one bullet; **every** bullet carries `(source: …)` — or the
   explicit marker `(assumption)` when it's yours, so review can challenge it.
5. `current_state`: non-empty, ≤600 characters.
6. `acceptance_criteria`: at least two `- [ ]` boxes; none containing the vague words
   the validator flags (`should work`, `properly`, `correctly`, `good`, `etc`).

## Hand-off wrapper (Step 5, "run it elsewhere")

Wrap the filled spec in this envelope — self-contained, paste-anywhere:

```xml
<orchestration_package>
  <system_role>…</system_role>
  <user_intent>…</user_intent>
  <functional_requirements>
    <req id="1">…</req>
  </functional_requirements>
  <constraints>
    <constraint source="PROJECTS/x.md">…</constraint>
  </constraints>
  <current_state>…</current_state>
  <acceptance_criteria>
    <criterion>…</criterion>
  </acceptance_criteria>
</orchestration_package>
```
