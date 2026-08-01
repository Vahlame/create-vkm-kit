---
name: vkm-verify
description: Prove a green check actually ran, covered the change, and can fail. Use before claiming done / tests pass / CI green / committed / deployed, when a guard or lint has never once fired, or when a pass contradicts a symptom the user still sees. NOT for writing tests or debugging a known-red failure.
user-invocable: true
---

# vkm-verify — the green that proves nothing

Installed by create-vkm-kit (vkm-kit). One job: **turn "it passed" into "it passed, and it
would have failed."**

A check reports two different things with the same green: _your code is correct_, and
_nothing was examined_. The second is the expensive one, because it looks exactly like the
first and it removes the very alarm you were relying on. Every entry below is a real
incident, not a category invented for symmetry:

- a lint that walks the tree for an antipattern goes **green forever** the day its regex
  stops matching — zero matches is a pass;
- a CI job that is **skipped** counts as success, so a release published without ever
  touching npm reported all-green (twice);
- `gh pr checks` exited **0 with zero jobs**;
- a matrix's `fail-fast` cancelled two legs mid-suite, which then reported "fail" for tests
  that never ran — the mirror image, and just as wrong;
- a validator printed **nothing and exited 0** on Windows: indistinguishable from a pass
  for anyone reading the exit code;
- 415 unit tests passed while the installer they cover wired every MCP server the wrong
  way, because **no test ran the installer**;
- a substitution script "fixed" 8 files and matched **nothing**, because the patterns had
  accents and the files did not;
- a file was created, verified locally, and "committed" — `.gitignore` swallowed it in
  silence and the commit message claimed it was there.

## The four questions

Ask them in order. The first that fails is the answer; stop there and fix the check before
trusting anything it says.

1. **Did it run at all?** Look for the count, not the exit code: tests collected, files
   linted, matches found, jobs executed. `0 passed` is not a pass. A tool that prints
   nothing did nothing. A skipped job is not a green job.
2. **Did it cover MY change?** A suite that ran 900 tests still proves nothing about the
   file you touched if none of them import it. Name the specific test, rule, or assertion
   that exercises this change — if you cannot, that absence IS the finding.
3. **Can it fail?** This is the load-bearing one and the only one that needs work: break
   the thing on purpose and confirm the check goes red. A check that has never been
   observed failing is a check whose green means nothing yet.
4. **Is what you verified what ships?** The artifact, not the source: the built bundle, the
   committed tree, the deployed image, the installed file. Verified-here / shipped-there is
   its own failure family — gitignored files, stale build outputs, an editor writing to the
   main checkout while the tests run in a worktree.

## The negative control

Question 3, mechanically. Break it, watch it go red, put it back, watch it go green again:

```bash
node scripts/prove-it.mjs --file <path-you-changed> --cmd "<check command>"   # from this skill's directory
```

It runs the check (must pass), mutates the file (a syntax error, or an inverted assertion
for a test file), runs it again (**must fail**), restores byte-for-byte, and runs a third
time to prove the restore was clean. Three verdicts, and the interesting one is the middle:

- `PROVEN` — the check fails when the code is wrong. Its green is now evidence.
- `VACUOUS` — green with the file broken. The check does not look at your change; the
  green you were about to report is worth nothing.
- `DIRTY` — the third run did not come back green. **Stop and fix the tree** before doing
  anything else: a harness that mutates and restores has left a suite broken before.

Do it by hand when the check is not a command (a UI flow, a hook, a permission rule): make
the condition false and confirm you get the failure you expect. A `PreToolUse` guard that
never denied anything has not been tested.

## Where the answer usually is

| Symptom                                     | Look at                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| Exit 0, no output                           | Did the entry point run? Windows/shell quoting, a `main` guard never taken |
| "0 tests" / "no files matched"              | Path filters, testMatch, working directory, a rename                       |
| CI green, symptom persists                  | Skipped jobs, cancelled matrix legs, cached steps, a job that only lints   |
| Green after an edit that should have broken | You are editing a different file than the one being run (worktree, build)  |
| Passes locally, fails in CI (or reverse)    | Environment: a flag you exported, a service only one side has              |
| A guard/lint that has never fired           | Its pattern. Feed it a known-bad input and watch it catch it               |

A note on your own harness: check the environment you are running the check IN. A kill
switch you exported for an unrelated reason (`VKM_TOKEN_SAVER=0`, `CI=1`, a proxy var) can
turn a real red into a fake red — or a real green into a meaningless one.

## Reporting it

State what ran, what it covered, and how you know it can fail — in one line each. If a check
turned out vacuous, say so plainly and say what you replaced it with. Never report a green
you did not earn; "tests pass" and "tests exist and pass on this change" are different
claims, and only the second is worth anything to the person reading it.

When the finding is reusable beyond this session (a lint that silently stopped matching, a
CI shape that reports success while doing nothing), record it in `KNOWN_FAILURES.md` as
`## <symptom>` + `- [failure] …`, `- [root_cause] …`, `- [fix] …`.
