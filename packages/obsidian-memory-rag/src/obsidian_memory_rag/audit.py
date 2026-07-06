"""Vault health audit: size budget, broken wikilinks, SESSION_LOG growth (D4/D7),
plus corruption/conflict signals (sync-conflict files, committed merge markers,
in-progress git rebase/merge state, stale atomic-write temp files).

Pure stdlib, read-only. Scans every ``*.md`` under the vault (excluding the
sidecar/tooling dirs) and reports notes that blow the per-note token budget,
``[[wikilinks]]`` whose target file does not exist, and whether ``SESSION_LOG.md``
has grown past its own threshold. The output dict is JSON-serializable verbatim so
the Node MCP bridge can forward it untouched (see ``cli.py`` ``json-audit``).
"""

from __future__ import annotations

import re
import time
from math import ceil
from pathlib import Path

from .text_scrub import strip_code_regions

# Directories that never hold user notes: VCS metadata, the Obsidian app config,
# and our own SQLite sidecar. Excluded by name at any depth.
_EXCLUDE_DIRS = frozenset({".git", ".obsidian", ".obsidian-memory-rag"})

# [[target]] / [[target|alias]] / [[target#section]] — capture only the target.
_WIKILINK_RE = re.compile(r"\[\[([^\[\]]+?)\]\]")

# Token estimate heuristic: ~4 bytes per token. This is the same rough rule used
# across the kit (good enough for a budget alarm; we never tokenize for real here).
_BYTES_PER_TOKEN = 4

SESSION_LOG_NAME = "SESSION_LOG.md"

# A git merge-conflict marker committed into a note is corrupted state the human
# needs to see. Only the opening marker is scanned for (7 chars + space), on
# code-stripped text so documentation examples inside fences don't trip it.
_CONFLICT_MARKER_PREFIX = "<<<<<<< "

# Leftover from a crashed atomic write (the MCP writes `<file>.tmp-<pid>-<ts>`
# then renames). Anything matching that shape older than this many seconds is
# debris — a live write holds its tmp file for milliseconds.
_STALE_TMP_RE = re.compile(r"\.tmp-\d+-\d+$")
_STALE_TMP_AGE_SECONDS = 3600


def _scan_conflict_and_tmp_files(vault: Path, *, now: float) -> tuple[list[dict], list[dict]]:
    """One rglob pass for Syncthing conflict files and stale atomic-write temps.

    Conflict files can be any extension (Syncthing marks whatever it synced), so
    this walks all files, not just ``*.md``, still skipping the tooling dirs.
    """
    sync_conflicts: list[dict] = []
    stale_tmp: list[dict] = []
    for path in vault.rglob("*"):
        if not path.is_file():
            continue
        rel_parts = path.relative_to(vault).parts
        if any(part in _EXCLUDE_DIRS for part in rel_parts[:-1]):
            continue
        rel = path.relative_to(vault).as_posix()
        if ".sync-conflict-" in path.name:
            sync_conflicts.append({"path": rel})
        elif _STALE_TMP_RE.search(path.name):
            try:
                age = now - path.stat().st_mtime
            except OSError:
                continue
            if age > _STALE_TMP_AGE_SECONDS:
                stale_tmp.append({"path": rel, "age_hours": round(age / 3600, 1)})
    sync_conflicts.sort(key=lambda item: item["path"])
    stale_tmp.sort(key=lambda item: item["path"])
    return sync_conflicts, stale_tmp


def _git_state(vault: Path) -> dict | None:
    """In-progress rebase/merge markers inside ``.git`` — the state the daemon
    leaves behind when it aborts on conflict (or a human interrupted a merge).
    ``None`` when the vault is not a git repo."""
    git_dir = vault / ".git"
    if not git_dir.is_dir():
        return None
    return {
        "rebase_in_progress": (git_dir / "rebase-merge").exists()
        or (git_dir / "rebase-apply").exists(),
        "merge_in_progress": (git_dir / "MERGE_HEAD").exists(),
    }


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
    limit: int = 100,
) -> dict:
    """Audit a vault and return a JSON-serializable health report.

    - ``oversized``: notes whose estimated tokens exceed ``budget_tokens`` (desc),
      capped at ``limit`` entries (worst first) — ``oversized_total`` carries the
      real count so a messy vault can't blow up the response size.
    - ``broken_links``: ``[[target]]`` references with no ``<target>.md`` anywhere
      in the vault (case-insensitive basename match); ``[[...]]`` occurrences inside
      fenced code blocks or inline code spans are ignored (documentation examples of
      the syntax, not real edges). Capped at ``limit`` entries — ``broken_links_total``
      carries the real count.
    - ``session_log``: token count + over-threshold flag for ``SESSION_LOG.md``
      (``None`` when the file is absent).
    - ``sync_conflicts``: Syncthing ``*.sync-conflict-*`` files (any extension).
    - ``conflict_markers``: notes with a committed git ``<<<<<<< `` marker outside
      code regions (first offending line per note).
    - ``stale_tmp``: leftover ``*.tmp-<pid>-<ts>`` files from a crashed atomic
      write, older than an hour.
    - ``git_state``: in-progress rebase/merge markers (``None`` if not a git repo)
      — the state the sync daemon leaves when it aborts on conflict.
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
    conflict_markers: list[dict] = []
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
        scan_text = strip_code_regions(text)
        for lineno, line in enumerate(scan_text.splitlines(), start=1):
            if line.startswith(_CONFLICT_MARKER_PREFIX):
                # First marker per note is enough to flag it for a human.
                conflict_markers.append({"path": rel, "line": lineno})
                break
        for match in _WIKILINK_RE.finditer(scan_text):
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
    oversized_total = len(oversized)
    broken_links_total = len(broken_links)
    oversized = oversized[:limit]
    broken_links = broken_links[:limit]

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

    sync_conflicts, stale_tmp = _scan_conflict_and_tmp_files(vault, now=time.time())
    sync_conflicts_total = len(sync_conflicts)
    stale_tmp_total = len(stale_tmp)
    conflict_markers_total = len(conflict_markers)

    return {
        "budget_tokens": budget_tokens,
        "totals": {"notes": len(files), "tokens": total_tokens},
        "oversized": oversized,
        "oversized_total": oversized_total,
        "broken_links": broken_links,
        "broken_links_total": broken_links_total,
        "session_log": session_log,
        "sync_conflicts": sync_conflicts[:limit],
        "sync_conflicts_total": sync_conflicts_total,
        "conflict_markers": conflict_markers[:limit],
        "conflict_markers_total": conflict_markers_total,
        "stale_tmp": stale_tmp[:limit],
        "stale_tmp_total": stale_tmp_total,
        "git_state": _git_state(vault),
    }
