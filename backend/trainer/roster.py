"""Staff roster reader. Source of truth: ``backend/data/trainer/staff_roster.csv``.

The file is admin-uploaded (A7 endpoints). This module only reads it. Validation
errors are surfaced as structured codes so the admin UI can render row-level
feedback.

mtime-based cache: re-read the file only when its mtime changes. Roster reads
are hot during drill-start, so we want this cheap.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import re
import threading
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .config import CITY_STORE_MAPPING_PATH, TRAINER_DATA_DIR

logger = logging.getLogger("trainer.roster")

ROSTER_FILENAME = "staff_roster.csv"
REQUIRED_COLUMNS = (
    "staff_id",
    "full_name",
    "store_name",
    "role",
    "joined_date",
    "status",
    "real_call_agent_name_variants",
)
OPTIONAL_COLUMNS = ("email",)
ALL_COLUMNS = REQUIRED_COLUMNS + OPTIONAL_COLUMNS

VALID_ROLES = {"staff", "manager", "cluster_head"}
VALID_STATUSES = {"active", "inactive"}
NEW_JOINER_WINDOW_DAYS = 30


# ── Data classes ─────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class StaffRow:
    staff_id: str
    full_name: str
    store_name: str
    role: str
    joined_date: date
    status: str
    real_call_agent_name_variants: Tuple[str, ...] = ()
    email: str = ""


@dataclass
class Validation:
    rows: List[StaffRow] = field(default_factory=list)
    errors: List[Dict[str, Any]] = field(default_factory=list)
    warnings: List[Dict[str, Any]] = field(default_factory=list)


# ── Cache ────────────────────────────────────────────────────────────────────

_cached_rows: Optional[List[StaffRow]] = None
_cached_mtime: Optional[float] = None
_cache_lock = threading.Lock()


def _roster_path() -> Path:
    return Path(TRAINER_DATA_DIR) / ROSTER_FILENAME


# ── Validation primitives ────────────────────────────────────────────────────


_STAFF_ID_RE = re.compile(r"^[A-Za-z0-9_\-]{1,32}$")


def _validate_staff_id(value: str) -> Optional[Dict[str, Any]]:
    if not value or not _STAFF_ID_RE.match(value):
        return {"code": "INVALID_STAFF_ID", "value": value}
    return None


def _parse_variants(raw: str, line_no: int) -> Tuple[Tuple[str, ...], List[Dict[str, Any]]]:
    """Split semicolon-separated variants, trim each, drop empties.

    Surfaces a ``TRIMMED_VARIANTS`` warning if any item had whitespace.
    """
    if not raw:
        return (), []
    parts = raw.split(";")
    cleaned: List[str] = []
    needed_trim = False
    for p in parts:
        stripped = p.strip()
        if stripped != p:
            needed_trim = True
        if stripped:
            cleaned.append(stripped)
    warnings: List[Dict[str, Any]] = []
    if needed_trim:
        warnings.append({"code": "TRIMMED_VARIANTS", "line": line_no, "raw": raw})
    return tuple(cleaned), warnings


def _load_known_stores() -> set:
    """Read the backend copy of city_store_mapping.json. Returns set of store names.

    On error returns an empty set — store-name validation is a warning, not an
    error, so a missing file should not block roster loads.
    """
    path = Path(CITY_STORE_MAPPING_PATH)
    if not path.exists():
        return set()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        stores: set = set()
        for v in data.values():
            if isinstance(v, list):
                stores.update(v)
        return stores
    except (ValueError, OSError) as exc:
        logger.warning("Could not read city_store_mapping.json: %s", exc)
        return set()


# ── Parser ───────────────────────────────────────────────────────────────────


def parse_csv_text(text: str) -> Validation:
    """Validate + parse a roster CSV. Never raises."""
    v = Validation()

    try:
        reader = csv.reader(io.StringIO(text))
        header = next(reader, None)
    except (StopIteration, csv.Error) as exc:
        v.errors.append({"code": "UNREADABLE_CSV", "detail": str(exc)})
        return v

    if not header:
        v.errors.append({"code": "EMPTY_FILE"})
        return v

    header = [h.strip() for h in header]
    missing = [c for c in REQUIRED_COLUMNS if c not in header]
    if missing:
        v.errors.append({"code": "MISSING_COLUMNS", "missing": missing, "got": header})
        return v

    known_stores = _load_known_stores()
    seen_ids: set = set()

    for line_no, raw_row in enumerate(reader, start=2):  # 2 = first data line
        if not any(cell.strip() for cell in raw_row):
            continue  # skip blank lines

        row = dict(zip(header, [c.strip() if isinstance(c, str) else c for c in raw_row]))

        # staff_id
        sid = row.get("staff_id", "")
        if (issue := _validate_staff_id(sid)):
            v.errors.append({**issue, "line": line_no})
            continue
        if sid in seen_ids:
            v.errors.append({"code": "DUPLICATE_STAFF_ID", "line": line_no, "staff_id": sid})
            continue
        seen_ids.add(sid)

        # role
        role = row.get("role", "").lower()
        if role not in VALID_ROLES:
            v.errors.append({"code": "INVALID_ROLE", "line": line_no, "value": role})
            continue

        # status
        status = row.get("status", "").lower()
        if status not in VALID_STATUSES:
            v.errors.append({"code": "INVALID_STATUS", "line": line_no, "value": status})
            continue

        # joined_date
        joined_raw = row.get("joined_date", "")
        try:
            joined = datetime.strptime(joined_raw, "%Y-%m-%d").date()
        except ValueError:
            v.errors.append({"code": "INVALID_DATE", "line": line_no, "value": joined_raw})
            continue

        # store_name
        store = row.get("store_name", "")
        if not store:
            v.errors.append({"code": "EMPTY_STORE_NAME", "line": line_no})
            continue
        if known_stores and store not in known_stores:
            v.warnings.append({"code": "STORE_NOT_IN_MAPPING", "line": line_no, "store": store})

        # variants
        variants, vw = _parse_variants(row.get("real_call_agent_name_variants", ""), line_no)
        v.warnings.extend(vw)

        v.rows.append(
            StaffRow(
                staff_id=sid,
                full_name=row.get("full_name", ""),
                store_name=store,
                role=role,
                joined_date=joined,
                status=status,
                real_call_agent_name_variants=variants,
                email=row.get("email", ""),
            )
        )

    return v


# ── Public API ──────────────────────────────────────────────────────────────


def load_roster() -> List[StaffRow]:
    """Return the cached active+inactive roster. Cached by mtime.

    Returns ``[]`` if the file is missing — callers must handle empty rosters.
    """
    global _cached_rows, _cached_mtime

    path = _roster_path()
    if not path.exists():
        return []

    try:
        current_mtime = path.stat().st_mtime
    except OSError:
        return []

    with _cache_lock:
        if _cached_rows is not None and _cached_mtime == current_mtime:
            return _cached_rows

        try:
            text = path.read_text(encoding="utf-8")
        except OSError as exc:
            logger.warning("Could not read roster: %s", exc)
            return _cached_rows or []

        v = parse_csv_text(text)
        if v.errors:
            logger.warning(
                "Roster has %d validation errors (first: %s); using best-effort row set of %d",
                len(v.errors),
                v.errors[0],
                len(v.rows),
            )

        _cached_rows = v.rows
        _cached_mtime = current_mtime
        return _cached_rows


def reset_cache() -> None:
    """Force the next ``load_roster`` to re-read the file. Used after admin upload."""
    global _cached_rows, _cached_mtime
    with _cache_lock:
        _cached_rows = None
        _cached_mtime = None


def lookup_by_id(staff_id: str) -> Optional[StaffRow]:
    for r in load_roster():
        if r.staff_id == staff_id:
            return r
    return None


def staff_in_store(store_name: str) -> List[StaffRow]:
    """Active staff for a given store, sorted by name."""
    return sorted(
        (r for r in load_roster() if r.store_name == store_name and r.status == "active"),
        key=lambda r: r.full_name.lower(),
    )


def is_new_joiner(staff_id: str, today: Optional[date] = None) -> bool:
    today = today or date.today()
    row = lookup_by_id(staff_id)
    if not row:
        return False
    return (today - row.joined_date).days <= NEW_JOINER_WINDOW_DAYS


def coverage_for_store(store_name: str) -> Dict[str, Any]:
    """% of active staff in a store with at least one populated variants entry."""
    rows = [r for r in load_roster() if r.store_name == store_name and r.status == "active"]
    total = len(rows)
    with_variants = sum(1 for r in rows if r.real_call_agent_name_variants)
    pct = round((with_variants / total) * 100, 1) if total else 0.0
    return {"total": total, "with_variants": with_variants, "coverage_pct": pct}


def agent_name_variants_for(staff_id: str) -> Tuple[str, ...]:
    row = lookup_by_id(staff_id)
    return row.real_call_agent_name_variants if row else ()
