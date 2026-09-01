> [🇪🇸 Español](../es/deepseek.md) · 🇬🇧 English

# DeepSeek V4

How to drive the kit with **DeepSeek V4** (API, OpenAI/Anthropic-compatible) and get the
full stack — vault memory, hybrid search, research, skills and rules — tuned for a
reasoning model instead of Claude. Design record: [ADR-0088](../adr/0088-deepseek-v4-first-class.md).

## The one thing to get right: the key lives in the environment only

The kit reads `DEEPSEEK_API_KEY` from the **process environment** of whatever launches the
agent and the MCP servers. It is never written to disk, `mcp.json`, git, or a log, and it
is redacted from every error message. Set it in your shell / OS keychain — **never** in a
committed file:

```powershell
# current session only
$env:DEEPSEEK_API_KEY = "<your-deepseek-key>"

# persistent (Windows, user scope)
setx DEEPSEEK_API_KEY "<your-deepseek-key>"
```

`setx` only affects **new** shells — restart the agent host after setting it.

## Running DeepSeek through an agent host

DeepSeek has no `deepseek mcp add` and no dedicated config surface — it runs **inside an
existing host**, so there is no `--ide deepseek`. Wire the kit for your host as usual, then
point that host at the DeepSeek API:

- **Claude Code** — DeepSeek ships an Anthropic-compatible endpoint. Point the harness at
  it (`ANTHROPIC_BASE_URL` and a DeepSeek model id), then install the kit normally
  (`--ide claude`). The kit's hooks detect the DeepSeek model id from the session payload.
- **Cursor / Codex** — use an OpenAI-compatible provider with
  `https://api.deepseek.com/v1` and a DeepSeek model id; `--ide cursor` / `--ide codex`
  wire the vault + hybrid + rules + skills as usual.

The model detection is **host-agnostic** and lives in the hooks and the effort gate, so it
works whichever host you use.

## Hosts without hooks (DSH, opencode, …)

The hook surfaces (SessionStart DeepSeek block, effort gate, token-saver) only run where the
kit can wire them: Claude Code, Codex, Cursor, Kimi. A host with none of those — e.g. the
DeepSeek Harness (DSH) — still gets the three things that matter most, with zero hooks:

| Surface     | How it reaches the model in a hook-less host                                                                                                                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rules block | The `vkm-kit:start/end` block in `AGENTS.md` is loaded every session (the kit installs it into the project).                                                                                                                           |
| Skills      | DSH reads `~/.agents/skills` (the Codex layout): install them with `node packages/create-vkm-kit/src/index.js --skills-dir <dir> --vault <vault>` or by copying after an `--ide codex` install.                                        |
| MCP         | Only if the host exposes an MCP registry. DSH currently exposes **no MCP service**, so the `vault_*` tools are absent — the memory protocol honestly degrades ("no vault MCP → say so"), and the skills + rules still work standalone. |

**Flash session tuning (DSH):** `~/.dsh/settings.yaml` → `agent-default-model.reasoningEffort`.
Set it to `low` for a flash default: the kit's guidance below says low for cheap extraction,
and `max` on flash makes every message slower and more expensive for no measured gain.

## What "first-class" changes for DeepSeek

| Surface           | DeepSeek behavior                                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Effort gate       | Recognizes `deepseek-*`; advises `/effort` but **never** proposes `/model opus/sonnet/haiku`                                                                              |
| SessionStart hook | Injects a short DeepSeek-only block: thinking ON by default (reasoning in `reasoning_content`), `reasoning_effort` flash/pro split, verify-tool-results, key-env reminder |
| Agent profiles    | V4 row in `_meta/agent-profiles.md` + a dedicated `AGENTS/deepseek-v4.md` note (scoped recall `scope: "AGENTS/deepseek-v4"`)                                              |
| Research stack    | Curation/expansion/translation/leads/summaries route to the DeepSeek API — no local Ollama required                                                                       |
| Embeddings        | Stay local (Ollama `/api/embed`) — DeepSeek has no embedding endpoint; the near-duplicate pass just degrades without it                                                   |

## Research backend (obscura-web)

The research LLM calls use a provider selector:

```text
OBSCURA_LLM_PROVIDER=auto     # default: DeepSeek when DEEPSEEK_API_KEY is set, else Ollama
OBSCURA_LLM_PROVIDER=deepseek # force the API (openai is an alias); errors if no key
OBSCURA_LLM_PROVIDER=ollama   # force local models — the "API got expensive" fallback
OBSCURA_LLM_PROVIDER=none     # degrade every call to the heuristic fallbacks
```

`OBSCURA_DEEPSEEK_MODEL` picks the model (default `deepseek-v4-flash`; `deepseek-v4-pro`
for higher-quality summaries/expansion). `OBSCURA_DEEPSEEK_BASE_URL` overrides the endpoint.

At install time, the non-secret half is expressible as flags (the key itself is never a flag):

```bash
node packages/create-vkm-kit/src/index.js --research-llm deepseek --deepseek-model deepseek-v4-pro ...
```

**Falling back to local models:** `OBSCURA_LLM_PROVIDER=ollama` (or unsetting
`DEEPSEEK_API_KEY`) returns every research call to a local Ollama — in both directions, so
you can switch on cost without reinstalling.

## Subagent model (Claude Code)

The shipped `vkm-implementer` subagent template defaults to `model: sonnet`, which is wrong
under DeepSeek. Override it with the environment variable the template documents:

```powershell
$env:CLAUDE_CODE_SUBAGENT_MODEL = "deepseek-v4-pro"
```

## Tuning notes

- **Thinking is ON by default.** Reasoning arrives in a separate `reasoning_content` field,
  not the visible message — do not expect it in the assistant text.
- **Cost is tuned with `reasoning_effort`**, not `/model`: low for cheap extraction, high
  for hard logic; `flash` for volume/breadth, `pro` for hard single-step logic.
- **Verify tool results before trusting them** — DeepSeek is occasionally fluent-but-wrong
  on a rare hallucination.
- **Measured on flash (discipline-bench):** deepseek-v4-flash with the redesigned
  vkm-discipline skill scores **92.5 vs 78.3 stock** (+14.3, 95% CI [2.5, 26.6]) on the
  kit's hidden-test coding bench — the skills are not decoration for this model.
  Flash-tier SKILL.md cores ("PROCEDURE — flash") are the recommended reading order for
  flash-class models; edge-case and normalization mandates live inside the core, not in a
  reference file.

← Back to the [docs index](README.md)
