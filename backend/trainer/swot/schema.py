"""Pydantic models for the SWOT pipeline.

The Stage-1 Map output and Stage-2 Reduce output are deliberately separate
schemas — Stage-1 is per-batch (smaller fan-out) and Stage-2 is the final
report shown to managers. We validate both strictly so a flaky LLM response
fails loudly instead of corrupting the cache.
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

Severity = Literal["low", "medium", "high"]


# ── Stage-1 (per-batch) ──────────────────────────────────────────────────────


class Stage1Evidence(BaseModel):
    model_config = ConfigDict(extra="ignore")
    clean_number: str = Field(..., description="Phone identifier from the input batch")
    quote: str = Field(..., max_length=500)


class Stage1Item(BaseModel):
    model_config = ConfigDict(extra="ignore")
    theme: str = Field(..., max_length=120)
    detail: str = Field(..., max_length=500)
    evidence: List[Stage1Evidence] = Field(default_factory=list)


class Stage1Result(BaseModel):
    model_config = ConfigDict(extra="ignore")
    strengths: List[Stage1Item] = Field(default_factory=list)
    weaknesses: List[Stage1Item] = Field(default_factory=list)
    opportunities: List[Stage1Item] = Field(default_factory=list)
    threats: List[Stage1Item] = Field(default_factory=list)


# ── Stage-2 (final report) ───────────────────────────────────────────────────


class SWOTItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    theme: str = Field(..., max_length=120)
    detail: str = Field(..., max_length=600)
    severity: Severity = "medium"
    evidence_count: int = Field(0, ge=0)
    representative_quotes: List[str] = Field(default_factory=list, max_length=3)
    # Clean numbers (10-digit phone identifiers) of the calls most strongly
    # exhibiting this theme. Frontend renders these as clickable links to
    # /call/{cleanNumber}. Sanitised server-side against the actual input
    # batch so fabricated numbers never reach the UI.
    example_clean_numbers: List[str] = Field(default_factory=list, max_length=5)


# ── Function Improvement Areas (CSO / Head-of-Sales / CGO view) ─────────────

# The 5 functions a CSO+CGO want segmented insights for. Locked enum so the
# prompt cannot drift into ad-hoc function names like "Pricing Team".
FunctionName = Literal[
    "sales_team",                # agent skill, probing, hooks, soft skills, brand intro
    "marketing",                 # lead quality, brand awareness, campaign promises
    "supply_chain_and_delivery", # stock-outs, delivery delays, damaged-on-arrival
    "product_team",              # product gaps, missing sizes, defects, model confusion
    "omnichannel_team",          # web/app/store info mismatch, online order handoff, WhatsApp
]


class FunctionImprovementItem(BaseModel):
    """One actionable improvement theme scoped to a specific function.

    Designed for executive consumption — every field is short and the
    `recommended_action` is explicitly the operator's next step.
    """

    model_config = ConfigDict(extra="ignore")

    function: FunctionName
    theme: str = Field(..., max_length=120)
    detail: str = Field(..., max_length=500, description="1-2 sentence problem statement")
    recommended_action: str = Field(
        ..., max_length=200,
        description="Concrete next step the function owner should take (≤20 words ideally)",
    )
    severity: Severity = "medium"
    evidence_count: int = Field(0, ge=0, description="Total calls exhibiting this theme")
    example_clean_numbers: List[str] = Field(default_factory=list, max_length=5)


class FunctionBlock(BaseModel):
    """All improvement themes for one function. When ``items`` is empty the UI
    renders a 'No issues identified' placeholder so the CSO knows the function
    was scanned (rather than skipped)."""

    model_config = ConfigDict(extra="ignore")

    function: FunctionName
    items: List[FunctionImprovementItem] = Field(default_factory=list, max_length=5)


class QuickStats(BaseModel):
    """Headline strip rendered above the SWOT quadrants. CSO-facing 5-second
    read of the store's status."""

    model_config = ConfigDict(extra="ignore")

    calls_analyzed: int = Field(..., ge=0)
    top_blocker_theme: str = Field("", max_length=120, description="The single most-cited weakness theme")
    top_blocker_calls: int = Field(0, ge=0, description="Volume of calls citing the top blocker")
    biggest_strength_theme: str = Field("", max_length=120)
    high_severity_count: int = Field(0, ge=0, description="Total weakness/threat themes flagged severity=high")


class SWOTReport(BaseModel):
    model_config = ConfigDict(extra="ignore")

    store_name: str
    generated_at: datetime
    input_call_count: int = Field(..., ge=0)
    model_map: str = Field(..., description="Stage-1 model id")
    model_reduce: str = Field(..., description="Stage-2 model id")
    cost_inr: float = Field(0.0, ge=0)

    strengths: List[SWOTItem] = Field(default_factory=list, max_length=7)
    weaknesses: List[SWOTItem] = Field(default_factory=list, max_length=7)
    opportunities: List[SWOTItem] = Field(default_factory=list, max_length=5)
    threats: List[SWOTItem] = Field(default_factory=list, max_length=5)

    # CSO/CGO additions. Default empty for backward-compat with cached SWOTs
    # generated before this field existed; the frontend renders an empty state
    # with a "regenerate" hint when both are empty.
    quick_stats: Optional[QuickStats] = None
    function_improvements: List[FunctionBlock] = Field(default_factory=list)

    notes: Optional[str] = None


class SWOTBody(BaseModel):
    """Just the four SWOT lists + notes — what Call-1 of Stage-2 returns.

    The synthesis is split into two model calls because the previous single-
    mega-prompt approach produced enough output for ``response_schema`` mode
    to truncate JSON mid-string for rich stores. SWOT-only stays well under
    any token cap. ``run_stage2`` makes a separate call for function
    improvements (see :class:`FunctionsBody`) and merges + computes
    quick_stats server-side.
    """

    model_config = ConfigDict(extra="ignore")
    strengths: List[SWOTItem] = Field(default_factory=list)
    weaknesses: List[SWOTItem] = Field(default_factory=list)
    opportunities: List[SWOTItem] = Field(default_factory=list)
    threats: List[SWOTItem] = Field(default_factory=list)
    notes: Optional[str] = None


class FunctionsBody(BaseModel):
    """What Call-2 of Stage-2 returns — just the 5 function-improvement blocks."""

    model_config = ConfigDict(extra="ignore")
    function_improvements: List[FunctionBlock] = Field(default_factory=list)
