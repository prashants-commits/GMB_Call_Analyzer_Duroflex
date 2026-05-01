"""Tiny in-memory job tracker for SWOT refresh background tasks.

We don't need Celery/RQ for this. Refresh is at most ~5 stores in flight at
once (one per pilot store) and a job's lifetime is ≤ 60s. An in-memory dict
with a lock is sufficient; jobs are lost on restart, which is fine — clients
just kick off a new refresh.
"""

from __future__ import annotations

import logging
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, Optional

logger = logging.getLogger("trainer.swot.jobs")


@dataclass
class Job:
    job_id: str
    store_name: str
    status: str = "queued"  # queued | running | completed | failed
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    error: Optional[str] = None
    cost_inr: Optional[float] = None

    def to_public_dict(self) -> dict:
        return {
            "job_id": self.job_id,
            "store_name": self.store_name,
            "status": self.status,
            "created_at": self.created_at.isoformat(timespec="seconds"),
            "started_at": self.started_at.isoformat(timespec="seconds") if self.started_at else None,
            "finished_at": self.finished_at.isoformat(timespec="seconds") if self.finished_at else None,
            "error": self.error,
            "cost_inr": self.cost_inr,
        }


_jobs: Dict[str, Job] = {}
_lock = threading.Lock()
_MAX_JOBS = 200  # ring-buffer cap to keep memory bounded


def create(store_name: str) -> Job:
    job = Job(job_id=uuid.uuid4().hex[:12], store_name=store_name)
    with _lock:
        _jobs[job.job_id] = job
        # Trim oldest if past the cap.
        if len(_jobs) > _MAX_JOBS:
            oldest = sorted(_jobs.values(), key=lambda j: j.created_at)[: len(_jobs) - _MAX_JOBS]
            for j in oldest:
                _jobs.pop(j.job_id, None)
    return job


def get(job_id: str) -> Optional[Job]:
    with _lock:
        return _jobs.get(job_id)


def mark_running(job_id: str) -> None:
    with _lock:
        j = _jobs.get(job_id)
        if j:
            j.status = "running"
            j.started_at = datetime.now(timezone.utc)


def mark_completed(job_id: str, cost_inr: float) -> None:
    with _lock:
        j = _jobs.get(job_id)
        if j:
            j.status = "completed"
            j.finished_at = datetime.now(timezone.utc)
            j.cost_inr = cost_inr


def mark_failed(job_id: str, error: str) -> None:
    with _lock:
        j = _jobs.get(job_id)
        if j:
            j.status = "failed"
            j.finished_at = datetime.now(timezone.utc)
            j.error = error


def find_running_for_store(store_name: str) -> Optional[Job]:
    """Return the in-flight job for a store, if any. Used to debounce the
    "Refresh" button so two clicks don't fire two generations."""
    with _lock:
        for j in _jobs.values():
            if j.store_name == store_name and j.status in ("queued", "running"):
                return j
    return None
