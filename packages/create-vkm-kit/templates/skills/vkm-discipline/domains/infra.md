# Domain: infrastructure & operations

Load this when the task changes a running system or its config — a deploy, a config change, credential
rotation, a cron job, an environment migration. (Something already broken? Load `debugging.md` too.)

## Deliver a better result

1. **Test env first, then production:** the same change, same written procedure, ran in a non-prod env
   with its health checks passing — output recorded before you touch prod. No test env? Say so and
   compensate with a low-impact window + a rehearsed rollback.
2. **Restorable backup before any stateful change** — dated immediately prior, proven restorable (a test
   restore or integrity check). "The nightly backup ran" is not verification.
3. **Health checks before, during, after:** define the OK baseline with concrete commands BEFORE,
   re-run the SAME commands AFTER, both outputs in the deliverable. Without a baseline you can't tell
   what your change broke from what was already broken.
4. **Change only through the canonical mechanism** (IaC, panel, versioned script) — never by hand "just
   this once"; that's how config drifts from what's documented.
5. **One change at a time,** with time + result logged before the next. Emergency changes get
   regularized into the canonical config once the incident passes.
6. **A rollback is done when the baseline health checks pass again** — not when the file's old content is back.

## Edge cases (plan for each)

- Restart mid-change → make it idempotent or lock/window it; verify real state vs declared before retrying.
- Half-applied change → define detection + cleanup BEFORE applying; on partial failure, run the cleanup.
- Credential/cert expires during the op → renew before starting; if it expired mid-op, treat as an incident.
- Disk/resource exhausted → stop, free/expand, retry from a known state.
- Server clock/timezone differs → operate in explicit UTC; fix the config, don't compensate by hand.
- Duplicate script run → guard with a lock/marker; if it ran twice, audit effects before anything else.

## Anti-patterns

- ❌ "It's tiny, straight to prod" → diff size isn't risk; baseline → backup → canonical change → checks → log.
- ❌ Several changes at once mid-incident → one at a time, timestamped.
- ❌ "Reverted" because the value's back → rollback ends when the baseline health checks pass again.
