# ADR-0071: Bench arms that prove what they carry

- **Status:** Accepted
- **Date:** 2026-07-25
- **Deciders:** maintainer

## Context

ADR-0063 measured the fixed context layer — 45,247 chars, ~11,312 tokens paid on every
session before the user has typed anything — and deliberately refused to turn that
number into a budget:

> Turning the band into a real budget is deliberately deferred. Picking a ceiling now,
> before the off-target control (WP1) says what the fixed layer actually costs in
> behaviour, would be inventing a number.

WP1 is that control: run the same off-target tasks — tasks the kit has nothing to do
with — against a subject that has the kit installed and one that never met it. A
difference is what the always-paid layer costs (or buys) on work it was not written
for. Nothing in the repo could build those subjects.

**And the obvious way to build them is already wrong here.** Two temp-HOME installers
exist, and both install with `--minimal --no-skills --no-agents`:

- `scripts/e2e-smoke.mjs:60` — proving hybrid search works over stdio
- `scripts/harness-matrix.mjs:127` — proving per-harness wiring lands

Neither is measuring behaviour, so neither has any reason to install the behavioural
layer. Reused as the "kit installed" arm of an A/B, either one produces a subject
**missing the entire independent variable** — no rules block, no skills, no hooks, no
output style. The bench then runs, grades, and reports a null. The number is real; what
it measures is nothing.

That failure is silent by construction. A broken build stops a bench; a mislabelled arm
publishes a result.

## Decision

`evals/lib/arm-install.mjs`: an arm **declares the layers it carries, and a build that
does not match its declaration throws** (`ArmMismatchError`, listing each disagreeing
layer). There is no path from "install returned 0" to a usable subject — the exit code
is not consulted for verification at all.

Verification reads the filesystem a subject session would actually load —
`~/.claude/CLAUDE.md`, `~/.claude/skills/`, `~/.claude/agents/`, `~/.claude/settings.json`,
`~/.claude.json`, `./AGENTS.md` — never the installer's stdout. What the installer says
it did and what the model receives are separate claims, and only the second is the
independent variable.

Five arms: `off` (no installer runs at all), `core`, `standard`, `rules-full`
(ADR-0067's three rule levels, everything else stripped), and `full` (the real default
install). That is a dose-response ladder plus its control, and the control is what makes
the ladder interpretable — without a subject that never met the kit, every delta is
measured against another dose of the same thing.

Three details carry most of the value:

**Arms opt pieces in, not out.** Every spec starts from a strip-everything flag set and
adds back what it is about. A spec that forgets a flag under-installs, and the probe
catches it. Under the opposite convention a forgotten `--no-` flag over-installs
silently into whatever the installer's defaults grow into next release.

**Rule levels are detected by `levelBody()`, not by copied marker strings.** The probe
imports the same function the installer composes the block from, so a renamed heading
cannot leave every arm reporting a stale composition.

**A missing CLI is `skipped`, never a pass.** The `full` arm gets its MCP layer through
`claude mcp add -s user`, so without that CLI it cannot be built. It reports unmeasured
and the survey still exits 0 — the same rule ADR-0066 applies to absent harnesses,
because "we could not check" and "we checked and it was fine" must never render alike.

**Which edge of the control loop this closes:** none yet, again. It is the second
precondition of ② DOSE — ADR-0063 gave the layer a size, this gives it an experiment.
Dosing is still not implementable, and this ADR claims no behavioural result. It ships
the instrument, and the honest statement is that the instrument has not been pointed at
anything yet.

## Alternatives considered

- **Parameterize `e2e-smoke.mjs` / `harness-matrix.mjs` with the missing flags.**
  Rejected: it makes two probes with sharply different purposes share a flag set, and
  the reason the trap exists is that `--minimal --no-skills --no-agents` is _correct_
  for both of them. The right fix is a builder whose job is arms, not a third caller
  of an installer invocation tuned for something else.
- **Trust the installer's exit code and skip the probe.** Rejected: it is exactly the
  assumption that produced the trap. The installer exits 0 while honouring
  `--no-skills`; success and "carries the skills layer" are unrelated propositions.
- **Compose arms by hand-writing `CLAUDE.md` and the hook files.** Rejected: faster and
  fully deterministic, but then the bench measures a hand-made approximation of the kit
  rather than the kit. Any drift between what the installer writes and what the fixture
  contains becomes an invisible confound, and the whole point is fidelity to what users
  actually get.
- **Assert the `full` arm's exact hook and MCP lists.** Rejected: their membership
  legitimately changes per release, so pinning them turns every feature addition into a
  bench failure. `full` asserts they are non-empty; that they exist at all is what the
  arm means.
- **Cache built arms across runs.** Rejected as premature: an arm is built once and
  reused across every task and replica already, so the build cost is amortized to near
  zero by the API shape. A cache keyed on a spec hash would add a staleness failure
  mode to buy back a few seconds.

## Consequences

- Positive: WP1 is unblocked, and the deferred budget in ADR-0063 has a path to a
  number that was measured rather than picked.
- Positive: the trap is a **test that executes it** — `arm-install.test.mjs` builds an
  arm from the real `e2e-smoke` flag set, labels it a full install, and asserts the
  build throws naming both missing layers. Verified to fail when `buildArm` stops
  verifying (mutation run: `not ok 10`, `# fail 1`).
- Positive: the survey runs in `e2e-smoke` on every push, so an installer change that
  stops delivering a layer breaks CI at the arm, not silently inside a future bench.
- Neutral: the probe found its own bug before shipping — hooks are spelled
  `{command: "node", args: [script]}`, so reading `command` alone returned `"node"` and
  reported `hooks=0` for an install carrying seven. It slipped past the first survey
  because the `full` arm had not declared `hooks` at all; both the probe and the
  declaration were fixed, and the spelling is now pinned by a test verified to fail
  against the old parser (`not ok 3`).
- Negative: the `full` arm is unverifiable on any machine without the `claude` CLI,
  which includes CI. Its wiring is covered there by `harness-matrix.mjs`; its
  end-to-end integrity is only checked where the CLI exists.
- Neutral: no bench consumes arms yet. This is an instrument landing ahead of its use,
  which is the same order ADR-0064 (statistics) and ADR-0065 (cost) landed in.

## References

- `evals/lib/arm-install.mjs`, `evals/lib/arm-install.test.mjs`
- `scripts/e2e-smoke.mjs:60`, `scripts/harness-matrix.mjs:127` (the two installers whose
  flag set is correct for them and wrong for a bench arm)
- ADR-0063 (the fixed-layer inventory, and the deferral this unblocks)
- ADR-0066 (the "not measured is not a pass" rule reused here)
- ADR-0067 (the three rule levels the ladder doses)
