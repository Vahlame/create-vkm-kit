---
name: vkm-ui-judge
description: Measured visual judgment for ANY GUI. Web: bundled live-page audit (viewports x light/dark, computed WCAG contrast, overflow, tap targets). Flutter: generated a11y guideline tests. Other native UIs (Qt, .NET, Python, Java): screenshot-evidence loop. Fix by severity, before/after proof.
user-invocable: true
---

# vkm-ui-judge — evidence before opinion, on any GUI

Installed by create-vkm-kit (vkm-kit). One job: when the user says "judge this UI and fix
what's wrong" (bad contrast, text that disappears in dark mode, broken responsive layout,
misplaced controls), **measure the rendered UI instead of staring at the source**. A model
that "visually judges" from code is slow, token-hungry and wrong exactly where users
notice: computed styles, theme switches, and window sizes it never rendered. That holds
for a React page, a Flutter app, a Qt dialog and a WinForms window alike — only the
measuring instrument changes.

Division of labor with `/vkm-design`: that skill designs and statically audits _source_
(tokens, type scale, spacing). This skill judges the _rendered result_ and drives the fix
loop. Use both when redesigning; use this one alone for "why does it look broken".

## Route first: what renders this UI?

| the UI is…                                                                                                                       | route                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| anything a browser renders: HTML/CSS, React/Vue/Angular, Electron, Flutter Web, Blazor, Python web apps (Django/Flask/Streamlit) | **A — bundled live-page audit** (below)                                  |
| Flutter (mobile/desktop native)                                                                                                  | **B — generated `flutter_test` a11y gates**: `references/native-guis.md` |
| any other native GUI: Qt/C++, GTK, WinForms/WPF/MAUI (.NET/C#), Tkinter/PySide, Java Swing/Compose                               | **C — screenshot-evidence loop**: `references/native-guis.md`            |

All three routes are the same discipline — **measure → fix by severity → re-measure** —
with the strongest instrument the stack allows. Route A is fully automated; B uses the
framework's own deterministic gates; C is real screenshots + platform scanners, judged on
pixels, never on imagined renders. If a desktop app has a web build (Electron, Flutter
Web), prefer running THAT through Route A for the automated pass, then spot-check native.

## Route A — the bundled live-page audit

**1. Get the page running.** Dev server, built file, or static HTML — whatever renders.

**2. Run the audit — this replaces the "visual thinking" phase entirely:**

```bash
node scripts/ui-audit.mjs <url-or-file.html> --out ./ui-audit   # from this skill's directory
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

## Routes B and C — native GUIs

Read `references/native-guis.md` (this folder) when the routing table sends you there. In
short: Flutter gets a generated test file running the framework's own
`textContrastGuideline`/tap-target gates across sizes × light/dark; other toolkits get
real screenshots at ≥2 window sizes × OS light/dark plus a platform accessibility scanner
where one exists (axe-windows, Accessibility Inspector), judged against the same defect
classes. The root-cause rule carries over unchanged: a theme-flip invisibility is a
hardcoded color where a theme token belongs, whatever the framework calls its tokens.

## Static fallback (nothing renders at all)

Weaker but honest — say which path you used:

- Web: `/vkm-design`'s `scripts/audit-css.mjs` + `contrast.mjs` audit declared color
  pairs; grep for hardcoded colors, fixed px widths, missing `@media`/viewport meta.
- Native: grep for hardcoded colors outside the theme/token layer, fixed pixel sizes on
  containers, and missing dark-theme variants of custom styles.
- State plainly that rendered checks (computed contrast, real overflow) were NOT run.

## Token discipline

The instruments exist so the model does not spend thinking-tokens simulating a renderer.
Do not narrate the checks; run them. Do not paste raw JSON or describe every screenshot;
cite counts, the decisive findings, and the diff after the fix. The deliverable is a fixed
UI plus a two-line before/after, not an essay about design.
