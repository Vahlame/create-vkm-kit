# Mode: visual loop — render, critique, fix, repeat

An LLM's code-level intuition about how a UI looks is unreliable; the loop replaces intuition
with observation. This mode composes with generate (as its finishing pass) or runs standalone.

## 0. Capability check

Find a renderer in the current harness: an in-app browser/preview pane, Playwright/puppeteer, a
screenshot MCP, a desktop screenshot tool for native apps, or — worst case — asking the user to
paste a screenshot. **No renderer at all →** degrade to static critique (`modes/critique.md`) plus
the computed checks, and say explicitly: "the visual loop did not run; finish is unverified."

## The loop

1. **Render the real thing** — the app with real data/copy, not an isolated snippet.
2. **Capture** at minimum: 375px (mobile), 1280px (laptop), the declared minimum width if
   different, and BOTH themes if light+dark ships. For finish details, also capture a zoomed
   region (header, one card, one form row) — micro-craft is invisible in full-page shots.
3. **Self-critique the screenshots** with `modes/critique.md` severities + the crit vocabulary of
   `references/designer-mind.md` (entry point, grouping, rhythm, near-misses, signature). Run the
   **lineup test** on the first-viewport capture every iteration
   (`references/contemporary.md`): logo hidden, can this be picked out of ten templates? If not,
   the committed move isn't landing — intensify or swap it, don't add a third one. Write the
   findings down before touching code — otherwise you'll fix the first thing you see and miss
   the pattern.
4. **Fix causes, not symptoms** — at the token/system level when possible: a bad gap is usually a
   missing scale step, not a one-off margin; a flat hierarchy is a scale-ratio problem, not a
   font-size tweak.
5. **Re-render and diff** against the previous capture. Confirm the fix landed AND nothing else
   regressed.

## Stop condition

Stop when: zero blockers and zero majors remain, and one full pass produces only taste-level
notes — or after 4 iterations (then report what remains, honestly). Do not polish forever; do not
stop at "renders without errors" either — rendering is the floor, not the finish.

## Traps (each one observed in real sessions)

- Judging from code and calling it done — "should look right" is not evidence.
- Screenshotting only one viewport/theme and generalizing.
- Sticky/scroll chrome verified by resizing instead of actually scrolling (wheel/`scrollTo` +
  capture) — see vkm-discipline `domains/design-ui.md`.
- Fixing the symptom pixel while the token stays wrong — the bug returns on the next screen.
- Iterating on aesthetics while a blocker (contrast, keyboard) sits unfixed: severity order holds
  inside the loop too.
- Declaring an empty/error state "handled" without rendering it — force the state with real
  conditions (empty dataset, failing request) and capture it.
- Publishing the fixed page to a NEW artifact/URL while the user still holds the OLD link — they
  refresh the stale page and report "no changes" (real session: the fix landed on a fresh
  artifact, the user's bookmarked one never updated). Before publishing a document the user has
  seen before, list existing artifacts and redeploy to the SAME url; verify at the link the user
  actually holds.
