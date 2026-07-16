"""Regression test: two overlapping ``ensure_fresh()`` calls on the same vault
(e.g. two concurrent ``vault_hybrid_search`` MCP calls hitting a stale index)
must not crash.

Root cause (pre-fix): both writers open their own connection via
``store.connect()`` and take the write lock via ``BEGIN IMMEDIATE``
(``index_vault``/``index_vectors``, indexer.py). ``sqlite3.connect()`` applies
its own *implicit*, undocumented ~5s busy wait even with no ``PRAGMA
busy_timeout`` set — plenty for a quick commit batch, but too short once a
batch (``batch_commit_every`` notes, each re-embedded) legitimately holds the
lock longer, e.g. under a real embedder. The loser then raised
``sqlite3.OperationalError: database is locked`` instead of waiting. The fix
is an explicit, larger ``PRAGMA busy_timeout`` in the shared ``connect()``.
"""

from __future__ import annotations

import threading
import time
from array import array
from pathlib import Path
from typing import Sequence

from obsidian_memory_rag import ensure_fresh, search_vault
from obsidian_memory_rag.embeddings import HashingEmbedder
from obsidian_memory_rag.indexer import index_vault, index_vectors
from obsidian_memory_rag.paths import index_db_path
from obsidian_memory_rag.store import connect
from obsidian_memory_rag.vector_store import current_chunk_keys

N_NOTES = 80


class _SlowEmbedder:
    """``HashingEmbedder`` with an artificial per-call delay, so a single
    ``index_vectors`` commit batch (64 notes) holds the write lock for several
    seconds — long enough to force genuine ``BEGIN IMMEDIATE`` contention
    between two threads instead of a lucky non-overlap."""

    def __init__(self, delay: float) -> None:
        self._inner = HashingEmbedder(dim=64)
        self.name = self._inner.name
        self.dim = self._inner.dim
        self._delay = delay

    def embed(self, texts: Sequence[str]) -> list[array]:
        time.sleep(self._delay)
        return self._inner.embed(texts)


def test_two_ensure_fresh_calls_on_same_vault_do_not_crash(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    vault.mkdir()

    # Bootstrap an existing vector index (one seed note) so _vault_has_vectors()
    # is already True — the real trigger: a bare ensure_fresh() call (what
    # vault_hybrid_search makes) refreshes vectors whenever a vault has *ever*
    # opted in, not only when semantic=True is passed explicitly.
    (vault / "seed.md").write_text("# Seed\n\nseed body\n", encoding="utf-8")
    index_vault(vault)
    index_vectors(vault, HashingEmbedder(dim=64))

    for i in range(N_NOTES):
        (vault / f"note{i}.md").write_text(
            f"# Note {i}\n\nuniquephrase{i} body content here\n", encoding="utf-8"
        )

    # ~6.4s per 64-note commit batch: comfortably past sqlite3.connect()'s
    # undocumented ~5s implicit wait, comfortably under the fixed busy_timeout.
    slow_embedder = _SlowEmbedder(delay=0.1)
    barrier = threading.Barrier(2)
    errors: list[BaseException] = []

    def worker() -> None:
        barrier.wait()  # both threads call ensure_fresh() at (as close to) the same instant
        try:
            ensure_fresh(vault, embedder=slow_embedder)
        except BaseException as exc:  # capture; asserted below so pytest shows both if it fires
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, f"ensure_fresh() raised under concurrency: {errors!r}"

    # The index must be complete and consistent, regardless of which thread did
    # the work — no note lost, none double-corrupted.
    for i in range(N_NOTES):
        hits = search_vault(vault, f"uniquephrase{i}", limit=5)
        assert len(hits) == 1, f"note{i}.md missing from FTS index after concurrent ensure_fresh"

    conn = connect(index_db_path(vault.resolve()))
    try:
        have = current_chunk_keys(conn, slow_embedder.name)
    finally:
        conn.close()
    for i in range(N_NOTES):
        assert f"note{i}.md" in have, f"note{i}.md missing from vector index after concurrent ensure_fresh"
