"""Assemble-context economy gate.

The measured floor of the ``assemble_context`` claim (ADR-0045): the one-call
bundle gathers the same ground-truth context as the naive multi-call pattern
(completeness gate) while spending far fewer wire tokens. Deterministic
(dependency-free ``HashingEmbedder``), so it doubles as a CI regression gate.

Thresholds sit a margin below the numbers measured on the 10-query fixture
(answered=100%, median savings=68%, aggregate assemble/naive=65%) so they
catch real regressions without flaking on corpus tweaks. The fixture also
encodes the honest counterpoint: with no project note to replace a whole-note
read of, cross-cutting queries save less (~45% median) — that bucket is
reported, not hidden.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from obsidian_memory_rag import run_assemble_benchmark
from obsidian_memory_rag.bench_assemble import (
    _ASSEMBLE_TRUST_NOTICE,
    AssembledBundle,
    assemble_bundle,
    assemble_response_tokens,
    evaluate_assemble,
)
from obsidian_memory_rag.bench_tokens import estimate_tokens

# Repo layout: packages/obsidian-memory-rag/tests/<this> -> repo root is parents[3].
REPO_ROOT = Path(__file__).resolve().parents[3]
CORPUS = REPO_ROOT / "evals" / "assemble" / "corpus"
QUERIES = REPO_ROOT / "evals" / "assemble" / "queries.jsonl"

needs_fixture = pytest.mark.skipif(
    not (CORPUS.is_dir() and QUERIES.is_file()),
    reason="assemble fixture (evals/assemble) not present (package shipped standalone)",
)


@needs_fixture
def test_assemble_economy_floor() -> None:
    report = run_assemble_benchmark(CORPUS, QUERIES)
    assert report.n >= 10, "golden set should stay at/above the 10-query floor"
    # Completeness gate: a cheaper bundle that missed a ground-truth note is a
    # miss, not a win. Measured 100%; the floor leaves one query of slack.
    unanswered = [r.query for r in report.results if not r.answered]
    assert report.answered_rate >= 0.9, f"completeness gate failed: {unanswered}"
    assert report.median_savings >= 0.60, (
        f"median savings regressed: {report.median_savings:.3f}"
    )
    total = 1 - report.total_assemble_tokens / report.total_naive_tokens
    assert total >= 0.55, f"aggregate savings regressed: {total:.3f}"


@needs_fixture
def test_per_kind_buckets_are_reported_not_averaged_away() -> None:
    # Both buckets stay individually visible. The savings MECHANISM differs by
    # kind — project tasks replace a whole-note read; cross-cutting queries win
    # via the relevance gate + no-project stack suppression (the naive arm still
    # pays every unfiltered hit on the wire) — so no ordering between the two is
    # guaranteed; what IS guaranteed is that each bucket clears a real floor.
    # (The original assertion cross < project inverted when the relevance gate
    # landed: dropping vault-global stack facts from no-project bundles was the
    # fix for real-world context pollution, and it made those bundles leaner.)
    report = run_assemble_benchmark(CORPUS, QUERIES)
    assert "cross-cutting" in report.by_kind
    assert "project-task" in report.by_kind
    assert report.by_kind["cross-cutting"]["median_savings"] >= 0.5
    assert report.by_kind["project-task"]["median_savings"] >= 0.5


@needs_fixture
def test_benchmark_is_deterministic() -> None:
    a = run_assemble_benchmark(CORPUS, QUERIES)
    b = run_assemble_benchmark(CORPUS, QUERIES)
    assert (a.median_savings, a.answered_rate, a.total_assemble_tokens) == (
        b.median_savings,
        b.answered_rate,
        b.total_assemble_tokens,
    )


def test_assemble_response_tokens_matches_compact_shape() -> None:
    # The assemble arm must serialize exactly the wire shape the MCP tool
    # emits: camelCase buckets + usedFallback/backendError + _trust, compact
    # separators, no extra keys.
    bundle = AssembledBundle(
        historical_decisions=["decision one"],
        active_patterns=["[gotcha] pattern one"],
        pattern_sources=["PROJECTS/p.md"],
        tech_stack=["stack fact"],
        tech_sources=["STACKS/s.md"],
        current_state=None,
        used_fallback=False,
        project_note="PROJECTS/p.md",
        hits=[],
    )
    expected = json.dumps(
        {
            "historicalDecisions": ["decision one"],
            "activePatterns": ["[gotcha] pattern one"],
            "techStack": ["stack fact"],
            "currentState": None,
            "usedFallback": False,
            "backendError": None,
            "_trust": _ASSEMBLE_TRUST_NOTICE,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    assert assemble_response_tokens(bundle) == estimate_tokens(expected)


def _build_vault(tmp_path: Path) -> Path:
    """A hand-built vault: one fat project note with typed observations, one
    stack note with #stack facts, one untagged project note for the fallback."""
    from obsidian_memory_rag import HashingEmbedder, index_vault, index_vectors

    vault = tmp_path / "v"
    (vault / "PROJECTS").mkdir(parents=True)
    (vault / "STACKS").mkdir()
    (vault / "PROJECTS" / "big.md").write_text(
        "# big\n\n"
        "## Decisiones\n\n"
        "- [decision] La clave del webhook idempotente vive en la tabla eventos #webhooks\n"
        "- [decision] Cola sobre Postgres con SKIP LOCKED #colas\n\n"
        "## Gotchas\n\n"
        "- [gotcha] El spooler reordenaba tickets sin ORDER BY estable #colas\n\n"
        + "\n\n".join(
            f"## seccion {i}\n\nParrafo de relleno numero {i} " + ("bla " * 120)
            for i in range(10)
        )
        + "\n",
        encoding="utf-8",
    )
    (vault / "PROJECTS" / "plain.md").write_text(
        "---\ntype: project\n---\n\n# plain\n\n"
        "Nota de proyecto en prosa pura, sin observaciones tipadas todavia.\n"
        "Describe un prototipo de agenda con recordatorios locales que guarda\n"
        "todo en el dispositivo y sincroniza el calendario solo bajo demanda.\n"
        "Los recordatorios usan la cola de notificaciones del sistema y se\n"
        "reprograman al arrancar; el prototipo evita cualquier servidor propio\n"
        "y exporta la agenda completa a un archivo portable por semana.\n",
        encoding="utf-8",
    )
    (vault / "STACKS" / "tool.md").write_text(
        "# tool\n\n- [fact] El modo WAL permite lectores concurrentes #stack\n",
        encoding="utf-8",
    )
    # Two extra notes sharing the "webhook" anchor so the lexical relevance gate
    # (mirrored from the .mjs) lets broader passages through — the budget-trim
    # assertions below need MULTIPLE surviving passages to have anything to trim.
    (vault / "PRACTICES.md").write_text(
        "# practicas\n\nLeccion webhook: firmar cada webhook entrante y rechazar "
        "timestamps viejos.\n\nReintentos de webhook: backoff exponencial con tope, "
        "nunca reintentos infinitos.\n" + ("relleno de nota larga " * 60) + "\n",
        encoding="utf-8",
    )
    (vault / "PROJECTS" / "sibling.md").write_text(
        "# sibling\n\nEste proyecto hermano tambien consume el webhook de eventos y "
        "documenta la clave compartida del webhook en su runbook.\n"
        + ("mas relleno " * 80)
        + "\n",
        encoding="utf-8",
    )
    emb = HashingEmbedder(dim=256)
    index_vault(vault)
    index_vectors(vault, emb)
    return vault


def test_evaluate_assemble_math_and_gate(tmp_path: Path) -> None:
    """Unit-test the arithmetic and the completeness gate on a hand-built vault."""
    from obsidian_memory_rag import HashingEmbedder

    vault = _build_vault(tmp_path)
    emb = HashingEmbedder(dim=256)

    queries = [
        # Answerable: the project's decisions surface via the typed-observation
        # pass; savings must be positive and match the recomputed ratio.
        {
            "query": "clave webhook idempotente",
            "project": "big",
            "relevant": ["PROJECTS/big.md"],
            "kind": "a",
        },
        # Gate: the ground-truth note does not exist, so no pass can surface it
        # — the bundle may be cheap but earns no credit.
        {
            "query": "clave webhook idempotente",
            "project": "big",
            "relevant": ["PROJECTS/ghost.md"],
            "kind": "b",
        },
        # Negative query (no relevant note): skipped entirely, not scored.
        {"query": "algo inexistente", "relevant": [], "kind": "neg"},
    ]
    report = evaluate_assemble(vault, queries, emb)

    assert report.n == 2, "negative queries are skipped, not scored"
    good, gated = report.results
    assert good.answered
    assert "PROJECTS/big.md" in good.sources
    assert "STACKS/tool.md" in good.sources, "stack facts carry their source note"
    assert good.naive_tokens > good.assemble_tokens, "whole-note read must dominate"
    assert good.savings == pytest.approx(1 - good.assemble_tokens / good.naive_tokens)

    assert not gated.answered, "a note that never surfaced fails the gate"
    assert gated.savings is None, "unanswered queries earn no savings"
    assert report.answered_rate == 0.5
    # Aggregates come from the answered query alone.
    assert report.median_savings == pytest.approx(good.savings)
    assert report.total_naive_tokens == good.naive_tokens


def test_fallback_excerpt_and_budget_trim(tmp_path: Path) -> None:
    """The raw-note fallback marks the project note as a source; the char
    budget trims passages AND their source credit in lockstep."""
    from obsidian_memory_rag import HashingEmbedder

    vault = _build_vault(tmp_path)
    emb = HashingEmbedder(dim=256)

    # 'plain' has zero typed decisions -> currentState carries the excerpt
    # (frontmatter stripped) and the note still counts as surfaced.
    fallback = assemble_bundle(vault, "agenda recordatorios", emb, project="plain")
    assert fallback.historical_decisions == []
    assert fallback.current_state is not None
    assert not fallback.current_state.startswith("---"), "frontmatter must be stripped"
    assert "PROJECTS/plain.md" in fallback.sources()

    # At the minimum budget the broader passages are dropped first — and a
    # trimmed passage must no longer count as a surfaced source.
    wide = assemble_bundle(vault, "clave webhook idempotente", emb, project="big")
    tight = assemble_bundle(
        vault, "clave webhook idempotente", emb, project="big", budget_chars=500
    )
    assert len(tight.active_patterns) < len(wide.active_patterns)
    assert len(tight.pattern_sources) == len(tight.active_patterns)
    assert tight.sources() <= wide.sources()
    assert assemble_response_tokens(tight) < assemble_response_tokens(wide)
