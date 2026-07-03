"""Token-economy gate.

The measured floor of the doctrine's token claim: passage-first recall answers
the same labelled queries as whole-note reads (completeness gate) while
spending far fewer tokens on realistically-sized notes. Deterministic
(dependency-free ``HashingEmbedder``), so it doubles as a CI regression gate.

Thresholds sit a margin below the numbers measured on the 16-query fixture at
k=5 (answered=100%, median savings=47%, aggregate passage/whole-note=56%) so
they catch real regressions without flaking on corpus tweaks. The fixture also
encodes the honest counterpoint: on small notes (STACKS, <2 KB) reading whole
is CHEAPER than k=5 passages — that bucket is reported, not hidden, and the
doctrine already says to read small notes whole.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from obsidian_memory_rag import run_token_benchmark
from obsidian_memory_rag.bench_tokens import estimate_tokens, evaluate_tokens

# Repo layout: packages/obsidian-memory-rag/tests/<this> -> repo root is parents[3].
REPO_ROOT = Path(__file__).resolve().parents[3]
CORPUS = REPO_ROOT / "evals" / "tokens" / "corpus"
QUERIES = REPO_ROOT / "evals" / "tokens" / "queries.jsonl"

needs_fixture = pytest.mark.skipif(
    not (CORPUS.is_dir() and QUERIES.is_file()),
    reason="token fixture (evals/tokens) not present (package shipped standalone)",
)


@needs_fixture
def test_token_economy_floor() -> None:
    report = run_token_benchmark(CORPUS, QUERIES, k=5)
    assert report.n >= 14, "golden set should stay at/above the 14-query floor"
    # Completeness gate: a cheaper answer that missed the note is a miss, not a
    # win. Every positive query must surface all its ground-truth notes.
    unanswered = [r.query for r in report.results if not r.answered]
    assert not unanswered, f"completeness gate failed: {unanswered}"
    assert report.median_savings >= 0.40, (
        f"median savings regressed: {report.median_savings:.3f}"
    )
    total = 1 - report.total_passage_tokens / report.total_full_tokens
    assert total >= 0.45, f"aggregate savings regressed: {total:.3f}"


@needs_fixture
def test_lower_k_saves_more_without_losing_answers() -> None:
    # k is the agent's main token lever: fewer passages returned = cheaper
    # recall. The measured contract is that k=3 still answers everything on
    # this fixture while saving strictly more than k=5.
    k3 = run_token_benchmark(CORPUS, QUERIES, k=3)
    k5 = run_token_benchmark(CORPUS, QUERIES, k=5)
    assert k3.answered_rate == 1.0
    assert k3.median_savings > k5.median_savings


@needs_fixture
def test_small_note_counterpoint_is_reported_not_hidden() -> None:
    # The fixture's STACKS notes are deliberately small (<2 KB): at k=5 the
    # whole-note read is competitive or cheaper there. The benchmark must keep
    # that bucket visible (per-kind breakdown) instead of averaging it away.
    report = run_token_benchmark(CORPUS, QUERIES, k=5)
    assert "stack-fact" in report.by_kind
    assert report.by_kind["stack-fact"]["median_savings"] < report.median_savings


@needs_fixture
def test_benchmark_is_deterministic() -> None:
    a = run_token_benchmark(CORPUS, QUERIES, k=5)
    b = run_token_benchmark(CORPUS, QUERIES, k=5)
    assert (a.median_savings, a.answered_rate, a.total_passage_tokens) == (
        b.median_savings,
        b.answered_rate,
        b.total_passage_tokens,
    )


def test_estimate_tokens_matches_audit_rule() -> None:
    # Same ~4 bytes/token heuristic as audit.py, on UTF-8 bytes (not chars):
    # a non-ASCII character costs its encoded length.
    assert estimate_tokens("") == 0
    assert estimate_tokens("abcd" * 10) == 10
    assert estimate_tokens("abc") == 1  # ceil(3/4)
    assert estimate_tokens("ñ" * 4) == 2  # 8 UTF-8 bytes


def test_evaluate_tokens_math_and_gate(tmp_path: Path) -> None:
    """Unit-test the arithmetic and the completeness gate on a hand-built vault."""
    from obsidian_memory_rag import HashingEmbedder, index_vault, index_vectors

    vault = tmp_path / "v"
    (vault / "PROJECTS").mkdir(parents=True)
    big = vault / "PROJECTS" / "big.md"
    # A fat note (many sections) where passage-first must win.
    big.write_text(
        "# big\n\n"
        + "\n\n".join(
            f"## seccion {i}\n\nParrafo de relleno numero {i} " + ("bla " * 120)
            for i in range(10)
        )
        + "\n\n## respuesta\n\nLa clave del webhook idempotente vive aqui.\n",
        encoding="utf-8",
    )
    (vault / "PROJECTS" / "other.md").write_text(
        "# other\n\nNota sin relacion sobre impresoras y tickets.\n",
        encoding="utf-8",
    )
    emb = HashingEmbedder(dim=256)
    index_vault(vault)
    index_vectors(vault, emb)

    queries = [
        # Answerable: relevant note surfaces; savings must be large and match
        # the recomputed ratio from the result's own token fields.
        {"query": "clave webhook idempotente", "relevant": ["PROJECTS/big.md"], "kind": "a"},
        # Gate: lexically matches 'other.md', but ground truth says big.md must
        # ALSO surface — with k=1 it cannot, so no savings may be credited.
        {
            "query": "impresoras tickets",
            "relevant": ["PROJECTS/big.md", "PROJECTS/other.md"],
            "kind": "b",
        },
        # Negative query (no relevant note): skipped entirely, not scored.
        {"query": "algo inexistente", "relevant": [], "kind": "neg"},
    ]
    report = evaluate_tokens(vault, queries, emb, k=1)

    assert report.n == 2, "negative queries are skipped, not scored"
    answered = {r.query: r for r in report.results}
    good = answered["clave webhook idempotente"]
    assert good.answered
    assert good.savings is not None and good.savings > 0.5
    assert good.savings == pytest.approx(1 - good.passage_tokens / good.full_tokens)

    gated = answered["impresoras tickets"]
    assert not gated.answered, "k=1 cannot surface both relevant notes"
    assert gated.savings is None, "unanswered queries earn no savings"
    assert report.answered_rate == 0.5
    # Aggregates come from the answered query alone.
    assert report.median_savings == pytest.approx(good.savings)
    assert report.total_full_tokens == good.full_tokens
