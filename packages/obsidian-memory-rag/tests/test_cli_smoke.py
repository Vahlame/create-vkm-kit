"""Every CLI subcommand runs, and every ``json-*`` twin emits one JSON object.

Before this file, ``cli.py`` was 1,104 lines of parser wiring plus a 484-line
dispatch chain covered by exactly two assertions, both against
``json-rotate-log``. A typo in any other branch — a renamed ``args`` attribute, a
subcommand wired to the wrong handler, a ``json-*`` twin that prints prose —
reached users, because the only thing exercising those paths was the Node MCP
bridge at runtime.

The subcommand names are a public contract: ``hybrid-mcp.mjs`` and
``context-assemble.mjs`` spawn the twelve ``json-*`` twins by name, and
``ci.yml`` invokes ``bench-recall`` / ``bench-tokens`` / ``bench-assemble`` by
name. ``test_table_covers_every_subcommand`` is what makes that contract
enforceable: the table below must name every subcommand the parser declares, so
adding one without an invocation here fails rather than shipping untested.

This is a smoke test on purpose — it asserts each command runs to completion and
that machine-readable output is machine-readable. Behavioural depth lives in the
per-module tests (test_hybrid, test_audit, test_reflect, …); duplicating it here
would make the file slow enough that nobody runs it.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from obsidian_memory_rag import cli
from obsidian_memory_rag.indexer import index_vault

# --- fixture vault -----------------------------------------------------------
# Small but not degenerate: wikilinks (so the graph has edges), typed relations
# and categorized observations (so the KG commands have rows), a #tag, YAML
# frontmatter, and a SESSION_LOG.md with two sections (so rotate-log has
# something to rotate). Every command below finds real data rather than
# exercising only its empty-input branch.

NOTES: dict[str, str] = {
    "MEMORY.md": (
        "---\nstatus: confirmed\n---\n\n"
        "# Memory\n\n"
        "Prefers Markdown notes under git over a database. See [[PROJECTS/bike-shop]].\n\n"
        "- [decision] plain Markdown beats a database for portable memory #architecture\n"
    ),
    "PROJECTS/bike-shop.md": (
        "---\nstatus: confirmed\n---\n\n"
        "# bike-shop\n\n"
        "Bike workshop app on Tauri 2 with Svelte 5 and Supabase.\n\n"
        "- implements [[STACKS/tauri]]\n"
        "- [decision] Tauri over Electron for the desktop shell #tauri\n"
        "- [gotcha] Supabase row-level security must be on before the first deploy #supabase\n"
    ),
    "STACKS/tauri.md": (
        "---\nstatus: hypothesis\n---\n\n"
        "# tauri\n\n"
        "Rust-backed desktop shell. Verdict: like.\n\n"
        "- [fact] Tauri 2 ships a mobile target #tauri\n"
    ),
    "SESSION_LOG.md": (
        "# Session log\n\n"
        "## 2026-06-01 — first\n\nWired the vault.\n\n"
        "## 2026-06-02 — second\n\nAdded the bike-shop project note.\n"
    ),
}

# Ground truth for the three bench commands: one query whose answer is a note
# that exists in the fixture, so the harness computes real (not degenerate)
# recall/savings numbers without needing the full labelled corpora in evals/.
BENCH_QUERIES = [
    {
        "query": "Tauri Svelte Supabase bike workshop",
        "relevant": ["PROJECTS/bike-shop.md"],
        "kind": "project-fact",
        "project": "bike-shop",
    }
]


@pytest.fixture(scope="module")
def vault(tmp_path_factory: pytest.TempPathFactory) -> Path:
    root = tmp_path_factory.mktemp("vault")
    for rel, body in NOTES.items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(body, encoding="utf-8")
    # Index up front rather than relying on the `index` case running first: most
    # commands auto-index, but `bench` does not and exits 2 on an empty result, so
    # without this the suite would pass or fail on pytest's parametrize ordering.
    index_vault(root)
    return root


@pytest.fixture(scope="module")
def queries_file(tmp_path_factory: pytest.TempPathFactory) -> Path:
    fp = tmp_path_factory.mktemp("bench") / "queries.jsonl"
    fp.write_text(
        "".join(json.dumps(q, ensure_ascii=False) + "\n" for q in BENCH_QUERIES),
        encoding="utf-8",
    )
    return fp


# --- invocation table --------------------------------------------------------
# One entry per subcommand. `{vault}`, `{corpus}` and `{queries}` are substituted
# per run; `{corpus}` is the fixture vault, since a bench corpus IS a vault.

INVOCATIONS: dict[str, list[str]] = {
    "index": ["--vault", "{vault}"],
    "json-index": ["--vault", "{vault}"],
    "search": ["--vault", "{vault}", "tauri supabase"],
    "json-search": ["--vault", "{vault}", "--query", "tauri supabase"],
    "hybrid-search": ["--vault", "{vault}", "tauri supabase"],
    "json-hybrid-search": ["--vault", "{vault}", "--query", "tauri supabase"],
    "bench": ["--vault", "{vault}", "--query", "tauri", "--iterations", "2"],
    "audit": ["--vault", "{vault}"],
    "json-audit": ["--vault", "{vault}"],
    "complete": ["--vault", "{vault}", "tau"],
    "json-complete": ["--vault", "{vault}", "--prefix", "tau"],
    "relations": ["--vault", "{vault}", "PROJECTS/bike-shop.md"],
    "json-relations": ["--vault", "{vault}", "PROJECTS/bike-shop.md"],
    "observations": ["--vault", "{vault}"],
    "json-observations": ["--vault", "{vault}"],
    "kg-suggest": ["--vault", "{vault}", "PROJECTS/bike-shop.md"],
    "json-kg-suggest": ["--vault", "{vault}", "PROJECTS/bike-shop.md"],
    "memory-report": ["--vault", "{vault}"],
    "json-memory-report": ["--vault", "{vault}"],
    "memory-reflect": ["--vault", "{vault}"],
    "json-memory-reflect": ["--vault", "{vault}"],
    "json-log-use": ["--vault", "{vault}", "--path", "PROJECTS/bike-shop.md"],
    # rotate-log rewrites SESSION_LOG.md, so it runs last against a keep count
    # that leaves the fixture intact for any test ordering.
    "rotate-log": ["--vault", "{vault}", "--keep", "8"],
    "json-rotate-log": ["--vault", "{vault}", "--keep", "8"],
    "bench-recall": ["--corpus", "{corpus}", "--queries", "{queries}"],
    "json-bench-recall": ["--corpus", "{corpus}", "--queries", "{queries}"],
    "bench-tokens": ["--corpus", "{corpus}", "--queries", "{queries}"],
    "json-bench-tokens": ["--corpus", "{corpus}", "--queries", "{queries}"],
    "bench-assemble": ["--corpus", "{corpus}", "--queries", "{queries}"],
    "json-bench-assemble": ["--corpus", "{corpus}", "--queries", "{queries}"],
}


def _subcommand_names() -> list[str]:
    parser = cli.build_parser()
    (action,) = [a for a in parser._subparsers._group_actions if hasattr(a, "choices")]
    return sorted(action.choices)


def test_table_covers_every_subcommand() -> None:
    """A new subcommand must arrive with an invocation, or this fails."""
    assert sorted(INVOCATIONS) == _subcommand_names()


@pytest.mark.parametrize("cmd", sorted(INVOCATIONS))
def test_subcommand_runs(
    cmd: str,
    vault: Path,
    queries_file: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    argv = [cmd] + [
        arg.format(vault=vault, corpus=vault, queries=queries_file) for arg in INVOCATIONS[cmd]
    ]

    cli.main(argv)  # a non-zero exit raises SystemExit and fails the test

    out = capsys.readouterr().out
    assert out.strip(), f"{cmd} produced no output"

    if cmd.startswith("json-"):
        # The bridge does JSON.parse on the whole stream, so the machine-readable
        # twins must emit exactly one object and nothing else.
        payload = json.loads(out)
        assert isinstance(payload, dict), f"{cmd} emitted {type(payload).__name__}, not an object"
