"""Split a Markdown note into heading-aware retrieval chunks.

Embedding and returning *chunks* instead of whole notes is the main token saver
of the hybrid memory: a query matches a specific section, and search hands the
agent just that passage — so it rarely has to read the full note. Splitting is
heading-first (Markdown ``#``..``######``), then size-capped packing of
paragraphs within each section.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*\S)\s*$")
_FENCE_MARKER_RE = re.compile(r"^(```|~~~)")


@dataclass
class Chunk:
    ordinal: int
    heading: str
    text: str


def _pack(text: str, max_chars: int) -> list[str]:
    """Greedily pack paragraphs into pieces of at most ``max_chars`` characters."""
    pieces: list[str] = []
    buf = ""
    for para in re.split(r"\n\s*\n", text):
        para = para.strip()
        if not para:
            continue
        if buf and len(buf) + len(para) + 2 > max_chars:
            pieces.append(buf)
            buf = ""
        if len(para) <= max_chars:
            buf = f"{buf}\n\n{para}" if buf else para
        else:
            # Hard-split an oversized paragraph, preferring a space near the cap.
            start = 0
            while start < len(para):
                end = min(start + max_chars, len(para))
                if end < len(para):
                    sp = para.rfind(" ", start + max_chars // 2, end)
                    if sp != -1:
                        end = sp
                pieces.append(para[start:end].strip())
                start = end
    if buf:
        pieces.append(buf)
    return pieces


def split_into_chunks(
    title: str, body: str, *, max_chars: int = 800, min_chars: int = 40
) -> list[Chunk]:
    """Split a note into heading-scoped, size-capped chunks.

    Each chunk carries the nearest heading (the note title for the preamble) so
    embedding and display keep section context. Tiny trailing fragments are folded
    into the previous chunk to avoid noise. A note with no body falls back to a
    single chunk built from the title.

    A ``#``-prefixed line inside a fenced code block (```` ``` ```` or ``~~~``) is
    real code (e.g. a shell comment or Python ``#`` comment), not a heading — fence
    state is tracked across lines so it's never mistaken for one. The line itself is
    still kept verbatim in the chunk text; only heading *detection* is suppressed.
    """
    sections: list[tuple[str, str]] = []
    cur_heading = (title or "").strip()
    cur_lines: list[str] = []
    in_fence = False
    fence_marker: str | None = None
    for line in (body or "").split("\n"):
        stripped = line.strip()
        fence_match = _FENCE_MARKER_RE.match(stripped)
        if fence_match:
            marker = fence_match.group(1)
            if not in_fence:
                in_fence, fence_marker = True, marker
            elif marker == fence_marker:
                in_fence, fence_marker = False, None
            cur_lines.append(line)
            continue
        m = None if in_fence else _HEADING_RE.match(stripped)
        if m:
            if cur_lines:
                sections.append((cur_heading, "\n".join(cur_lines)))
                cur_lines = []
            cur_heading = m.group(2).strip()
        else:
            cur_lines.append(line)
    if cur_lines:
        sections.append((cur_heading, "\n".join(cur_lines)))

    chunks: list[Chunk] = []
    for heading, text in sections:
        text = text.strip()
        if not text:
            continue
        for piece in _pack(text, max_chars):
            if not piece:
                continue
            if len(piece) < min_chars and chunks:
                prev = chunks[-1]
                chunks[-1] = Chunk(prev.ordinal, prev.heading, f"{prev.text}\n\n{piece}")
            else:
                chunks.append(Chunk(len(chunks), heading, piece))

    if not chunks:
        fallback = (body or title or "").strip()
        if fallback:
            chunks.append(Chunk(0, (title or "").strip(), fallback[:max_chars]))
    return chunks
