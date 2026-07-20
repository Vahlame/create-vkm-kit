# ADR-0050: the 4.0.0 release train — two additive minors first, breaking changes last, npm shim forever

- **Status:** Accepted, **amended 2026-07-20** (4.x shipped; the npm shim was never actually published — see Amendment)
- **Date:** 2026-07-10
- **Deciders:** maintainer

## Context

The vkm-kit plan (ADR-0041→0049) mixes two kinds of change: purely **additive** modules that are useful the day they land (token-saver hooks, doctor + telemetry sink, `assemble_context`) and **breaking** ones that must ride a major (the rename with its dual-read migration, the prompt-compiler deletion, the vkm-spec/skills surface that completes the suite identity). Shipping everything as one big-bang 4.0.0 would hold finished, independently valuable work hostage to the slowest phase; shipping the rename early would force every subsequent phase to be written twice (once against old identifiers, once against new). npm adds its own constraint: no redirects, so the package rename needs an explicit continuity mechanism, and unpublishing the old name would break every pinned install retroactively.

## Decision

Sequence the train as **two additive minors under the old name, then one breaking major, with the rename dead last**:

1. **3.16.0** — groundwork refactor (`settings-io.mjs` / `settings-writers.mjs` / `asset-install.mjs`, behavior-identical extraction guarded by the existing suite) + the token-saver module (ADR-0043). Additive; useful immediately.
2. **3.17.0** — `vkm-doctor` + local OTLP sink + telemetry wiring (ADR-0044) and `assemble_context` with its bench gate (ADR-0045). Additive; useful immediately.
3. **4.0.0** — the breaking train: `vkm-spec` (ADR-0046/0047/0048), skills/subagent/discipline surfaces (ADR-0049), the prompt-compiler deletion (ADR-0046), and the rename (ADR-0041) executed **last within the train** so no phase's output is written under a name a later phase rewrites — the repo rename is the final act before the tag.
4. **npm continuity:** `release.yml` publishes both `@vkmikc/create-vkm-kit` and the forwarding shim under `@vkmikc/create-obsidian-memory`; the old name is `npm deprecate`d with a pointer and **never yanked** — a pinned `npx @vkmikc/create-obsidian-memory` keeps working indefinitely, landing users on the 4.0.0 behavior via the shim. The version-lock gate (ADR-0042: tag == every marker == CHANGELOG) holds at each of the three releases.

## Alternatives considered

- **Single big-bang 4.0.0:** rejected — the token-saver and doctor have no dependency on the rename or vkm-spec; parking finished, measured modules for months is pure opportunity cost, and one giant release maximizes the blast radius of any regression.
- **Rename first, features after:** rejected — every subsequent phase would touch renamed paths, markers and docs, re-churning what the rename just churned; doing it last means the dual-read/migration code is written once against a finished surface.
- **More granular minors (one per module):** considered and softened rather than rejected — 3.16/3.17 already group by natural dependency (groundwork→token-saver; doctor and assemble_context are independent but both additive); further splitting adds release overhead without de-risking anything the gates don't already cover.
- **Unpublish or yank the old npm name after a grace period:** rejected outright — it breaks pinned installs retroactively and burns trust for zero benefit; deprecation warnings reach everyone the yank would punish.

## Consequences

- Positive: value ships as it's finished; each release is small enough to bisect; existing 3.x users get two safe upgrades before any breaking change; the old npm name remains a working, self-explaining entry point forever.
- Negative: the interim state is publicly inconsistent — 3.16/3.17 ship vkm-branded internals (`VKM_TOKEN_SAVER`, `~/.vkm/`) under the `create-obsidian-memory` name; the shim is a package to maintain (thin, but published) — accepted as the price of npm having no redirects.
- Neutral: Proposed until the train completes — 3.16/3.17 content is implemented, but the sequencing decision is only fully validated when 4.0.0 tags; migration fixtures (settings.json + CLAUDE.md from a real 3.15 install → single migrated block, zero orphaned hooks, clean uninstall) are the train's exit gate.

## Amendment (2026-07-20): the shim is retired unpublished; the old name stays frozen on the v3 kit

Decision §4 above ("`release.yml` publishes both … the old name is `npm deprecate`d with a pointer") described an intent that never became true, and the docs asserted it as fact for four releases. What the registry actually holds under `@vkmikc/create-obsidian-memory` is **the last real v3 kit, 3.15.0, published 2026-07-09** — sixteen versions, all deprecated, none of them a forwarder. The shim package exists only in-tree.

Two independent causes, both invisible from the repo:

1. **The publish step never succeeded.** The granular `NPM_TOKEN` only grants write on the new name, and npm answers an unauthorized publish with **`404 … could not be found or you do not have permission to access it`** — a status that reads like "package missing", not "wrong token". Before 4.4.0 the job soft-exited on a missing token anyway, so the 404 only became visible once the hard fail (4.4.0) forced the job to run for real.
2. **The old name was deprecated with npm's generic message** ("Package no longer supported. Contact Support…"), not the pointer §4 called for. Deprecation is per-version, so publishing 4.x to that name would have produced a _non-deprecated_ latest version — quietly reviving the name the deprecation was meant to retire.

Amended decision: **one live entry point, one signpost.** `release.yml` publishes `@vkmikc/create-vkm-kit` only; `packages/create-obsidian-memory-shim/` stays in-tree (version-locked, tested) but unpublished; the old name keeps its 3.15.0 tarball and its deprecation, and every user-facing doc now states the truth — _deprecated and frozen on the v3 kit, does not forward, repoint your scripts_. The remaining gap is the deprecation text itself, which needs an `npm deprecate` run with the maintainer's own credentials.

What this cost, and the transferable lesson: a claim about a **published artifact** was carried in ADRs and three READMEs for four releases because everyone read it off the repo's `package.json` instead of the registry. The source of truth for "what users get" is the registry packument (`https://registry.npmjs.org/<pkg>`), never the source tree — and a green release check proves neither.

## References

- `.github/workflows/release.yml` (tag == markers == CHANGELOG guard; publish job), `CHANGELOG.md` `[Unreleased]` (the as-built 3.16/3.17-bound content).
- ADR-0041 (rename mechanics + what's frozen), ADR-0042 (version-lock gate), ADR-0043/0044/0045 (the additive minors' content), ADR-0046/0049 (the breaking train's content).
