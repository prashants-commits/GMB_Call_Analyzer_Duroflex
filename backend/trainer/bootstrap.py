"""One-time startup wiring for the trainer subsystem.

Called from ``backend/main.py`` only when ``TRAINER_ENABLED=true``. Sets up
directories, ensures CSVs exist with headers, and stashes a reference to the
existing ``CallDataStore`` so SWOT/Score-Card modules can read the call corpus
without circular imports.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Optional

from . import csvstore
from .config import (
    CITY_STORE_MAPPING_PATH,
    TRAINER_ADMIN_EMAILS,
    TRAINER_AUDIO_DIR,
    TRAINER_COOKIE_SECRET,
    TRAINER_DATA_DIR,
)

logger = logging.getLogger("trainer.bootstrap")

_call_data_store: Any = None


def on_startup(call_data_store: Any) -> None:
    """Run trainer boot tasks. Idempotent (safe to call from a uvicorn reload)."""
    global _call_data_store

    Path(TRAINER_DATA_DIR).mkdir(parents=True, exist_ok=True)
    Path(TRAINER_AUDIO_DIR).mkdir(parents=True, exist_ok=True)

    if TRAINER_COOKIE_SECRET == "change-me-in-production":
        logger.warning(
            "TRAINER_COOKIE_SECRET is the default placeholder. Set a real value in .env "
            "before any non-local deployment."
        )
    if not TRAINER_ADMIN_EMAILS:
        logger.warning(
            "TRAINER_ADMIN_EMAILS is empty. Admin endpoints (roster upload, persona publish, "
            "etc.) will be inaccessible until you set this in .env."
        )
    if not Path(CITY_STORE_MAPPING_PATH).exists():
        logger.warning(
            "city_store_mapping.json missing at %s. Run "
            "`python backend/scripts/sync_city_store_mapping.py` once.",
            CITY_STORE_MAPPING_PATH,
        )

    _call_data_store = call_data_store

    csvstore.ensure_headers()

    logger.info(
        "Trainer feature ENABLED (data_dir=%s call_data_store=%s)",
        TRAINER_DATA_DIR,
        type(call_data_store).__name__ if call_data_store else "None",
    )


def get_call_data_store() -> Any:
    """Return the existing in-memory call corpus. Used by SWOT/Score-Card modules.

    Returns ``None`` when the trainer is disabled or boot did not run.
    """
    return _call_data_store
