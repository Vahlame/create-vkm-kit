---
name: vkm-ui-judge
description: Measured visual judgment for web UIs. Run the bundled audit on the LIVE page (3 viewports x light AND dark, computed WCAG contrast, invisible text, horizontal overflow, small tap targets), then fix by severity with before/after proof. NOT design-from-scratch (vkm-design) or non-web UIs.
user-invocable: true
---

# vkm-ui-judge — evidence before opinion

Installed by create-vkm-kit (vkm-kit). One job: when the user says "judge this UI and fix
what's wrong" (bad contrast, text that disappears in dark mode, broken responsive layout,
misplaced controls), **measure the rendered page instead of staring at it**. A model that
"visually judges" from source code is slow, token-hungry and wrong exactly where users
notice: computed styles, theme switches, and breakpoints it never rendered.

Division of labor with `/vkm-design`: that skill designs and statically audits _source_
(tokens, type scale, spacing). This skill judges the _rendered result_ and drives the fix
loop. Use both when redesigning; use this one alone for "why does it look broken".

## The loop

**1. Get the page running.** Dev server, built file, or static HTML — whatever renders. If
nothing renders and nothing can, fall back to the static path (below) and say so.

**2. Run the audit — this replaces the "visual thinking" phase entirely:**

```bash
node ~/.claude/skills/vkm-ui-judge/scripts/ui-audit.mjs <url-or-file.html> --out ./ui-audit
```

It renders the page at 360×740, 768×1024 and 1440×900, in **both** `prefers-color-scheme`
light and dark, and emits `ui-audit/report.json` plus one full-page screenshot per context.
Deterministic checks, deduplicated across contexts:

| check           | meaning                                                                  | severity |
| --------------- | ------------------------------------------------------------------------ | -------- |
| `invisible`     | text within 1.5:1 of its background — unreadable (the dark-mode classic) | error    |
| `contrast`      | text below WCAG AA (4.5:1 normal, 3:1 large)                             | error    |
| `overflow-x`    | horizontal scroll / elements past the right edge at that viewport        | error    |
| `viewport-meta` | no `<meta name="viewport">` — mobile rendering is a lottery              | error    |
| `tap-target`    | interactive element under 44×44 px at mobile width                       | warn     |
| `img-overflow`  | image rendered wider than the viewport                                   | warn     |

Requires Playwright (`playwright` or `playwright-core` + a Chromium; honors
`PLAYWRIGHT_BROWSERS_PATH`). If neither resolves, the script exits with code 3 and says
what to install — do not fake its output.

**3. Read `report.json` — not the page, not your memory.** Quote the summary counts and the
top findings (selector + values). Do NOT paste the whole JSON into the conversation; it is
on disk. Open the screenshots for anything measurement can't see (alignment, spacing,
visual hierarchy) — that is the one place human-style judgment belongs, and it happens on
pixels, not on imagined renders.

**4. Fix in severity order, root cause first.** `invisible`/`contrast` in dark mode almost
always means a hardcoded color where a theme token belongs — fix the token/variable, not
the one element. `overflow-x` at 360px means a fixed width, an unwrapped flex row, or an
unconstrained image — prefer `max-width: 100%`, wrapping, and intrinsic sizing over
per-element patches. One cause often clears many findings; fix causes, then re-measure.

**5. Prove it.** Re-run the exact same command. Done means: error-count 0 (or each survivor
justified in one line), and the before/after counts stated to the user. A fix without the
re-run is an opinion.

## Static fallback (no browser available)

Weaker but honest — say which path you used:

- `/vkm-design`'s `scripts/audit-css.mjs` + `contrast.mjs` audit declared color pairs, type
  scale and spacing from the source.
- Grep for the classic causes: hardcoded hex colors outside the token file, `width:` with
  fixed px on containers, missing `@media`, missing `<meta name="viewport">`, `color`
  without a paired dark-scheme value.
- State plainly that rendered-page checks (computed contrast, real overflow) were NOT run.

## Token discipline

The audit exists so the model does not spend thinking-tokens simulating a renderer. Do not
narrate the checks; run them. Do not paste raw JSON or describe every screenshot; cite
counts, the decisive findings, and the diff after the fix. The deliverable is a fixed UI
plus a two-line before/after, not an essay about design.
