"""Mock-Call Drill Engine (Group D).

Pipeline (per drill):
  POST /api/trainer/drills/start         -> picks persona, writes STARTING row
  WS   /ws/trainer/drill/{drill_uuid}    -> bridges browser <-> Gemini Live
  Server transitions: STARTING -> IN_CALL -> COMPLETED|FAILED|TIMED_OUT|CANCELLED
  POST /api/trainer/drills/{uuid}/cancel -> graceful cancel

State is persisted as append-only rows in ``calls.csv`` (tombstone pattern):
each transition writes a new row; ``read_latest_per`` resolves the current
state per drill_uuid.
"""

from .state import (
    DrillState,
    DrillStatus,
    InvalidStateTransition,
    latest_state,
    start_drill,
    transition,
)
from .prompt import build_system_prompt

__all__ = [
    "DrillState",
    "DrillStatus",
    "InvalidStateTransition",
    "latest_state",
    "start_drill",
    "transition",
    "build_system_prompt",
]
