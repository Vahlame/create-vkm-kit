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

← Back to the [docs index](README.md)
