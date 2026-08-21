# ADR-0088: DeepSeek V4 as a first-class model (API, OpenAI/Anthropic-compatible)

- **Status:** Accepted
- **Date:** 2026-08-18
- **Deciders:** maintainer

## Context

The kit's agent-facing surfaces grew up around Claude Code: the subagent template
hardcodes `model: sonnet`, the effort gate proposes `/model opus|sonnet|haiku`, and the
`agent-profiles.md` tuning rows assumed Claude's haiku/sonnet/opus cost tiers. Meanwhile
the research stack (`obscura-web`) hard-required a **local Ollama** for every LLM call —
curation, query expansion, translation, lead generation and summarization — plus a local
embedding model for near-duplicate detection.

DeepSeek V4 is driven **by API** (OpenAI-compatible `/chat/completions`, plus an
Anthropic-compatible endpoint for Claude-Code harnesses), not as a local daemon. A
DeepSeek user therefore cannot satisfy the Ollama requirement, and the Claude-specific
model advice is meaningless to them. Three constraints from the user are hard
requirements:

1. **The API key must never leak** — not into git, `mcp.json`, a config file or a log.
2. **Local models must remain an escape hatch** if the API gets too expensive.
3. DeepSeek V4 is a **reasoning model with thinking ON by default** (reasoning arrives in
   a separate `reasoning_content` field, and cost is tuned with `reasoning_effort`, with
   `flash`/`pro` tiers — not haiku/sonnet/opus).

## Decision

1. **DeepSeek runs inside an existing host, so there is no `--ide deepseek`.** DeepSeek
   has no `deepseek mcp add` CLI and no dedicated config surface — it is reached by
   pointing an existing agent host (Claude Code via the Anthropic-compatible endpoint,
   Cursor/Codex via an OpenAI-compatible provider) at the API. Model detection therefore
   lives in the **model-agnostic** surfaces the kit already ships (the effort gate and the
   SessionStart hook), not in a new wiring target. `--skills-dir` remains the escape hatch
   for a client the kit has no `--ide` for.
2. **`modelFamily()` recognizes DeepSeek and the gate never proposes a Claude model to
   it.** `guard-effort-gate.mjs` classifies `deepseek-*` into a `NON_CLAUDE_FAMILIES` set
   and skips `/model` advice for those sessions while still advising `/effort` (which is
   model-agnostic). The `/effort`/`/model` applier keeps its closed model set
   (`haiku|sonnet|opus`) — a DeepSeek session is never typed a Claude model.
3. **`deepseekGuidance()` injects DeepSeek-specific tuning at SessionStart, only for
   DeepSeek sessions** — thinking ON by default, reasoning in `reasoning_content`, the
   `reasoning_effort` flash/pro split, "verify tool results", and the two env levers
   (`DEEPSEEK_API_KEY` env-only, `OBSCURA_LLM_PROVIDER=ollama` to fall back to local
   models). Zero cost otherwise.
4. **The research LLM surface routes through a provider selector in `ollama-client.mjs`.**
   `resolveProvider()` returns `deepseek` when `DEEPSEEK_API_KEY` is set (or
   `OBSCURA_LLM_PROVIDER=deepseek`/`openai`), `ollama` when `OBSCURA_LLM_PROVIDER=ollama`,
   else `none`. The five structured callers (curate/expand/translate/leads/summarize) route
   through one `chatJSON` branch that posts to an OpenAI-compatible `/chat/completions`
   with `response_format: {type:"json_object"}` and `reasoning_effort:"none"` (these are
   short extractions, not hard problems). **Embeddings stay local** — DeepSeek offers no
   embedding endpoint, so `embedPassages` remains Ollama `/api/embed` and the
   near-duplicate/diversify pass simply degrades without it.
5. **The key is env-only by construction.** `deepseekChatJSON` reads `DEEPSEEK_API_KEY`
   from the process environment, sends it only in the `Authorization` header, never echoes
   it into a thrown message, and never writes it to disk. The installer passes only the
   NON-secret half through to the MCP server env: `--research-llm` → `OBSCURA_LLM_PROVIDER`
   and `--deepseek-model` → `OBSCURA_DEEPSEEK_MODEL`. The key reaches obscura-web by
   environment inheritance from whatever process spawns it.
6. **Vault templates ship a first-class DeepSeek note** — `AGENTS/deepseek-v4.md` (en/es,
   scoped recall via `scope: "AGENTS/deepseek-v4"`) plus the updated V4 row in
   `_meta/agent-profiles.md`.

## Alternatives considered

- **A dedicated `--ide deepseek` wiring target:** rejected — there is no DeepSeek MCP
  registry to write and no DeepSeek config surface; it runs inside an existing host, so a
  target would invent a surface that doesn't exist and mislead about what got wired. Model
  detection in the hooks/gate is host-agnostic and already covers every host.
- **Persisting the key in `mcp.json` alongside the provider:** rejected — a config file
  checked into git (or sync'd) is exactly the leak the user forbade. Env-only, with the
  non-secret provider/model still expressible in `mcp.json`.
- **Routing embeddings through DeepSeek:** rejected — no embedding endpoint exists; the
  dedupe pass keeps its local embedding model and degrades when absent.
- **Defaulting the research LLM to DeepSeek unconditionally:** rejected — `auto` keeps the
  existing Ollama users working and makes the local-model fallback a one-flag switch in
  either direction.

## Consequences

- Positive: DeepSeek-via-API sessions get correct cost-tier advice, no bogus `/model`
  proposals, model-specific SessionStart tuning, and a research stack that no longer needs
  Ollama; the key stays out of every persisted artifact.
- Negative: embeddings remain Ollama-only, so the near-duplicate/diversify pass is inert on
  a DeepSeek-only machine — accepted (it is an optional quality pass, not correctness).
- Neutral: `OBSCURA_LLM_PROVIDER`, `OBSCURA_DEEPSEEK_MODEL`, `OBSCURA_DEEPSEEK_BASE_URL`
  are the non-secret knobs; the key itself has no flag and never appears in config.

## References

- ADR-0055 (obscura research local-LLM curation) — the Ollama dependency this relaxes.
- ADR-0031 / ADR-0081 (effort gate) — where `modelFamily()` and the no-Claude-model rule live.
- ADR-0086 (scoped memory namespaces) — the `scope: "AGENTS/deepseek-v4"` recall surface.
- `docs/en/deepseek.md` / `docs/es/deepseek.md` — the user guide this decision backs.
