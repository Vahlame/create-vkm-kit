from __future__ import annotations

from obsidian_memory_rag.chunking import split_into_chunks


def test_splits_by_heading() -> None:
    body = (
        "Some introductory text that is reasonably long to stand on its own here.\n\n"
        "## Section A\n\nAlpha content describing the first topic in enough detail.\n\n"
        "## Section B\n\nBeta content describing a second unrelated topic in detail.\n"
    )
    chunks = split_into_chunks("Title", body)
    headings = [c.heading for c in chunks]
    assert "Section A" in headings
    assert "Section B" in headings
    assert chunks[0].heading == "Title"  # preamble carries the note title
    assert [c.ordinal for c in chunks] == list(range(len(chunks)))


def test_size_cap_splits_long_section() -> None:
    big = " ".join(f"word{i}" for i in range(400))  # one paragraph, well over 800 chars
    chunks = split_into_chunks("T", f"## Big\n\n{big}")
    assert len(chunks) >= 2
    assert all(len(c.text) <= 800 for c in chunks)


def test_title_only_note_yields_one_chunk() -> None:
    chunks = split_into_chunks("Solo title", "")
    assert len(chunks) == 1
    assert chunks[0].text  # non-empty fallback built from the title


def test_tiny_fragment_folds_into_previous() -> None:
    body = "## A\n\n" + ("x" * 200) + "\n\n## B\n\nhi"
    chunks = split_into_chunks("T", body)
    assert any("hi" in c.text for c in chunks)  # the tiny "hi" is not dropped


def test_hash_comment_inside_fenced_code_is_not_a_heading() -> None:
    # A shell/Python comment inside a fenced example starts with '#' but is real
    # code, not a section heading — and the fence content must survive verbatim.
    body = (
        "## Real section\n\n"
        "Some prose introducing the snippet below.\n\n"
        "```bash\n"
        "# this looks like a heading but is a shell comment\n"
        "echo hi\n"
        "```\n\n"
        "## Next section\n\n"
        "Enough prose in this section to clear the tiny-fragment folding threshold.\n"
    )
    chunks = split_into_chunks("T", body)
    headings = [c.heading for c in chunks]
    assert "this looks like a heading but is a shell comment" not in headings
    assert "Real section" in headings
    assert "Next section" in headings
    joined = "\n".join(c.text for c in chunks)
    assert "# this looks like a heading but is a shell comment" in joined
    assert "echo hi" in joined
