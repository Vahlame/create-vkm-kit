"""Typed relations + structured observations parsed from Markdown notes (ADR-0023).

This is the *structured* layer of the knowledge graph. ADR-0019 already treats the
vault as a graph for retrieval — but every edge is the same untyped "A links to B",
and the graph is only ever a ranking nudge, never something you can *ask a question*.
Competing memory systems (Basic Memory, MemPalace) expose a richer, queryable model:
**typed relations** (``implements``, ``supersedes`` — not just "links to") and
**categorized observations** (``[decision] … #tag``). This module brings the same
expressivity here while keeping the kit's invariants intact:

- **Markdown stays the source of truth.** The structure lives *inside the notes* as
  plain conventions; this module only *parses* it. Nothing here writes.
- **Byte-compatible with Basic Memory's syntax**, so a vault authored for one works
  in the other — relations are ``- relation_type [[Target]] (optional context)`` list
  items; observations are ``- [category] content #tags`` list items.
- **Pure stdlib, deterministic.** Same ``WIKILINK_RE`` / ``normalize_target`` as
  ``graphlink.py`` and ``audit.py`` so all three see the exact same edges.

Back-compat with the untyped graph: a note's *typed* relations come only from list
items of the exact shape ``- <single_token> [[target]]``; **every other**
``[[wikilink]]`` in the note becomes an untyped ``relates_to`` edge. The union of
both is precisely the set of wikilink edges ``graphlink.py`` already counts, so the
adjacency the retrieval signal sees is unchanged — only now some edges carry a type.

Design notes that earn their keep:

- **Relation types are a single token** (``implements``, ``part_of``, ``see_also``)
  anchored immediately after the list marker. This is deliberately strict: a prose
  bullet like ``- Lección cross-proyecto en [[x]]`` must NOT become a relation of
  type "lección" — and it doesn't, because the token after the marker is followed by
  more prose, not ``[[``. Multi-word relations use underscores, as in Basic Memory.
- **Task checkboxes are not observations.** ``- [ ]`` / ``- [x]`` look like
  ``- [category]`` but are GFM tasks; categories that are only a checkbox marker
  (empty, space, ``x``/``X``) are rejected.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .graphlink import WIKILINK_RE, normalize_target
from .text_scrub import strip_code_regions

# The default type for a bare ``[[wikilink]]`` that carries no explicit relation
# verb — matches Basic Memory's implicit-link semantics.
RELATES_TO = "relates_to"

# A typed-relation list item: ``- <type> [[target]] (optional context)``.
# The type is a SINGLE token starting with a letter, anchored right after the list
# marker and immediately followed by the wikilink — that anchoring is what keeps
# prose bullets ("- see [[x]] for details") from minting garbage relation types.
_TYPED_REL_RE = re.compile(
    r"^\s*[-*+]\s+"
    r"(?P<type>[A-Za-z][A-Za-z0-9_-]*)\s+"
    r"\[\[(?P<target>[^\[\]]+?)\]\]"
    r"\s*(?:\((?P<context>[^)]*)\))?\s*$"
)

# A structured-observation list item: ``- [category] content #tags``. The opening
# bracket must be a SINGLE ``[`` (negative lookahead for a second ``[``) so a bare
# wikilink list item ``- [[note]]`` is a relation, never an observation with a
# bogus ``[note`` category; the category itself holds no brackets.
_OBSERVATION_RE = re.compile(
    r"^\s*[-*+]\s+\[(?!\[)(?P<category>[^\]\[]*)\]\s*(?P<rest>.*)$"
)

# Inline ``#tag`` (incl. Obsidian hierarchical ``#a/b``). The lookbehind rejects a
# Markdown heading ``## H`` and a second ``#`` of ``##tag``; a digit-only tag like
# ``#2024`` is allowed (Obsidian permits it).
_TAG_RE = re.compile(r"(?<![\w#])#(?P<tag>[A-Za-z0-9_/-]+)")

# Bracket contents that are GFM task markers, not observation categories.
_CHECKBOX_MARKERS = frozenset({"", "x"})

_HEX_DIGITS = frozenset("0123456789abcdef")
_HEX_LETTERS = frozenset("abcdef")


def is_css_hex_color(tag: str) -> bool:
    """True if a ``#tag`` token is really a CSS hex color (``fff``, ``e63946``).

    A color palette written inline (``#e63946 #f1faee #fff #000``) otherwise floods
    the tag index with meaningless entries. Lengths 3/6/8 of pure hex digits are
    unambiguous CSS colors; length 4 (RGBA) is only treated as a color when it
    contains a hex *letter*, so a 4-digit numeric tag like ``#2024`` (a year —
    Obsidian permits numeric tags) is preserved.
    """
    t = tag.lower()
    if not t or any(c not in _HEX_DIGITS for c in t):
        return False
    if len(t) in (3, 6, 8):
        return True
    if len(t) == 4:
        return any(c in _HEX_LETTERS for c in t)
    return False


def normalize_relation_type(raw: str) -> str:
    """Normalize a relation verb to a snake_case key (``See Also`` -> ``see_also``).

    Lowercases, trims, and collapses internal whitespace/dashes to single
    underscores. Returns ``""`` for an empty input.
    """
    s = raw.strip().lower()
    if not s:
        return ""
    return re.sub(r"[\s-]+", "_", s)


@dataclass(frozen=True)
class Relation:
    """A typed directed edge from the containing note to ``target``.

    ``target`` is the normalized wikilink key (see :func:`graphlink.normalize_target`),
    resolved to a real note path later by the indexer. ``context`` is the optional
    ``(parenthetical)`` trailing a relation line, or ``""``.
    """

    relation_type: str
    target: str
    context: str = ""


@dataclass(frozen=True)
class Observation:
    """A categorized fact stated in a note, with any inline ``#tags`` pulled out."""

    category: str
    content: str
    tags: tuple[str, ...] = field(default_factory=tuple)


def parse_relations(text: str) -> list[Relation]:
    """Extract typed + untyped relations from a note body (first-seen order, deduped).

    Two passes that together reproduce the untyped wikilink edge set exactly:

    1. **Typed:** list items ``- <type> [[target]] (context)`` -> ``Relation(type, …)``.
    2. **Untyped:** every remaining ``[[wikilink]]`` whose target was not already
       emitted by a typed relation -> ``Relation("relates_to", target)``.

    Dedup key is ``(relation_type, target)``, so the same target may appear under two
    different verbs but never twice under one.

    Fenced code blocks and inline code spans are blanked before scanning, so a
    documentation example (``- implements [[adr-0014]]`` inside a fence, or
    `` `[[target]]` `` inline) never mints a bogus relation.
    """
    text = strip_code_regions(text)
    relations: list[Relation] = []
    seen: set[tuple[str, str]] = set()
    typed_targets: set[str] = set()

    for line in text.splitlines():
        m = _TYPED_REL_RE.match(line)
        if not m:
            continue
        rtype = normalize_relation_type(m.group("type"))
        target = normalize_target(m.group("target"))
        if not rtype or not target:
            continue
        typed_targets.add(target)
        key = (rtype, target)
        if key not in seen:
            seen.add(key)
            context = (m.group("context") or "").strip()
            relations.append(Relation(rtype, target, context))

    for m in WIKILINK_RE.finditer(text):
        target = normalize_target(m.group(1))
        if not target or target in typed_targets:
            continue
        key = (RELATES_TO, target)
        if key not in seen:
            seen.add(key)
            relations.append(Relation(RELATES_TO, target))

    return relations


def _clean_category(raw: str) -> str | None:
    """Return the normalized observation category, or ``None`` for a task checkbox.

    ``[decision]`` -> ``"decision"``; ``[ ]`` / ``[x]`` / ``[X]`` -> ``None``.
    """
    cat = raw.strip().lower()
    if cat in _CHECKBOX_MARKERS:
        return None
    return cat


def parse_observations(text: str) -> list[Observation]:
    """Extract ``- [category] content #tags`` observations (first-seen order).

    Skips GFM task checkboxes (``- [ ]`` / ``- [x]``). Inline ``#tags`` are pulled
    into ``tags`` (deduped, order-preserving) and also left in ``content`` verbatim,
    so a caller can show the original line or query by tag.

    Fenced code blocks and inline code spans are blanked before scanning, so a
    documentation example of the observation syntax is never parsed as a real fact.
    """
    text = strip_code_regions(text)
    observations: list[Observation] = []
    for line in text.splitlines():
        m = _OBSERVATION_RE.match(line)
        if not m:
            continue
        category = _clean_category(m.group("category"))
        if category is None:
            continue
        content = m.group("rest").strip()
        tags: list[str] = []
        for tm in _TAG_RE.finditer(content):
            tag = tm.group("tag").lower()
            if tag not in tags and not is_css_hex_color(tag):
                tags.append(tag)
        observations.append(Observation(category, content, tuple(tags)))
    return observations
