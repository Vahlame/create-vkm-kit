# Direction — the anti-generic engine

Generic output is not a style problem; it is a _process_ problem: the model emits its most probable
design. This protocol makes the default visible, bans it, and forces a deliberate choice. Run it
BEFORE any tokens, CSS, or components exist. It costs minutes and is the single highest-leverage
step in this skill.

## Step 0 — name your default, then ban it

Write one sentence describing exactly what you would produce on autopilot for this brief ("dark
hero, indigo gradient, Inter, three feature cards…"). That description is now banned for this task.
If you can't articulate your default, you can't avoid it.

## The slop fingerprint — banned as defaults

**Nothing in this skill is forbidden — defaults are priced.** Every item below stays fully
available the moment you write one line justifying it from the brief (not from habit). The list
exists because a model's unpriced default is statistically identical across a million outputs;
the price tag is what forces a decision to happen at all. The text-detectable half is
mechanized: `node scripts/slop-check.mjs <files>` scans any HTML/CSS for the markers below and
exits non-zero on hits — run it on your own output before delivering (composition-level slop,
like the centered hero or the 3-card grid, is judged by the critique rubric instead).

But prohibition only protects the floor — it cannot generate variety (observed: with indigo
priced, independent runs converged on the model's SECOND default, then its third). Variety
comes from **sampling, not avoidance**: build the three directions from the sampler below.

## The variety sampler (generative, not restrictive)

Before writing the three directions, deal yourself a spread — don't "think of" options (that
replays your priors), CONSTRUCT them:

1. **Hues:** pick three hues at least 90° apart on the OKLCH wheel, none within 30° of your
   last run's hue for this product (any pick is legal — including a priced one, with its line).
2. **Lineages:** three different capsules from `lineages.md`, at most one you used last time.
3. **Currents:** three different moves from `contemporary.md`.
4. Cross them into three directions (hue × lineage × current each), then apply the protocol
   below. The brief kills combinations that don't fit its job — what survives is both varied
   AND functional, which is the actual goal; a beautiful page whose controls don't work fails
   `modes/critique.md` at Blocker level before taste is even discussed.

**Web/app slop:**

- Indigo/violet/purple gradients, especially on dark navy (`#6366f1`, `#8b5cf6` and neighbors).
- Inter, Poppins, or an anonymous geometric sans as the answer to every typography question.
- Glassmorphism cards (blur + transparency + 1px light border) as texture for everything.
- Emoji as icons. Ever. Use a real icon set.
- The centered hero: pill badge ("✨ Now with AI"), gradient headline, two buttons, floating
  screenshot with glow.
- Three-column grid of rounded cards, each icon + title + two lines of blurb.
- Uniform `border-radius` ≥ 12px on every element, `0 4px 6px rgba(0,0,0,0.1)` on everything.
- Purple-to-pink CTA buttons; gradient text on headlines.
- "Modern, clean, minimalist" as the entire design rationale — these words are banned in
  rationales; name a lineage instead (see `designer-mind.md`).
- Bento grids used because they're trending, not because content has bento structure.
- The default shadcn/ui theme shipped as-is — it is a _starting point_; unthemed shadcn is the
  new Bootstrap-2013.

**Dataviz slop:** rainbow categorical palettes; gradient-filled area charts with glow; 3D anything;
donut charts for more than 3 categories; legends when direct labels fit.

**Brand slop:** generic geometric-sans wordmark + abstract swoosh/spark mark; palettes lifted from
the 2021 fintech gradient era.

## The axes — where directions come from

A direction is a coherent position across these axes. Vary at least three axes away from your
banned default; keep the rest quiet. Every lineage in the first row has an **executable capsule**
(real typefaces, OKLCH seeds, shape/motion numbers) in [`lineages.md`](lineages.md) — name the
lineage there, build from its capsule. Then cross it with **one contemporary current** from
[`contemporary.md`](contemporary.md) (the 1–2 full-intensity moves of the boldness budget) — the
lineage gives coherence, the current gives the memorable move; the cross is usually the
signature. A direction with zero moves produces a correct template, which is its own failure.

| Axis                   | The range                                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Lineage/era**        | Swiss grid · editorial print · Bauhaus geometry · brutalist · humanist minimal · art deco · terminal/instrument · retro-digital (choose ONE)       |
| **Density**            | airy gallery ←→ dense instrument panel                                                                                                             |
| **Color strategy**     | monochrome + one accent · duotone · warm paper neutrals · high-chroma on neutral field · dark instrument + signal colors                           |
| **Type pairing**       | grotesk + mono · serif display + humanist sans · single variable family with range · slab + geometric — a pairing with tension, not two lookalikes |
| **Shape language**     | sharp/zero-radius · soft/rounded · mixed-with-rule (e.g., outer sharp, inner soft)                                                                 |
| **Texture**            | flat · hairline rules · grain/noise · duotone imagery · line-work illustration · depth/material                                                    |
| **Motion personality** | none/instant · mechanical/precise · springy/playful · cinematic/slow (see `foundations.md` for numbers)                                            |
| **Layout topology**    | strict modular grid · asymmetric editorial · split-pane · single column with rhythm · dense table-first                                            |

## The protocol

1. Generate **three directions**. Each gets: a name, a one-sentence concept (the organizing idea),
   its position on the axes it moves, one real-world precedent, and one line on what it _rejects_.
   **Diversity is mandatory, twice over:** the three must live in three different color worlds —
   one light-field, one dark-field, one chromatic (a saturated field or dopamine accents) — AND
   in at least two different lineages. Three tasteful variations of the same world is the
   convergence failure this step exists to prevent (observed in practice: a model re-offered the
   same paper-editorial direction across independent runs and called it three options).
2. **Score against the brief** — audience fit, job fit (density/legibility needs), brand adjacency,
   feasibility in the target stack. One winner. When working interactively, show the three options
   in 6 lines and let the user pick; when autonomous, pick, state the choice and the reason.
   **Rejection memory:** if the user (or a previous run) already rejected a direction for this
   product, that direction's whole family — its lineage AND its color world — is banned from the
   retry. A re-skin of a rejected direction is not a new direction; move to a different world.
3. **Commit and derive.** After commit, every concrete choice (palette, type, radii, motion) must
   be derivable from the direction. A choice you can't derive is noise — cut it. This coherence
   rule is what makes the result look designed rather than assembled.
4. **Record it.** One line in the deliverable ("Direction: _name_ — concept"). If the vault is
   wired, store it as a `[decision]` observation on the project note.

## The innovation guardrail

Distinctive must never mean unusable:

- **Spend the novelty budget in 1–2 places** (type, color, layout, texture OR motion — not all
  five). The rest stays disciplined.
- **Never innovate on interaction conventions** — where navigation lives, how forms submit, what a
  button looks like enough-to-be-a-button. Identity is the playground; usability is not.
- Accessibility gates (contrast, focus, states — `domains/design-ui.md` of vkm-discipline, or the
  summary in `foundations.md`) apply to every direction equally. A direction that can't pass them
  is not a direction; it's a mistake.
