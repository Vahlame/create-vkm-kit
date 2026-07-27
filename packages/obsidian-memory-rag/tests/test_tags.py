"""One definition of "a #tag", agreed on by every module that reads them.

There used to be three regexes, and they disagreed observably:

- ``knowledge_graph``  ``(?<![\\w#])#(?P<tag>[A-Za-z0-9_/-]+)``   — the canonical one
- ``complete``         ``(?:^|\\s)#([A-Za-z0-9][\\w/-]*)``          — missed ``(#paren)``
- ``reflect``          ``(?<!\\w)#([\\w][\\w/-]*)``                  — matched ``##tag``,
                                                                    and skipped the hex filter

The consequence was not academic: ``vault_complete`` could suggest a tag
``vault_observations`` had never indexed, and the reflection digest counted ``##Heading``
as a tag while an inline colour palette flooded its "top tags".

`knowledge_graph`'s rule is canonical because the persisted ``observations.tags`` column
is built from it — anything else is already downstream.
"""

from __future__ import annotations

from obsidian_memory_rag.complete import extract_tags as complete_extract
from obsidian_memory_rag.knowledge_graph import parse_observations
from obsidian_memory_rag.tags import extract_tags, is_css_hex_color


def _kg_tags(line: str) -> list[str]:
    """Tags as the knowledge graph records them, for the same text."""
    obs = parse_observations(f"- [fact] {line}")
    return list(obs[0].tags) if obs else []


# (text, expected tags) — each case is one the three regexes used to answer differently.
CASES = [
    ("plain #database usage", ["database"]),
    ("hierarchical #a/b nested", ["a/b"]),
    ("dashed #multi-word tag", ["multi-word"]),
    ("numeric #2024 year is a tag", ["2024"]),
    # complete.py's `(?:^|\s)` guard needed whitespace before the '#', so a tag in
    # parentheses was invisible to it while knowledge_graph had already indexed it.
    ("in parens (#paren) here", ["paren"]),
    # reflect.py's lookbehind only rejected word chars, so the second '#' of '##tag'
    # matched and a Markdown heading became a tag.
    ("## Heading is not a tag", []),
    ("##doubled is not a tag either", []),
    # Only knowledge_graph applied the hex filter, so a palette flooded reflect's counts.
    ("palette #e63946 #f1faee #fff #000", []),
]


def test_every_module_agrees_on_what_a_tag_is() -> None:
    for text, expected in CASES:
        assert extract_tags(text) == expected, f"shared extractor on {text!r}"
        assert complete_extract(text) == expected, f"completion trie on {text!r}"
        assert _kg_tags(text) == expected, f"knowledge graph on {text!r}"


def test_hex_colours_are_dropped_but_numeric_years_survive() -> None:
    for colour in ("fff", "000", "e63946", "f1faee", "aabbccdd"):
        assert is_css_hex_color(colour), colour
    # A 4-digit all-numeric token is a year, which Obsidian permits as a tag; only a
    # 4-char RGBA with a hex LETTER is treated as a colour.
    assert not is_css_hex_color("2024")
    assert is_css_hex_color("abcd")
    assert not is_css_hex_color("notahexcolour")


def test_first_seen_order_and_dedup() -> None:
    assert extract_tags("#b then #a then #b again") == ["b", "a"]


def test_lower_folds_case_only_when_asked() -> None:
    # The reflection digest counts case-insensitively; the completion trie must not,
    # because it offers the user back the spelling they wrote.
    assert extract_tags("#Tauri and #tauri") == ["Tauri", "tauri"]
    assert extract_tags("#Tauri and #tauri", lower=True) == ["tauri"]
