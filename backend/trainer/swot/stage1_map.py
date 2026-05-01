"""B2 — Stage-1 Map.

Run the per-batch SWOT extraction in parallel. Each batch is sent to the
configured fast model (``SWOT_MAP_MODEL``); results are JSON-parsed and
validated against ``Stage1Result``. Failures bubble up as ``Stage1Error``
with the batch index attached for debugging.
"""

from __future__ import annotations

import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Any, Dict, List

from pydantic import ValidationError

from ..config import (
    SWOT_MAP_INR_PER_1M_IN,
    SWOT_MAP_INR_PER_1M_OUT,
    SWOT_MAP_MODEL,
)
from .gemini_client import call_text_model, strip_json_fences
from .prompts import stage1_map_prompt
from .schema import Stage1Result

logger = logging.getLogger("trainer.swot.stage1")


class Stage1Error(RuntimeError):
    def __init__(self, batch_index: int, reason: str, raw: str = ""):
        super().__init__(f"Stage-1 batch {batch_index}: {reason}")
        self.batch_index = batch_index
        self.reason = reason
        self.raw = raw


@dataclass
class Stage1Output:
    partials: List[Stage1Result] = field(default_factory=list)
    cost_inr: float = 0.0
    input_tokens: int = 0
    output_tokens: int = 0


def _run_one_attempt(batch_index: int, batch: List[Dict[str, Any]]) -> tuple[Stage1Result, float, int, int]:
    prompt = stage1_map_prompt(batch)
    call = call_text_model(SWOT_MAP_MODEL, prompt, response_schema=Stage1Result)

    raw = strip_json_fences(call.text)
    if not raw:
        raise Stage1Error(batch_index, "empty response", raw=call.text)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise Stage1Error(batch_index, f"invalid JSON: {exc}", raw=raw) from exc

    try:
        result = Stage1Result.model_validate(data)
    except ValidationError as exc:
        raise Stage1Error(batch_index, f"schema mismatch: {exc.errors()[:2]}", raw=raw) from exc

    cost = call.cost_inr(SWOT_MAP_INR_PER_1M_IN, SWOT_MAP_INR_PER_1M_OUT)
    return result, cost, call.input_tokens, call.output_tokens


def _run_one(batch_index: int, batch: List[Dict[str, Any]], retries: int = 1) -> tuple[Stage1Result, float, int, int]:
    """Run one Stage-1 batch with up to ``retries`` retries on parse failure.

    Structured-output mode usually makes a retry unnecessary, but the SDK can
    still surface a transient ``RESOURCE_EXHAUSTED`` or empty response — in
    that case a quick second attempt almost always succeeds.
    """
    last_exc: Stage1Error | None = None
    for attempt in range(retries + 1):
        try:
            return _run_one_attempt(batch_index, batch)
        except Stage1Error as exc:
            logger.warning(
                "swot.stage1.batch=%d attempt=%d failed: %s", batch_index, attempt, exc.reason,
            )
            last_exc = exc
    assert last_exc is not None
    raise last_exc


def run_stage1(batches: List[List[Dict[str, Any]]], max_workers: int = 5) -> Stage1Output:
    """Fan out one Gemini call per batch. Returns merged ``Stage1Output``.

    Tolerance: if at least half the batches succeed (and at least one), we
    accept partial results and surface a soft warning. A drop of one in five
    batches is far better than failing the whole SWOT. Only when MORE than
    half the batches fail do we raise — at that point Stage-2 wouldn't have
    enough signal to merge.
    """
    if not batches:
        return Stage1Output()

    out = Stage1Output()

    if len(batches) == 1:
        result, cost, in_tok, out_tok = _run_one(0, batches[0])
        out.partials.append(result)
        out.cost_inr += cost
        out.input_tokens += in_tok
        out.output_tokens += out_tok
        return out

    with ThreadPoolExecutor(max_workers=min(max_workers, len(batches))) as ex:
        futures = {ex.submit(_run_one, i, b): i for i, b in enumerate(batches)}
        results: Dict[int, tuple] = {}
        errors: Dict[int, Stage1Error] = {}
        for fut in as_completed(futures):
            idx = futures[fut]
            try:
                results[idx] = fut.result()
            except Stage1Error as exc:
                errors[idx] = exc

    if errors and len(errors) > len(batches) // 2:
        # Too many failures — raise the first one encountered.
        first_idx = min(errors)
        raise errors[first_idx]

    for i in range(len(batches)):
        if i not in results:
            continue  # tolerated batch failure — soldier on
        result, cost, in_tok, out_tok = results[i]
        out.partials.append(result)
        out.cost_inr += cost
        out.input_tokens += in_tok
        out.output_tokens += out_tok

    if errors:
        logger.warning(
            "swot.stage1 batches=%d ok=%d failed=%d (tolerated)",
            len(batches), len(results), len(errors),
        )

    logger.info(
        "swot.stage1 batches=%d ok=%d cost_inr=%.4f in_tok=%d out_tok=%d",
        len(batches), len(out.partials), out.cost_inr, out.input_tokens, out.output_tokens,
    )
    return out
