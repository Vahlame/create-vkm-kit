# Dial examples — two complete passes

The dial's failure modes are symmetric: full ceremony on a trivial task wastes the
user's time; "just do it" on an irreversible one gambles with it. One worked pass at
each end.

## Pass 1 — trivial, reversible: "rename `getUserData` to `fetchUserProfile`"

**Dial reading:** one obvious outcome, reversible in one commit → row 1, just do it.

What the execution looks like — no restatement ceremony, no options:

```text
Renamed getUserData → fetchUserProfile: 1 definition, 7 call sites, 2 test files.
`npm run lint && npm test` pass (evidence-gates: 2 passed, 0 failed).
Also updated the one JSDoc @see reference — it would have gone stale.
```

Note the shape: the whole "more than asked" contribution is one stale-reference catch,
one line. The evidence is a real gate run, not "should be fine". Total friction added
to the user: zero questions, three lines of output.

**What row 3 treatment would have looked like (wrong):** a restated goal, a plan with
two naming alternatives, a request for approval — three exchanges for a rename the
user already decided.

## Pass 2 — hard, irreversible: "drop the `sessions` table, we moved to JWT"

**Dial reading:** destructive, production data, no undo → row 3, full treatment.

```text
Goal: remove server-side session storage now that auth is JWT-only.

Before dropping, verified reality (not assumed):
- grep: 3 live references to `sessions` remain — a cron cleanup job, a metrics query,
  and an admin "force logout" endpoint. The migration is NOT reference-free.
- The force-logout endpoint has no JWT equivalent (revocation list) yet — dropping the
  table silently breaks it.

Plan (in order, each step reversible until the last):
1. Ship the JWT revocation list; port force-logout to it.
2. Retire the cron job and the metrics query.
3. Rename the table to `sessions_deprecated` for one release (rollback stays possible).
4. Drop it next release, with a verified backup taken first.

Step 4 is the only irreversible one — I'll ask before executing it. Steps 1–3 I can
start now. Proceed?
```

Note the shape: the verification came **before** the plan (the endpoint discovery
changed it); every irreversible action is isolated and gated on explicit confirmation;
the options presented are real decisions the user owns, not hedging.

**What row 1 treatment would have looked like (wrong):** `DROP TABLE sessions;` — and
a broken admin endpoint discovered in production.

## Reading the boundary

Between the rows, ask one question: **what does it cost to be wrong?** A wrong rename
costs a revert; a wrong drop costs data. Cost-of-wrong, not effort-to-do, sets the dial.
