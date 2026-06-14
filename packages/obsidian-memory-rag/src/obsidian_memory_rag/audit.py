"""Vault health audit: size budget, broken wikilinks, SESSION_LOG growth (D4/D7).

Pure stdlib, read-only. Scans every ``*.md`` under the vault (excluding the
sidecar/tooling dirs) and reports notes that blow the per-note token budget,
``[[wikilinks]]`` whose target file does not exist, and whether ``SESSION_LOG.md``
has grown past its own threshold. The output dict is JSON-serializable verbatim so
the Node MCP bridge can forward it untouched (see ``cli.py`` ``json-audit``).
"""

from __future__ import annotations

import re
from math import ceil
from pathlib import Path

# Directories that never hold user notes: VCS metadata, the Obsidian app config,
# and our own SQLite sidecar. Excluded by name at any depth.
_EXCLUDE_DIRS = frozenset({".git", ".obsidian", ".obsidian-memory-rag"})

# [[target]] / [[target|alias]] / [[target#section]] — capture only the target.
_WIKILINK_RE = re.compile(r"\[\[([^\[\]]+?)\]\]")

# Token estimate heuristic: ~4 bytes per token. This is the same rough rule used
# across the kit (good enough for a budget alarm; we never tokenize for real here).
_BYTES_PER_TOKEN = 4

SESSION_LOG_NAME = "SESSION_LOG.md"


def _estimate_tokens(num_bytes: int) -> int:
    """Approximate token count from raw byte length (ceil(bytes / 4))."""
    return ceil(num_bytes / _BYTES_PER_TOKEN)


def _iter_md_files(vault: Path) -> list[Path]:
    """All ``*.md`` files under ``vault`` excluding the tooling/VCS dirs."""
    out: list[Path] = []
    for path in vault.rglob("*.md"):
        # Skip anything living under an excluded directory (at any depth).
        if any(part in _EXCLUDE_DIRS for part in path.relative_to(vault).parts[:-1]):
            continue
        if path.is_file():
            out.append(path)
    return out


def _wikilink_target(raw: str) -> str:
    """Normalize a raw ``[[...]]`` inner text to its target basename.

    Strips a trailing ``#section`` anchor and a ``|alias`` display label, then the
    surrounding whitespace. ``[[Note#Heading|Label]]`` -> ``Note``.
    """
    target = raw.split("|", 1)[0]  # drop display alias
    target = target.split("#", 1)[0]  # drop section anchor
    target = target.strip()
    # Obsidian links may include the .md extension explicitly ([[note.md]]); normalize it off.
    if target.lower().endswith(".md"):
        target = target[:-3]
    return target.strip()


def audit_vault(
    vault: Path,
    *,
    budget_tokens: int = 8000,
    session_log_budget: int = 6000,
) -> dict:
    """Audit a vault and return a JSON-serializable health report.

    - ``oversized``: notes whose estimated tokens exceed ``budget_tokens`` (desc).
    - ``broken_links``: ``[[target]]`` references with no ``<target>.md`` anywhere
      in the vault (case-insensitive basename match).
    - ``session_log``: token count + over-threshold flag for ``SESSION_LOG.md``
      (``None`` when the file is absent).
    """
    vault = vault.resolve()
    files = _iter_md_files(vault)

    # Index notes for link resolution two ways: by bare basename (Obsidian
    # resolves [[note]] by basename anywhere) AND by full relative path without
    # extension (path-qualified links like [[PROJECTS/foo]]). Both lowercased, posix.
    known_basenames: set[str] = {f.stem.lower() for f in files}
    known_relpaths: set[str] = {
        f.relative_to(vault).with_suffix("").as_posix().lower() for f in files
    }

    total_tokens = 0
    oversized: list[dict] = []
    broken_links: list[dict] = []
    seen_broken: set[tuple[str, str]] = set()  # dedup (source, target) pairs

    for fp in files:
        rel = fp.relative_to(vault).as_posix()
        try:
            data = fp.read_bytes()
        except OSError:
            continue
        tokens = _estimate_tokens(len(data))
        total_tokens += tokens
        if tokens > budget_tokens:
            oversized.append({"path": rel, "tokens": tokens})

        # Decode for wikilink scanning; utf-8-sig drops a leading BOM if present.
        text = data.decode("utf-8-sig", errors="replace")
        for match in _WIKILINK_RE.finditer(text):
            target = _wikilink_target(match.group(1))
            if not target:
                continue
            norm = target.replace("\\", "/").strip("/").lower()
            basename = norm.rsplit("/", 1)[-1]
            if basename in known_basenames or norm in known_relpaths:
                continue
            dedup_key = (rel, target)
            if dedup_key in seen_broken:
                continue
            seen_broken.add(dedup_key)
            broken_links.append({"source": rel, "target": target})

    oversized.sort(key=lambda item: item["tokens"], reverse=True)
    broken_links.sort(key=lambda item: (item["source"], item["target"]))

    session_log: dict | None = None
    log_path = vault / SESSION_LOG_NAME
    if log_path.is_file():
        try:
            log_bytes = len(log_path.read_bytes())
        except OSError:
            log_bytes = 0
        log_tokens = _estimate_tokens(log_bytes)
        session_log = {
            "path": SESSION_LOG_NAME,
            "tokens": log_tokens,
            "over_threshold": log_tokens > session_log_budget,
        }

    return {
        "budget_tokens": budget_tokens,
        "totals": {"notes": len(files), "tokens": total_tokens},
        "oversized": oversized,
        "broken_links": broken_links,
        "session_log": session_log,
    }
