# Mode: generate — design something new

From brief to built artifact. The order is the method — skipping ahead to code is how slop
happens.

## 1. Interrogate the brief

Run the designer-mind questions (`references/designer-mind.md` § process): audience, job,
context of use, one-word feeling, brand constraints, target stack/medium. Interactive user →
ask ONLY the questions whose answers change the design; autonomous → state assumptions
explicitly and proceed.

## 2. Recall (vault opt-in)

If the obsidian-memory-hybrid MCP responds: one `assemble_context` call with the project name —
existing palette, type choices, committed directions, and design decisions already made. An
existing direction wins over inventing a new one unless the user asked for a redesign.

## 3. Live inspiration (gate)

Read `references/inspiration.md` (this skill). Show the three-URL dossier for THIS brief
before any direction exists. Search the job, not "best websites 2026". Each line names a
stolen technique, a spacing attitude, and a reject. No dossier and no explicit `NO LIVE
LOOKUP` = you are about to restyle this skill's menu — stop.

The 1–2 visual technologies you will actually implement come from those URLs (`craft-tech.md`
is a decoder of what you saw, not a picker). Look up the current how-to online at use-time.

## 4. Direction

Run `references/direction.md` in full: name the default, ban it, three directions across the
axes, commit one with a reason. Every axis you keep must cite a dossier line. This step
produces the sentence every later choice derives from. A direction without a move stolen
from the live pages ships a correct template, and the lineup test will fail it at verify
time anyway. Do **not** order a move from `contemporary.md` to fill the slot.

## 5. System before screens

Build the token layer FIRST, as real code (CSS custom properties / `@theme` / platform theme
file):

- Type: family (real, loaded), scale ratio + derived sizes, line heights, tracking corrections.
- Space: base unit + scale.
- Color: neutral ramp + accent ramp + semantics, in OKLCH, per theme if light+dark ships.
- Shape: the ≤ 3 radius tokens; the depth system (shadows OR hairlines OR surface shifts).
- Motion: duration + easing tokens per pattern.

Any bespoke figurative asset (a drawn species, product, landmark, mascot) is planned HERE, not
patched later: fetch its real reference and list the distinguishing features now
(`references/illustration.md`), so the build draws from the reference, not from memory.

Generate, don't guess: `node scripts/palette.mjs --hue <brand-hue>` emits gamut-aware neutral +
accent ramps with the key contrast pairs pre-computed; `node scripts/scale.mjs --gen base,ratio,steps`
emits the type scale. Then verify the pairs the UI actually uses:
`node scripts/contrast.mjs --pairs <tokens>` (hex or `oklch()` both work). Fix the token, not the
component. One full pass of this step, with real output, is in
the skill's `examples/worked-example.md` (linked from SKILL.md).

## 6. Build

- Real libraries per `references/libraries.md` — versions verified online at this moment.
- The 1–2 visual technologies named from the dossier are implemented here (looked up live),
  not approximated with "a bit of blur and a bigger heading".
- Semantic structure first (native controls, landmarks, heading order); custom controls only with
  role + keyboard + focus handling.
- Zero magic values in components — everything references the token layer. A one-off value is
  either a bug or a missing token.
- Spacing from the dossier's attitude: viewport gutter (16px compact / 24px medium+ unless the
  direction earns a full-bleed crop), card/section inner padding ≥ 8px, group gap ≈ 2× in-group
  gap. Same component type shares padding, radius, type size.
- Design ALL states as you build: empty / error / loading per screen; hover / focus / disabled /
  busy per control (the vkm-discipline `domains/design-ui.md` gate list).
- Write plausible real copy — lorem ipsum hides hierarchy and length bugs and produces layouts
  that break on contact with reality.

## 7. Verify

- `node scripts/slop-check.mjs <your output files>` — zero unjustified fingerprint hits; every
  surviving hit carries its one-line justification in the deliverable.
- Accessibility gate: computed contrast per theme, keyboard-only walk, 200% zoom, minimum width.
- Renderer available → run `modes/visual-loop.md` (this is the default finish, not an extra).
  On web that loop **runs `vkm-ui-judge` `scripts/ui-audit.mjs`** and you fix layout findings
  (`edge-flush`, `tight-padding`, `overlap`, `component-drift`, `cramped-stack`) from
  `report.json` / `geometry.json`, not from taste.
- No renderer → static self-crit against `modes/critique.md` + the crit vocabulary; say the
  visual loop did not run.

## 8. Deliver

State: the dossier URLs · the direction and why · which live technique you implemented · what
was verified (with numbers, including layout) · what remains assumption. If the vault is wired,
record the direction as a `[decision]` observation.
