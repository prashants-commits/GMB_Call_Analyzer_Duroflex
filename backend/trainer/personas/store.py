"""Persistent persona library store.

Files (all under ``backend/data/trainer/``):
  - ``personas_draft.json``        — current admin-editable draft
  - ``personas_v{N}.json``         — published, frozen version N
  - ``personas_published.json``    — pointer to the latest published vN
  - ``personas.csv``               — per-persona audit trail (publish events,
                                     draft saves; rows append-only)

Atomic writes via tempfile + os.replace. Reads tolerate missing files.
"""

from __future__ import annotations

import json
import logging
import os
import re
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from pydantic import ValidationError

from .. import audit, csvstore
from ..config import TRAINER_DATA_DIR
from .schema import PersonaLibrary

logger = logging.getLogger("trainer.personas.store")

DRAFT_FILE = "personas_draft.json"
PUBLISHED_POINTER = "personas_published.json"
VERSIONED_PATTERN = re.compile(r"^personas_v(\d+)\.json$")

_write_lock = threading.Lock()


def _data_dir() -> Path:
    return Path(TRAINER_DATA_DIR)


def _atomic_write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}_", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2, default=str)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except OSError:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# ── Drafts ──────────────────────────────────────────────────────────────────


def save_draft(library: PersonaLibrary, *, actor_staff_id: Optional[str] = None,
               actor_email: Optional[str] = None) -> None:
    if library.status != "draft":
        library = library.model_copy(update={"status": "draft"})
    with _write_lock:
        _atomic_write_json(_data_dir() / DRAFT_FILE, library.model_dump(mode="json"))
    audit.audit(
        actor_staff_id or "system",
        "personas.draft.saved",
        actor_email=actor_email,
        target=f"v{library.version}",
        payload={"persona_count": len(library.personas)},
    )
    logger.info("personas.draft saved version=%d count=%d", library.version, len(library.personas))


def load_draft() -> Optional[PersonaLibrary]:
    path = _data_dir() / DRAFT_FILE
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return PersonaLibrary.model_validate(data)
    except (ValueError, ValidationError) as exc:
        logger.warning("Could not parse draft: %s", exc)
        return None


def list_drafts() -> List[PersonaLibrary]:
    """Currently we keep only one in-flight draft. Returns [] or [draft]."""
    draft = load_draft()
    return [draft] if draft else []


# ── Published ───────────────────────────────────────────────────────────────


def _next_version() -> int:
    existing = []
    for f in _data_dir().glob("personas_v*.json"):
        m = VERSIONED_PATTERN.match(f.name)
        if m:
            existing.append(int(m.group(1)))
    return max(existing) + 1 if existing else 1


def publish_draft(*, actor_staff_id: str, actor_email: Optional[str] = None) -> PersonaLibrary:
    """Promote the current draft to a frozen published version. Returns the
    published library."""
    draft = load_draft()
    if draft is None:
        raise FileNotFoundError("No draft to publish. Generate one first.")

    next_v = _next_version()
    published = draft.model_copy(update={
        "status": "published",
        "version": next_v,
        "generated_at": datetime.now(timezone.utc),
    })

    payload = published.model_dump(mode="json")
    versioned = _data_dir() / f"personas_v{next_v}.json"

    with _write_lock:
        _atomic_write_json(versioned, payload)
        _atomic_write_json(_data_dir() / PUBLISHED_POINTER, payload)
        # Drafts persist after publish so admin can iterate from where they were;
        # for clean-room behaviour they can clear the draft separately.

    csvstore.append("personas.csv", {
        "persona_id": "*library*",
        "version": next_v,
        "name": "PUBLISH",
        "summary": f"{len(published.personas)} personas",
        "payload_json": "",
        "status": "published",
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "approved_by": actor_email or actor_staff_id,
        "published_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    })

    audit.audit(
        actor_staff_id,
        "personas.published",
        actor_email=actor_email,
        target=f"v{next_v}",
        payload={"persona_count": len(published.personas), "cost_inr": published.cost_inr},
    )
    logger.info("personas.published version=%d count=%d", next_v, len(published.personas))
    return published


def load_published() -> Optional[PersonaLibrary]:
    path = _data_dir() / PUBLISHED_POINTER
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return PersonaLibrary.model_validate(data)
    except (ValueError, ValidationError) as exc:
        logger.warning("Could not parse published pointer: %s", exc)
        return None


def list_published_versions() -> List[int]:
    versions = []
    for f in _data_dir().glob("personas_v*.json"):
        m = VERSIONED_PATTERN.match(f.name)
        if m:
            versions.append(int(m.group(1)))
    return sorted(versions)


def load_version(version: int) -> Optional[PersonaLibrary]:
    path = _data_dir() / f"personas_v{version}.json"
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return PersonaLibrary.model_validate(data)
    except (ValueError, ValidationError) as exc:
        logger.warning("Could not parse v%d: %s", version, exc)
        return None
