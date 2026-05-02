"""B1 — Pull the latest N analyzed calls for a single store OR city.

Reads from the existing in-memory ``CallDataStore`` (populated at app startup
from the GMB Calls CSV). The trainer never mutates this store — we only use
its read methods.

City lookups use ``backend/data/city_store_mapping.json`` to resolve a city
to its set of stores, then union the stores' calls.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List

from .. import bootstrap
from ..config import CITY_STORE_MAPPING_PATH

logger = logging.getLogger("trainer.swot.input")

DEFAULT_N = 100
HARD_CAP = 250  # mirrors /api/generate-insights


def latest_calls_for_store(store_name: str, n: int = DEFAULT_N) -> List[Dict[str, Any]]:
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

    # Sort by call_date desc. CallDateTime is a free-form string; lexicographic
    # ordering works for ISO-8601 / "MM/DD/YYYY HH:MM:SS"-style values
    # consistently within the dataset (call_parser stores them as raw strings).
    # If parse fails for any row we fall back to natural order.
    matching.sort(key=lambda c: c.get("call_date") or "", reverse=True)

    top_clean_numbers = [c["clean_number"] for c in matching[:n] if c.get("clean_number")]
    rich = cds.get_insight_columns(top_clean_numbers)
    logger.info(
        "swot.input store=%s requested=%d matching=%d returned=%d",
        store_name, n, len(matching), len(rich),
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


def latest_calls_for_city(city_name: str, n: int = DEFAULT_N) -> List[Dict[str, Any]]:
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

    matching.sort(key=lambda c: c.get("call_date") or "", reverse=True)
    top_clean_numbers = [c["clean_number"] for c in matching[:n] if c.get("clean_number")]
    rich = cds.get_insight_columns(top_clean_numbers)
    logger.info(
        "swot.input city=%s stores=%d requested=%d matching=%d returned=%d",
        city_name, len(stores), n, len(matching), len(rich),
    )
    return rich
