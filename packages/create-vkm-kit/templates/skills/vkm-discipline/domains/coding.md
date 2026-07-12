# Domain: coding & refactoring

Load this when the task changes source code — a feature, a refactor, a bug fix, a dependency bump —
plus the tests and docs that ride with it. (Starting from a _failure_ instead? Load `debugging.md` too.)

## Deliver a better result

1. **Reproduce before you fix.** A bug isn't understood until a deterministic case fails on it; that
   same case must pass after — keep both outputs.
2. **Validate at the boundaries.** Every input crossing a line (API, file, form, CLI, DB) is typed and
   checked before use — point to the line that does it. An unguarded boundary is a defect, not a nit.
3. **Fix the root cause in the shared function, not the symptom** at one call site — then confirm every
   consumer still works (find-usages + tests).
4. **Keep the diff to the change asked.** Zero opportunistic edits; anything else you spot → derived task.
5. **Refactor and behavior-change are two commits:** first refactor with identical behavior (tests
   green, untouched), then the behavior change with its new tests.
6. **Errors propagate, are handled with a concrete action, or logged with context** — never swallowed
   (empty catch, ignored exit code, forced `any`) without a written reason.
7. **Build/lint/tests run from the real repo state** (not the editor's memory); paste the decisive output.

## Edge cases to actually run (or mark "not covered", with a reason)

- Empty/null input → decide the behavior _with the user_ before coding it, never silently.
- Extreme size → document the supported limit and reject cleanly above it.
- Malformed input → explicit typed error, never a silent partial result.
- Duplicate/retried op → make it idempotent or block the duplicate; "unlikely" isn't a mitigation.
- Concurrency on shared state → serialize or lock.
- Paths/names with spaces & non-ASCII → fix the encoding/quoting, not the test file's name.

## Anti-patterns

- ❌ Patching where the symptom shows instead of the origin → trace to the source function, fix there.
- ❌ "While I'm here" scope creep → note it, don't touch it.
- ❌ Making a test pass by weakening the test → change the code, unless the spec proves the test wrong.
