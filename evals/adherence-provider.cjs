class AdherenceStub {
  id() {
    return "adherence-stub";
  }

  async callApi(prompt, context) {
    const token = context?.vars?.expected_token ?? "";
    return {
      output: `According to the vault memory, the fact token is ${token}.`,
      tokenUsage: { total: 1, prompt: 1, completion: 0 },
    };
  }
}

module.exports = AdherenceStub;
