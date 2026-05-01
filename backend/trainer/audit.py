"""Audit log helper. Writes are best-effort: ``audit()`` never raises.

If the underlying CSV write fails, the failure is logged and the action proceeds.
The audit log is a forensic aid, not a critical path — a flaky disk must not
prevent a drill from completing.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from . import csvstore

logger = logging.getLogger("trainer.audit")


def audit(
    actor_staff_id: str,
    action: str,
    target: Optional[str] = None,
    payload: Optional[Any] = None,
    actor_email: Optional[str] = None,
) -> None:
    """Append a single audit row. Never raises.

    Action keys are dotted snake_case: ``drills.started``, ``drills.completed``,
    ``personas.published``, ``roster.uploaded``, ``swot.generated``, ``auth.login``.
    """
    try:
        csvstore.append(
            "audit_log.csv",
            {
                "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "actor_staff_id": actor_staff_id or "",
                "actor_email": actor_email or "",
                "action": action,
                "target": target or "",
                "payload_json": payload if payload is not None else "",
            },
        )
    except Exception as exc:
        logger.warning("audit() suppressed exception: action=%s err=%s", action, exc)


def read_recent(
    limit: int = 100,
    action: Optional[str] = None,
    since: Optional[datetime] = None,
) -> List[Dict[str, Any]]:
    """Return up to ``limit`` rows, newest first, optionally filtered."""
    df = csvstore.read_all("audit_log.csv")
    if df.empty:
        return []

    if action:
        df = df[df["action"].str.startswith(action)]

    if since is not None:
        # ts column is ISO-8601; lexicographic comparison is correct for that format
        df = df[df["ts"] >= since.isoformat(timespec="seconds")]

    df = df.sort_values("ts", ascending=False, kind="stable").head(limit)

    rows: List[Dict[str, Any]] = []
    for _, r in df.iterrows():
        row = r.to_dict()
        if row.get("payload_json"):
            try:
                row["payload"] = json.loads(row["payload_json"])
            except (ValueError, TypeError):
                row["payload"] = row["payload_json"]
        else:
            row["payload"] = None
        rows.append(row)
    return rows
