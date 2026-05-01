"""Atomic append-only CSV store for trainer subsystem.

Concurrency model:
- One in-process ``threading.Lock`` per filename (cheap, prevents row interleaving
  inside one uvicorn worker).
- ``portalocker`` advisory file lock guards writes across worker processes.
- Reads use a snapshot copy via pandas; if a write is in flight the reader waits
  on the file lock briefly.

We never overwrite a row in place. Updates use the "tombstone + new row" pattern
and ``read_latest_per`` resolves to the most recent row by a key column (drill
state machine in D1).
"""

from __future__ import annotations

import csv
import io
import json
import logging
import threading
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import pandas as pd
import portalocker

from .config import TRAINER_DATA_DIR

logger = logging.getLogger("trainer.csvstore")


class CSVStoreError(Exception):
    """Raised when a caller asks for an unknown filename or violates the schema."""


# ── Canonical schemas (single source of truth for every CSV the trainer owns) ──

FILES: Dict[str, List[str]] = {
    "staff_roster.csv": [
        "staff_id",
        "full_name",
        "store_name",
        "role",
        "joined_date",
        "status",
        "real_call_agent_name_variants",
        "email",
    ],
    "calls.csv": [
        "drill_uuid",
        "staff_id",
        "store_name",
        "persona_id",
        "persona_difficulty",
        "status",
        "started_at",
        "ended_at",
        "duration_seconds",
        "score_overall",
        "score_json",
        "cost_inr",
        "model",
        "disposition_reason",
        "audio_path",
        "transcript_path",
    ],
    "personas.csv": [
        "persona_id",
        "version",
        "name",
        "summary",
        "payload_json",
        "status",
        "created_at",
        "approved_by",
        "published_at",
    ],
    "swot_cache.csv": [
        "store_name",
        "generated_at",
        "input_call_count",
        "swot_json",
        "model",
        "cost_inr",
        "status",
    ],
    "audit_log.csv": [
        "ts",
        "actor_staff_id",
        "actor_email",
        "action",
        "target",
        "payload_json",
    ],
    "score_cards.csv": [
        "drill_uuid",
        "staff_id",
        "store_name",
        "persona_id",
        "scored_at",
        "score_overall",
        "strengths_json",
        "gaps_json",
        "framework_scores_json",
        "cost_inr",
        "model",
    ],
}


# ── Locks ────────────────────────────────────────────────────────────────────

_locks: Dict[str, threading.Lock] = {}
_locks_master = threading.Lock()


def _file_lock(filename: str) -> threading.Lock:
    """One ``threading.Lock`` per filename, lazily created."""
    with _locks_master:
        lock = _locks.get(filename)
        if lock is None:
            lock = threading.Lock()
            _locks[filename] = lock
        return lock


# ── Path + schema helpers ────────────────────────────────────────────────────

def _columns(filename: str) -> List[str]:
    if filename not in FILES:
        raise CSVStoreError(f"Unknown trainer CSV: {filename}")
    return FILES[filename]


def _path(filename: str) -> Path:
    if filename not in FILES:
        raise CSVStoreError(f"Unknown trainer CSV: {filename}")
    return Path(TRAINER_DATA_DIR) / filename


def ensure_headers() -> None:
    """Create any missing CSV with its canonical header. Idempotent.

    Called once from ``bootstrap.on_startup`` when the trainer is enabled.
    Never modifies existing files.
    """
    Path(TRAINER_DATA_DIR).mkdir(parents=True, exist_ok=True)
    for filename, columns in FILES.items():
        path = _path(filename)
        if path.exists():
            continue
        with path.open("w", encoding="utf-8", newline="") as f:
            csv.writer(f).writerow(columns)
        logger.info("Created CSV %s with header columns=%s", path.name, columns)


# ── Append ───────────────────────────────────────────────────────────────────

def append(filename: str, row: Dict[str, Any]) -> None:
    """Append a single row; values default to empty string when keys are absent.

    Raises ``CSVStoreError`` if ``row`` contains a column not in the schema —
    forces the caller to keep schema in sync rather than silently losing data.
    """
    columns = _columns(filename)
    column_set = set(columns)

    unknown = set(row.keys()) - column_set
    if unknown:
        raise CSVStoreError(
            f"{filename}: unknown columns {sorted(unknown)} (schema: {columns})"
        )

    path = _path(filename)
    serialised = [_serialise(row.get(c, "")) for c in columns]

    with _file_lock(filename):
        # Defensive: create file with header if it disappeared since startup.
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("w", encoding="utf-8", newline="") as f:
                csv.writer(f).writerow(columns)

        with path.open("a", encoding="utf-8", newline="") as f:
            portalocker.lock(f, portalocker.LOCK_EX)
            try:
                csv.writer(f).writerow(serialised)
                f.flush()
            finally:
                portalocker.unlock(f)


def append_many(filename: str, rows: Iterable[Dict[str, Any]]) -> int:
    """Append several rows under one file lock acquisition. Returns count."""
    rows = list(rows)
    if not rows:
        return 0
    columns = _columns(filename)
    column_set = set(columns)

    serialised_rows = []
    for row in rows:
        unknown = set(row.keys()) - column_set
        if unknown:
            raise CSVStoreError(
                f"{filename}: unknown columns {sorted(unknown)} (schema: {columns})"
            )
        serialised_rows.append([_serialise(row.get(c, "")) for c in columns])

    path = _path(filename)
    with _file_lock(filename):
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("w", encoding="utf-8", newline="") as f:
                csv.writer(f).writerow(columns)

        with path.open("a", encoding="utf-8", newline="") as f:
            portalocker.lock(f, portalocker.LOCK_EX)
            try:
                writer = csv.writer(f)
                writer.writerows(serialised_rows)
                f.flush()
            finally:
                portalocker.unlock(f)

    return len(serialised_rows)


# ── Read ─────────────────────────────────────────────────────────────────────

def read_all(filename: str) -> pd.DataFrame:
    """Return the full file as a DataFrame with stable column order.

    If the file is missing or empty, returns an empty DataFrame with the correct
    columns (so callers can rely on column access).
    """
    path = _path(filename)
    columns = _columns(filename)

    if not path.exists() or path.stat().st_size == 0:
        return pd.DataFrame(columns=columns)

    # Snapshot read under the file lock to avoid pandas catching a half-written line.
    with _file_lock(filename):
        with path.open("r", encoding="utf-8", newline="") as f:
            portalocker.lock(f, portalocker.LOCK_SH)
            try:
                content = f.read()
            finally:
                portalocker.unlock(f)

    if not content.strip():
        return pd.DataFrame(columns=columns)

    df = pd.read_csv(io.StringIO(content), dtype=str, keep_default_na=False)

    # Be tolerant of a missing column (older deployments) — add as empty.
    for c in columns:
        if c not in df.columns:
            df[c] = ""
    return df[columns]


def read_filtered(filename: str, **filters: Any) -> pd.DataFrame:
    """Convenience: read_all then equality-filter on supplied columns."""
    df = read_all(filename)
    for col, val in filters.items():
        if col not in df.columns:
            raise CSVStoreError(f"{filename}: filter column '{col}' not in schema")
        df = df[df[col] == str(val)]
    return df


def read_latest_per(filename: str, key_col: str, order_col: str = "started_at") -> pd.DataFrame:
    """Resolve "tombstone + new row" updates: keep the most recent row per ``key_col``.

    Sorts by ``order_col`` ascending and uses ``drop_duplicates(keep='last')``,
    which gives the latest row per key when ``order_col`` is monotonic
    (timestamps fit; row index also works).
    """
    df = read_all(filename)
    if df.empty or key_col not in df.columns:
        return df

    if order_col in df.columns and df[order_col].notna().any():
        df = df.sort_values(order_col, kind="stable")
    return df.drop_duplicates(subset=[key_col], keep="last").reset_index(drop=True)


# ── Serialisation ───────────────────────────────────────────────────────────

def _serialise(value: Any) -> str:
    """Render ``value`` for CSV. Lists/dicts become compact JSON; None → "".

    Newlines inside strings are stripped to keep the one-row-per-line invariant.
    """
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (list, dict)):
        return json.dumps(value, separators=(",", ":"), ensure_ascii=False)
    s = str(value)
    if "\n" in s or "\r" in s:
        s = s.replace("\r", " ").replace("\n", " ")
    return s


def file_exists(filename: str) -> bool:
    return _path(filename).exists()
