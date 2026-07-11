# ADR-0042: version-lock every suite package to the kit version

- **Status:** Accepted
- **Date:** 2026-07-10
- **Deciders:** maintainer

## Context

The kit already treats version drift as a shippable-bug class: `scripts/version.mjs` holds a MARKERS list (both package.jsons, pyproject.toml, README badges, agent.toml, the Go daemon's `var version`) and `check` fails on any disagreement with the CHANGELOG's latest release — a gate built after real incidents (README badge at 3.6.0 while packages said 3.5.0 and no tag existed). The one exception was `obsidian-prompt-compiler`, deliberately versioned independently as a "sidecar with its own life". The 4.0.0 train adds two more packages, `vkm-doctor` and `vkm-spec`, and forces the question: does the suite grow more independent version lines, or one?

The packages are not independent products. They ship cross-package contracts that must move together: the installer's managed `TELEMETRY_ENV` endpoint must match `vkm-doctor`'s `DEFAULT_PORT`; `vkm-spec` imports `assembleContext` directly from `obsidian-memory-mcp`; the bench that gates `assemble_context` lives in `obsidian-memory-rag`. A user reports "vkm-kit 4.0.0", not a 4-tuple of package versions.

## Decision

All suite packages are **version-locked to the kit version**. `vkm-doctor/package.json` and `vkm-spec/package.json` are added to `scripts/version.mjs` MARKERS, so `version.mjs set` rewrites them and `version.mjs check` (run in CI and by the release workflow) fails on drift. This **reverses the prompt-compiler precedent** of independent versioning — a precedent whose only holder is being deleted anyway (ADR-0046). The release gate stays three-way: git tag == every marker == CHANGELOG latest (`release.yml` refuses to publish otherwise).

## Alternatives considered

- **Independent semver per package (the compiler precedent):** rejected — it buys accurate per-package change signaling at the cost of a compatibility matrix nobody maintains; with in-repo cross-package imports and a port contract between installer and doctor, "which vkm-spec works with which create-vkm-kit" is a question that should never be askable. Independent versioning makes sense for packages with external consumers on their own upgrade cadence; none of these have that.
- **Workspace release tooling (changesets/lerna):** rejected — the MARKERS + gate mechanism already exists, is dependency-free, covers non-npm surfaces (Go daemon, badges, agent.toml) that npm-centric tooling does not, and has caught real drift.
- **Locking only the npm-published packages, floating the private ones:** rejected — the drift incidents that motivated `version.mjs` were precisely in the "nobody publishes this, who cares" surfaces.

## Consequences

- Positive: one version answers every "what are you running" question; a release is a single `version.mjs set` + tag; cross-package contracts are exercised at one version, the only one users can install.
- Negative: a one-line fix in `vkm-doctor` still ships as a kit-wide version bump — version numbers over-signal change breadth for small patches.
- Neutral: the npm scope keeps publishing multiple packages; lockstep is about the version string, not about collapsing packages (dependency profiles still justify the split — `vkm-doctor` is zero-dep, `vkm-spec` carries the Ollama/GUI surface).

## References

- `scripts/version.mjs` (MARKERS, including the vkm-doctor/vkm-spec entries and their ADR-0042 comment), `.github/workflows/release.yml` (tag == markers == CHANGELOG guard).
- ADR-0046 (deletion of the independent-versioning precedent holder), ADR-0050 (release train this policy gates).
