# Mode: handoff — specs another dev or agent implements

The deliverable is a spec precise enough that a different implementer (human or LLM, any stack)
reproduces the design without asking questions. Everything lives in text/JSON — an image-only
spec is not consumable by an agent.

## 1. Tokens — the machine-readable core

Emit design tokens in the W3C DTCG format (first stable spec: 2025.10 — verify current revision
online; `$value`/`$type` structure, groups, aliases). It is the interop format tools
(Style Dictionary, Figma, Penpot) and platforms translate from:

```json
{
  "color": {
    "surface": { "$type": "color", "$value": "oklch(0.98 0.005 95)" },
    "accent": { "$type": "color", "$value": "oklch(0.55 0.15 250)" }
  },
  "space": { "2": { "$type": "dimension", "$value": "8px" } },
  "type": {
    "scale-ratio": { "$type": "number", "$value": 1.25 }
  }
}
```

Target stack known → also emit the translated form (CSS custom properties / Tailwind `@theme` /
XAML `ResourceDictionary` / Flutter `ThemeData`), derived from the tokens, never parallel-invented.

## 2. The human spec

- **Direction statement:** name, one-sentence concept, lineage, precedent — the implementer's
  tiebreaker for every decision the spec doesn't cover.
- **Type ramp table:** role → family/weight/size/line-height/tracking (real values, per
  breakpoint if fluid).
- **Spacing scale** and the grouping rule (within-group vs between-group gaps).
- **Color pairs WITH computed contrast ratios** — every text/surface and control/surface pair,
  per theme, marked pass/fail against its gate. Run `scripts/contrast.mjs --pairs` and paste the
  table; a handoff without ratios hands off the bugs too.
- **Component states matrix:** per component × rest/hover/focus/active/disabled/busy + the three
  screen states (empty/error/loading) — cell = which tokens change.
- **Motion spec:** pattern → duration token, easing token, what property animates, reduced-motion
  behavior.
- **Assets:** exact font families with source and license note; the ONE icon set with size/stroke
  rules; any SVG marks as final vector code.

## 3. Redlines (key screens)

For 1–3 representative screens, annotate measurements in text: region → padding, gaps, column
widths, alignment edges, which token each value is. Format: a nested list mirroring the layout
tree — terser and more diffable than an image.

## 4. Implementer's acceptance checklist

Binary checks the implementer runs at the end — contrast pairs re-computed in the built artifact,
keyboard walk, states rendered, 200% zoom, minimum width, tokens-only styling (no magic values).
Copy the relevant gates from `references/foundations.md` § accessibility, plus any
direction-specific check ("all radii 0 — any rounded corner is a bug").

## Rules

- No pixel value without a token name; no token without a use.
- Ranges forbidden where a decision was made ("16–24px" is a question, not a spec).
- If something is genuinely flexible, say so explicitly and give the constraint ("any width
  ≥ 320px; content max 72ch").
- Version the spec: date + direction name; supersedes-note when replacing an earlier handoff.
