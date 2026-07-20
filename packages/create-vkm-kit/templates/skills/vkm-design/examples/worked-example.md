# Worked example — the whole method on one brief

A compressed, real pass through generate mode. Every validator line below is actual output from
the scripts in this skill, not invented. Use this as the pattern to match; do not copy its
direction into unrelated briefs (that would be slop with extra steps).

## Contents

- Brief — the example client brief
- Step 0 — name the default, ban it
- Three directions (axes per `references/direction.md`, capsules per `references/lineages.md`)
- System before screens — tokens, generated then verified
- Build notes that follow from the direction
- One crit round (vocabulary from `references/designer-mind.md`)
- Deliver — the final handoff summary

## Brief

"Dashboard for a bike-repair shop POS: today's work orders, parts stock alerts, cash summary.
Used all day on a counter PC by mechanics with greasy hands. Feeling: _under control_."

Assumptions stated: desktop-first (1280px counter screen), light ambient workshop, keyboard +
mouse, existing stack renders HTML/CSS.

## Step 0 — name the default, ban it

> Autopilot would produce: light gray page, white rounded cards with soft shadows, indigo accent,
> Inter, a 4-KPI row with icons, a line chart. Banned for this task.

## Three directions (axes per `references/direction.md`, capsules per `references/lineages.md`)

1. **Ledger** — the day is an accounting book. Editorial-print lineage: warm paper, serif
   display + humanist text, hairline rules, table-first. Precedent: printed stock ledgers.
   Rejects: cards, shadows, icon KPIs.
2. **Instrument** — the shop floor is a cockpit. Terminal/instrument lineage: near-black field,
   green signal ramp, mono numerals, radius 0, dense columns. Precedent: trading terminals.
   Rejects: whitespace-as-luxury, decorative motion.
3. **Depot** — warehouse signage. Swiss lineage with industrial orange safety accent, Archivo
   Expanded headings, thick rules. Precedent: parts-warehouse wayfinding. Rejects: subtlety.

**Commit: Instrument.** Reason: 8-hour glanceability and status-first reading beat charm here;
mechanics scan for exceptions, an instrument panel is the native idiom for that. (Interactive
session → show the three lines and let the user pick instead.)

## System before screens — tokens, generated then verified

```text
$ node scripts/palette.mjs --hue 145 --chroma 0.14
neutral-99  oklch(0.99 0.012 145)  #f7fef7
neutral-13  oklch(0.13 0.012 145)  #050805
accent-88   oklch(0.88 0.14 145)   #9af09d
accent-56   oklch(0.56 0.14 145)   #34893c
accent-40   oklch(0.4 0.125 145)   #015814   ← chroma auto-reduced to stay in gamut
…
semantic (AA-normal guaranteed on both surface extremes):
ok/on-dark      oklch(0.56 0.14 145)   #34893c  4.59:1
warn/on-dark    oklch(0.58 0.115 85)   #99740e  4.66:1
danger/on-dark  oklch(0.59 0.14 25)    #c35651  4.57:1
…
key pairs:
PASS  text/dark-surface  19.62:1 (normal)
PASS  accent-text/dark   8.53:1 (normal)
PASS  accent-ui/dark     6.34:1 (ui)
```

```text
$ node scripts/scale.mjs --gen 14,1.2,5
14, 16.8, 20.16, 24.19, 29.03, 34.84
```

Token excerpt (CSS, everything below derives from the direction — dense ratio 1.2, radius 0,
mono numerals):

```css
:root {
  --surface: oklch(0.13 0.012 145);
  --surface-raised: oklch(0.18 0.012 145);
  --text: oklch(0.87 0.02 145);
  --signal-ok: oklch(0.56 0.14 145); /* palette.mjs ok/on-dark — 4.59:1 guaranteed */
  --signal-warn: oklch(0.58 0.115 85);
  --signal-stop: oklch(0.59 0.14 25);
  --font-data: "JetBrains Mono", monospace; /* version verified online at use-time */
  --step-0: 14px;
  --step-1: 16.8px;
  --step-3: 24.19px;
  --space: 4px;
  --radius: 0;
}
```

Spot-check the pairs the UI actually uses (real output):

```text
$ node scripts/contrast.mjs "oklch(0.85 0.14 145)" "oklch(0.13 0.012 145)"
PASS  oklch(0.85 0.14 145) on oklch(0.13 0.012 145)  13.37:1  (normal: AA pass >= 4.5:1, AAA pass)
$ node scripts/contrast.mjs "oklch(0.56 0.14 145)" "oklch(0.13 0.012 145)" --ui
PASS  oklch(0.56 0.14 145) on oklch(0.13 0.012 145)  4.59:1  (ui: AA pass >= 3:1, AAA n/a)
```

## Build notes that follow from the direction

Work orders = the primary readout: one dense table, `tabular-nums`, status as symbol + color
(`● OK / ▲ WAIT / ■ STOP` — never hue alone). Stock alerts = exception list, not a chart. Cash =
one large mono figure, not a KPI card row. Empty state: "No open orders — last closed 17:42".
Error state: inline row, input preserved. All states rendered, not assumed.

## One crit round (vocabulary from `references/designer-mind.md`)

- **[major] Entry point wrong:** the cash figure (largest element) wins the squint test, but the
  job says exceptions first → promote the STOP/WAIT rows (weight + signal), demote cash to
  `--step-1`. One strong dimension, not three.
- **[major] Near-miss spacing:** table row padding 6px vs card padding 8px — no 6 on the scale →
  both to 8 (`--space`×2). Cause fixed at the token, not the pixel.
- **[minor] Fake emphasis:** synthetic bold on JetBrains Mono 500 → load the real 700.

## Deliver

> Direction: **Instrument** — the shop floor is a cockpit (terminal/instrument lineage,
> precedent: trading terminals). Verified: 6/6 key pairs AA (min 4.59:1), scale coherent
> (ratio 1.2, base 14). Assumption pending: counter screen is 1280px — re-check the table at
> the real width. Visual loop: ran 1 round, 3 findings fixed above.
