# design-bench — does the `vkm-design` skill actually improve output?

Same spirit as `evals/discipline-bench/`: measure the **before/after** of loading the skill,
with mechanical scoring, not impressions.

## Protocol (reproducible)

1. **Fixed brief** (maximum slop attractor): _"single-file landing page for 'Facturio', a SaaS
   invoicing tool for freelancers — hero, features, pricing, footer; embedded CSS, no JS, no
   network"_.
2. **Two agents, same model, same bench session:**
   - **Baseline:** brief only; forbidden from reading repo/skill files.
   - **With-skill:** brief + instruction to follow `templates/skills/vkm-design/SKILL.md` in
     full (designer-mind → direction → lineages → foundations → generate, scripts included).
3. **Mechanical scoring** of both `index.html` with the skill's own validators:
   - `slop-check.mjs` — fingerprint hits (fewer = better; 0 = target).
   - `audit-css.mjs` — declared contrast pairs PASS/FAIL, scale coherence, spacing rhythm.
4. **Judgment scoring** (documented, fallible): a named and derivable direction, hierarchy under
   the squint test, a signature recognizable without the logo.

Run artifacts land in `samples/`, numbers in `RESULTS.md`.

## Tracks

The original brief banned JS/network for scoring simplicity — that constraint also bans the
libraries the skill teaches (three.js, GSAP, Motion), capping the ceiling. Run the bench in two
tracks and say which one a run belongs to: **static track** (single file, no JS — measures
direction/tokens/craft) and **full-stack track** (real libraries allowed, embedded or bundled —
measures the immersive ceiling of `contemporary.md`).

## Honest limits

- n=1 per run and a single brief: this is a directional smoke test, not a statistical benchmark.
- Mechanical scoring only sees the text-detectable half of the fingerprint; composition-level
  slop is judged by a human/LLM with the `modes/critique.md` rubric.
- Both agents share the model; the bench measures the SKILL's delta, not the model's.
