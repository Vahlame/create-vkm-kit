# `scripts/`

- **`sync-agents.ts`** — regenerates `AGENTS.md`, `.cursor/rules`, `.continue/rules` from `.agents/` and `agents-manifest.yaml`.
- **`linkcheck.mjs`** — offline relative-link + heading-anchor checker for the Markdown docs (`npm run linkcheck`). Complements the lychee CI job, which also validates external URLs.
- **`license-sync.mjs`** — mirrors the root `LICENSE.md` into every `packages/*` dir (`npm run license:sync`; `--check` gates CI and `npm publish`). npm only auto-includes `LICENSE*` files from the package root, so the published tarball needs its own copy.

**`scripts/windows/`** contained example Windows integration scripts; they were **removed in v3** (script-free public kit). See [`docs/legacy/v2-to-v3-script-free-kit.md`](../docs/legacy/v2-to-v3-script-free-kit.md).
