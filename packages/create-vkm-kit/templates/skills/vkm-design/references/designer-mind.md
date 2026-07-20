# The designer's mind — how a trained professional thinks

A model left on autopilot produces the statistical average of every interface it has seen — which
is exactly what "generic" means. A trained designer's head runs different machinery: an education
in perception, a process that front-loads thinking, and a critique loop with precise vocabulary.
This file operationalizes that machinery. Run it explicitly; do not trust the autopilot.

## Contents

- What the education installed
- The process — run these steps in order
- The crit vocabulary — so you can SEE
- Taste heuristics that separate trained from generated
- Fake ten thousand hours — the pre-flight

## What the education installed

The internalized curriculum of a top design program, distilled to what changes your output:

1. **Design is decision-making under intent, not decoration.** Every choice (type, color, spacing,
   motion) either serves the brief's job or is noise. A professional can answer "why?" for every
   pixel; if you can't justify a choice from the brief or the direction, remove it.
2. **Perception precedes reading — Gestalt.** Users group before they read: things close together
   belong together (proximity), things that look alike act alike (similarity), aligned things form
   units (continuity), enclosed things are a group (common region), and the eye separates figure
   from ground. Most layout bugs are Gestalt violations: a label closer to the wrong field, two
   unrelated cards that look identical, an almost-aligned edge.
3. **Hierarchy is the first deliverable.** Each view has ONE primary element, a deliberate second,
   and a quiet rest. The squint test: blur your eyes (or downscale the screenshot) — what survives
   is your hierarchy. If everything survives, nothing is hierarchical.
4. **Typography is the core skill.** Interfaces are mostly text; type choice, scale, measure and
   rhythm do more for perceived quality than any illustration. A designer sets type first and
   decorates never.
5. **History is a toolbox of coherent languages.** Swiss/International style (grids, objective
   sans, asymmetric balance), Bauhaus (form from function, geometry), editorial/print (strong type
   contrast, columns, pull-quotes), brutalism (raw, honest structure), humanist minimalism (warm
   neutrals, quiet type, generous space), art deco (geometry with ornament), terminal/instrument
   design (density, mono, function-first). Each is a _system of rules_, not a skin — borrowing one
   gives you coherence for free. Naming your lineage is how professionals innovate without
   producing arbitrary weirdness.
6. **Craft lives in the last 2%.** Optical alignment over metric, punctuation and widows fixed,
   consistent corner radii, one light source for shadows, states designed (not defaulted). Details
   are not polish added at the end; they are the difference between designed and generated.

## The process — run these steps in order

A senior designer never starts by drawing. The sequence:

1. **Interrogate the brief.** Who is this for, what job does it do for them, where is it used
   (glanced at on a phone / lived in for 8 hours), what should the user _feel_ in one word, what
   brand constraints exist? Unknown answers get explicit assumptions, stated in the output.
2. **Gather precedents before sketching.** Name 2–3 real-world references (products, print, eras)
   and say in one line _why each works_. If you cannot name a precedent, you are pattern-matching
   generic training data — stop and find the lineage first.
3. **Set constraints deliberately.** One type pairing, one accent, one spacing unit, one shape
   language. Creativity comes from constraints; slop comes from unlimited defaults.
4. **Name the organizing concept in one sentence.** "The dashboard is an instrument panel." "The
   landing page is a magazine cover." "The form is a conversation." Every later decision must be
   derivable from this sentence.
5. **Diverge cheaply, then commit.** Three directions on paper (see `direction.md`), pick one with
   a reason, never blend all three into mush.
6. **Craft in passes, not all at once.** Hierarchy pass → spacing/rhythm pass → color pass →
   micro-detail pass (optical alignment, states, motion). One concern per pass; re-render between
   passes when a renderer exists.
7. **Crit, then kill your darlings.** Self-critique with the vocabulary below; delete the flourish
   that doesn't serve the concept, even if it took effort.

## The crit vocabulary — so you can SEE

Run these questions against the actual render (or the code if no renderer), in this order:

- **Entry point:** where does the eye land first? Second? Third? Is that the order the job needs?
- **Grouping:** does proximity match meaning everywhere? Is any label/control closer to the wrong
  neighbor?
- **Rhythm:** do spacing values repeat from a scale, or is every gap bespoke? Measure, don't feel.
- **Near-misses:** anything _almost_ aligned, _almost_ the same size, _almost_ the same color?
  Near-misses read as mistakes — make them equal or make them clearly different.
- **Contrast economy:** is emphasis achieved by ONE strong dimension (size OR weight OR color) or
  by three weak ones fighting?
- **Consistency vs monotony:** do same things look the same (buttons, cards, radii)? Do different
  things look different enough?
- **Texture and temperature:** squint — is the page an even gray soup, or does it have deliberate
  areas of density and rest? Do the neutrals lean consistently warm or cool, or drift?
- **Reduction:** what can be removed with zero loss? Remove it.
- **Signature:** with the logo hidden, is this distinguishable from a template? What single
  element would a user remember?

## Taste heuristics that separate trained from generated

- Whitespace is a material you spend deliberately, not leftover margin.
- One typeface family used with range (weights, optical sizes, width axes) beats three families
  used timidly.
- Neutrals are never pure gray — cast them slightly toward the brand hue (see `foundations.md`).
- Strong hierarchy + quiet palette outperforms loud palette + flat hierarchy, always.
- Platform idiom first, invention second: innovate in identity (type, color, texture, motion
  personality), keep interaction patterns where users expect them.
- If a choice needs a paragraph to defend, it's probably wrong; if you can't defend it in a
  sentence, it's definitely wrong.

## Fake ten thousand hours — the pre-flight

Before emitting any design artifact, write three sentences (in your working notes or the reply):

1. **Lineage:** which design language/era does this belong to?
2. **Precedent:** which real artifact is the closest ancestor, and why does it work?
3. **Feeling:** the single word the viewer must feel.

If any of the three is blank or generic ("modern", "clean"), you are not ready to design — go back
to step 1 of the process.
