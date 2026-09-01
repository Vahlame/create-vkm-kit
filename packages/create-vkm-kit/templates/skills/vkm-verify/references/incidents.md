# Incidents — every green that lied

Real incidents behind vkm-verify, not categories invented for symmetry. Each entry is a
check reporting one of two things with the same green: _your code is correct_, or
_nothing was examined_.

- A lint that walks the tree for an antipattern goes **green forever** the day its regex
  stops matching — zero matches is a pass.
- A CI job that is **skipped** counts as success, so a release published without ever
  touching npm reported all-green (twice).
- `gh pr checks` exited **0 with zero jobs**.
- A matrix's `fail-fast` cancelled two legs mid-suite, which then reported "fail" for tests
  that never ran — the mirror image, and just as wrong.
- A validator printed **nothing and exited 0** on Windows: indistinguishable from a pass
  for anyone reading the exit code.
- 415 unit tests passed while the installer they cover wired every MCP server the wrong
  way, because **no test ran the installer**.
- A substitution script "fixed" 8 files and matched **nothing**, because the patterns had
  accents and the files did not.
- A file was created, verified locally, and "committed" — `.gitignore` swallowed it in
  silence and the commit message claimed it was there.

The lesson is the same in every row: **a green check is only evidence when it ran, covered
your change, and would have failed if your change were wrong.**
