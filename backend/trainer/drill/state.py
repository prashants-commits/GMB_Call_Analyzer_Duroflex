"""D1 — Drill state machine (append-only rows in ``calls.csv``).

Rules:
  - Transitions append a new row, never edit in place.
  - ``latest_state(drill_uuid)`` resolves the current state via
    ``csvstore.read_latest_per`` over the ``started_at`` column.
  - Invalid transitions raise ``InvalidStateTransition`` (caught at the
    HTTP/WS boundary and surfaced as 409 / 1011).

State graph:
  STARTING -> IN_CALL -> COMPLETED
                       \-> TIMED_OUT
                       \-> FAILED
                       \-> CANCELLED
  STARTING -> CANCELLED  (user cancels before WS connects)
  STARTING -> FAILED     (preflight blew up)
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, Optional

from .. import csvstore

logger = logging.getLogger("trainer.drill.state")


class DrillStatus(str, Enum):
    STARTING = "starting"
    IN_CALL = "in_call"
    COMPLETED = "completed"
    FAILED = "failed"
    TIMED_OUT = "timed_out"
    CANCELLED = "cancelled"


_TERMINAL = {DrillStatus.COMPLETED, DrillStatus.FAILED, DrillStatus.TIMED_OUT, DrillStatus.CANCELLED}

_VALID_TRANSITIONS: Dict[DrillStatus, set] = {
    DrillStatus.STARTING: {DrillStatus.IN_CALL, DrillStatus.CANCELLED, DrillStatus.FAILED},
    DrillStatus.IN_CALL:  {DrillStatus.COMPLETED, DrillStatus.FAILED, DrillStatus.TIMED_OUT, DrillStatus.CANCELLED},
}


class InvalidStateTransition(RuntimeError):
    pass


@dataclass(frozen=True)
class DrillState:
    drill_uuid: str
    staff_id: str
    store_name: str
    persona_id: str
    persona_difficulty: str
    status: DrillStatus
    started_at: datetime
    ended_at: Optional[datetime] = None
    duration_seconds: Optional[int] = None
    score_overall: Optional[float] = None
    cost_inr: Optional[float] = None
    model: Optional[str] = None
    disposition_reason: Optional[str] = None
    audio_path: Optional[str] = None
    transcript_path: Optional[str] = None


def _row_to_state(row: Dict[str, str]) -> DrillState:
    def _parse_dt(value: str) -> Optional[datetime]:
        if not value:
            return None
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None

    def _parse_int(value: str) -> Optional[int]:
        if not value or value == "":
            return None
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return None

    def _parse_float(value: str) -> Optional[float]:
        if not value or value == "":
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    return DrillState(
        drill_uuid=row.get("drill_uuid", ""),
        staff_id=row.get("staff_id", ""),
        store_name=row.get("store_name", ""),
        persona_id=row.get("persona_id", ""),
        persona_difficulty=row.get("persona_difficulty", ""),
        status=DrillStatus(row.get("status") or DrillStatus.STARTING.value),
        started_at=_parse_dt(row.get("started_at", "")) or datetime.now(timezone.utc),
        ended_at=_parse_dt(row.get("ended_at", "")),
        duration_seconds=_parse_int(row.get("duration_seconds", "")),
        score_overall=_parse_float(row.get("score_overall", "")),
        cost_inr=_parse_float(row.get("cost_inr", "")),
        model=row.get("model", "") or None,
        disposition_reason=row.get("disposition_reason", "") or None,
        audio_path=row.get("audio_path", "") or None,
        transcript_path=row.get("transcript_path", "") or None,
    )


def start_drill(
    *,
    staff_id: str,
    store_name: str,
    persona_id: str,
    persona_difficulty: str,
    model: str,
) -> DrillState:
    """Persist a new STARTING row and return the seeded state."""
    drill_uuid = uuid.uuid4().hex
    now = datetime.now(timezone.utc)
    csvstore.append("calls.csv", {
        "drill_uuid": drill_uuid,
        "staff_id": staff_id,
        "store_name": store_name,
        "persona_id": persona_id,
        "persona_difficulty": persona_difficulty,
        "status": DrillStatus.STARTING.value,
        "started_at": now.isoformat(timespec="seconds"),
        "model": model,
    })
    logger.info("drill.start uuid=%s staff=%s persona=%s", drill_uuid, staff_id, persona_id)
    return DrillState(
        drill_uuid=drill_uuid,
        staff_id=staff_id,
        store_name=store_name,
        persona_id=persona_id,
        persona_difficulty=persona_difficulty,
        status=DrillStatus.STARTING,
        started_at=now,
        model=model,
    )


def latest_state(drill_uuid: str) -> Optional[DrillState]:
    df = csvstore.read_latest_per("calls.csv", key_col="drill_uuid", order_col="started_at")
    if df.empty:
        return None
    rows = df[df["drill_uuid"] == drill_uuid]
    if rows.empty:
        return None
    return _row_to_state(rows.iloc[-1].to_dict())


def transition(
    drill_uuid: str,
    new_status: DrillStatus,
    *,
    disposition_reason: Optional[str] = None,
    audio_path: Optional[str] = None,
    transcript_path: Optional[str] = None,
    duration_seconds: Optional[int] = None,
    score_overall: Optional[float] = None,
    cost_inr: Optional[float] = None,
) -> DrillState:
    current = latest_state(drill_uuid)
    if current is None:
        raise InvalidStateTransition(f"Unknown drill_uuid {drill_uuid!r}")

    if current.status in _TERMINAL:
        raise InvalidStateTransition(
            f"Drill {drill_uuid} already terminal (status={current.status.value})"
        )
    allowed = _VALID_TRANSITIONS.get(current.status, set())
    if new_status not in allowed:
        raise InvalidStateTransition(
            f"Cannot transition {current.status.value} -> {new_status.value}"
        )

    now = datetime.now(timezone.utc)
    started_at = current.started_at
    if started_at.tzinfo is None:
        started_at = started_at.replace(tzinfo=timezone.utc)
    computed_duration = duration_seconds
    if computed_duration is None and new_status in _TERMINAL:
        computed_duration = max(0, int((now - started_at).total_seconds()))

    new_row: Dict[str, Any] = {
        "drill_uuid": drill_uuid,
        "staff_id": current.staff_id,
        "store_name": current.store_name,
        "persona_id": current.persona_id,
        "persona_difficulty": current.persona_difficulty,
        "status": new_status.value,
        # Use a strictly increasing `started_at` so read_latest_per resolves
        # this row as the most recent. The value is "transition timestamp",
        # not the original drill start — we keep the original by re-reading
        # current.started_at when callers need it.
        "started_at": now.isoformat(timespec="seconds"),
        "ended_at": now.isoformat(timespec="seconds") if new_status in _TERMINAL else "",
        "duration_seconds": computed_duration if computed_duration is not None else "",
        "score_overall": score_overall if score_overall is not None else (current.score_overall or ""),
        "cost_inr": cost_inr if cost_inr is not None else (current.cost_inr or ""),
        "model": current.model or "",
        "disposition_reason": disposition_reason or current.disposition_reason or "",
        "audio_path": audio_path or current.audio_path or "",
        "transcript_path": transcript_path or current.transcript_path or "",
    }
    csvstore.append("calls.csv", new_row)
    logger.info(
        "drill.transition uuid=%s %s -> %s reason=%s",
        drill_uuid, current.status.value, new_status.value, disposition_reason,
    )
    return latest_state(drill_uuid)


def is_owned_by(drill_uuid: str, staff_id: str) -> bool:
    state = latest_state(drill_uuid)
    return state is not None and state.staff_id == staff_id
