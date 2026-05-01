"""Pydantic models for the score card.

Mirrors the rubric in AITrainer_Idea_v1.md §11.3:

  | Section            | Weight |
  | Opening            | 10     |
  | Need Discovery     | 15     |
  | Product Pitch      | 15     |
  | Objection Handling | 15     |
  | Hook Usage         | 15     |
  | Closing            | 10     |
  | Soft Skills        | 10     |
  | Brand Compliance   | 5      |
  | Time Management    | 5      |
  | TOTAL              | 100    |

Each section is scored 0-10 by the model. ``score_overall`` is computed
deterministically server-side from ``section_scores`` × weights, normalised
to 0-100. We never trust the model's own ``overall_score`` — drift would
make the section bar chart on the UI inconsistent with the headline number.

Schema shape note: section_scores is a LIST of objects (not a Dict[str, …])
because Gemini's structured-output mode rejects ``additionalProperties``,
which Pydantic emits for free-form-keyed dicts. Using a list with an enum
``name`` field satisfies the validator and keeps iteration simple.
"""

from __future__ import annotations

from typing import Dict, List, Literal

from pydantic import BaseModel, ConfigDict, Field

# ── Rubric ─────────────────────────────────────────────────────────────────

# Order matters: this is the order skill bars render on the UI.
SECTION_WEIGHTS: Dict[str, int] = {
    "opening": 10,
    "need_discovery": 15,
    "product_pitch": 15,
    "objection_handling": 15,
    "hook_usage": 15,
    "closing": 10,
    "soft_skills": 10,
    "brand_compliance": 5,
    "time_management": 5,
}

# Sanity check at import time so a bad edit fails loudly.
assert sum(SECTION_WEIGHTS.values()) == 100, "Section weights must sum to 100"

SECTION_DISPLAY: Dict[str, str] = {
    "opening": "Opening",
    "need_discovery": "Need Discovery",
    "product_pitch": "Product Pitch",
    "objection_handling": "Objection Handling",
    "hook_usage": "Hook Usage",
    "closing": "Closing",
    "soft_skills": "Soft Skills",
    "brand_compliance": "Brand Compliance",
    "time_management": "Time Management",
}

SectionKey = Literal[
    "opening",
    "need_discovery",
    "product_pitch",
    "objection_handling",
    "hook_usage",
    "closing",
    "soft_skills",
    "brand_compliance",
    "time_management",
]


# ── Atoms ──────────────────────────────────────────────────────────────────


class SectionScore(BaseModel):
    """One row of the rubric."""

    model_config = ConfigDict(extra="ignore")

    name: SectionKey = Field(..., description="One of the 9 rubric section keys")
    score: int = Field(..., ge=0, le=10, description="0 (absent) … 10 (excellent)")
    rationale: str = Field("", max_length=500, description="One-sentence why")


class MomentClip(BaseModel):
    """A noteworthy moment in the call. Quoted verbatim from the transcript."""

    model_config = ConfigDict(extra="ignore")

    label: str = Field(..., max_length=120)
    speaker: Literal["staff", "customer"] = "staff"
    quote: str = Field(..., max_length=400, description="Verbatim quote from transcript")
    sentiment: Literal["good", "missed", "neutral"] = "neutral"


# ── Top-level score card ──────────────────────────────────────────────────


class ScoreCard(BaseModel):
    """Everything the model is asked to produce.

    ``overall_score`` is recomputed server-side from ``section_scores`` after
    parsing — see ``compute_overall_score``.
    """

    model_config = ConfigDict(extra="ignore")

    # All 9 rubric axes as a list. Backfilled to 9 entries server-side if
    # the model omits any (logs a warning so we can spot prompt drift).
    section_scores: List[SectionScore] = Field(..., min_length=1, max_length=9)

    # 0-100 weighted sum. Recomputed server-side; the model's value is overwritten.
    overall_score: int = Field(0, ge=0, le=100)

    # 1-line band caption (e.g. "Good — needs hook discipline").
    overall_band: str = Field("", max_length=200)

    top_3_strengths: List[str] = Field(default_factory=list, max_length=3)
    top_3_gaps: List[str] = Field(default_factory=list, max_length=3)

    moment_clips: List[MomentClip] = Field(default_factory=list, max_length=8)

    next_recommended_focus: str = Field(
        "",
        max_length=120,
        description="Skill axis the trainee should drill next, e.g. 'hook_usage'",
    )

    low_signal: bool = Field(
        False,
        description=(
            "True if transcript was too thin (e.g. <2 staff turns, <60 chars) "
            "for the model to score reliably. Section scores are best-effort."
        ),
    )


def compute_overall_score(section_scores: List[SectionScore]) -> int:
    """Weighted sum normalised to 0-100. Missing sections count as 0.

    Each section_score.score is 0-10; weights sum to 100, so:
        weighted_sum = Σ score_i × weight_i      (max = 10 × 100 = 1000)
        overall_100  = round(weighted_sum / 10)  (range 0-100)

    Duplicate section names: the LAST entry wins (defensive against Gemini
    returning two rows for the same axis).
    """
    by_name = {s.name: s.score for s in section_scores}
    weighted = 0
    for key, weight in SECTION_WEIGHTS.items():
        weighted += int(by_name.get(key, 0)) * int(weight)
    return max(0, min(100, round(weighted / 10)))


def overall_band_for(score: int) -> str:
    """Default fallback caption when the model returns an empty band string."""
    if score >= 85:
        return "Excellent"
    if score >= 70:
        return "Good"
    if score >= 55:
        return "Needs work"
    return "Concerning"
