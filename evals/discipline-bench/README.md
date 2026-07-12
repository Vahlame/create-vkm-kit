# /vkm-discipline mini-bench

Measures whether loading the `/vkm-discipline` doctrine **helps or hurts** task quality versus
stock, **per model** — the parity check before the kit's discipline system supersedes the
SOP-suite. The key question, given that heavy procedure/CoT measurably hurts small models: does
**+discipline ≥ stock on the small model (Haiku)**, while still helping the large one (Opus)?

## Method (objective, execution-graded)

- **Task:** a discriminating spec whose naive happy-path solution fails the edge cases the coding
  domain calls out (empty/malformed/duplicate/reversed/negative). See `tasks/*/PROMPT.md`.
- **Grader:** `tasks/*/grade.mjs` runs hidden tests the subject never sees against the subject's
  exported function → score = % passed (0-100). Execution-graded, no blind-judge needed.
- **Conditions:** `stock` (task only) vs `discipline` (the real `SKILL.md` core + the relevant
  `domains/*.md` prepended to the task). Same task, same model — the delta isolates the doctrine.
- **Models:** Haiku (the risk) and Opus (the ceiling), spawned as subjects.
- **Anti-contamination:** the subject sees only `PROMPT.md`; the grader and hidden tests are separate.

Subjects are spawned with the Agent tool (`model` = haiku/opus), instructed to return the solution
as a single fenced code block; each returned solution is saved to `solutions/<model>-<condition>-<n>.mjs`
and graded. Results go in `RESULTS.md`.

## Reading the result

- `discipline - stock ≥ 0` on **Haiku** → the doctrine doesn't hurt the small model → safe to retire the SOP.
- A negative Haiku delta → the doctrine is too heavy for the small model; iterate before retiring.

Mini-bench: few tasks, few replicas — a directional check, not the SOP's full multi-judge program.
Not a CI gate (it spawns model subjects); run it manually.
