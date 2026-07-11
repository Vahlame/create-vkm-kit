# ADR-0049: discipline doctrine in three channels — output style, one managed-block bullet, on-demand skill

- **Status:** Accepted
- **Date:** 2026-07-10
- **Deciders:** maintainer

## Context

The 4.0.0 train distills an execution doctrine — dense minimal code, terse output, vault-first context via one `assemble_context` call, nothing "done" without executed evidence — and has to place it in Claude Code's context economy, where every placement has a different cost profile: always-in-context text is paid **every turn by every session** (the ADR-0035/0036 budget discipline exists precisely because this compounds), while on-demand text is nearly free until invoked but shapes nothing unless invoked. One clarification from the maintainer is load-bearing enough to record as the doctrine's core semantic: **minimal code means the same functionality and quality in fewer lines — density — NEVER a reduced scope of the deliverable.** An agent that hears "minimal" and trims requirements is worse than one that never heard the doctrine.

## Decision

Split the doctrine across **three channels by cost-to-influence ratio**:

1. **`vkm-terse` output style** (installed and activated by the token-saver module, ADR-0043) — the always-on system-prompt layer carrying the _output_ half (dense, direct, no filler), with `keep-coding-instructions: true` so Claude Code's own coding behavior survives underneath. An output style is the sanctioned mechanism for turn-shaping instructions and costs its budget once, at the system-prompt layer.
2. **ONE bullet in the managed rules block** — "Executable discipline (vkm)" (ES/EN): use `assemble_context` for project context before chaining searches; invoke `/vkm-discipline` on non-trivial code; density at full quality (fewer lines, SAME scope); executed evidence before "done". It fits **within the existing block budgets** (the ADR-0036/0039 gates pass without a raise) because it is a pointer, not the doctrine.
3. **The full doctrine in the `/vkm-discipline` skill**, loaded only on invoke (progressive disclosure: always-in-context cost is one frontmatter description line). Alongside it ship the `/vkm-spec` skill (idea → context-grounded spec in-session, explicitly **no local LLM in the synchronous path** — ADR-0047) and the `vkm-implementer` subagent template. All are hash-tracked assets (`asset-install.mjs`): `--skills`/`--agents` toggles, user-modified files survive uninstall, and a lint gate keeps every skill description ≤300 chars.

## Alternatives considered

- **Skill-only (no style, no bullet):** rejected — a skill shapes nothing until invoked, and the doctrine's terseness/density half must shape **every** turn; relying on the user to invoke discipline is how doctrine becomes decoration.
- **Managed-block-only (full doctrine in CLAUDE.md):** rejected — ~2K chars paid every turn by every wired agent, against budget gates built to prevent exactly this (ADR-0035/0036); the block's job is pointers and contracts, not essays.
- **A hook enforcing terseness/density mechanically:** rejected — unlike memory-write redirection (ADR-0030), "is this code dense at full scope" is not machine-checkable; a hook would enforce a proxy and punish legitimate verbosity.

## Consequences

- Positive: every-turn influence at near-zero marginal context cost (style rides the system prompt, the bullet fits existing budgets, skills pay only their description line); the doctrine is upgradeable in place (skill bodies re-hash on reinstall); the scope-vs-density clarification is written where agents actually read it.
- Negative: three channels means three surfaces to keep consistent — the drift gates (AGENTS.md, install docs) and the skill-description lint carry that; an output style is a global setting, so users of a competing style must opt out (`--no-terse-style`).
- Neutral: the discipline content itself is doctrine, not mechanism — this ADR fixes its _placement_; the sop-suite it distills from remains an external, read-only source.

## References

- `packages/create-obsidian-memory/templates/skills/{vkm-discipline,vkm-spec}/SKILL.md`, `templates/agents/vkm-implementer.md`, `templates/output-styles/vkm-terse.md`, `src/skills-install.mjs`, `src/memory-rules.mjs` (the "Executable discipline (vkm)" bullet, ES/EN).
- ADR-0030 (what hooks are for), ADR-0035/0036 (the budget discipline that shaped the split), ADR-0043 (style installer), ADR-0045 (`assemble_context` the doctrine points at), ADR-0047 (no-Ollama-in-sync-path rule the `/vkm-spec` skill encodes).
