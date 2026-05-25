# Evaluations

> **Read this first.** The CI job is named **`eval-harness-smoke`**, not "adherence". It is **not** a model-adherence evaluation — it verifies the eval harness itself runs end-to-end with a deterministic stub provider that echoes the expected token. The gate is always **1.0** unless the harness pipeline breaks (missing yaml, broken require, etc.). Do **not** treat a green badge here as evidence that any agent follows the vault User Rules.

To measure real adherence, run promptfoo locally with a live LLM provider against a real `basic-memory` MCP server.

## Files

- **`adherence.yaml`** — 20 deterministic test cases. Each test asks the provider to apply a `FACT_NN` token and asserts the response contains it.
- **`adherence-provider.cjs`** — **stub provider.** `callApi()` returns the expected token verbatim. Replace with a real provider (Anthropic/OpenAI SDK + MCP client) to do an actual adherence measurement.
- **`run-adherence-ci.mjs`** — CI harness that walks `adherence.yaml`, invokes the provider, and exits 1 if pass rate < 0.80. With the stub, pass rate is always 1.0 — that's the point of a smoke gate.

## Run real promptfoo (optional, local)

```bash
rm -rf .promptfoo
npx --yes promptfoo@latest eval -c evals/adherence.yaml --repeat 3
```

To actually exercise the LLM, swap `file://adherence-provider.cjs` in `adherence.yaml` for `anthropic:claude-opus-4-7` (or similar) and add a real test that spins up `basic-memory mcp` and asks the model to read/write notes.
