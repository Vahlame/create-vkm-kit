"""What counts as an inline ``#tag`` — one answer, for the whole engine.

There used to be three, and they disagreed observably:

===========================  =========================================  ==========================
module                        pattern                                    disagreed on
===========================  =========================================  ==========================
``knowledge_graph``          ``(?<![\\w#])#(?P<tag>[A-Za-z0-9_/-]+)``     —
``complete``                 ``(?:^|\\s)#([A-Za-z0-9][\\w/-]*)``           ``(#paren)`` missed
``reflect``                  ``(?<!\\w)#([\\w][\\w/-]*)``                   ``##tag`` matched
===========================  =========================================  ==========================

So ``vault_complete`` could suggest a tag ``vault_observations`` never indexed, and the
reflection digest counted ``##Heading`` as a tag. Only ``knowledge_graph`` also applied
:func:`is_css_hex_color`, so a note containing a palette (``#e63946 #f1faee #fff``)
flooded the reflection's "top tags" with colours.

``knowledge_graph``'s rule is the canonical one, and not by seniority: it is what the
persisted ``observations.tags`` column is built from, so anything else is already
downstream of it. Its lookbehind ``(?<![\\w#])`` is what rejects both a Markdown heading
``## H`` and the second ``#`` of ``##tag``, while still allowing a digit-only tag like
``#2024`` (Obsidian permits those).
"""

from __future__ import annotations

import re

# Inline ``#tag`` (incl. Obsidian hierarchical ``#a/b``). The lookbehind rejects a
# Markdown heading ``## H`` and a second ``#`` of ``##tag``; a digit-only tag like
# ``#2024`` is allowed (Obsidian permits it).
TAG_RE = re.compile(r"(?<![\w#])#(?P<tag>[A-Za-z0-9_/-]+)")

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
    return len(t) == 4 and any(c in _HEX_LETTERS for c in t)


def extract_tags(text: str, *, lower: bool = False) -> list[str]:
    """Distinct inline ``#tags`` in ``text``, without the ``#``, in first-seen order.

    CSS hex colours are dropped (:func:`is_css_hex_color`). ``lower`` folds case, which
    the reflection digest wants for counting and the completion trie does not.
    """
    seen: dict[str, None] = {}
    for m in TAG_RE.finditer(text):
        tag = m.group("tag")
        if lower:
            tag = tag.lower()
        if tag and tag not in seen and not is_css_hex_color(tag):
            seen[tag] = None
    return list(seen)
