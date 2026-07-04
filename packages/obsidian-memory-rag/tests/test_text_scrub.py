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


def test_double_backtick_span_with_inner_backticks() -> None:
    # Real case from the kit's own vault: a note documenting the syntax writes
    # `` `[[target]]` `` (double-backtick span, single backtick inside). A
    # single-backtick regex mispairs the delimiters and the wikilink leaks.
    text = "syntax note (e.g. `` `[[target]]` `` or `- implements [[adr-0014]]`) but [[real]]\n"
    out = strip_code_regions(text)
    assert "[[target]]" not in out
    assert "[[adr-0014]]" not in out
    assert "[[real]]" in out


def test_backtick_parity_preserved_after_multi_backtick_span() -> None:
    # A mispaired multi-backtick span must not flip the open/close parity for
    # later single-backtick spans on the same line.
    text = "first `` `x` `` then `[[hidden]]` and [[real]]\n"
    out = strip_code_regions(text)
    assert "[[hidden]]" not in out
    assert "[[real]]" in out


def test_lone_backtick_is_left_alone() -> None:
    text = "a stray ` backtick with [[real]]\n"
    assert "[[real]]" in strip_code_regions(text)
