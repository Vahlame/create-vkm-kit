"""Blank out Markdown code regions before structural scanning (wikilinks, headings).

``graphlink``/``knowledge_graph``/``audit`` all regex-scan raw note text for
``[[wikilinks]]`` (and ``chunking`` for ``#`` headings), with no Markdown-structure
awareness. A note that *documents* the syntax — e.g. a fenced example showing
``- implements [[adr-0014]]``, or inline code like `` `[[target]]` `` — contains the
literal bytes ``[[...]]`` despite not being a real edge. That mints a bogus relation
or a false "broken link" for a target that was never meant to exist. This module is
the shared fix: blank fenced code blocks and inline code spans (replacing content
with spaces/blank lines, so line numbers and character offsets are unchanged for any
caller that still walks the result structurally) before any regex sees the text.
"""

from __future__ import annotations

import re

_FENCED_BLOCK_RE = re.compile(r"^([ \t]*)(```|~~~).*?^\1\2[ \t]*\r?$", re.MULTILINE | re.DOTALL)
_INLINE_CODE_RE = re.compile(r"`[^`\n]+`")


def _blank_fenced(match: "re.Match[str]") -> str:
    return "\n".join(" " * len(line) for line in match.group(0).split("\n"))


def strip_code_regions(text: str) -> str:
    """Return ``text`` with fenced code blocks and inline code spans blanked out.

    Line count and character offsets are preserved (blanks, not deletions), so a
    line-based scan (``splitlines()``) or a position-sensitive one still lines up
    with the original note.
    """
    text = _FENCED_BLOCK_RE.sub(_blank_fenced, text)
    text = _INLINE_CODE_RE.sub(lambda m: " " * len(m.group(0)), text)
    return text
