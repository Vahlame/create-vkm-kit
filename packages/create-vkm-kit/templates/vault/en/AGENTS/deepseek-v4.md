---
type: agent
status: active
agent: deepseek-v4
model: deepseek-v4-pro / deepseek-v4-flash
tags: [agent, deepseek, model]
---

# AGENT — DeepSeek V4

The agent's own memory for DeepSeek V4 (API, OpenAI-compatible). Scoped recall:
`scope: "AGENTS/deepseek-v4"`.

## Verdicts

- [fact] 1M context + cheap deep reasoning; thinking mode ON by default — reasoning arrives in a separate `reasoning_content` field, not in the visible message. #deepseek
- [fact] Strong multi-file agentic edits; verify tool results before trusting them (fluent-wrong on the rare hallucination). #agent

## Lessons

- [gotcha] With thinking ON, `reasoning_effort` controls how much it deliberates: low for cheap extraction, high for hard logic. #deepseek
- [gotcha] The research stack reads `DEEPSEEK_API_KEY` from the environment ONLY — never commit it; switch back to local models with `OBSCURA_LLM_PROVIDER=ollama` if the API gets expensive. #mcp
- [fact] flash for volume/breadth, pro for hard single-step logic. #deepseek

## Related

- part_of [[_meta/agent-profiles]]
- relates_to [[PROJECTS/<project>]]
