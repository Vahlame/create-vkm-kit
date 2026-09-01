# ADR-0091: Flash-tier skills and host-agnostic rules (making DeepSeek V4 Flash beat stock)

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** maintainer

## Context

ADR-0088 made DeepSeek "first-class" at the **hook** level: the effort gate recognizes
`deepseek-*` and the SessionStart hook injects a DeepSeek block. Two gaps remained:

1. **The hook surfaces never reach a hook-less host.** DSH (DeepSeek Harness), opencode and
   similar hosts run no `settings.json`/`hooks.json` — so the DeepSeek tuning, the
   vault-context injection and the effort gate never fire there. What DOES reach the model
   is the always-on `AGENTS.md` rules block and the installed skills — and both were
   written for a strong, self-directing model (Claude Sonnet-class).
2. **The always-on and skill surfaces were Claude-shaped and process-heavy.** The rules
   block named Claude-only machinery (`ToolSearch`, `/vkm-*` slash commands, native
   auto-memory paths); skills led with meta-cognition ("read the real intent", "calibrate
   the dial", tier self-selection) and progressive disclosure chains that a flash-class
   model under-follows — it skims the SKILL.md and improvises, which is indistinguishable
   from a generic skill. And the discipline evidence gate was `bash`-only, which does not
   run on Windows hosts without bash.

Measured baseline on the kit's own hidden-test bench (discipline-bench, deepseek-v4-flash,
n=12 per arm): **stock 78.3 vs with-skill 90.6, Δ +12.3 (95% CI [1.1, 24.5] excludes 0,
cliffs 0.40)** — the doctrine text is real leverage for flash, but only when it is
followed. The redesign must keep that edge and make it the default. **Measured outcome of
the redesign:** the first core (summary-only) **regressed** (87.8, Δ +9.6, inconclusive) —
it told flash to read less and dropped the edge-case mandate. Iterating the core to carry
the edge-case + normalization rules inline recovered and exceeded the baseline:
**92.5 vs 78.3, Δ +14.3 (95% CI [2.5, 26.6] excludes 0, cliffs 0.47)**. The lesson is a
decision input, not an accident: for flash-class models the high-value rules must sit in
the visible core, never only in a reference file.

## Decision

1. **Every skill leads with a "PROCEDURE — flash" core** — ≤15 concrete ordered steps with
   exact commands, output formats and one inline example, marked "read nothing else unless a
   step says so". The existing tiers/tables/rigor stay below as detail ("full mode"), and
   each core carries a one-line DeepSeek-Flash calibration ("one pass, no narrated
   reasoning; verify with the skill's scripts, never by inspection"). Routing signal first,
   process second.
2. **Skill frontmatter descriptions become decision rules** — trigger → action → hard
   exclusions — so catalog routing is mechanical instead of "use when doing almost
   anything". No skill is renamed or added: the drift gates (README, hero.svg, parity docs)
   stay green.
3. **`evidence-gates.mjs` (Node ≥ 18, zero deps) becomes the primary discipline runner**;
   the `.sh` remains the POSIX fallback. Same detection, same PASS/FAIL contract, exit 0/1/2,
   with Windows `npm.cmd` handling. Covered by a new package test.
4. **The rules block becomes host-agnostic and flash-aware.** Claude-only phrasing
   (`ToolSearch`, `/vkm-*` commands, unconditional native-auto-memory claims) is replaced
   with host-conditional wording; the `doctrine` level gains a "flash-class" clause. The
   per-level budgets are **net-negative or neutral** (memory level actually shrinks), so the
   always-on cost does not grow.
5. **The DeepSeek docs state the hook-less-host reality and the measured result.** DSH
   currently exposes no MCP service — the `vault_*` tools are absent and the memory protocol
   honestly degrades; skills + rules still work standalone. A `vkm-implementer.deepseek.md`
   subagent variant ships as the flash-flavored template.

## Consequences

- A flash-class model reading any SKILL.md gets the executable core first and the
  meta-cognition second; a strong model still has the full depth below.
- The bench becomes the arbiter: the same discipline-bench run after the redesign must
  show Δ(redesigned−stock) ≥ Δ(current−stock) on deepseek-v4-flash, or the cores iterate
  before release.
- Always-on token cost stays flat (rules budgets are build-gated and measured).
- `--skills-dir` remains the wiring path for hosts the kit has no `--ide` for; hook-level
  tuning (effort gate, SessionStart block) is unchanged for the four wired hosts.

## Alternatives considered

- **A separate "flash" skill set:** rejected — two parallel catalogs double the routing
  ambiguity for the exact model that routes worst; the core/full split achieves the same
  inside one file.
- **Cutting the skills down to the cores:** rejected — the bench subject reads the whole
  body, and the depth below the core is where the +12.3 comes from; removing it would
  remove the measured edge.
- **Wiring MCP into DSH:** rejected — the harness exposes no MCP service; documented as a
  hard degradation instead of a claim.

## Links

- ADR-0088 (DeepSeek first-class at hook level) — this ADR extends it to the always-on
  surfaces.
- ADR-0067 (rules block levels) / ADR-0036 (budgets + drift gate) — the rules edits
  respect both.
- ADR-0061 (skill structure gate) — the cores stay within the 500-line SKILL.md limit.
- ADR-0064/0071 (bench arms) — the measured Δ is produced by the existing harness.
