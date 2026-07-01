from __future__ import annotations

from obsidian_memory_rag.knowledge_graph import (
    RELATES_TO,
    is_css_hex_color,
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


def test_parse_relations_ignores_fenced_and_inline_code_examples() -> None:
    # Docs explaining the relation syntax with a fenced example must not mint a
    # real "implements" edge to a target that was only ever an illustration.
    text = (
        "- implements [[adr-0014]]\n\n"
        "Example: `- supersedes [[adr-0019]]`\n\n"
        "```\n"
        "- extends [[some-example]]\n"
        "```\n"
    )
    rels = parse_relations(text)
    targets = {r.target for r in rels}
    assert targets == {"adr-0014"}


def test_parse_observations_ignores_fenced_code_examples() -> None:
    # A fenced example of the observation syntax (e.g. in a template/README note)
    # must not be parsed as a real fact.
    text = "```\n- [decision] example only, not a real fact\n```\n- [decision] the real one\n"
    obs = parse_observations(text)
    assert [o.content for o in obs] == ["the real one"]


def test_parse_observations_extracts_category_and_tags() -> None:
    text = "- [decision] weighted RRF weight 0.1 #ranking #rrf\n- [gotcha] dense scores #rrf\n"
    obs = parse_observations(text)
    assert (obs[0].category, obs[0].tags) == ("decision", ("ranking", "rrf"))
    assert obs[0].content == "weighted RRF weight 0.1 #ranking #rrf"
    assert obs[1].category == "gotcha"


def test_css_hex_colors_do_not_pollute_tags() -> None:
    # A color palette inside an observation (PROJECTS/ap-sport.md had
    # "#FFF #000 #E63946 #8D99AE") must not flood the tag index with junk entries.
    text = "- [fact] Paleta: #FFF #000 #E63946 #8D99AE #target-matching #2024\n"
    obs = parse_observations(text)
    assert obs[0].tags == ("target-matching", "2024")


def test_is_css_hex_color_classification() -> None:
    assert is_css_hex_color("fff")  # 3-digit shorthand
    assert is_css_hex_color("e63946") and is_css_hex_color("8d99ae")  # 6-digit
    assert is_css_hex_color("000")  # pure digits, but a color length
    assert is_css_hex_color("1a2b3c4d")  # 8-digit RGBA
    assert not is_css_hex_color("2024")  # 4 digits, no hex letter -> year tag kept
    assert not is_css_hex_color("16")  # not a CSS color length
    assert not is_css_hex_color("laser")
    assert not is_css_hex_color("target-matching")


def test_task_checkboxes_are_not_observations() -> None:
    text = "- [ ] todo item\n- [x] done item\n- [X] also done\n- [fact] a real one\n"
    obs = parse_observations(text)
    assert [o.category for o in obs] == ["fact"]


def test_bare_wikilink_list_item_is_not_an_observation() -> None:
    # Regression: `- [[note]]` must not parse as an observation with a `[note` category.
    obs = parse_observations("- [[typescript]]\n")
    assert obs == []
