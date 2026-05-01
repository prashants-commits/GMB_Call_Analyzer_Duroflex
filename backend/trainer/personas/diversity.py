"""C4 — Diversity coverage check + structured top-up request.

Computes a coverage matrix across (language_mix × age_band × decision_role ×
difficulty_band). For demos at small K (12) we don't insist on full coverage,
just on minimum band thresholds. For larger libraries this can be tightened.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Dict, List

from .schema import Persona


@dataclass
class CoverageReport:
    """Snapshot of how the library spans the diversity matrix."""

    n_personas: int
    by_difficulty: Dict[str, int] = field(default_factory=dict)
    by_language: Dict[str, int] = field(default_factory=dict)
    by_age: Dict[str, int] = field(default_factory=dict)
    by_decision_role: Dict[str, int] = field(default_factory=dict)
    issues: List[str] = field(default_factory=list)

    def passes_minimums(self, *, min_easy: int = 1, min_hard: int = 1, min_languages: int = 3) -> bool:
        return (
            self.by_difficulty.get("easy", 0) >= min_easy
            and self.by_difficulty.get("hard", 0) >= min_hard
            and len(self.by_language) >= min_languages
        )


def compute_coverage(personas: List[Persona]) -> CoverageReport:
    rep = CoverageReport(n_personas=len(personas))

    rep.by_difficulty = dict(Counter(p.difficulty_band for p in personas))
    rep.by_language = dict(Counter(p.language_mix for p in personas))
    rep.by_age = dict(Counter(p.age_band for p in personas))
    rep.by_decision_role = dict(Counter(p.decision_role for p in personas))

    if rep.by_difficulty.get("easy", 0) == 0:
        rep.issues.append("no_easy_personas")
    if rep.by_difficulty.get("hard", 0) == 0:
        rep.issues.append("no_hard_personas")
    if len(rep.by_language) < 3:
        rep.issues.append(f"low_language_diversity ({len(rep.by_language)} of 3+ expected)")
    if len(rep.by_age) < 3:
        rep.issues.append(f"low_age_diversity ({len(rep.by_age)} of 3+ expected)")
    if len(rep.by_decision_role) < 2:
        rep.issues.append(f"low_decision_role_diversity ({len(rep.by_decision_role)} of 2+ expected)")

    return rep
