# Observations (hypotheses)

The agent's hypotheses about recurring patterns it sees — **not facts yet**. One line each:

`date · file:line · pattern · status: pending|confirmed|dismissed`

When the user confirms one, move it to `confirmed-bad.md` (anti-pattern) or `confirmed-good.md`
(preferred). Drop `pending` items left untouched for months.

<!-- example -->

- 2026-01-15 · api/users.ts:42 · SQL built by string concatenation (injection risk) · status: pending
