"""B4 — End-to-end SWOT generation orchestrator.

`generate_swot(store_name)` runs:
  1. B1: pull latest 100 calls
  2. B2: Stage-1 Map across batches
  3. B3: Stage-2 Reduce
  4. cache.put_cache(report)
  5. audit.audit('swot.generated')

Wraps the whole thing in a single try/except so partial failures land as a
`status='failed'` row in the cache (handy for the admin audit view) instead
of silently disappearing.
"""

from __future__ import annotations

import logging
from typing import Optional

from .. import audit
from ..config import SWOT_MAP_MODEL
from . import cache
from .input_adapter import chunk_into_batches, latest_calls_for_store
from .schema import SWOTReport
from .stage1_map import Stage1Error, run_stage1
from .stage2_reduce import Stage2Error, run_stage2

logger = logging.getLogger("trainer.swot.orchestrator")


class SWOTGenerationError(RuntimeError):
    def __init__(self, reason: str, *, stage: str = ""):
        super().__init__(reason)
        self.reason = reason
        self.stage = stage


def generate_swot(
    store_name: str,
    *,
    n: int = 100,
    actor_staff_id: Optional[str] = None,
    actor_email: Optional[str] = None,
) -> SWOTReport:
    """Generate, cache, and return a fresh SWOTReport for a store.

    Raises ``SWOTGenerationError`` on any pipeline failure; in that case a
    ``status='failed'`` row is appended to the cache so the failure is
    auditable.
    """
    audit.audit(
        actor_staff_id or "system",
        "swot.generation.started",
        target=store_name,
        actor_email=actor_email,
        payload={"n": n},
    )

    try:
        rows = latest_calls_for_store(store_name, n=n)
        if not rows:
            raise SWOTGenerationError(
                f"No calls found for store '{store_name}'", stage="input"
            )
        batches = chunk_into_batches(rows, batch_size=20)

        stage1 = run_stage1(batches)
        stage2 = run_stage2(
            store_name,
            stage1.partials,
            input_call_count=len(rows),
            map_model=SWOT_MAP_MODEL,
            map_cost_inr=stage1.cost_inr,
        )

        cache.put_cache(stage2.report)
        audit.audit(
            actor_staff_id or "system",
            "swot.generation.completed",
            target=store_name,
            actor_email=actor_email,
            payload={
                "input_call_count": stage2.report.input_call_count,
                "cost_inr": stage2.report.cost_inr,
                "n_strengths": len(stage2.report.strengths),
                "n_weaknesses": len(stage2.report.weaknesses),
            },
        )
        return stage2.report

    except SWOTGenerationError as exc:
        cache.put_failure(store_name, f"{exc.stage}: {exc.reason}")
        audit.audit(
            actor_staff_id or "system",
            "swot.generation.failed",
            target=store_name,
            actor_email=actor_email,
            payload={"stage": exc.stage, "reason": exc.reason},
        )
        raise

    except Stage1Error as exc:
        cache.put_failure(store_name, f"stage1: {exc.reason}", model=SWOT_MAP_MODEL)
        audit.audit(
            actor_staff_id or "system",
            "swot.generation.failed",
            target=store_name,
            actor_email=actor_email,
            payload={"stage": "stage1", "reason": exc.reason},
        )
        raise SWOTGenerationError(exc.reason, stage="stage1") from exc

    except Stage2Error as exc:
        cache.put_failure(store_name, f"stage2: {exc.reason}")
        audit.audit(
            actor_staff_id or "system",
            "swot.generation.failed",
            target=store_name,
            actor_email=actor_email,
            payload={"stage": "stage2", "reason": exc.reason},
        )
        raise SWOTGenerationError(exc.reason, stage="stage2") from exc

    except Exception as exc:
        logger.exception("swot.generation unexpected failure for %s", store_name)
        cache.put_failure(store_name, f"unexpected: {type(exc).__name__}: {exc}")
        audit.audit(
            actor_staff_id or "system",
            "swot.generation.failed",
            target=store_name,
            actor_email=actor_email,
            payload={"stage": "unknown", "reason": str(exc)},
        )
        raise SWOTGenerationError(str(exc), stage="unknown") from exc
