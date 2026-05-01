"""E1 — Score-card extractor.

End-to-end:
  1. Read transcript JSONL for ``drill_uuid``.
  2. Load persona spec from the published library.
  3. Build prompt + call Gemini Pro with structured output (Pydantic schema).
  4. Recompute ``overall_score`` server-side from section weights (defends
     against model drift between section bars and headline number).
  5. Persist a row to ``score_cards.csv`` and the full JSON payload to
     ``data/trainer/scorecards/{drill_uuid}.json``.

Triggered as a fire-and-forget asyncio task from the WS bridge on drill
COMPLETED / TIMED_OUT. Failures are logged but never raised back into the
WS handler — the user shouldn't see an error if scoring breaks; they'll
see the polling endpoint return 404 until they retry or admin re-scores.
"""

from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from pydantic import ValidationError

from .. import csvstore
from ..config import (
    GEMINI_SCORING_MODEL,
    SCORING_INPUT_RATE_INR_PER_1M,
    SCORING_OUTPUT_RATE_INR_PER_1M,
    TRAINER_DATA_DIR,
)
from ..drill import state as drill_state
from ..personas.schema import Persona
from ..personas.store import load_published
from ..swot.gemini_client import GeminiNotConfigured, call_text_model, strip_json_fences
from .prompt import build_prompt
from .schema import (
    ScoreCard,
    SectionScore,
    SECTION_WEIGHTS,
    compute_overall_score,
    overall_band_for,
)

logger = logging.getLogger("trainer.scoring.extractor")

SCORECARDS_DIR = Path(TRAINER_DATA_DIR) / "scorecards"


class ScoringError(RuntimeError):
    """Raised when the score-card pipeline cannot complete (Gemini missing,
    transcript missing, persona missing, model output unparseable)."""


# ── I/O helpers ────────────────────────────────────────────────────────────


def _scorecard_json_path(drill_uuid: str) -> Path:
    return SCORECARDS_DIR / f"{drill_uuid}.json"


def _read_transcript(transcript_path: Optional[str]) -> List[dict]:
    """Load the transcript JSONL given the relative path stored in calls.csv.

    The path is relative to ``backend/`` (see Transcript.relative_path).
    Returns an empty list if the file is missing.
    """
    if not transcript_path:
        return []
    # transcript_path is relative to ``backend/data/`` (see Transcript.relative_path),
    # e.g. "trainer/audio/2026/05/<uuid>.jsonl".
    data_dir = Path(TRAINER_DATA_DIR).parent  # backend/data
    candidates = [
        data_dir / transcript_path,                # backend/data/<rel>
        Path(TRAINER_DATA_DIR).parent.parent / transcript_path,  # backend/<rel> (legacy)
        Path(transcript_path),                     # absolute fallback
    ]
    path: Optional[Path] = None
    for c in candidates:
        if c.exists():
            path = c
            break
    if path is None:
        logger.warning("scoring: transcript file not found at %s", transcript_path)
        return []
    lines: List[dict] = []
    with path.open("r", encoding="utf-8") as f:
        for raw in f:
            raw = raw.strip()
            if not raw:
                continue
            try:
                lines.append(json.loads(raw))
            except json.JSONDecodeError:
                continue
    return lines


def _resolve_persona(persona_id: str) -> Optional[Persona]:
    library = load_published()
    if library is None:
        return None
    for p in library.personas:
        if p.persona_id == persona_id:
            return p
    return None


def _ensure_section_scores(raw: ScoreCard) -> ScoreCard:
    """Backfill missing rubric axes with neutral 5s so the UI never crashes
    on a missing bar, and dedupe duplicates (last wins). Logs which keys
    were filled in for prompt-tuning."""
    by_name = {}
    for s in raw.section_scores:
        by_name[s.name] = s  # last wins on duplicates
    missing = [k for k in SECTION_WEIGHTS.keys() if k not in by_name]
    if missing:
        logger.warning("scoring: model omitted sections %s — backfilling with 5s", missing)
        for k in missing:
            by_name[k] = SectionScore(name=k, score=5, rationale="No evidence in transcript.")
    # Re-emit in canonical SECTION_WEIGHTS order so the UI doesn't have to sort.
    raw.section_scores = [by_name[k] for k in SECTION_WEIGHTS.keys()]
    return raw


# ── Core entry ─────────────────────────────────────────────────────────────


def score_drill(drill_uuid: str) -> ScoreCard:
    """Run the full pipeline for one drill. Returns the persisted ScoreCard.

    Raises ``ScoringError`` on any unrecoverable failure. The caller (a
    background task wired in by ws.py / router.py) catches and logs.
    """
    state = drill_state.latest_state(drill_uuid)
    if state is None:
        raise ScoringError(f"Unknown drill_uuid {drill_uuid!r}")
    persona = _resolve_persona(state.persona_id)
    if persona is None:
        raise ScoringError(f"Persona '{state.persona_id}' missing from published library")

    transcript_lines = _read_transcript(state.transcript_path)

    prompt = build_prompt(
        persona=persona,
        transcript_lines=transcript_lines,
        drill_uuid=drill_uuid,
        store_name=state.store_name,
        duration_seconds=state.duration_seconds,
        staff_display_name=state.staff_id,
    )

    try:
        gemini_call = call_text_model(
            GEMINI_SCORING_MODEL,
            prompt,
            response_schema=ScoreCard,
        )
    except GeminiNotConfigured as exc:
        raise ScoringError(f"gemini_unavailable: {exc}") from exc
    except Exception as exc:
        raise ScoringError(f"gemini_error: {type(exc).__name__}: {exc}") from exc

    raw_text = strip_json_fences(gemini_call.text)
    if not raw_text:
        raise ScoringError("Gemini returned empty text")

    # Pro with response_schema usually returns clean JSON; parse defensively.
    try:
        try:
            card = ScoreCard.model_validate_json(raw_text)
        except ValidationError:
            # Fall back to manual JSON load — the response_schema mode can
            # occasionally return slightly off-spec dicts (extra keys).
            card = ScoreCard.model_validate(json.loads(raw_text))
    except (ValidationError, json.JSONDecodeError) as exc:
        logger.error("scoring: failed to parse model output: %s\nraw=%s", exc, raw_text[:1000])
        raise ScoringError(f"parse_error: {type(exc).__name__}") from exc

    # Server-authoritative overall score: never trust the model's own number.
    card = _ensure_section_scores(card)
    card.overall_score = compute_overall_score(card.section_scores)
    if not card.overall_band.strip():
        card.overall_band = overall_band_for(card.overall_score)

    cost_inr = gemini_call.cost_inr(SCORING_INPUT_RATE_INR_PER_1M, SCORING_OUTPUT_RATE_INR_PER_1M)
    scored_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    # Persist rich JSON next to drill data.
    SCORECARDS_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "drill_uuid": drill_uuid,
        "staff_id": state.staff_id,
        "store_name": state.store_name,
        "persona_id": state.persona_id,
        "persona_name": persona.name,
        "scored_at": scored_at,
        "model": GEMINI_SCORING_MODEL,
        "cost_inr": round(cost_inr, 4),
        "duration_seconds": state.duration_seconds,
        "started_at": state.started_at.isoformat(timespec="seconds"),
        "scorecard": card.model_dump(mode="json"),
    }
    _scorecard_json_path(drill_uuid).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    # Flat CSV row (one per drill). Idempotent re-scoring just appends a
    # second row — read endpoints take the latest by scored_at.
    csvstore.append("score_cards.csv", {
        "drill_uuid": drill_uuid,
        "staff_id": state.staff_id,
        "store_name": state.store_name,
        "persona_id": state.persona_id,
        "scored_at": scored_at,
        "score_overall": card.overall_score,
        "strengths_json": card.top_3_strengths,
        "gaps_json": card.top_3_gaps,
        "framework_scores_json": {s.name: s.score for s in card.section_scores},
        "cost_inr": round(cost_inr, 4),
        "model": GEMINI_SCORING_MODEL,
    })

    logger.info(
        "scoring.persisted uuid=%s overall=%d cost_inr=%.4f model=%s in_tok=%d out_tok=%d",
        drill_uuid, card.overall_score, cost_inr, GEMINI_SCORING_MODEL,
        gemini_call.input_tokens, gemini_call.output_tokens,
    )
    return card


# ── Read-side ─────────────────────────────────────────────────────────────


def schedule_scoring(drill_uuid: str) -> None:
    """Fire-and-forget background scoring. Safe to call from sync or async
    contexts. Errors are logged, not raised — a failed score-card is recovered
    by the admin rescore endpoint, not by surfacing 500s to the trainee."""
    def _run() -> None:
        try:
            score_drill(drill_uuid)
        except ScoringError as exc:
            logger.warning("scoring %s failed: %s", drill_uuid, exc)
        except Exception as exc:
            logger.exception("scoring %s crashed: %s", drill_uuid, exc)

    thread = threading.Thread(
        target=_run,
        name=f"scoring-{drill_uuid[:8]}",
        daemon=True,
    )
    thread.start()
    logger.info("scoring.scheduled uuid=%s", drill_uuid)


def list_scorecards(limit: int = 100) -> List[dict]:
    """Return up to ``limit`` most-recent score-cards as a flat list.

    Each row: ``{drill_uuid, staff_id, staff_name, store_name, persona_id,
    persona_name, scored_at, score_overall, overall_band, duration_seconds}``.

    Joins ``score_cards.csv`` with the latest ``calls.csv`` row (for
    duration), the staff roster (for display name), and the published
    persona library (for persona display name). De-dupes on ``drill_uuid``
    keeping the most recent ``scored_at`` (rescores are append-only).

    No role filtering at this layer — the caller (router endpoint) decides
    what to expose. MVP currently shows all to all per user direction.
    """
    df = csvstore.read_all("score_cards.csv")
    if df.empty:
        return []

    # Most recent per drill_uuid (rescores).
    df = df.sort_values("scored_at", kind="stable")
    df = df.drop_duplicates(subset=["drill_uuid"], keep="last")
    # Newest first overall.
    df = df.sort_values("scored_at", ascending=False, kind="stable").head(int(limit))

    # Join sources: staff name + persona display name + duration from calls.
    from .. import roster
    persona_library = load_published()
    persona_name_by_id = {}
    if persona_library is not None:
        for p in persona_library.personas:
            persona_name_by_id[p.persona_id] = p.name

    calls_df = csvstore.read_latest_per("calls.csv", key_col="drill_uuid", order_col="started_at")
    duration_by_uuid = {}
    if not calls_df.empty:
        for _, row in calls_df.iterrows():
            d = row.get("duration_seconds", "")
            if d:
                try:
                    duration_by_uuid[row["drill_uuid"]] = int(float(d))
                except (TypeError, ValueError):
                    pass

    # Heuristic band caption fallback if score_cards.csv predates the
    # ``overall_band`` field (we don't currently store it as a CSV column;
    # fall back to recomputing from overall_score).
    from .schema import overall_band_for

    out: List[dict] = []
    for _, row in df.iterrows():
        staff_id = row.get("staff_id", "")
        staff_row = roster.lookup_by_id(staff_id) if staff_id else None
        try:
            score_overall = int(float(row.get("score_overall") or 0))
        except (TypeError, ValueError):
            score_overall = 0
        out.append({
            "drill_uuid": row.get("drill_uuid", ""),
            "staff_id": staff_id,
            "staff_name": staff_row.full_name if staff_row else (staff_id or ""),
            "store_name": row.get("store_name", ""),
            "persona_id": row.get("persona_id", ""),
            "persona_name": persona_name_by_id.get(row.get("persona_id", ""), row.get("persona_id", "")),
            "scored_at": row.get("scored_at", ""),
            "score_overall": score_overall,
            "overall_band": overall_band_for(score_overall),
            "duration_seconds": duration_by_uuid.get(row.get("drill_uuid", "")),
        })
    return out


def load_scorecard(drill_uuid: str) -> Optional[dict]:
    """Return the persisted score card payload (the rich JSON), or None.

    Read endpoint serves this dict directly — no model in the response path,
    so we don't pay model_validate cost on every poll.
    """
    path = _scorecard_json_path(drill_uuid)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("load_scorecard %s failed: %s", drill_uuid, exc)
        return None
