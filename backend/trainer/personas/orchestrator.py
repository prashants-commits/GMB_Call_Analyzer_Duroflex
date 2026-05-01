"""End-to-end persona library generation.

Pipeline: latest_calls → C1 (signatures, parallel) → C2 (synthesise) →
C4 (coverage report) → save_draft. Admin reviews + publishes separately.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from .. import audit
from ..config import (
    PERSONA_DEFAULT_K_PERSONAS,
    PERSONA_DEFAULT_N_CALLS,
    PERSONA_MAX_N_CALLS,
    PERSONA_SIGNATURE_MODEL,
    PERSONA_SYNTHESIS_MODEL,
)
from .diversity import compute_coverage
from .schema import PersonaLibrary
from .signature import extract_signatures, latest_calls_for_signatures
from .store import load_draft, save_draft
from .synthesise import SynthesisError, synthesise_personas

logger = logging.getLogger("trainer.personas.orchestrator")


class PersonaGenerationError(RuntimeError):
    def __init__(self, reason: str, stage: str = ""):
        super().__init__(reason)
        self.reason = reason
        self.stage = stage


def generate_library(
    *,
    n_calls: Optional[int] = None,
    k_personas: Optional[int] = None,
    store_name: Optional[str] = None,
    actor_staff_id: Optional[str] = None,
    actor_email: Optional[str] = None,
) -> PersonaLibrary:
    n_calls = n_calls or PERSONA_DEFAULT_N_CALLS
    k_personas = k_personas or PERSONA_DEFAULT_K_PERSONAS

    # n_calls validation: when store-scoped, allow any value ≤ cap because the
    # adapter just returns whatever's available (down to 0). When global,
    # require ≥5 to avoid pointless runs.
    if not store_name and n_calls < 5:
        raise PersonaGenerationError(f"n_calls={n_calls} too small", stage="input")
    if n_calls > PERSONA_MAX_N_CALLS:
        raise PersonaGenerationError(
            f"n_calls={n_calls} exceeds cap {PERSONA_MAX_N_CALLS}", stage="input"
        )
    if k_personas < 3 or k_personas > 60:
        raise PersonaGenerationError(f"k_personas={k_personas} out of range [3,60]", stage="input")

    audit.audit(
        actor_staff_id or "system",
        "personas.generation.started",
        actor_email=actor_email,
        payload={"n_calls": n_calls, "k_personas": k_personas, "store_name": store_name or ""},
    )

    try:
        # ── C1
        calls = latest_calls_for_signatures(n_calls, store_name=store_name)
        if not calls:
            scope = f" for store {store_name!r}" if store_name else ""
            raise PersonaGenerationError(
                f"No calls available{scope} — is the corpus loaded?",
                stage="input",
            )

        sig_out = extract_signatures(calls)
        if len(sig_out.signatures) < 3:
            raise PersonaGenerationError(
                f"only {len(sig_out.signatures)} usable signatures from {len(calls)} calls "
                f"(need at least 3 for any meaningful library)",
                stage="signature",
            )
        # Reduce k down to what we actually have if needed (the synthesis prompt
        # needs ≥3 usable signatures per output persona is a soft target, but
        # don't force the model to invent personas without source data).
        effective_k = min(k_personas, len(sig_out.signatures))
        if effective_k < k_personas:
            logger.info(
                "personas.generation k reduced %d→%d (only %d usable signatures)",
                k_personas, effective_k, len(sig_out.signatures),
            )

        # ── C2
        synth = synthesise_personas(sig_out.signatures, k=effective_k)

        # ── C4 — non-blocking: surface as notes
        coverage = compute_coverage(synth.personas)
        coverage_note = "; ".join(coverage.issues) if coverage.issues else None

        existing_draft = load_draft()
        next_version = (existing_draft.version + 1) if existing_draft else 1

        notes_parts = [synth.notes] if synth.notes else []
        if store_name:
            notes_parts.append(f"source store: {store_name}")
        if coverage_note:
            notes_parts.append(f"coverage: {coverage_note}")

        library = PersonaLibrary(
            version=next_version,
            status="draft",
            generated_at=datetime.now(timezone.utc),
            source_call_count=len(calls),
            model_signature=PERSONA_SIGNATURE_MODEL,
            model_synthesis=PERSONA_SYNTHESIS_MODEL,
            cost_inr=round(sig_out.cost_inr + synth.cost_inr, 4),
            notes=" | ".join(notes_parts) if notes_parts else None,
            personas=synth.personas,
        )
        save_draft(library, actor_staff_id=actor_staff_id, actor_email=actor_email)

        audit.audit(
            actor_staff_id or "system",
            "personas.generation.completed",
            actor_email=actor_email,
            target=f"v{next_version}",
            payload={
                "persona_count": len(library.personas),
                "cost_inr": library.cost_inr,
                "coverage_issues": coverage.issues,
            },
        )
        return library

    except PersonaGenerationError:
        raise
    except SynthesisError as exc:
        audit.audit(actor_staff_id or "system", "personas.generation.failed",
                    actor_email=actor_email, payload={"stage": "synthesis", "reason": exc.reason})
        raise PersonaGenerationError(exc.reason, stage="synthesis") from exc
    except Exception as exc:
        logger.exception("personas.generation unexpected failure")
        audit.audit(actor_staff_id or "system", "personas.generation.failed",
                    actor_email=actor_email, payload={"stage": "unknown", "reason": str(exc)})
        raise PersonaGenerationError(str(exc), stage="unknown") from exc
