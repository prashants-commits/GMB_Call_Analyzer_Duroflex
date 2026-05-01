"""C2 — Cluster + synthesise via a single Gemini Pro call.

The original plan called for numpy k-medoids clustering followed by per-
cluster synthesis. We replace that with one Pro call that takes the full
signature set, reasons about clustering internally, and returns K personas
with diversity built in. Cleaner, more reliable, and ~K× cheaper.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import List, Optional

from pydantic import ValidationError

from ..config import (
    PERSONA_INR_PER_1M_IN,
    PERSONA_INR_PER_1M_OUT,
    PERSONA_SYNTHESIS_MODEL,
)
from ..swot.gemini_client import call_text_model, strip_json_fences
from .schema import PersonaSignature, Persona, SynthesisOutput

logger = logging.getLogger("trainer.personas.synthesis")


class SynthesisError(RuntimeError):
    def __init__(self, reason: str, raw: str = ""):
        super().__init__(reason)
        self.reason = reason
        self.raw = raw


@dataclass
class SynthesisResult:
    personas: List[Persona]
    notes: Optional[str]
    cost_inr: float
    input_tokens: int
    output_tokens: int


_PROMPT = """You are a senior customer-research lead at Duroflex (mattress retailer in India). You will receive {n_signatures} per-call PersonaSignature objects extracted from analyzed inbound sales calls.

Your job: synthesise EXACTLY {k} distinct, drillable customer personas suitable for staff training role-play. Each persona is a *composite* of multiple real callers — never a 1:1 clone.

Diversity targets (must be respected):
  - At least {n_easy} personas with difficulty_band="easy".
  - At least {n_medium} personas with difficulty_band="medium".
  - At least {n_hard} personas with difficulty_band="hard".
  - Cover at least 3 distinct language_mix values across the {k} personas.
  - Cover at least 3 distinct decision_role values across the {k} personas.
  - Cover at least 3 distinct age_band values across the {k} personas.

Persona quality rules:
  - persona_id: kebab-case, ≤40 chars, e.g. "P-elderly-back-pain-cautious".
  - name: friendly + descriptive, e.g. "Anand, the Cautious Parent-Buyer".
  - summary: 1-2 sentence character snapshot.
  - opening_line_hint: realistic first thing they'd say. Quote the language they'd use.
  - target_skill_focus: 1-4 skills the agent must demonstrate. Pick from this list:
      needs_discovery, objection_handling, probing, hooks_and_offers,
      follow_up_capture, product_pivoting, empathy_and_tone, closing
  - difficulty_band: "easy" if the customer is friendly + clear; "hard" if multiple
    objections / language switches / surprise pivots are likely; "medium" for the rest.
  - surprise_pivot: optional mid-call twist (a sentence or null).
  - backstory: 1-3 sentences of richer context (family, location, prior brand experience).
  - buying_journey_focus: list of EXACTLY 3 OR 4 stage keys, primary first. Pick from
    these 6 canonical stages:
      needs_discovery       — pain, sleeper type, current mattress, room/bed size
      product_discovery     — which range/model fits, firmness, foam vs hybrid
      product_availability  — in stock, sizes on display, showroom demo
      price_and_offers      — MRP, EMI, festive/bundle offers, discount applicability
      delivery_timeline     — how soon, express slot, white-glove, specific day
      warranty              — length, claim process, sleep-trial / return window
    The PRIMARY (first entry) = the stage this customer cares MOST about, derived
    from the strongest theme in the source signatures (objections_emitted +
    hooks_responded_to). The SECONDARY entries (next 2-3) = aspects this customer
    will ALSO raise during the call. Real customers care about multiple stages —
    a one-note customer is unrealistic and is the BIGGEST error to avoid.

Hard rules:
  - Output ONLY the schema; no extra commentary.
  - "objections_likely" and "hooks_to_try" must use SHORT labels (1-4 words each).
  - "language_mix", "voice_profile", "decision_role", "age_band", "income_band",
    "brand_affinity", "urgency_profile", "price_sensitivity", "difficulty_band"
    must be exact enum values from the schema.
  - "buying_journey_focus" entries MUST be exact keys from the 6-stage list above.
  - Cover at least 4 distinct PRIMARY stages across the {k} personas — don't make
    every persona primary-focused on price.

Input signatures (JSON array):
{signatures_json}
"""


def synthesise_personas(
    signatures: List[PersonaSignature],
    *,
    k: int,
) -> SynthesisResult:
    if k < 3:
        raise SynthesisError(f"k={k} too small; need at least 3 for any diversity")
    if not signatures:
        raise SynthesisError("no signatures provided")

    n_easy = max(1, k // 5)        # at least 20%
    n_medium = max(1, k // 2)      # at least 50%
    n_hard = max(1, k - n_easy - n_medium)

    prompt = _PROMPT.format(
        n_signatures=len(signatures),
        k=k,
        n_easy=n_easy,
        n_medium=n_medium,
        n_hard=n_hard,
        signatures_json=json.dumps(
            [s.model_dump() for s in signatures], ensure_ascii=False, indent=2
        ),
    )

    try:
        call = call_text_model(
            PERSONA_SYNTHESIS_MODEL, prompt, response_schema=SynthesisOutput
        )
    except Exception as exc:
        raise SynthesisError(f"gemini_error: {type(exc).__name__}: {exc}") from exc

    raw = strip_json_fences(call.text)
    if not raw:
        raise SynthesisError("empty response", raw=call.text)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SynthesisError(f"invalid JSON: {exc}", raw=raw) from exc

    try:
        out = SynthesisOutput.model_validate(data)
    except ValidationError as exc:
        raise SynthesisError(f"schema mismatch: {exc.errors()[:2]}", raw=raw) from exc

    # Defensive: dedupe by persona_id (model occasionally repeats one).
    seen: set = set()
    unique: List[Persona] = []
    for p in out.personas:
        if p.persona_id not in seen:
            seen.add(p.persona_id)
            unique.append(p)

    cost = call.cost_inr(PERSONA_INR_PER_1M_IN, PERSONA_INR_PER_1M_OUT)
    logger.info(
        "personas.synthesis k_requested=%d returned=%d unique=%d cost_inr=%.4f",
        k, len(out.personas), len(unique), cost,
    )

    return SynthesisResult(
        personas=unique,
        notes=out.notes,
        cost_inr=cost,
        input_tokens=call.input_tokens,
        output_tokens=call.output_tokens,
    )
