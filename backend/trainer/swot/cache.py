"""B4 — SWOT cache (read + write).

Persisted as rows in ``swot_cache.csv`` (column schema in
``trainer/csvstore.py:FILES``). We never overwrite — refreshes append a new
row, and ``get_cached`` returns the most recent ``status='ok'`` row per
``(scope, name, version)``.

Scope semantics (added when the Insights-side SWOT Reports page landed):
  - ``scope='store'`` (default, legacy rows): keyed by store_name. Used by
    the AI Trainer's per-store SWOT view AND the Store Reports tab on
    Insights side.
  - ``scope='city'``: keyed by city_name (stored in the same ``store_name``
    column for brevity). Used by the City Reports tab on Insights side.

Version semantics (added when the Insights "Mattress calls / All calls"
toggle landed — see input_adapter for the filter rules):
  - ``version='all_calls'``: SWOT was built from every PRE_PURCHASE call.
    All legacy/pre-version rows resolve here.
  - ``version='mattress_only'``: SWOT was built from calls whose
    ``product_category`` is in the mattress allow-list.

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

# Legacy rows (pre-version-filter) have ``version==""``. Treat that as
# "all_calls" — those rows were generated before any category filter
# existed, so they ARE the all-calls view of the data.
_DEFAULT_VERSION = "all_calls"

ALLOWED_VERSIONS = ("all_calls", "mattress_only")


def _resolve_version_col(df: pd.DataFrame) -> pd.Series:
    """Return df['version'] with empty/missing values resolved to 'all_calls'."""
    if "version" not in df.columns:
        return pd.Series([_DEFAULT_VERSION] * len(df), index=df.index)
    return df["version"].fillna("").replace("", _DEFAULT_VERSION)


def get_cached(
    name: str,
    *,
    scope: str = "store",
    version: str = _DEFAULT_VERSION,
) -> Optional[SWOTReport]:
    """Return the most recent ``status='ok'`` SWOT for ``(scope, name, version)``.

    ``version`` defaults to ``'all_calls'`` so legacy callers that don't
    pass version still resolve to the unfiltered report — matching the
    legacy-row meaning. New consumers should pass version explicitly.

    Use ``is_stale(report)`` to check the TTL separately — callers may want
    to serve stale-while-revalidate.
    """
    if version not in ALLOWED_VERSIONS:
        raise ValueError(f"unknown SWOT version {version!r}; allowed: {ALLOWED_VERSIONS}")
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
    # Filter by version. Legacy rows ("") resolve as "all_calls".
    df = df[_resolve_version_col(df) == version]
    if df.empty:
        return None
    df = df.sort_values("generated_at", kind="stable")
    row = df.iloc[-1]
    try:
        report_dict = json.loads(row["swot_json"])
        return SWOTReport.model_validate(report_dict)
    except (ValueError, TypeError) as exc:
        logger.warning(
            "Could not parse cached SWOT for %s/%s/%s: %s", scope, version, name, exc,
        )
        return None


def is_stale(report: SWOTReport, ttl_days: int = SWOT_CACHE_TTL_DAYS) -> bool:
    if report.generated_at.tzinfo is None:
        ts = report.generated_at.replace(tzinfo=timezone.utc)
    else:
        ts = report.generated_at
    age = datetime.now(timezone.utc) - ts
    return age.days >= ttl_days


def put_cache(
    report: SWOTReport,
    *,
    status: str = "ok",
    scope: str = "store",
    version: str = _DEFAULT_VERSION,
) -> None:
    """Append a new cache row. Never updates in place."""
    if version not in ALLOWED_VERSIONS:
        raise ValueError(f"unknown SWOT version {version!r}; allowed: {ALLOWED_VERSIONS}")
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
            "version": version,
        },
    )


def put_failure(
    name: str,
    reason: str,
    *,
    model: str = "",
    scope: str = "store",
    version: str = _DEFAULT_VERSION,
) -> None:
    """Audit a failed generation by appending a stub row with status='failed'."""
    if version not in ALLOWED_VERSIONS:
        raise ValueError(f"unknown SWOT version {version!r}; allowed: {ALLOWED_VERSIONS}")
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
            "version": version,
        },
    )


def list_cached(
    scope: Optional[str] = None,
    version: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Return one summary row per (scope, name, version) with the latest
    ``ok`` SWOT.

    Pass ``scope`` and/or ``version`` to filter; ``None`` returns all
    kinds (each row tagged with its scope and version so the caller can
    group). Newest first.
    """
    df = csvstore.read_all(CACHE_FILE)
    if df.empty:
        return []
    df = df[df["status"] == "ok"]
    if df.empty:
        return []
    # Normalise legacy empty values -> defaults.
    df = df.assign(
        scope=df["scope"].fillna("").replace("", _DEFAULT_SCOPE),
        version=_resolve_version_col(df).values,
    )
    if scope is not None:
        df = df[df["scope"] == scope]
    if version is not None:
        df = df[df["version"] == version]
    if df.empty:
        return []
    df = df.sort_values("generated_at", kind="stable")
    df = df.drop_duplicates(subset=["scope", "store_name", "version"], keep="last")
    df = df.sort_values("generated_at", ascending=False, kind="stable")

    rows: List[Dict[str, Any]] = []
    for _, r in df.iterrows():
        rows.append(
            {
                "scope": r["scope"],
                "version": r["version"],
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
