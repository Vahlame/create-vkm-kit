"""Tests for the generic ``scope`` filter (scoped-memory contract, ADR-0074).

One vault, per-agent/per-project namespaces inside it: ``scope`` is a posix-style
relative path prefix matched at segment boundaries — a path P matches scope S iff
``P == S``, ``P == S + '.md'`` or ``P.startswith(S + '/')`` (case-sensitive).
Invalid scopes (``..``, leading ``/``, drive letter, backslashes, empty) are
rejected with an error, never silently unfiltered. The filter threads through
FTS, vector, hybrid (including graph recall) and the knowledge-graph queries,
and the CLI wires it as ``--scope`` with a JSON error object on the json twins.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from obsidian_memory_rag import (
    HashingEmbedder,
    cli,
    hybrid_search,
    index_vault,
    index_vectors,
    observations_query,
    relations_for,
    search_vault,
    semantic_search,
)
from obsidian_memory_rag.paths import scope_matches, validate_scope

EMB = HashingEmbedder(dim=128)
QUERY = "scope filter retrieval contract"

# The fixture spans every namespace the contract names: a project note plus a
# same-named folder (segment-boundary probe), a sibling whose name shares the
# prefix ("vkm-kit" must NOT match scope "PROJECTS/vkm"), two agent memories,
# and a RESEARCH source (scope+section composition).
NOTES: dict[str, str] = {
    "PROJECTS/vkm.md": (
        "# vkm\n\nUmbrella note: scope filter retrieval contract for the memory kit.\n\n"
        "- part_of [[PROJECTS/vkm-kit]]\n"
        "- [decision] scope filtering is a frozen retrieval contract #scope\n"
    ),
    "PROJECTS/vkm/design.md": (
        "# design\n\nDesign notes on the scope filter retrieval contract internals.\n"
    ),
    "PROJECTS/vkm-kit.md": (
        "# vkm-kit\n\nInstaller project; scope filter retrieval contract applies here too.\n\n"
        "- [gotcha] segment boundary matters for scope prefixes #scope\n"
    ),
    "PROJECTS/graph-only.md": (
        "# graph-only\n\nA note reachable only through the wikilink graph.\n"
    ),
    "AGENTS/vkm-implementer.md": (
        "# vkm-implementer\n\nAgent memory: implemented the scope filter retrieval "
        "contract.\n\nLinked context: [[PROJECTS/graph-only]].\n\n"
        "- implements [[PROJECTS/vkm-kit]]\n"
        "- [failure] first scope draft matched raw prefixes, not segment boundaries #scope\n"
    ),
    "AGENTS/other-agent.md": (
        "# other-agent\n\nUnrelated agent memory about deployment pipelines.\n"
    ),
    "RESEARCH/scope/sources/aaaa-prior-art.md": (
        "# Prior art\n\nWeb research: scope filter retrieval contract prior art.\n"
    ),
}

INVALID_SCOPES = (
    "",
    "..",
    "../x",
    "PROJECTS/../AGENTS",
    "a..b",
    "/PROJECTS",
    "C:/vault",
    "c:relative",
    "AGENTS\\vkm",
)


@pytest.fixture(scope="module")
def vault(tmp_path_factory: pytest.TempPathFactory) -> Path:
    root = tmp_path_factory.mktemp("scope-vault")
    for rel, body in NOTES.items():
        fp = root / rel
        fp.parent.mkdir(parents=True, exist_ok=True)
        fp.write_text(body, encoding="utf-8")
    index_vault(root)
    index_vectors(root, EMB)
    return root


# --- scope_matches: the frozen matching rule ---------------------------------------


@pytest.mark.parametrize(
    ("path", "scope", "expected"),
    [
        ("PROJECTS/vkm.md", "PROJECTS/vkm", True),  # P == S + ".md"
        ("PROJECTS/vkm/x.md", "PROJECTS/vkm", True),  # P startswith S + "/"
        ("PROJECTS/vkm", "PROJECTS/vkm", True),  # P == S
        ("PROJECTS/vkm-kit.md", "PROJECTS/vkm", False),  # segment boundary
        ("PROJECTS/vkmx/x.md", "PROJECTS/vkm", False),  # segment boundary
        ("projects/vkm.md", "PROJECTS/vkm", False),  # case-sensitive
        ("AGENTS/vkm-implementer.md", "AGENTS", True),
        ("AGENTS.md", "AGENTS", True),  # top-level note form
        ("AGENTSX/x.md", "AGENTS", False),
        ("PROJECTS/vkm.md", None, True),  # None = unfiltered
    ],
)
def test_scope_matches_segment_boundary(path: str, scope: str | None, expected: bool) -> None:
    assert scope_matches(path, scope) is expected


@pytest.mark.parametrize("bad", INVALID_SCOPES)
def test_validate_scope_rejects(bad: str) -> None:
    with pytest.raises(ValueError, match="invalid scope"):
        validate_scope(bad)


def test_validate_scope_accepts_safe_prefixes() -> None:
    for ok in (None, "AGENTS", "PROJECTS/vkm-kit", "a.b/c-d_e", "RESEARCH/scope"):
        validate_scope(ok)  # must not raise


# --- search_vault (FTS/BM25) -------------------------------------------------------


def test_search_vault_scope_segment_boundary(vault: Path) -> None:
    hits = search_vault(vault, QUERY, scope="PROJECTS/vkm")
    paths = {h.path for h in hits}
    assert paths == {"PROJECTS/vkm.md", "PROJECTS/vkm/design.md"}
    # The sibling sharing the raw prefix is only reachable via the wider scope.
    wider = {h.path for h in search_vault(vault, QUERY, scope="PROJECTS")}
    assert "PROJECTS/vkm-kit.md" in wider


def test_search_vault_scope_none_matches_omitted(vault: Path) -> None:
    explicit = search_vault(vault, QUERY, scope=None)
    omitted = search_vault(vault, QUERY)
    assert [(h.path, h.bm25) for h in explicit] == [(h.path, h.bm25) for h in omitted]
    # Sanity: unfiltered really spans several namespaces.
    paths = {h.path for h in explicit}
    assert any(p.startswith("AGENTS/") for p in paths)
    assert any(p.startswith("PROJECTS/") for p in paths)


def test_search_vault_scope_composes_with_section(vault: Path) -> None:
    memory = search_vault(vault, QUERY, section="memory", scope="PROJECTS/vkm")
    assert {h.path for h in memory} == {"PROJECTS/vkm.md", "PROJECTS/vkm/design.md"}
    # Disjoint section and scope: an error-free empty result, never a leak.
    assert search_vault(vault, QUERY, section="research", scope="PROJECTS") == []
    research = search_vault(vault, QUERY, section="research", scope="RESEARCH/scope")
    assert {h.path for h in research} == {"RESEARCH/scope/sources/aaaa-prior-art.md"}


def test_search_vault_invalid_scope_raises(vault: Path) -> None:
    with pytest.raises(ValueError, match="invalid scope"):
        search_vault(vault, QUERY, scope="../evil")


# --- semantic_search + hybrid_search (vector hits) ---------------------------------


def test_semantic_search_scope_filters_chunk_hits(vault: Path) -> None:
    unfiltered = semantic_search(vault, QUERY, EMB, limit=50)
    assert any(not h.path.startswith("AGENTS/") for h in unfiltered)
    scoped = semantic_search(vault, QUERY, EMB, limit=50, scope="AGENTS")
    assert scoped
    assert all(h.path.startswith("AGENTS/") for h in scoped)


def test_hybrid_search_scope_filters_vector_hits(vault: Path) -> None:
    unfiltered = hybrid_search(vault, QUERY, EMB, limit=20)
    assert any(h.path == "PROJECTS/vkm-kit.md" for h in unfiltered)
    scoped = hybrid_search(vault, QUERY, EMB, limit=20, scope="PROJECTS/vkm")
    assert scoped
    assert {h.path for h in scoped} <= {"PROJECTS/vkm.md", "PROJECTS/vkm/design.md"}
    # The vector leg is filtered, not dropped: in-scope hits still carry vector ranks.
    assert any(h.vector_rank is not None for h in scoped)


def test_hybrid_search_scope_none_matches_omitted(vault: Path) -> None:
    explicit = hybrid_search(vault, QUERY, EMB, limit=10, scope=None)
    omitted = hybrid_search(vault, QUERY, EMB, limit=10)
    assert [(h.path, h.score, h.bm25_rank, h.vector_rank) for h in explicit] == [
        (h.path, h.score, h.bm25_rank, h.vector_rank) for h in omitted
    ]


def test_hybrid_search_graph_respects_scope(vault: Path) -> None:
    """A [[wikilink]] neighbour of an in-scope seed that itself lives outside the
    scope must never leak in — the link graph is scope-agnostic, so the graph
    ranking needs its own cut."""
    unfiltered = hybrid_search(vault, QUERY, EMB, limit=20, graph=True)
    assert any(h.path == "PROJECTS/graph-only.md" for h in unfiltered)
    scoped = hybrid_search(vault, QUERY, EMB, limit=20, graph=True, scope="AGENTS")
    assert scoped
    assert all(h.path.startswith("AGENTS/") for h in scoped)


def test_hybrid_search_scope_composes_with_section(vault: Path) -> None:
    hits = hybrid_search(vault, QUERY, EMB, limit=20, section="memory", scope="PROJECTS")
    assert hits
    assert all(h.path.startswith("PROJECTS/") for h in hits)
    assert hybrid_search(vault, QUERY, EMB, limit=20, section="research", scope="AGENTS") == []


def test_hybrid_search_invalid_scope_raises(vault: Path) -> None:
    with pytest.raises(ValueError, match="invalid scope"):
        hybrid_search(vault, QUERY, EMB, scope="/abs")


# --- knowledge graph: observations + relations -------------------------------------


def test_observations_scope(vault: Path) -> None:
    scoped = observations_query(vault, scope="AGENTS")
    assert scoped
    assert all(o.source_path.startswith("AGENTS/") for o in scoped)
    assert any(o.category == "failure" for o in scoped)


def test_observations_scope_composes_with_filters(vault: Path) -> None:
    # The only [gotcha] lives in PROJECTS/vkm-kit.md — outside PROJECTS/vkm at a
    # segment boundary, inside PROJECTS/vkm-kit exactly.
    assert observations_query(vault, category="gotcha", scope="PROJECTS/vkm") == []
    hit = observations_query(vault, category="gotcha", scope="PROJECTS/vkm-kit")
    assert [o.source_path for o in hit] == ["PROJECTS/vkm-kit.md"]


def test_observations_invalid_scope_raises(vault: Path) -> None:
    with pytest.raises(ValueError, match="invalid scope"):
        observations_query(vault, scope="a\\b")


def test_relations_scope_incoming(vault: Path) -> None:
    everyone = relations_for(vault, "PROJECTS/vkm-kit.md", direction="in")
    assert {h.source_path for h in everyone} == {"PROJECTS/vkm.md", "AGENTS/vkm-implementer.md"}
    scoped = relations_for(vault, "PROJECTS/vkm-kit.md", direction="in", scope="AGENTS")
    assert {h.source_path for h in scoped} == {"AGENTS/vkm-implementer.md"}


def test_relations_scope_outgoing(vault: Path) -> None:
    in_scope = relations_for(vault, "AGENTS/vkm-implementer.md", direction="out", scope="AGENTS")
    assert any(h.relation_type == "implements" for h in in_scope)
    # Out-edges are authored by the note itself; when that note is out of scope,
    # nothing survives.
    out_of_scope = relations_for(
        vault, "AGENTS/vkm-implementer.md", direction="out", scope="PROJECTS"
    )
    assert out_of_scope == []


def test_relations_invalid_scope_raises(vault: Path) -> None:
    with pytest.raises(ValueError, match="invalid scope"):
        relations_for(vault, "PROJECTS/vkm.md", scope="..")


# --- CLI wire contract -------------------------------------------------------------

JSON_BAD_INVOCATIONS: dict[str, list[str]] = {
    "json-search": ["--vault", "{vault}", "--query", "x", "--scope", "../evil"],
    "json-hybrid-search": ["--vault", "{vault}", "--query", "x", "--scope", ".."],
    "json-observations": ["--vault", "{vault}", "--scope", "/abs"],
    "json-relations": ["--vault", "{vault}", "PROJECTS/vkm.md", "--scope", "C:/x"],
}

HUMAN_BAD_INVOCATIONS: dict[str, list[str]] = {
    "search": ["--vault", "{vault}", "x", "--scope", "AGENTS\\x"],
    "hybrid-search": ["--vault", "{vault}", "x", "--scope", ".."],
    "observations": ["--vault", "{vault}", "--scope", ""],
    "relations": ["--vault", "{vault}", "PROJECTS/vkm.md", "--scope", "../.."],
}


@pytest.mark.parametrize("cmd", sorted(JSON_BAD_INVOCATIONS))
def test_json_command_invalid_scope_emits_error_object(
    cmd: str, vault: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    argv = [cmd] + [a.format(vault=vault) for a in JSON_BAD_INVOCATIONS[cmd]]
    cli.main(argv)  # exit 0: must NOT raise SystemExit — the bridge reads the object
    out = capsys.readouterr().out
    assert len(out.strip().splitlines()) == 1, f"{cmd} must emit exactly one line"
    payload = json.loads(out)
    assert set(payload) == {"error"}
    assert "invalid scope" in payload["error"]


@pytest.mark.parametrize("cmd", sorted(HUMAN_BAD_INVOCATIONS))
def test_human_command_invalid_scope_exits_1(
    cmd: str, vault: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    argv = [cmd] + [a.format(vault=vault) for a in HUMAN_BAD_INVOCATIONS[cmd]]
    with pytest.raises(SystemExit) as excinfo:
        cli.main(argv)
    assert excinfo.value.code == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "invalid scope" in captured.err


def test_json_search_scope_happy_path(vault: Path, capsys: pytest.CaptureFixture[str]) -> None:
    cli.main(["json-search", "--vault", str(vault), "--query", QUERY, "--scope", "PROJECTS/vkm"])
    payload = json.loads(capsys.readouterr().out)
    paths = {h["path"] for h in payload["hits"]}
    assert paths == {"PROJECTS/vkm.md", "PROJECTS/vkm/design.md"}


def test_json_observations_scope_happy_path(
    vault: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    cli.main(["json-observations", "--vault", str(vault), "--scope", "AGENTS"])
    payload = json.loads(capsys.readouterr().out)
    assert payload["filters"]["scope"] == "AGENTS"
    assert payload["count"] >= 1
    assert all(o["source_path"].startswith("AGENTS/") for o in payload["observations"])
