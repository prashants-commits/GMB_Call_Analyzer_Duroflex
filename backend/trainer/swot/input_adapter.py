"""B1 — Pull the latest N analyzed calls for a single store OR city.

Reads from the existing in-memory ``CallDataStore`` (populated at app startup
from the GMB Calls CSV). The trainer never mutates this store — we only use
its read methods.

City lookups use ``backend/data/city_store_mapping.json`` to resolve a city
to its set of stores, then union the stores' calls.

Version filter (added with the Insights "All calls / Mattress calls" toggle):
``version='all_calls'`` keeps the historical behaviour (no category filter).
``version='mattress_only'`` restricts to calls whose ``product_category``
is one of the mattress product lines defined in ``MATTRESS_CATEGORIES``.
The filter is applied BEFORE the latest-N truncation, so we always return
up to N matching calls — not "N latest of which some happen to be mattress".
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List

from csv_parser import parse_call_date

from .. import bootstrap
from ..config import CITY_STORE_MAPPING_PATH

logger = logging.getLogger("trainer.swot.input")

DEFAULT_N = 100
HARD_CAP = 250  # mirrors /api/generate-insights

# Mattress category allow-list for ``version='mattress_only'``. Values are
# the canonical UPPERCASE strings as they appear in the GMB CSV column
# ``6_Product_Intelligence_Category`` (which surfaces as ``product_category``
# in the analytics rows). Comparison is case-insensitive at the call site.
MATTRESS_CATEGORIES = frozenset({
    "DUROPEDIC MATTRESS",
    "ENERGISE MATTRESS",
    "ESSENTIAL MATTRESS",
    "MATTRESS",
    "NATURAL LIVING MATTRESS",
})

ALLOWED_VERSIONS = ("all_calls", "mattress_only")


def _is_mattress_call(row: Dict[str, Any]) -> bool:
    cat = (row.get("product_category") or "").strip().upper()
    return cat in MATTRESS_CATEGORIES


def _filter_by_version(rows: List[Dict[str, Any]], version: str) -> List[Dict[str, Any]]:
    if version == "all_calls":
        return rows
    if version == "mattress_only":
        return [r for r in rows if _is_mattress_call(r)]
    raise ValueError(f"unknown SWOT version {version!r}; allowed: {ALLOWED_VERSIONS}")


def latest_calls_for_store(
    store_name: str,
    n: int = DEFAULT_N,
    *,
    version: str = "all_calls",
) -> List[Dict[str, Any]]:
    """Return the latest ``n`` calls (most recent first) for a store, in the
    same shape as ``CallDataStore.get_insight_columns(...)``.

    Returns ``[]`` when the store doesn't exist or has zero calls. Raises
    ``ValueError`` if ``n`` exceeds ``HARD_CAP``.
    """
    if n > HARD_CAP:
        raise ValueError(f"n={n} exceeds hard cap {HARD_CAP}")
    if n <= 0:
        return []

    cds = bootstrap.get_call_data_store()
    if cds is None:
        logger.warning("CallDataStore unavailable — trainer not bootstrapped?")
        return []

    analytics = cds.get_analytics_data()
    matching = [c for c in analytics if c.get("store_name") == store_name]
    if not matching:
        return []

    pre_filter_count = len(matching)
    matching = _filter_by_version(matching, version)
    if not matching:
        logger.info(
            "swot.input store=%s version=%s pre_filter=%d post_filter=0 → no matches",
            store_name, version, pre_filter_count,
        )
        return []

    matching.sort(key=lambda c: parse_call_date(c.get("call_date")), reverse=True)

    top_clean_numbers = [c["clean_number"] for c in matching[:n] if c.get("clean_number")]
    rich = cds.get_insight_columns(top_clean_numbers)
    logger.info(
        "swot.input store=%s version=%s requested=%d pre_filter=%d post_filter=%d returned=%d",
        store_name, version, n, pre_filter_count, len(matching), len(rich),
    )
    return rich


def chunk_into_batches(rows: List[Dict[str, Any]], batch_size: int = 20) -> List[List[Dict[str, Any]]]:
    """Split call data into Stage-1 Map batches. Last batch may be shorter."""
    if batch_size <= 0:
        raise ValueError("batch_size must be positive")
    return [rows[i : i + batch_size] for i in range(0, len(rows), batch_size)]


# Meta-cities — names that combine multiple raw mapping keys into one
# logical SWOT scope. The mapping splits Delhi-region cities into separate
# entries (New delhi, Noida, Greater noida, Gurugram) but for executive
# reporting we want a single "Delhi NCR" view.
_META_CITIES: Dict[str, List[str]] = {
    "Delhi NCR": ["New delhi", "Noida", "Greater noida", "Gurugram"],
}


def stores_for_city(city_name: str) -> List[str]:
    """Resolve a city name to its list of store names via city_store_mapping.json.

    Supports meta-cities (e.g. ``Delhi NCR``) that union multiple raw entries.
    Returns ``[]`` if the city isn't in the mapping or the meta-list (caller
    surfaces a user-friendly "no calls found" error).
    """
    path = Path(CITY_STORE_MAPPING_PATH)
    if not path.exists():
        logger.warning("city_store_mapping.json not found at %s", path)
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Could not read city_store_mapping.json: %s", exc)
        return []

    if city_name in _META_CITIES:
        # Union stores across the constituent raw cities, dedup, preserve order.
        seen = set()
        out: List[str] = []
        for raw_city in _META_CITIES[city_name]:
            for store in data.get(raw_city, []):
                if store not in seen:
                    seen.add(store)
                    out.append(store)
        return out
    return list(data.get(city_name, []))


def latest_calls_for_city(
    city_name: str,
    n: int = DEFAULT_N,
    *,
    version: str = "all_calls",
) -> List[Dict[str, Any]]:
    """Return the latest ``n`` calls (most recent first) across ALL stores in
    a city, in the same shape as ``CallDataStore.get_insight_columns(...)``.

    Mirrors ``latest_calls_for_store`` but unions the city's store-list. If
    the city has no mapping entry or no matching calls, returns ``[]``.
    """
    if n > HARD_CAP:
        raise ValueError(f"n={n} exceeds hard cap {HARD_CAP}")
    if n <= 0:
        return []

    stores = stores_for_city(city_name)
    if not stores:
        logger.info("swot.input city=%s has no stores in mapping", city_name)
        return []

    cds = bootstrap.get_call_data_store()
    if cds is None:
        logger.warning("CallDataStore unavailable — trainer not bootstrapped?")
        return []

    store_set = set(stores)
    analytics = cds.get_analytics_data()
    matching = [c for c in analytics if c.get("store_name") in store_set]
    if not matching:
        return []

    pre_filter_count = len(matching)
    matching = _filter_by_version(matching, version)
    if not matching:
        logger.info(
            "swot.input city=%s version=%s pre_filter=%d post_filter=0 → no matches",
            city_name, version, pre_filter_count,
        )
        return []

    matching.sort(key=lambda c: parse_call_date(c.get("call_date")), reverse=True)
    top_clean_numbers = [c["clean_number"] for c in matching[:n] if c.get("clean_number")]
    rich = cds.get_insight_columns(top_clean_numbers)
    logger.info(
        "swot.input city=%s stores=%d version=%s requested=%d pre_filter=%d post_filter=%d returned=%d",
        city_name, len(stores), version, n, pre_filter_count, len(matching), len(rich),
    )
    return rich
