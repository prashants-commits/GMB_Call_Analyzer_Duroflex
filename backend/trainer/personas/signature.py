"""C1 — Per-call PersonaSignature extraction.

Each analyzed call (with a non-trivial transcript) gets one Gemini call that
emits a 12-field signature. Runs in a thread-pool because the calls are I/O-
bound and independent. ``response_schema=PersonaSignature`` forces structured
output so we never hit JSON-parse drift.
"""

from __future__ import annotations

import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Any, Dict, List

from pydantic import ValidationError

from csv_parser import parse_call_date

from .. import bootstrap
from ..config import (
    PERSONA_INR_PER_1M_IN,
    PERSONA_INR_PER_1M_OUT,
    PERSONA_SIGNATURE_MODEL,
)
from ..swot.gemini_client import call_text_model, strip_json_fences
from .schema import PersonaSignature

logger = logging.getLogger("trainer.personas.signature")

MIN_TRANSCRIPT_CHARS = 200


@dataclass
class SignatureBatchOutput:
    signatures: List[PersonaSignature] = field(default_factory=list)
    skipped: int = 0
    failed: int = 0
    cost_inr: float = 0.0
    input_tokens: int = 0
    output_tokens: int = 0


_PROMPT_TEMPLATE = """You are a customer-research analyst at Duroflex (a mattress retailer in India). I will give you ONE analyzed inbound sales call. Your job: extract a tight 12-field "PersonaSignature" describing the *customer* in this call (NOT the agent).

Hard rules:
  - Use ONLY the schema fields, nothing else.
  - clean_number: copy verbatim from the input.
  - language: pick the closest of {{english_only, english_dominant_hindi, hinglish, hindi_dominant_english, regional_dominant}}.
  - regional_origin: short city/region string (≤40 chars). Empty if unknown.
  - gender_hint: male / female / unknown — only when there's clear linguistic evidence.
  - age_band: 18_25 / 26_35 / 36_45 / 46_55 / 56_plus. Best guess from speech patterns + buying motive.
  - income_band: budget / mid / premium / luxury — based on price tolerance, product interest, location signals.
  - brand_recall_strength: none / weak / strong / loyalist.
  - product_pref_keywords: ≤6 short keywords (e.g. ["king-size", "spring", "back-pain", "memory-foam"]).
  - urgency: low / medium / high.
  - price_sensitivity: low / medium / high.
  - decision_role: self / spouse / parent / household_head / gift.
  - objections_emitted: ≤8 short labels for objections raised in this call (e.g. ["price-too-high", "want-firmer", "no-warranty-clarity"]).
  - hooks_responded_to: ≤6 short labels for hooks the agent used that LANDED (e.g. ["weekend-discount", "free-delivery", "hdfc-offer"]). Empty list if no hook landed.

Input call (JSON):
{call_json}
"""


def _build_prompt(call: Dict[str, Any]) -> str:
    return _PROMPT_TEMPLATE.format(call_json=json.dumps(call, ensure_ascii=False, indent=2))


def _extract_one(call: Dict[str, Any]) -> tuple[PersonaSignature | None, float, int, int, str]:
    """Returns (signature_or_None, cost_inr, in_tok, out_tok, reason).

    On failure, signature is None and ``reason`` describes why.
    """
    prompt = _build_prompt(call)
    try:
        result = call_text_model(
            PERSONA_SIGNATURE_MODEL, prompt, response_schema=PersonaSignature
        )
    except Exception as exc:
        return None, 0.0, 0, 0, f"gemini_error: {type(exc).__name__}"

    raw = strip_json_fences(result.text)
    if not raw:
        return None, 0.0, result.input_tokens, result.output_tokens, "empty_response"
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        return None, 0.0, result.input_tokens, result.output_tokens, f"invalid_json: {exc}"
    try:
        sig = PersonaSignature.model_validate(data)
    except ValidationError as exc:
        return None, 0.0, result.input_tokens, result.output_tokens, f"schema: {exc.errors()[:1]}"

    cost = result.cost_inr(PERSONA_INR_PER_1M_IN, PERSONA_INR_PER_1M_OUT)
    return sig, cost, result.input_tokens, result.output_tokens, "ok"


def extract_signatures(
    calls: List[Dict[str, Any]],
    *,
    max_workers: int = 6,
) -> SignatureBatchOutput:
    """Run signature extraction across many calls in parallel."""
    out = SignatureBatchOutput()

    eligible: List[Dict[str, Any]] = []
    for c in calls:
        # Only "Call Summary" or transcript-like keys carry the rich text we need;
        # for the GMB CSV, "Call Summary" + "Customer Needs" are reliable proxies.
        text_signal = " ".join(
            str(c.get(k, "")) for k in ("Call Summary", "Customer Needs", "Agent Bad", "Brand Bad")
        )
        if len(text_signal) < MIN_TRANSCRIPT_CHARS:
            out.skipped += 1
            continue
        eligible.append(c)

    if not eligible:
        return out

    with ThreadPoolExecutor(max_workers=min(max_workers, len(eligible))) as ex:
        futures = {ex.submit(_extract_one, c): c for c in eligible}
        for fut in as_completed(futures):
            sig, cost, in_tok, out_tok, reason = fut.result()
            out.input_tokens += in_tok
            out.output_tokens += out_tok
            out.cost_inr += cost
            if sig is None:
                out.failed += 1
                logger.warning("personas.signature.failed reason=%s", reason)
            else:
                out.signatures.append(sig)

    logger.info(
        "personas.signatures total=%d ok=%d skipped=%d failed=%d cost_inr=%.4f",
        len(calls), len(out.signatures), out.skipped, out.failed, out.cost_inr,
    )
    return out


def latest_calls_for_signatures(n: int, store_name: str | None = None) -> List[Dict[str, Any]]:
    """Pull the latest ``n`` analyzed calls.

    When ``store_name`` is provided, filter to that store's calls (matches the
    SWOT input adapter pattern). Otherwise pulls across all stores. If a
    store-filtered run yields fewer than ``n`` calls, returns whatever is
    available (caller decides whether that's enough).
    """
    cds = bootstrap.get_call_data_store()
    if cds is None:
        return []
    analytics = cds.get_analytics_data()
    if store_name:
        analytics = [c for c in analytics if c.get("store_name") == store_name]
    analytics_sorted = sorted(analytics, key=lambda c: parse_call_date(c.get("call_date")), reverse=True)
    clean_numbers = [c["clean_number"] for c in analytics_sorted[:n] if c.get("clean_number")]
    return cds.get_insight_columns(clean_numbers)
