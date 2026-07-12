# Domain: debugging & incidents

Load this when the starting point is a FAILURE observed — a reported bug, behavior diverging from
expected, or a live incident — not a request to build. Active-incident order: **mitigate first,
diagnose after — but capture evidence before you touch anything.**

## Deliver a better result

1. **Reproduce before you touch.** A deterministic command/case triggers the failure (record its
   output); reduce it to the minimum that still fails — each element you remove without the bug
   vanishing rules a cause out. The fix is accepted only when that case passes after. Can't reproduce
   in a bounded effort? Document what you tried and switch to capturing evidence (instrumentation/logs)
   — not blind "fixes".
2. **First hypothesis = what changed.** Correlate the symptom's start time with the change log
   (deploys, config, data, deps, certs, cron) before theorizing about code stable for months.
3. **One hypothesis at a time, falsifiable:** write "if H, doing X I'll see Y", run X, record what you
   saw. Never change two variables in one test.
4. **Preserve evidence before mitigating:** logs, process/data state, timestamps, the exact deployed
   version — captured first. In an incident, capture is the only thing that precedes mitigation.
5. **A symptom that "stopped happening" isn't closed:** either a demonstrated cause→effect chain, or it
   stays open with instrumentation + a re-trigger condition. A fix you can't explain is a lucky
   correlation — ship it labeled "mitigation, root cause open", not "fixed".
6. **The reproducer becomes a permanent regression test** (or an archived executable procedure).

## Live incident (users affected now)

- Log the trigger + time — that opens the timeline.
- **Severity sets cadence:** SEV1 (unusable / data at risk) update every 15-30 min, escalate fast;
  SEV2 (degraded / workaround) 30-60 min; SEV3 → drop to the normal-bug flow. Re-evaluate on each new fact.
- **Default mitigation = revert the recent change.** Fix-forward during an incident needs a written reason.
- **Three hats even for one person:** incident lead (decides), comms (informs the affected), ops (executes).
- **Escalation threshold set up front** ("no mitigation in 30 min → escalate"); hitting it is procedure, not failure.
- **Comms one-liner:** "what's happening · known impact · what's being done · next update at HH:MM."
  Never promise a resolution time — promise the next-update time.
- **Close on the postmortem** (cause · detection time · mitigation time · preventive action), not on mitigation.

## Anti-patterns

- ❌ Shotgun debugging (several changes at once) → revert to last known good; one change per test, with its prediction.
- ❌ Closing because the symptom vanished → no demonstrated cause, no close.
- ❌ Making the test pass by editing the test → change the code, unless the spec proves the test wrong.
