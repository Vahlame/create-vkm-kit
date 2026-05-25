// STUB PROVIDER — NOT A REAL LLM.
// callApi() returns the expected token verbatim, so adherence_score is always 1.0.
// This exists to verify that the eval harness wiring (yaml parser, runner, score
// math, exit codes) works end-to-end in CI. The CI job is named
// `eval-harness-smoke` to reflect this.
//
// To measure actual adherence, replace this with a real provider that calls a
// live LLM (Anthropic/OpenAI SDK) with an MCP `basic-memory` server attached,
// and asks it to read/write notes against the expected_token. See evals/README.md.
class AdherenceStub {
  id() {
    return "adherence-stub";
  }

  async callApi(prompt, context) {
    const token = context?.vars?.expected_token ?? "";
    return {
      output: `According to the vault memory, the fact token is ${token}.`,
      tokenUsage: { total: 1, prompt: 1, completion: 0 }
    };
  }
}

module.exports = AdherenceStub;
