"""In-memory job tracker for persona generation. Mirrors swot/jobs.py."""

from __future__ import annotations

import logging
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, Optional

logger = logging.getLogger("trainer.personas.jobs")


@dataclass
class Job:
    job_id: str
    n_calls: int
    k_personas: int
    status: str = "queued"  # queued | running | completed | failed
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    error: Optional[str] = None
    cost_inr: Optional[float] = None
    persona_count: Optional[int] = None
    draft_version: Optional[int] = None

    def to_public_dict(self) -> dict:
        return {
            "job_id": self.job_id,
            "n_calls": self.n_calls,
            "k_personas": self.k_personas,
            "status": self.status,
            "created_at": self.created_at.isoformat(timespec="seconds"),
            "started_at": self.started_at.isoformat(timespec="seconds") if self.started_at else None,
            "finished_at": self.finished_at.isoformat(timespec="seconds") if self.finished_at else None,
            "error": self.error,
            "cost_inr": self.cost_inr,
            "persona_count": self.persona_count,
            "draft_version": self.draft_version,
        }


_jobs: Dict[str, Job] = {}
_lock = threading.Lock()
_MAX_JOBS = 50


def create(n_calls: int, k_personas: int) -> Job:
    job = Job(job_id=uuid.uuid4().hex[:12], n_calls=n_calls, k_personas=k_personas)
    with _lock:
        _jobs[job.job_id] = job
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


def mark_completed(job_id: str, *, cost_inr: float, persona_count: int, draft_version: int) -> None:
    with _lock:
        j = _jobs.get(job_id)
        if j:
            j.status = "completed"
            j.finished_at = datetime.now(timezone.utc)
            j.cost_inr = cost_inr
            j.persona_count = persona_count
            j.draft_version = draft_version


def mark_failed(job_id: str, error: str) -> None:
    with _lock:
        j = _jobs.get(job_id)
        if j:
            j.status = "failed"
            j.finished_at = datetime.now(timezone.utc)
            j.error = error


def find_running() -> Optional[Job]:
    with _lock:
        for j in _jobs.values():
            if j.status in ("queued", "running"):
                return j
    return None
