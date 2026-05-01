"""B3 — Stage-2 Reduce.

Take the Stage-1 partials and synthesise a final ``SWOTReport`` via the
configured Pro model. The output is strictly validated against the report
schema; an invalid response surfaces as ``Stage2Error`` and never lands in
the cache.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List

from pydantic import ValidationError

from concurrent.futures import ThreadPoolExecutor

from ..config import (
    SWOT_REDUCE_INR_PER_1M_IN,
    SWOT_REDUCE_INR_PER_1M_OUT,
    SWOT_REDUCE_MODEL,
)
from .gemini_client import call_text_model, strip_json_fences
from .prompts import stage2_swot_prompt, stage2_functions_prompt
from .schema import FunctionsBody, Stage1Result, SWOTBody, SWOTReport

logger = logging.getLogger("trainer.swot.stage2")


class Stage2Error(RuntimeError):
    def __init__(self, reason: str, raw: str = ""):
        super().__init__(f"Stage-2 reduce: {reason}")
        self.reason = reason
        self.raw = raw


@dataclass
class Stage2Output:
    report: SWOTReport
    cost_inr: float
    input_tokens: int
    output_tokens: int


def _collect_valid_clean_numbers(partials: List[Stage1Result]) -> set:
    """Build the set of Clean Numbers actually seen in Stage-1 evidence.

    Used to drop fabricated citations from the model's output. Mirrors the
    pattern in ``backend/gemini_service.py:_sanitize_clean_numbers``.
    """
    valid = set()
    for p in partials:
        for bucket in (p.strengths, p.weaknesses, p.opportunities, p.threats):
            for item in bucket:
                for ev in item.evidence:
                    if ev.clean_number:
                        valid.add(str(ev.clean_number))
    return valid


def _compute_quick_stats(data: dict, input_call_count: int) -> dict:
    """Derive the headline strip from the (already-parsed) SWOT body.

    Server-side compute = consistent with the quadrants below. We pick:
      - top_blocker: the SINGLE weakness/threat item with the highest
        ``evidence_count``. Threats and weaknesses share the pool because both
        cost revenue.
      - biggest_strength: the strength item with the highest evidence_count.
      - high_severity_count: total items across weaknesses + threats +
        function_improvements with severity == "high".
    """
    def _items(key):
        return [it for it in (data.get(key) or []) if isinstance(it, dict)]

    blockers = _items("weaknesses") + _items("threats")
    blockers_sorted = sorted(
        blockers, key=lambda it: int(it.get("evidence_count") or 0), reverse=True,
    )
    top_blocker = blockers_sorted[0] if blockers_sorted else None

    strengths = _items("strengths")
    strengths_sorted = sorted(
        strengths, key=lambda it: int(it.get("evidence_count") or 0), reverse=True,
    )
    top_strength = strengths_sorted[0] if strengths_sorted else None

    high_count = sum(
        1
        for key in ("weaknesses", "threats")
        for it in _items(key)
        if (it.get("severity") or "").lower() == "high"
    )
    for block in (data.get("function_improvements") or []):
        if not isinstance(block, dict):
            continue
        for it in (block.get("items") or []):
            if isinstance(it, dict) and (it.get("severity") or "").lower() == "high":
                high_count += 1

    return {
        "calls_analyzed": int(input_call_count),
        "top_blocker_theme": (top_blocker.get("theme") if top_blocker else "") or "",
        "top_blocker_calls": int((top_blocker or {}).get("evidence_count") or 0),
        "biggest_strength_theme": (top_strength.get("theme") if top_strength else "") or "",
        "high_severity_count": high_count,
    }


def _sanitize_clean_numbers(data: dict, valid: set) -> dict:
    """Walk the model's response and drop any Clean Number it invented.

    Fields touched: every ``example_clean_numbers`` array under SWOT items
    AND under each function-improvement item. Returns ``data`` mutated in
    place (and also returned for fluent chaining).
    """
    def _filter(numbers):
        if not isinstance(numbers, list):
            return numbers
        return [n for n in numbers if str(n) in valid]

    for key in ("strengths", "weaknesses", "opportunities", "threats"):
        for item in data.get(key, []) or []:
            if isinstance(item, dict) and "example_clean_numbers" in item:
                item["example_clean_numbers"] = _filter(item["example_clean_numbers"])

    for block in data.get("function_improvements", []) or []:
        if not isinstance(block, dict):
            continue
        for item in block.get("items", []) or []:
            if isinstance(item, dict) and "example_clean_numbers" in item:
                item["example_clean_numbers"] = _filter(item["example_clean_numbers"])

    return data


def run_stage2(
    store_name: str,
    partials: List[Stage1Result],
    *,
    input_call_count: int,
    map_model: str,
    map_cost_inr: float,
) -> Stage2Output:
    if not partials:
        raise Stage2Error("no partials to reduce")

    payload = [p.model_dump() for p in partials]
    swot_prompt = stage2_swot_prompt(store_name, payload, n_total_calls=input_call_count)
    fn_prompt = stage2_functions_prompt(store_name, payload, n_total_calls=input_call_count)

    # Two parallel Gemini calls — keeps each response well under the
    # token cap (single mega-prompt previously truncated JSON mid-string).
    # Pro 3.1 requires thinking_budget > 0; 4K is enough for the merging
    # work, which is mostly mechanical pattern recognition.
    def _swot_call():
        return call_text_model(
            SWOT_REDUCE_MODEL, swot_prompt,
            response_schema=SWOTBody,
            max_output_tokens=32_000,
            thinking_budget=4_096,
        )

    def _fn_call():
        return call_text_model(
            SWOT_REDUCE_MODEL, fn_prompt,
            response_schema=FunctionsBody,
            max_output_tokens=32_000,
            thinking_budget=4_096,
        )

    with ThreadPoolExecutor(max_workers=2) as ex:
        swot_future = ex.submit(_swot_call)
        fn_future = ex.submit(_fn_call)
        try:
            swot_result = swot_future.result()
        except Exception as exc:
            raise Stage2Error(f"SWOT call failed: {type(exc).__name__}: {exc}") from exc
        try:
            fn_result = fn_future.result()
        except Exception as exc:
            raise Stage2Error(f"Functions call failed: {type(exc).__name__}: {exc}") from exc

    # Parse SWOT response.
    swot_raw = strip_json_fences(swot_result.text)
    if not swot_raw:
        raise Stage2Error("empty SWOT response", raw=swot_result.text)
    try:
        swot_data = json.loads(swot_raw)
    except json.JSONDecodeError as exc:
        raise Stage2Error(f"SWOT invalid JSON: {exc}", raw=swot_raw) from exc

    # Parse Functions response.
    fn_raw = strip_json_fences(fn_result.text)
    if not fn_raw:
        # Functions are best-effort; failure here shouldn't kill the SWOT.
        logger.warning("swot.stage2 functions call returned empty; proceeding with SWOT-only")
        fn_data = {"function_improvements": []}
    else:
        try:
            fn_data = json.loads(fn_raw)
        except json.JSONDecodeError as exc:
            logger.warning("swot.stage2 functions invalid JSON, dropping: %s", exc)
            fn_data = {"function_improvements": []}

    # Merge into one body dict.
    data = {
        **{k: swot_data.get(k, []) for k in ("strengths", "weaknesses", "opportunities", "threats")},
        "notes": swot_data.get("notes"),
        "function_improvements": fn_data.get("function_improvements") or [],
    }

    # Defensive: drop any Clean Number the model invented (fabricated phone
    # citations would route to a 404 Call Detail page and erode trust).
    valid_numbers = _collect_valid_clean_numbers(partials)
    _sanitize_clean_numbers(data, valid_numbers)

    # Always compute quick_stats server-side from the (sanitised) parsed data —
    # consistent with the quadrants below, and we don't pay for the model to
    # derive its own headline.
    data["quick_stats"] = _compute_quick_stats(data, input_call_count)

    # Wrap with report metadata.
    body = {
        "store_name": store_name,
        "generated_at": datetime.now(timezone.utc),
        "input_call_count": input_call_count,
        "model_map": map_model,
        "model_reduce": SWOT_REDUCE_MODEL,
        "cost_inr": 0.0,  # filled below
        **{k: data.get(k, []) for k in ("strengths", "weaknesses", "opportunities", "threats")},
        "quick_stats": data.get("quick_stats"),
        "function_improvements": data.get("function_improvements") or [],
        "notes": data.get("notes"),
    }

    try:
        report = SWOTReport.model_validate(body)
    except ValidationError as exc:
        raise Stage2Error(f"schema mismatch: {exc.errors()[:2]}", raw=swot_raw) from exc

    swot_cost = swot_result.cost_inr(SWOT_REDUCE_INR_PER_1M_IN, SWOT_REDUCE_INR_PER_1M_OUT)
    fn_cost = fn_result.cost_inr(SWOT_REDUCE_INR_PER_1M_IN, SWOT_REDUCE_INR_PER_1M_OUT)
    reduce_cost = swot_cost + fn_cost
    report = report.model_copy(update={"cost_inr": round(map_cost_inr + reduce_cost, 4)})

    in_tok = swot_result.input_tokens + fn_result.input_tokens
    out_tok = swot_result.output_tokens + fn_result.output_tokens
    logger.info(
        "swot.stage2 store=%s partials=%d cost_inr=%.4f in_tok=%d out_tok=%d (2 calls)",
        store_name, len(partials), reduce_cost, in_tok, out_tok,
    )
    return Stage2Output(
        report=report,
        cost_inr=reduce_cost,
        input_tokens=in_tok,
        output_tokens=out_tok,
    )
