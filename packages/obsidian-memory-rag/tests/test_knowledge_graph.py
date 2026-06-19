from __future__ import annotations

from obsidian_memory_rag.knowledge_graph import (
    RELATES_TO,
    normalize_relation_type,
    parse_observations,
    parse_relations,
)


def test_normalize_relation_type_snake_cases() -> None:
    assert normalize_relation_type("See Also") == "see_also"
    assert normalize_relation_type("part-of") == "part_of"
    assert normalize_relation_type("  implements  ") == "implements"
    assert normalize_relation_type("") == ""


def test_parse_relations_typed_with_context() -> None:
    text = "- implements [[adr-0014]]\n- supersedes [[ADR-0019]] (replaced the rescan)\n"
    rels = parse_relations(text)
    assert (rels[0].relation_type, rels[0].target) == ("implements", "adr-0014")
    assert rels[1].relation_type == "supersedes"
    assert rels[1].target == "adr-0019"
    assert rels[1].context == "replaced the rescan"


def test_bare_and_inline_wikilinks_become_relates_to() -> None:
    text = "Prose mentioning [[python]] inline.\n- [[STACKS/sqlite]]\n"
    rels = parse_relations(text)
    types = {(r.relation_type, r.target) for r in rels}
    assert (RELATES_TO, "python") in types
    assert (RELATES_TO, "stacks/sqlite") in types


def test_typed_target_not_duplicated_as_relates_to() -> None:
    # The same target is both typed and mentioned inline; it must appear once, typed.
    text = "- implements [[adr-0014]]\nSee [[adr-0014]] again.\n"
    rels = parse_relations(text)
    adr_edges = [r for r in rels if r.target == "adr-0014"]
    assert len(adr_edges) == 1
    assert adr_edges[0].relation_type == "implements"


def test_prose_bullet_does_not_mint_a_relation_type() -> None:
    # A prose bullet with words before the link is NOT a typed relation — the link
    # still becomes relates_to, but the relation_type is never "lección"/"cross".
    text = "- Lección cross-proyecto en [[lessons-learned]]\n"
    rels = parse_relations(text)
    assert [(r.relation_type, r.target) for r in rels] == [(RELATES_TO, "lessons-learned")]


def test_parse_observations_extracts_category_and_tags() -> None:
    text = "- [decision] weighted RRF weight 0.1 #ranking #rrf\n- [gotcha] dense scores #rrf\n"
    obs = parse_observations(text)
    assert (obs[0].category, obs[0].tags) == ("decision", ("ranking", "rrf"))
    assert obs[0].content == "weighted RRF weight 0.1 #ranking #rrf"
    assert obs[1].category == "gotcha"


def test_task_checkboxes_are_not_observations() -> None:
    text = "- [ ] todo item\n- [x] done item\n- [X] also done\n- [fact] a real one\n"
    obs = parse_observations(text)
    assert [o.category for o in obs] == ["fact"]


def test_bare_wikilink_list_item_is_not_an_observation() -> None:
    # Regression: `- [[note]]` must not parse as an observation with a `[note` category.
    obs = parse_observations("- [[typescript]]\n")
    assert obs == []
