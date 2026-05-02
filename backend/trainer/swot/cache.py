"""B4 — SWOT cache (read + write).

Persisted as rows in ``swot_cache.csv`` (column schema in
``trainer/csvstore.py:FILES``). We never overwrite — refreshes append a new
row, and ``get_cached`` returns the most recent ``status='ok'`` row per
``(scope, name)``.

Scope semantics (added when the Insights-side SWOT Reports page landed):
  - ``scope='store'`` (default, legacy rows): keyed by store_name. Used by
    the AI Trainer's per-store SWOT view AND the Store Reports tab on
    Insights side.
  - ``scope='city'``: keyed by city_name (stored in the same ``store_name``
    column for brevity). Used by the City Reports tab on Insights side.

Both apps read from this single cache so a refresh from either UI is
visible to the other immediately.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import pandas as pd

from .. import csvstore
from ..config import SWOT_CACHE_TTL_DAYS
from .schema import SWOTReport

logger = logging.getLogger("trainer.swot.cache")

CACHE_FILE = "swot_cache.csv"

# Legacy rows (pre-scope migration) have ``scope==""``. Treat that as "store"
# so existing AI-Trainer SWOTs continue to resolve via get_cached(scope='store').
_DEFAULT_SCOPE = "store"


def _row_scope(row: pd.Series) -> str:
    """Return the row's scope, treating empty/missing as the default."""
    val = row.get("scope", "") if isinstance(row, pd.Series) else ""
    return val or _DEFAULT_SCOPE


def get_cached(name: str, *, scope: str = "store") -> Optional[SWOTReport]:
    """Return the most recent ``status='ok'`` SWOT for ``(scope, name)``.

    Use ``is_stale(report)`` to check the TTL separately — callers may want
    to serve stale-while-revalidate.
    """
    df = csvstore.read_filtered(CACHE_FILE, store_name=name)
    if df.empty:
        return None
    df = df[df["status"] == "ok"]
    if df.empty:
        return None
    # Filter by scope. Legacy rows ("") resolve as "store".
    df = df[df["scope"].fillna("").replace("", _DEFAULT_SCOPE) == scope]
    if df.empty:
        return None
    df = df.sort_values("generated_at", kind="stable")
    row = df.iloc[-1]
    try:
        report_dict = json.loads(row["swot_json"])
        return SWOTReport.model_validate(report_dict)
    except (ValueError, TypeError) as exc:
        logger.warning("Could not parse cached SWOT for %s/%s: %s", scope, name, exc)
        return None


def is_stale(report: SWOTReport, ttl_days: int = SWOT_CACHE_TTL_DAYS) -> bool:
    if report.generated_at.tzinfo is None:
        ts = report.generated_at.replace(tzinfo=timezone.utc)
    else:
        ts = report.generated_at
    age = datetime.now(timezone.utc) - ts
    return age.days >= ttl_days


def put_cache(report: SWOTReport, *, status: str = "ok", scope: str = "store") -> None:
    """Append a new cache row. Never updates in place."""
    csvstore.append(
        CACHE_FILE,
        {
            "store_name": report.store_name,
            "generated_at": report.generated_at.isoformat(timespec="seconds"),
            "input_call_count": report.input_call_count,
            "swot_json": report.model_dump(mode="json"),
            "model": f"{report.model_map}+{report.model_reduce}",
            "cost_inr": round(report.cost_inr, 4),
            "status": status,
            "scope": scope,
        },
    )


def put_failure(name: str, reason: str, *, model: str = "", scope: str = "store") -> None:
    """Audit a failed generation by appending a stub row with status='failed'."""
    csvstore.append(
        CACHE_FILE,
        {
            "store_name": name,
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "input_call_count": 0,
            "swot_json": json.dumps({"error": reason}),
            "model": model,
            "cost_inr": 0,
            "status": "failed",
            "scope": scope,
        },
    )


def list_cached(scope: Optional[str] = None) -> List[Dict[str, Any]]:
    """Return one summary row per (scope, name) with the latest ``ok`` SWOT.

    Pass ``scope='store'`` or ``scope='city'`` to filter; ``None`` returns
    both kinds (each row tagged with its scope so the caller can group).
    Newest first.
    """
    df = csvstore.read_all(CACHE_FILE)
    if df.empty:
        return []
    df = df[df["status"] == "ok"]
    if df.empty:
        return []
    # Normalise legacy empty scope -> "store".
    df = df.assign(scope=df["scope"].fillna("").replace("", _DEFAULT_SCOPE))
    if scope is not None:
        df = df[df["scope"] == scope]
        if df.empty:
            return []
    df = df.sort_values("generated_at", kind="stable")
    df = df.drop_duplicates(subset=["scope", "store_name"], keep="last")
    df = df.sort_values("generated_at", ascending=False, kind="stable")

    rows: List[Dict[str, Any]] = []
    for _, r in df.iterrows():
        rows.append(
            {
                "scope": r["scope"],
                "name": r["store_name"],
                # Keep store_name as alias for backward-compat with the
                # AI Trainer admin page which reads list_cached() pre-scope.
                "store_name": r["store_name"],
                "generated_at": r["generated_at"],
                "input_call_count": int(r["input_call_count"] or 0),
                "model": r["model"],
                "cost_inr": float(r["cost_inr"] or 0),
            }
        )
    return rows
