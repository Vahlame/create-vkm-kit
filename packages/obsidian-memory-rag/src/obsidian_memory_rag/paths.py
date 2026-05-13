"""Filesystem layout for the SQLite sidecar beside a vault."""

from __future__ import annotations

from pathlib import Path

SIDECAR_DIR = ".obsidian-memory-rag"
DB_NAME = "fts.sqlite"


def sidecar_dir(vault: Path) -> Path:
    return vault / SIDECAR_DIR


def index_db_path(vault: Path) -> Path:
    return sidecar_dir(vault) / DB_NAME
