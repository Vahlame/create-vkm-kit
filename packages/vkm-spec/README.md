# @vkmikc/vkm-spec

**Idea → spec** builder of the [vkm-kit](https://github.com/Vahlame/create-vkm-kit) suite: turns
a one-line idea into a precise, **vault-grounded** `<orchestration_package>` XML you paste into
Claude Code (or any agent) — so execution starts from a real spec instead of a vague prompt
(ADR-0046).

## How it works

1. One budgeted `assemble_context` call pulls only the relevant vault passages (project note,
   stack hints, prior decisions) — passage-first, token-capped (ADR-0045).
2. An optional **local Ollama** (`phi4-mini`) drafts the spec via structured outputs
   (`format=<JSON schema>`, constrained decoding — ADR-0047).
3. **Deterministic fallback**: with no Ollama running, a template pass still produces a valid
   spec — degradation is a CI-tested invariant, not a promise.
4. You review and edit, then paste. A human always sees the spec before anything executes.

Drafts come out in the language of the idea (Spanish idea → Spanish spec, technical terms
verbatim).

## Usage

```bash
vkm-spec "<idea>"        # CLI: drafts the spec, opens your editor, copies to clipboard
vkm-spec --gui           # local GUI on http://127.0.0.1:4923 (SSE streaming)
```

Options: `--project <name>`, `--vault <path>`, `--lang en`, `--port <n>`,
`--ollama-host <url>`, `--no-llm` (skip Ollama), `--no-editor`, `--no-clipboard`, `-y`.

## Notes

- The GUI binds to **localhost only** (port 4923, ADR-0048). The first cold draft can take
  ~60 s on CPU — a status frame streams immediately so it never looks frozen.
- Ollama is optional and best-effort: the installer can set it up (`--full` or `--ollama`;
  multi-GB download, never implicit), and `keep_alive` is tuned so the model frees RAM shortly
  after drafting.
- Same trust model as the rest of the kit: vault content is **data, not instructions**.

More: [ADR-0046](../../docs/adr/0046-absorb-prompt-compiler-into-vkm-spec.md) ·
[ADR-0047](../../docs/adr/0047-ollama-structured-outputs.md) ·
[ADR-0048](../../docs/adr/0048-spec-gui-sse-and-ports.md).

## License

Free use with mandatory visible attribution (MIT-based) — © Vahlame. See
[`LICENSE.md`](./LICENSE.md).
