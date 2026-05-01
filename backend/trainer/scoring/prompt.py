"""Prompt builder for the score-card extractor.

One Gemini Pro call. Inputs:
  - Drill metadata (persona, store, duration)
  - Persona spec (skill focus, hooks_to_try, objections_likely)
  - Full transcript JSONL rendered as a labelled conversation

Output (enforced via Pydantic ``response_schema``): :class:`ScoreCard`.

We deliberately keep the prompt structural and rubric-anchored — no chain-of-
thought, no role-play. The model is in "expert call-quality reviewer" mode.
"""

from __future__ import annotations

import json
from typing import List

from ..personas.schema import Persona
from .schema import SECTION_DISPLAY, SECTION_WEIGHTS


def _format_transcript(lines: List[dict]) -> str:
    """Render JSONL lines as a `[mm:ss] SPEAKER: text` log.

    Skips empty lines and partials (we already buffer + flush per turn in
    ws.py, but be defensive in case older drills wrote partials).
    """
    out = []
    for ln in lines:
        if not ln or ln.get("partial"):
            continue
        text = (ln.get("text") or "").strip()
        if not text:
            continue
        speaker = ln.get("speaker", "?")
        t_ms = int(ln.get("t_ms", 0) or 0)
        mm, ss = divmod(t_ms // 1000, 60)
        out.append(f"[{mm:02d}:{ss:02d}] {speaker.upper()}: {text}")
    return "\n".join(out) if out else "(empty transcript)"


def _format_persona(p: Persona) -> str:
    """Compact, score-card-relevant persona summary."""
    return json.dumps({
        "persona_id": p.persona_id,
        "name": p.name,
        "summary": p.summary,
        "decision_role": p.decision_role,
        "urgency_profile": p.urgency_profile,
        "price_sensitivity": p.price_sensitivity,
        "brand_affinity": p.brand_affinity,
        "difficulty_band": p.difficulty_band,
        "target_skill_focus": p.target_skill_focus,
        "objections_likely": p.objections_likely,
        "hooks_to_try": p.hooks_to_try,
        "surprise_pivot": p.surprise_pivot,
    }, ensure_ascii=False, indent=2)


def _rubric_block() -> str:
    rows = []
    for key, weight in SECTION_WEIGHTS.items():
        rows.append(f"  - {key} ({SECTION_DISPLAY[key]}, weight={weight}/100)")
    return "\n".join(rows)


SECTION_GUIDANCE = """
What to look for in each section (score 0-10):

  - opening: Greeting warmth, brand intro, permission to speak. 0 = abrupt;
    10 = warm, branded, sets expectations.
  - need_discovery: Probing-question count and quality. 0 = no probes, jumps
    to pitch; 10 = at least 3 layered probes uncovering pain, sleeper(s),
    budget, urgency. NOTE: real customers raise concerns across MULTIPLE
    buying-journey stages (needs, product fit, availability, price, delivery,
    warranty) — agents who acknowledged and addressed concerns from at least
    3 distinct stages should score higher here AND on closing/soft_skills.
  - product_pitch: Catalog-faithful product mention fitting the discovered
    need. 0 = irrelevant or no product; 10 = right product + size + tier
    explained crisply.
  - objection_handling: For each objection the customer raised, did the
    agent acknowledge AND address (price → EMI/value/trial; comfort →
    Sleep Trial; brand doubt → reviews/showroom)? 0 = ignored; 10 = each
    objection answered with a concrete pivot.
  - hook_usage: How many of Duroflex's standard hooks (Sleep Trial, Showroom
    visit, EMI, Mattress Measurement, Video Demo, WhatsApp follow-up) were
    deployed when relevant? 0 = none; 10 = right hooks at the right moments.
  - closing: Concrete next step (visit / WhatsApp share / callback). 0 =
    open-ended; 10 = mutual commitment with date/time and follow-up channel.
  - soft_skills: Empathy, listening, no-interruption, tone. 0 = pushy or flat;
    10 = warm, paced, mirrors customer.
  - brand_compliance: No false claims, no over-promising delivery / pricing
    / discounts beyond standard policy. 0 = multiple violations; 10 = clean.
  - time_management: Used the 5-minute window well. 0 = rushed past
    discovery or rambled past close; 10 = paced naturally to a good close.

If a section has insufficient evidence (e.g. customer never raised an
objection, so objection_handling has nothing to score), give a neutral 5
and say "no evidence" in the rationale — DO NOT give a 10 by default.
"""


def build_prompt(
    *,
    persona: Persona,
    transcript_lines: List[dict],
    drill_uuid: str,
    store_name: str,
    duration_seconds: int | None,
    staff_display_name: str = "",
) -> str:
    """Build the score-card extraction prompt."""
    transcript_block = _format_transcript(transcript_lines)
    persona_block = _format_persona(persona)
    duration_str = f"{duration_seconds}s" if duration_seconds is not None else "unknown"

    prompt = f"""You are an expert sales call-quality reviewer for Duroflex/SleepyHead, a mattress and sleep products retailer in India. You are scoring a 5-minute MOCK SALES CALL where a store agent (the trainee) practiced on an AI customer playing the persona below. The agent's goal is to drive a store visit, capture a lead via WhatsApp, or close a purchase commitment.

## Drill metadata
- drill_uuid: {drill_uuid}
- store: {store_name}
- staff: {staff_display_name or "(unknown)"}
- duration: {duration_str}
- max_allowed: 300s (5 minutes)

## Persona the AI customer played
```json
{persona_block}
```

## Transcript (timestamps in mm:ss from start of call)
```
{transcript_block}
```

## Your job
Score the AGENT (the staff trainee, who speaks as STAFF) on this 9-section rubric:
{_rubric_block()}

{SECTION_GUIDANCE}

Then:
  1. Identify up to 3 concrete STRENGTHS (what the agent did well, in past tense, ≤14 words each — quote evidence in the rationale below if useful).
  2. Identify up to 3 concrete GAPS (what the agent missed or could have done, ≤14 words each).
  3. Pick up to 6 MOMENT_CLIPS — quote the agent or customer verbatim from the transcript above, label what it shows, and tag sentiment as "good", "missed", or "neutral". Quotes must be COPIED VERBATIM from the transcript above. Do NOT paraphrase.
  4. Set ``next_recommended_focus`` to the single section_scores key (e.g. "hook_usage", "need_discovery") that would benefit the agent most to drill next.
  5. Write a 1-line ``overall_band`` caption (e.g. "Good — needs hook discipline", "Concerning — missed core probes").
  6. Set ``low_signal=true`` ONLY IF the transcript has fewer than 2 staff turns or <60 characters of staff text combined. In that case, give all section scores a neutral 5 and explain in rationales that there was no evidence.

Hard rules:
  - Be decisive. Don't hedge with mid-scores when there's clear evidence either way.
  - section_scores keys MUST exactly match: {", ".join(SECTION_WEIGHTS.keys())}.
  - moment_clips quotes MUST appear verbatim in the transcript above. NEVER fabricate quotes.
  - You MAY set ``overall_score`` to any value; the server recomputes it from section_scores anyway.
  - Output strict JSON conforming to the schema. No markdown fences. No commentary outside the JSON.
"""
    return prompt
