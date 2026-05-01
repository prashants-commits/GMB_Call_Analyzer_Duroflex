"""E1 — Score-card extraction.

Takes a completed drill (transcript JSONL + persona spec) and produces a
9-section rubric score per AITrainer_Idea_v1.md §11.3. One Gemini Pro call,
Pydantic-validated output, persisted to ``score_cards.csv`` plus a per-drill
JSON file in ``data/trainer/scorecards/``.
"""

from .extractor import (
    ScoringError,
    score_drill,
    schedule_scoring,
    load_scorecard,
    list_scorecards,
)
from .schema import ScoreCard, SectionScore, MomentClip, SECTION_WEIGHTS

__all__ = [
    "ScoringError",
    "score_drill",
    "schedule_scoring",
    "load_scorecard",
    "list_scorecards",
    "ScoreCard",
    "SectionScore",
    "MomentClip",
    "SECTION_WEIGHTS",
]
