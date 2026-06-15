"""A prefix tree (Trie) for autocompleting note titles, filenames and tags.

A Trie shares common prefixes across all keys, so a completion lookup costs
``O(len(prefix))`` to walk to the branch plus ``O(matches)`` to collect the
words beneath it — independent of how many keys are stored. That is the exact
shape of the "type a prefix, get the words under it" problem (autocomplete,
predictive text), which is why a Trie beats scanning every title on each call.

Pure stdlib; keys are matched case-folded while the original display string is
preserved for output (see :mod:`.complete`).
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class _Node:
    children: dict[str, "_Node"] = field(default_factory=dict)
    values: set[str] = field(default_factory=set)  # display strings ending here


class Trie:
    """Insert ``key`` (matched case-folded) carrying a ``value`` (shown verbatim)."""

    def __init__(self) -> None:
        self._root = _Node()

    def insert(self, key: str, value: str | None = None) -> None:
        """Store ``value`` (default: ``key``) under the path spelled by ``key``."""
        if not key:
            return
        node = self._root
        for ch in key:
            node = node.children.setdefault(ch, _Node())
        node.values.add(key if value is None else value)

    def complete(self, prefix: str, *, limit: int = 20) -> list[str]:
        """Return display values whose key starts with ``prefix`` (sorted, deduped).

        An empty prefix lists everything (still capped by ``limit``); a prefix
        with no branch returns ``[]``.
        """
        node = self._root
        for ch in prefix:
            nxt = node.children.get(ch)
            if nxt is None:
                return []
            node = nxt
        collected: set[str] = set()
        self._collect(node, collected)
        return sorted(collected)[:limit]

    def _collect(self, node: _Node, out: set[str]) -> None:
        out.update(node.values)
        for child in node.children.values():
            self._collect(child, out)
