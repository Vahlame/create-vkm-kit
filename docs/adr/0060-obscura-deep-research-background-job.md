# ADR-0060: Background deep-research jobs — depth that outlives an agent-loop turn

- **Status:** Accepted
- **Date:** 2026-07-19
- **Deciders:** maintainer

## Context

The user's ask, restated plainly: run research the way a human researcher spends an afternoon on
a hard question — start from a handful of seed topics, actually iterate for 10-20 minutes (chase
subtopics, notice correlated areas, borrow analogies from other fields, propose improvement or
application ideas), stay anchored to one objective the whole time, and only then hand Claude a
dump to read and consolidate. Nothing about that shape fits inside one tool call.

The 60-second wall is not new and this ADR does not relitigate it — ADR-0057 §5 already
established it precisely: the MCP SDK's `tools/call` timeout (`DEFAULT_REQUEST_TIMEOUT_MSEC =
60000`, `shared/protocol.js:8`) is enforced **client-side**, and `resetTimeoutOnProgress` defaults
to `false` (`protocol.js:714`) — a server has no channel to extend it unless the specific client
opts in. `obscura_research` (the synchronous tool) already answers this for a single call: a
`deadline_ms` budget (capped at 55000, ~5s of headroom under the wall) returns the best-ranked
finished prefix instead of losing everything. What that fix cannot do is turn one ~55-second call
into fifteen unattended minutes.

ADR-0057's own fourth addendum considered exactly this and declined it, in its own words: the
original plan for that phase "included the MCP process itself continuing to crawl, unattended,
after returning a response." It was declined because the session had already shipped a cheaper
mechanism for going deeper than one call — the second addendum's `persist:true` + `excludeHashes`
loop, where the calling agent re-invokes `obscura_research` and reads `alreadyCovered`/`remaining`
to decide whether to continue. Building MCP-side auto-continue as well would have meant two code
paths solving the same problem for no benefit the existing one didn't already cover. The addendum
named its own reversal condition rather than leaving the door merely ajar: "if a use case ever
needs progress with no caller ever returning (an unattended cron trigger, not an agent loop), that
is the trigger to revisit this, not a general preference for more automation."

This feature is that declined mechanism, built — with one honest correction to how the trigger
actually fires, versus the letter of the cron example. `obscura_research_start` is still one
interactive call, and it still returns, in milliseconds, not never. What changed is not "no
caller" but the cost of the existing alternative: the second addendum's loop makes the calling
agent spend a live turn — a real round-trip through its own reasoning and context — for every
~50-second increment of depth. Fifteen to twenty minutes of that is fifteen to twenty real agent
turns, each one asking the agent to stay "awake" and re-invoke on schedule, which is not what
"let it research for twenty minutes" means to a person asking for it. The gap ADR-0057 left open
was never "no caller" in the literal cron sense — it was "no way to buy fifteen minutes of depth
for one caller." That is the gap this ADR closes.

## Decision

1. **In-process job registry + three MCP tools.**
   `obscura_research_start(objective, topics, topic, …)` / `obscura_research_status(job_id?)` /
   `obscura_research_stop(job_id?)`, backed by a module-level `Map` in `deep-research.mjs`
   (`JOBS`) that outlives the tool call that created it —
   the same server process, not a child process or a database, because the MCP server is already
   long-lived for the session and a background `Promise` inside it is the cheapest thing that
   satisfies "returns immediately, keeps running." `start` validates synchronously (objective
   non-empty, 1-6 topics, a valid `topic` slug) and resolves `OBSCURA_RESEARCH_DIR` **before**
   registering the job, so a missing research root fails immediately rather than being discovered
   only when an already-running 15-30 minute job reaches its own report-write step. The crawl loop
   (`runJob`) is then kicked off unawaited, its promise stored on the job record and given a
   terminal `.catch` — a genuinely unexpected throw still lands as a typed `failed` state instead
   of an unhandled rejection with no observer, which is also what this repo's own
   `no-floating-promises` lint rule requires of any fire-and-forget promise.

2. **Rounds reuse `deepResearch` whole — never a second crawl implementation.** Each round is a
   normal call into the exact function `obscura_research` itself calls: same expansion, gather,
   fusion, curation, sanitization, and `excludeHashes` handling. `deep-research.mjs` is
   orchestration only — pick the next query, call `deepResearch`, persist, decide whether to
   branch, decide whether to keep going. Every future gather/rank/curate fix to `research.mjs`
   benefits both tools for free, and there is exactly one place that owns "how a page gets judged."

3. **Typed leads via the expand model, zero-shot.** `generateLeads` (`ollama-client.mjs`) runs on
   `DEFAULT_EXPAND_MODEL` (`qwen3.5:4b-q4_K_M`, not the curation model) for the same reason
   `expandQuery` does: proposing a _new_ search direction is a recall task, not reading
   comprehension, and ADR-0057 §5 already measured a curation-sized model losing at recall tasks.
   Each lead is typed as exactly one of `subtopic | related | analogy | application` and carries a
   one-clause `why` tying it to the run's `objective` — not to the seed topic's literal wording, so
   a lead can survive several hops away from where it started as long as it still serves the stated
   goal. The prompt is deliberately zero-shot: ADR-0057's own alternatives-considered section
   measured, three times, that few-shot examples on a model this size either get copied verbatim
   (golden-answer examples, 4/4) or cross-bleed into unrelated domains (a SQLite query coming back
   as "sqlite crash loop backoff," borrowed from a Kubernetes example) — nothing about proposing
   leads instead of expanding a query changes that mechanism, so no examples were added here
   either. A proposed lead is also rejected as a near-duplicate if `similarityRatio` (the
   Ratcliff/Obershelp port ADR-0057's first addendum built for SERP fallback ranking) scores it
   ≥0.85 against anything already searched or queued — one more place that primitive turned out to
   be reusable beyond the job it was built for.

4. **Per-round durable persist + `excludeHashes` accumulation.** Every finished round calls
   `persistResults` immediately, not batched at the end, so a killed process loses only the round
   in flight, never banked work. Before the loop starts, `listCoveredHashes(topic)` reads every URL
   already under `RESEARCH/<topic>/sources/` (the second addendum's durable seen-set), and each
   round's own newly-covered URLs are folded into that same in-memory set as the job runs — round 2
   of one job already excludes round 1's own catches, not only a previous job's, and a job started
   on a well-covered topic reaches further into the pool from its very first round.

5. **Pacing plus banned-round detection, escalating together.** `paceMs` (default
   `OBSCURA_DEEP_PACE_MS` or 15s) sleeps between rounds, and doubles the moment a round comes back
   looking banned rather than waiting for a human to notice. A round counts as banned by the same
   signature ADR-0057 §6 identified as the dangerous one: `scanned:0` together with a non-empty
   `enginesUnavailable` — a fully-suspended SearXNG answers HTTP 200 + `results: []`,
   indistinguishable from "no hits" unless that field is read. Two banned rounds in a row
   (`bannedStreak >= 2`) stops the whole job with `stoppedReason: "engines_suspended"` rather than
   grinding a banned machine for whatever budget remains — a 15-30 minute unattended run is exactly
   the shape that would otherwise burn its entire budget against a suspended engine and report back
   a confident-looking "done" with nothing in it. Every other exit is named just as explicitly:
   `stop_requested`, `budget_exhausted`, `max_rounds` (a hard ceiling of 40 regardless of remaining
   budget, against a runaway lead generator), or `frontier_empty`.

6. **One active job, enforced at `start`.** `startResearchJob` walks the registry and throws
   `job_active` if anything is `state: "running"` — the identical reasoning ADR-0057 §6 already
   established for the synchronous tool's own fan-out (this machine gets banned by request volume,
   not by any one request), now applied to a mechanism that runs unattended for up to half an hour
   with no operator watching to notice two overlapping jobs doubling the load.

7. **The internal deadline is mode-dependent, on purpose.** `obscura_research`'s own `deadline_ms`
   stays capped at 55000 (~5s of headroom under the 60s transport wall) because that call is still
   on the wire, still being waited on by a caller with a live budget. A background round is not:
   `obscura_research_start`'s `round_ms` (default `OBSCURA_DEEP_ROUND_MS` or 100000, clamped
   20000-300000) can run up to 300 seconds precisely because nothing is blocked on it — `start`
   itself has already returned, the transport has already closed out that call, and the only cost
   of a slower round is a slower background job, not a lost response. This extends ADR-0057 §5's
   "mode changes what deadline is honest" logic (there: does SearXNG exist) to a second axis:
   is anything waiting on this call at all.

8. **A run report per job, `runs/<timestamp>.md`, including an Unexplored-leads section even when
   it's empty.** Written from a pure function of the job record (`renderRunReport`) in the loop's
   `finally`, so it fires on every exit path — graceful stop, budget exhaustion, max rounds, engine
   suspension, or an unrecoverable error — not just a clean finish. Beyond a round-by-round table
   and a query genealogy (which lead spawned which, and why), the report always renders an
   "Unexplored leads" section listing whatever was still queued in the frontier when the job
   stopped. This is deliberately where an application or improvement idea the job generated but
   never got to chase surfaces for a human to read — matching the user's own framing that
   improvement ideas are part of what this kind of research is supposed to produce, not a report
   bug when the queue happens to be empty at exit.

## Alternatives considered

- **A detached CLI/bin run via the calling agent's own background shell.** Rejected for now: this
  is Claude-Code-specific (not every MCP client this kit targets exposes an equivalent "run this
  detached and let me poll it" facility — Cursor's agent loop doesn't), and it would need new
  installer surface (a `bin` entry point on PATH, a way to hand it `OBSCURA_RESEARCH_DIR` and the
  objective/topics outside of an MCP tool call) that the in-process registry costs nothing for,
  since the MCP server is already a long-lived process for the session. This is the shape closer to
  the fourth addendum's literal "unattended cron trigger" example — revisit it specifically if a
  genuinely no-agent-present trigger (a scheduled task, not a chat session) is ever the real ask.
- **Raising the client-side request timeout.** Rejected on the same grounds ADR-0057 §5 already
  gave for not fighting the wall: `DEFAULT_REQUEST_TIMEOUT_MSEC` is a per-client default this
  server cannot change on a user's behalf — asking every user to raise it in Cursor's config (and
  whatever the equivalent is in every other MCP client) is not portable, and even a raised timeout
  is still a wall, just a further one. It does not turn "one call" into "fifteen minutes with the
  agent free to do other things meanwhile."
- **Status quo: keep using the agent-loop `persist:true` + `excludeHashes` re-invocation
  pattern.** Still fully supported — nothing about this ADR changes `obscura_research` itself — but
  it cannot span 15-20 unattended minutes without 15-20 live agent turns, one per ~50-second
  increment, each a real round-trip through the calling agent's own reasoning and context. That is
  a materially different cost from "start it and check back," and closing that gap is this ADR's
  entire point (see Context).

## Consequences

- **Positive:** matches the user's actual shape of ask — seed topics, branching, objective-anchored
  filtering, a report to consolidate — with zero required agent round-trips during the 3-30 minute
  window. The 60s wall stops being a design constraint on depth at all: `start` returns in
  single-digit milliseconds. Nothing is lost if nobody polls: per-round persist means even a killed
  MCP process leaves every already-curated page banked under `RESEARCH/<topic>/sources/`. Almost no
  new crawl logic was needed: `deep-research.mjs` is orchestration over machinery
  ADR-0054/0055/0056/0057 already built, tested, and measured — the only genuinely new judgment
  call in the whole feature is `generateLeads`.
- **Negative, named honestly:**
  - **The job dies with the MCP process.** A restart, a crash, or the user closing their IDE
    mid-run ends it — there is no separate worker process and no on-disk job checkpoint beyond what
    persist already writes. Mitigated, not eliminated: every round's curated results are durably
    banked before the next round starts, so a mid-run kill's loss is bounded to the one round in
    flight (at most `round_ms`, 5 minutes worst case) plus the final run report and the in-memory
    `topFindings`/frontier snapshot, neither of which is otherwise written anywhere.
  - **Ban risk grows with run length, and the concurrency guess is still a guess.** A 15-30 minute
    job makes many more SearXNG round-trips than one `obscura_research` call. `paceMs` and the
    `bannedStreak >= 2` early stop both exist because of exactly this, but
    `OBSCURA_SUBQUERY_CONCURRENCY`'s default of 2 (ADR-0057 §6) was measured against a single
    call's fan-out, never re-measured for a _sustained_ background load — it is inherited here,
    not re-validated for this new usage pattern.
  - **Lead quality is bounded by a 4B model and, unlike every other model choice in this pipeline,
    not benchmarked.** `evals/research/` scores gather+rank; `evals/research/curation.jsonl` scores
    curation (ADR-0057 fifth addendum). Nothing scores whether `generateLeads`'s proposed subtopic/
    related/analogy/application queries are actually good next moves. ADR-0057 §5 had n=4 live
    measurements before calling expansion "directional, not settled"; lead generation ships with
    zero measurement of its own, on the same model class ADR-0057 documented needing a larger model
    for recall tasks. This is a real, open gap, not a hedge.
  - **A written report is not a free report.** Writing one even on failure is a deliberate positive
    property (a job is never a silent black hole), but a job that hits `MAX_CONSECUTIVE_ERRORS` (3)
    or fails outright has still spent whatever budget those failed rounds burned before giving up —
    a report from a failed run is better than nothing, not the same as a successful one.
- **Neutral:** `OBSCURA_DEEP_ROUND_MS` (default 100000) and `OBSCURA_DEEP_PACE_MS` (default 15000)
  are new, both optional, both overridable per-call (`round_ms`/`pace_ms`) without touching the
  environment. Purely additive to the tool surface — `obscura_research`, `obscura_fetch`,
  `obscura_fetch_many`, `obscura_search`, and `obscura_consolidate` are all byte-for-byte unchanged.
  The job registry is in-memory only and caps history at 5 finished jobs (`JOB_HISTORY_MAX`) — a
  fresh MCP server process (after any restart) has no memory of a previous session's job ids, even
  though the `RESEARCH/` files that job wrote are still on disk; only the _job snapshot_ (rounds,
  findings, frontier) is process-lifetime, never the persisted research itself.

## References

- `packages/obscura-web/src/deep-research.mjs` (job registry, `startResearchJob`/
  `getResearchJob`/`stopResearchJob`/`runJob`/`renderRunReport`), `src/ollama-client.mjs#generateLeads`
  (+ `LEAD_KINDS`, `LEADS_SYSTEM_PROMPT`), `src/research-persist.mjs#writeRunReport`,
  `src/obscura-mcp.mjs` (`obscura_research_start`/`obscura_research_status`/`obscura_research_stop`).
- `test/deep-research.test.mjs`, `test/deep-research-mcp.test.mjs`, `test/generate-leads.test.mjs`,
  `test/run-report.test.mjs`. `packages/obscura-web` 326/326 tests (this session's verification
  pass, no regressions against the pre-existing 288).
- MCP SDK: `shared/protocol.js:8` (`DEFAULT_REQUEST_TIMEOUT_MSEC`), `:714`
  (`resetTimeoutOnProgress`) — the same citation ADR-0057 §5 uses for the identical wall.
- ADR-0054 (base crawl pipeline this reuses), ADR-0055 (per-page curation, reused as-is), ADR-0056
  (`RESEARCH/` layout and `persistResults`, reused as-is), ADR-0057 (the gather-over-rank redesign
  this job loops over — §5 for the 60s-wall citation, §6 for the ban-avoidance/pacing precedent,
  fourth addendum for the declined mechanism and named revisit trigger this ADR fires on, fifth
  addendum for the curation-model-vs-recall-task precedent `generateLeads` inherits, first addendum
  for `similarityRatio`).

<!-- ADR numbering note: this document was commissioned as ADR-0058, but 0058/0059 were taken by
     the concurrently-landing vkm-downloads ADRs (background jobs + mirrors) by the time this was
     written — filed as ADR-0060, the next free number, to avoid a collision. -->
