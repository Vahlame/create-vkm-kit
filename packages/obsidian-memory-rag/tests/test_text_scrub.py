from __future__ import annotations

from obsidian_memory_rag.text_scrub import strip_code_regions


def test_strips_fenced_block_content() -> None:
    text = "before\n\n```\nsecret [[target]]\n```\n\nafter [[real]]\n"
    out = strip_code_regions(text)
    assert "[[target]]" not in out
    assert "[[real]]" in out


def test_strips_inline_code_span() -> None:
    text = "see `[[target]]` for syntax, but [[real]] is a real link\n"
    out = strip_code_regions(text)
    assert "[[target]]" not in out
    assert "[[real]]" in out


def test_preserves_line_count_and_offsets() -> None:
    text = "a\n```\nb\nc\n```\nd\n"
    out = strip_code_regions(text)
    assert len(out.split("\n")) == len(text.split("\n"))
    assert len(out) == len(text)


def test_handles_crlf_fenced_blocks() -> None:
    # This kit's own vault notes are CRLF-terminated (see doctrine) — the closing
    # fence line still has a trailing '\r' before the '\n', which must not defeat
    # the end-of-line anchor.
    text = "before\r\n\r\n```\r\n- implements [[adr-0014]]\r\n```\r\n\r\nafter [[real]]\r\n"
    out = strip_code_regions(text)
    assert "[[adr-0014]]" not in out
    assert "[[real]]" in out


def test_tilde_fence_supported() -> None:
    text = "```\nnot this\n```\n~~~\nsecret [[target]]\n~~~\nafter [[real]]\n"
    out = strip_code_regions(text)
    assert "[[target]]" not in out
    assert "[[real]]" in out


def test_unfenced_wikilinks_are_untouched() -> None:
    text = "plain prose with [[a]] and [[b]]\n"
    assert strip_code_regions(text) == text
