"""C7 — Persona picker.

With probability ``TRAINER_PERSONA_BIAS_PCT/100``, pick a persona whose
``target_skill_focus`` overlaps the store's top SWOT weakness. Otherwise
pick uniformly at random from the published library.

New joiners (≤30d at this store, per the roster's ``joined_date``) are
forced to "easy" difficulty for their first 5 drills. Drill count comes
from ``calls.csv``.
"""

from __future__ import annotations

import logging
import random
from datetime import date
from typing import List, Optional, Tuple

from .. import csvstore, roster
from ..config import TRAINER_PERSONA_BIAS_PCT
from ..swot import cache as swot_cache
from .schema import Persona, PersonaLibrary
from .store import load_published

logger = logging.getLogger("trainer.personas.picker")

NEW_JOINER_FORCE_EASY_DRILL_COUNT = 5


class PickerError(RuntimeError):
    pass


# ── Skill-focus inference from SWOT weakness themes ──────────────────────────

# Naive keyword → skill_focus map. Expanded as needed.
_SKILL_KEYWORDS = {
    "needs_discovery":   ["needs", "discovery", "probing", "open question", "rapport"],
    "objection_handling": ["objection", "barrier", "concern", "complaint", "pushback"],
    "probing":            ["probing", "qualify", "questioning"],
    "hooks_and_offers":   ["hook", "offer", "discount", "deal", "promo", "scheme"],
    "follow_up_capture":  ["follow", "lead", "capture", "whatsapp", "callback", "contact"],
    "product_pivoting":   ["pivot", "alternative", "upsell", "cross", "premium", "out of stock"],
    "empathy_and_tone":   ["empathy", "rude", "tone", "patience", "elderly"],
    "closing":            ["close", "convert", "decision", "commit"],
}


def _skills_from_swot_weakness(theme: str, detail: str) -> List[str]:
    text = (theme + " " + detail).lower()
    hits: List[str] = []
    for skill, keywords in _SKILL_KEYWORDS.items():
        if any(kw in text for kw in keywords):
            hits.append(skill)
    return hits


def _top_skill_focus_for_store(store_name: str) -> Optional[List[str]]:
    """Return the focus skills implied by the top SWOT weakness for a store,
    or ``None`` if no SWOT is cached or no weakness maps to a known skill."""
    report = swot_cache.get_cached(store_name)
    if report is None or not report.weaknesses:
        return None
    # Top weakness = first item (Stage-2 Reduce sorts by severity/frequency).
    top = report.weaknesses[0]
    skills = _skills_from_swot_weakness(top.theme, top.detail)
    return skills or None


# ── Drill counting ──────────────────────────────────────────────────────────


def _drills_for_staff(staff_id: str) -> int:
    df = csvstore.read_filtered("calls.csv", staff_id=staff_id)
    if df.empty:
        return 0
    # Count distinct drill_uuids that ever reached "completed" or any state past STARTING.
    return df["drill_uuid"].nunique()


# ── Picker ──────────────────────────────────────────────────────────────────


def pick_persona(
    *,
    staff_id: str,
    store_name: str,
    today: Optional[date] = None,
    rng: Optional[random.Random] = None,
) -> Tuple[Persona, dict]:
    """Choose one persona for a drill. Returns (persona, why_dict).

    Raises ``PickerError`` if the published library is empty.
    """
    rng = rng or random.Random()
    today = today or date.today()

    library: Optional[PersonaLibrary] = load_published()
    if library is None or not library.personas:
        raise PickerError("No published persona library — admin must publish one first.")

    pool = library.personas

    # ── New-joiner override ─────────────────────────────────────────────
    if roster.is_new_joiner(staff_id, today=today):
        if _drills_for_staff(staff_id) < NEW_JOINER_FORCE_EASY_DRILL_COUNT:
            easy = [p for p in pool if p.difficulty_band == "easy"]
            if easy:
                pick = rng.choice(easy)
                return pick, {"strategy": "new_joiner_easy", "pool_size": len(easy)}
            # Fall through if no easy personas exist.

    # ── SWOT-biased random ──────────────────────────────────────────────
    bias_roll = rng.randint(1, 100)
    if bias_roll <= TRAINER_PERSONA_BIAS_PCT:
        focus = _top_skill_focus_for_store(store_name)
        if focus:
            biased = [p for p in pool if any(s in focus for s in p.target_skill_focus)]
            if biased:
                pick = rng.choice(biased)
                return pick, {
                    "strategy": "swot_biased",
                    "focus_skills": focus,
                    "pool_size": len(biased),
                }

    # ── Uniform random fallback ─────────────────────────────────────────
    pick = rng.choice(pool)
    return pick, {"strategy": "uniform", "pool_size": len(pool)}
