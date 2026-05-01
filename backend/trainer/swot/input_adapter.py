"""B1 — Pull the latest N analyzed calls for a single store.

Reads from the existing in-memory ``CallDataStore`` (populated at app startup
from the GMB Calls CSV). The trainer never mutates this store — we only use
its read methods.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List

from .. import bootstrap

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
