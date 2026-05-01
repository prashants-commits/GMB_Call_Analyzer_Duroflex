"""All HTTP routes for the trainer subsystem.

Single ``APIRouter`` mounted under ``/api/trainer``. Mounted from
``backend/main.py`` only when ``TRAINER_ENABLED=true``.
"""

from __future__ import annotations

import logging
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Body, Depends, File, HTTPException, Request, Response, UploadFile, WebSocket
from pydantic import BaseModel, Field

from . import audit, roster
from .auth import (
    TrainerActor,
    current_actor,
    optional_actor,
    require_admin,
    require_manager_or_above,
    require_role,
    resolve_role,
    sign,
)
from .swot import (
    SWOTGenerationError,
    generate_swot,
    get_cached,
    list_cached,
)
from .swot import cache as swot_cache
from .swot import jobs as swot_jobs
from .personas import (
    PickerError,
    list_published_versions,
    load_draft,
    load_published,
    pick_persona,
    publish_draft,
    save_draft,
)
from .personas.orchestrator import PersonaGenerationError, generate_library
from .personas import jobs as persona_jobs
from .personas import store as persona_store
from .personas.schema import Persona, PersonaLibrary
from .drill import state as drill_state
from .drill import text_session as drill_text
from .drill.ws import drill_websocket
from .config import (
    DRILL_DEFAULT_MODE,
    GEMINI_DRILL_TEXT_MODEL,
    GEMINI_LIVE_MODEL,
)
from .config import (
    TRAINER_COOKIE_MAX_AGE_SECONDS,
    TRAINER_COOKIE_NAME,
    TRAINER_COOKIE_SECURE,
    TRAINER_DATA_DIR,
)

logger = logging.getLogger("trainer.router")

router = APIRouter(prefix="/api/trainer", tags=["trainer"])
# WebSocket endpoints can't share the /api/trainer prefix — the canonical
# trainer WS path is /ws/trainer/... per the plan. We register them on a
# separate un-prefixed router and main.py mounts both.
ws_router = APIRouter(tags=["trainer-ws"])


# ── Request/response shapes ──────────────────────────────────────────────────


class LoginBody(BaseModel):
    staff_id: str = Field(..., min_length=1, max_length=32)
    email: str = Field(default="", max_length=200)


# ── Health ───────────────────────────────────────────────────────────────────


@router.get("/health")
def health():
    return {"status": "ok", "version": "v1"}


# ── Auth ─────────────────────────────────────────────────────────────────────


@router.post("/auth/login")
def login(body: LoginBody, response: Response):
    """Bind a trainer session to a staff_id from the active roster.

    Sets a signed HttpOnly cookie. Returns the resolved actor so the React
    frontend can render the welcome screen without a follow-up request.
    """
    row = roster.lookup_by_id(body.staff_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"staff_id '{body.staff_id}' not found in roster")
    if row.status != "active":
        raise HTTPException(status_code=403, detail=f"staff_id '{body.staff_id}' is inactive")

    role = resolve_role(row.role, body.email)
    actor = TrainerActor(
        staff_id=row.staff_id,
        full_name=row.full_name,
        store_name=row.store_name,
        role=role,
        email=body.email or "",
    )
    token = sign(actor)
    response.set_cookie(
        key=TRAINER_COOKIE_NAME,
        value=token,
        max_age=TRAINER_COOKIE_MAX_AGE_SECONDS,
        httponly=True,
        samesite="lax",
        secure=TRAINER_COOKIE_SECURE,
    )

    audit.audit(
        actor_staff_id=actor.staff_id,
        actor_email=actor.email,
        action="auth.login",
        target=actor.store_name,
        payload={"role": actor.role},
    )

    return {"actor": actor.to_public_dict()}


@router.post("/auth/logout")
def logout(response: Response, actor: Optional[TrainerActor] = Depends(optional_actor)):
    response.delete_cookie(TRAINER_COOKIE_NAME)
    if actor:
        audit.audit(actor.staff_id, "auth.logout", actor_email=actor.email)
    return {"ok": True}


@router.get("/me")
def me(actor: TrainerActor = Depends(current_actor)):
    return {"actor": actor.to_public_dict()}


# ── Cities + stores (so the React identify page never imports the JSON) ──────


@router.get("/cities")
def cities():
    """Return the city → store_name map used by the identify page.

    Reads the backend copy at ``backend/data/city_store_mapping.json``. The
    frontend's copy at ``frontend/src/utils/city_store_mapping.json`` is the
    source of truth; sync via ``backend/scripts/sync_city_store_mapping.py``.
    """
    from .config import CITY_STORE_MAPPING_PATH
    import json

    if not Path(CITY_STORE_MAPPING_PATH).exists():
        raise HTTPException(
            status_code=503,
            detail="city_store_mapping.json not found on backend. "
            "Run `python backend/scripts/sync_city_store_mapping.py` once.",
        )
    try:
        return json.loads(Path(CITY_STORE_MAPPING_PATH).read_text(encoding="utf-8"))
    except (ValueError, OSError) as exc:
        raise HTTPException(status_code=500, detail=f"Could not read mapping: {exc}")


# ── Public roster lookup (just enough to populate the identify page) ────────


@router.get("/stores/{store_name}/staff")
def list_staff_in_store(store_name: str):
    """Public list of active staff in a store, for the identify-page dropdown.

    Returns only ``staff_id``, ``full_name``, ``role`` — no email or other PII.
    The trainer page is already behind the base app's auth; this endpoint
    doesn't add PII risk beyond what's visible elsewhere in the app.
    """
    rows = roster.staff_in_store(store_name)
    return {
        "store_name": store_name,
        "staff": [
            {"staff_id": r.staff_id, "full_name": r.full_name, "role": r.role}
            for r in rows
        ],
    }


# ── Roster (admin) ──────────────────────────────────────────────────────────


@router.get("/admin/roster")
def admin_get_roster(_actor: TrainerActor = Depends(require_admin)):
    """Return current roster + validation report from the on-disk file."""
    path = Path(TRAINER_DATA_DIR) / roster.ROSTER_FILENAME
    if not path.exists():
        return {"rows": [], "errors": [], "warnings": [], "exists": False}

    text = path.read_text(encoding="utf-8")
    v = roster.parse_csv_text(text)
    return {
        "rows": [
            {
                "staff_id": r.staff_id,
                "full_name": r.full_name,
                "store_name": r.store_name,
                "role": r.role,
                "joined_date": r.joined_date.isoformat(),
                "status": r.status,
                "real_call_agent_name_variants": list(r.real_call_agent_name_variants),
                "email": r.email,
            }
            for r in v.rows
        ],
        "errors": v.errors,
        "warnings": v.warnings,
        "exists": True,
    }


@router.post("/admin/roster")
async def admin_upload_roster(
    file: UploadFile = File(...),
    actor: TrainerActor = Depends(require_admin),
):
    """Replace the roster file atomically. Refuses to install a CSV with errors."""
    raw = await file.read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=422, detail="File is not valid UTF-8")

    v = roster.parse_csv_text(text)
    if v.errors:
        raise HTTPException(
            status_code=422,
            detail={"message": "Roster has validation errors", "errors": v.errors, "warnings": v.warnings},
        )

    target = Path(TRAINER_DATA_DIR) / roster.ROSTER_FILENAME
    target.parent.mkdir(parents=True, exist_ok=True)

    fd, tmp_path = tempfile.mkstemp(prefix=".staff_roster_", suffix=".tmp", dir=str(target.parent))
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(raw)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, target)
    except OSError as exc:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise HTTPException(status_code=500, detail=f"Could not write roster: {exc}")

    roster.reset_cache()
    audit.audit(
        actor.staff_id,
        "roster.uploaded",
        target=str(target.name),
        actor_email=actor.email,
        payload={"row_count": len(v.rows), "warning_count": len(v.warnings)},
    )

    return {
        "row_count": len(v.rows),
        "warning_count": len(v.warnings),
        "warnings": v.warnings,
    }


@router.get("/admin/roster/coverage")
def admin_roster_coverage(_actor: TrainerActor = Depends(require_admin)):
    """% of active staff per store with populated agent_name_variants."""
    rows = roster.load_roster()
    stores = sorted({r.store_name for r in rows if r.status == "active"})
    return {
        "stores": [
            {"store_name": s, **roster.coverage_for_store(s)} for s in stores
        ]
    }


# ── Audit log (admin only) ──────────────────────────────────────────────────


@router.get("/admin/audit")
def admin_audit(
    limit: int = 100,
    action: Optional[str] = None,
    _actor: TrainerActor = Depends(require_admin),
):
    if limit < 1 or limit > 1000:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 1000")
    return {"rows": audit.read_recent(limit=limit, action=action)}


# ── Store SWOT (Group B) ────────────────────────────────────────────────────


@router.get("/swot")
def list_swot_summaries(_actor: TrainerActor = Depends(current_actor)):
    """Lightweight summary of every store with a cached SWOT, newest first."""
    return {"items": list_cached()}


@router.get("/swot/{store_name}")
def get_swot(store_name: str, actor: TrainerActor = Depends(current_actor)):
    """Return the latest cached SWOT for a store. Triggers generation only if
    no cached row exists yet — stale entries are still returned (the UI shows
    a "stale" pill and offers a Refresh button)."""
    report = get_cached(store_name)
    if report is None:
        # No cache yet. Auto-generate synchronously for the first viewer.
        # This is up to ~30s; subsequent viewers hit the cache instantly.
        try:
            report = generate_swot(
                store_name,
                actor_staff_id=actor.staff_id,
                actor_email=actor.email,
            )
        except SWOTGenerationError as exc:
            raise HTTPException(status_code=502, detail={"stage": exc.stage, "reason": exc.reason})

    return {
        "report": report.model_dump(mode="json"),
        "stale": swot_cache.is_stale(report),
    }


@router.post("/swot/{store_name}/refresh", status_code=202)
def refresh_swot(
    store_name: str,
    background: BackgroundTasks,
    actor: TrainerActor = Depends(require_manager_or_above),
):
    """Kick off a fresh SWOT generation in the background. Returns a job id
    the client can poll via ``GET /swot/jobs/{job_id}``.

    Debounce: if a job is already in flight for this store, return that one
    instead of starting a duplicate."""
    existing = swot_jobs.find_running_for_store(store_name)
    if existing is not None:
        return {"job": existing.to_public_dict(), "deduped": True}

    job = swot_jobs.create(store_name)

    def _run():
        swot_jobs.mark_running(job.job_id)
        try:
            report = generate_swot(
                store_name,
                actor_staff_id=actor.staff_id,
                actor_email=actor.email,
            )
            swot_jobs.mark_completed(job.job_id, report.cost_inr)
        except SWOTGenerationError as exc:
            swot_jobs.mark_failed(job.job_id, f"{exc.stage}: {exc.reason}")
        except Exception as exc:  # belt-and-braces — orchestrator already wraps
            swot_jobs.mark_failed(job.job_id, str(exc))

    background.add_task(_run)
    return {"job": job.to_public_dict(), "deduped": False}


@router.get("/swot/jobs/{job_id}")
def get_swot_job(job_id: str, _actor: TrainerActor = Depends(current_actor)):
    job = swot_jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found (it may have been evicted)")
    return {"job": job.to_public_dict()}


# ── Persona Library (Group C) ───────────────────────────────────────────────


class GeneratePersonasBody(BaseModel):
    n_calls: Optional[int] = Field(None, ge=1, le=500)
    k_personas: Optional[int] = Field(None, ge=3, le=60)
    # When provided, the orchestrator pulls only that store's calls. Empty
    # string is treated as "all stores" (the legacy global behaviour).
    store_name: Optional[str] = Field(None, max_length=80)


class PublishLibraryBody(BaseModel):
    pass


@router.get("/personas")
def list_published_personas(_actor: TrainerActor = Depends(current_actor)):
    """Public listing of the currently published persona library (no draft)."""
    lib = load_published()
    if lib is None:
        return {"library": None, "personas": []}
    return {
        "library": {
            "version": lib.version,
            "status": lib.status,
            "generated_at": lib.generated_at.isoformat(timespec="seconds"),
            "source_call_count": lib.source_call_count,
            "model_signature": lib.model_signature,
            "model_synthesis": lib.model_synthesis,
            "cost_inr": lib.cost_inr,
            "notes": lib.notes,
            "persona_count": len(lib.personas),
        },
        "personas": [p.model_dump(mode="json") for p in lib.personas],
    }


@router.get("/personas/{persona_id}")
def get_published_persona(persona_id: str, _actor: TrainerActor = Depends(current_actor)):
    lib = load_published()
    if lib is None:
        raise HTTPException(status_code=404, detail="No persona library published yet")
    for p in lib.personas:
        if p.persona_id == persona_id:
            return p.model_dump(mode="json")
    raise HTTPException(status_code=404, detail=f"persona_id '{persona_id}' not in v{lib.version}")


@router.post("/personas/pick")
def pick(body: dict, actor: TrainerActor = Depends(current_actor)):
    """Pick a persona for a drill. Body: {staff_id, store_name}.

    Staff can only pick for themselves; manager+ can pick for any staff in
    their scope (rough check — refined in Group D when drill-start gates this).
    """
    staff_id = (body or {}).get("staff_id") or actor.staff_id
    store_name = (body or {}).get("store_name") or actor.store_name

    if actor.role == "staff" and staff_id != actor.staff_id:
        raise HTTPException(status_code=403, detail="Staff can only pick for themselves")

    try:
        persona, why = pick_persona(staff_id=staff_id, store_name=store_name)
    except PickerError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    return {"persona": persona.model_dump(mode="json"), "why": why}


# ── Admin: persona generation + draft + publish ──────────────────────────────


@router.post("/admin/personas/generate", status_code=202)
def admin_generate_personas(
    body: GeneratePersonasBody,
    background: BackgroundTasks,
    actor: TrainerActor = Depends(require_admin),
):
    """Kick off a fresh persona-library generation in the background. Returns a
    job id the client polls via ``GET /admin/personas/jobs/{job_id}``.

    Debounce: only one generation in flight at a time."""
    existing = persona_jobs.find_running()
    if existing is not None:
        return {"job": existing.to_public_dict(), "deduped": True}

    n_calls = body.n_calls
    k_personas = body.k_personas
    store_name = (body.store_name or "").strip() or None

    job = persona_jobs.create(
        n_calls=n_calls or 0,  # filled with default in the worker
        k_personas=k_personas or 0,
    )

    def _run():
        persona_jobs.mark_running(job.job_id)
        try:
            library = generate_library(
                n_calls=n_calls,
                k_personas=k_personas,
                store_name=store_name,
                actor_staff_id=actor.staff_id,
                actor_email=actor.email,
            )
            persona_jobs.mark_completed(
                job.job_id,
                cost_inr=library.cost_inr,
                persona_count=len(library.personas),
                draft_version=library.version,
            )
        except PersonaGenerationError as exc:
            persona_jobs.mark_failed(job.job_id, f"{exc.stage}: {exc.reason}")
        except Exception as exc:
            persona_jobs.mark_failed(job.job_id, str(exc))

    background.add_task(_run)
    return {"job": job.to_public_dict(), "deduped": False}


@router.get("/admin/personas/jobs/{job_id}")
def admin_get_persona_job(job_id: str, _actor: TrainerActor = Depends(require_admin)):
    job = persona_jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found (it may have been evicted)")
    return {"job": job.to_public_dict()}


@router.get("/admin/personas/draft")
def admin_get_draft(_actor: TrainerActor = Depends(require_admin)):
    draft = load_draft()
    return {"library": draft.model_dump(mode="json") if draft else None}


@router.put("/admin/personas/draft")
def admin_replace_draft(
    body: dict,
    actor: TrainerActor = Depends(require_admin),
):
    """Replace the draft library wholesale (used by the admin's "edit JSON"
    flow). Body must be a full ``PersonaLibrary`` JSON; we re-validate before
    persisting."""
    try:
        lib = PersonaLibrary.model_validate(body)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid PersonaLibrary: {exc}")

    save_draft(lib, actor_staff_id=actor.staff_id, actor_email=actor.email)
    return {"library": lib.model_dump(mode="json")}


@router.post("/admin/personas/publish")
def admin_publish(
    _body: PublishLibraryBody = Body(default_factory=PublishLibraryBody),
    actor: TrainerActor = Depends(require_admin),
):
    try:
        published = publish_draft(actor_staff_id=actor.staff_id, actor_email=actor.email)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return {"library": published.model_dump(mode="json")}


@router.get("/admin/personas/versions")
def admin_list_versions(_actor: TrainerActor = Depends(require_admin)):
    return {
        "versions": list_published_versions(),
        "latest": (load_published().version if load_published() else None),
    }


# ── Drills (Group D) ────────────────────────────────────────────────────────


class StartDrillBody(BaseModel):
    persona_id: Optional[str] = None
    store_name: Optional[str] = None
    # "text"  → Rung B: HTTP /turn endpoints + browser TTS for AI voice
    # "voice" → Rung C: WebSocket /ws/trainer/drill/{uuid} for full-duplex audio
    mode: Optional[str] = Field(default=None, pattern="^(text|voice)$")


@router.post("/drills/start")
def start_drill(body: StartDrillBody, actor: TrainerActor = Depends(current_actor)):
    """Pick a persona (or use the supplied one) and seed a STARTING drill row.

    Returns ``{drill_uuid, persona, mode, ws_url?, hard_timeout_seconds, ...}``.
    The frontend dispatches on ``mode`` to pick the transport.
    """
    store_name = body.store_name or actor.store_name
    mode = body.mode or DRILL_DEFAULT_MODE

    persona: Optional[Persona] = None
    why: dict = {}
    library = persona_store.load_published()
    if library is None or not library.personas:
        raise HTTPException(
            status_code=503,
            detail="No published persona library — admin must publish one (see /trainer/admin/personas).",
        )

    if body.persona_id:
        for p in library.personas:
            if p.persona_id == body.persona_id:
                persona = p
                why = {"strategy": "explicit", "pool_size": 1}
                break
        if persona is None:
            raise HTTPException(status_code=404, detail=f"persona_id '{body.persona_id}' not in library")
    else:
        from .personas.picker import PickerError, pick_persona
        try:
            persona, why = pick_persona(staff_id=actor.staff_id, store_name=store_name)
        except PickerError as exc:
            raise HTTPException(status_code=503, detail=str(exc))

    chosen_model = GEMINI_DRILL_TEXT_MODEL if mode == "text" else GEMINI_LIVE_MODEL
    state = drill_state.start_drill(
        staff_id=actor.staff_id,
        store_name=store_name,
        persona_id=persona.persona_id,
        persona_difficulty=persona.difficulty_band,
        model=chosen_model,
    )

    audit.audit(
        actor.staff_id,
        "drills.started",
        target=persona.persona_id,
        actor_email=actor.email,
        payload={"drill_uuid": state.drill_uuid, "store_name": store_name, "mode": mode, "why": why},
    )

    response: dict = {
        "drill_uuid": state.drill_uuid,
        "persona": persona.model_dump(mode="json"),
        "mode": mode,
        "hard_timeout_seconds": 5 * 60,
        "model": chosen_model,
        "why": why,
    }
    if mode == "voice":
        response["ws_url"] = f"/ws/trainer/drill/{state.drill_uuid}"
    else:
        # Rung B endpoints — relative paths the client POSTs to.
        response["kickoff_url"] = f"/api/trainer/drills/{state.drill_uuid}/kickoff"
        response["turn_url"] = f"/api/trainer/drills/{state.drill_uuid}/turn"
        response["end_url"] = f"/api/trainer/drills/{state.drill_uuid}/end"
    return response


@router.get("/drills/{drill_uuid}")
def get_drill(drill_uuid: str, actor: TrainerActor = Depends(current_actor)):
    state = drill_state.latest_state(drill_uuid)
    if state is None:
        raise HTTPException(status_code=404, detail="Drill not found")
    if state.staff_id != actor.staff_id and actor.role == "staff":
        raise HTTPException(status_code=403, detail="Not your drill")

    # Infer transport from the model name. Live-API models contain "live";
    # everything else is the standard text API (Rung B).
    mode = "voice" if (state.model or "").lower().__contains__("live") else "text"

    body = {
        "drill_uuid": state.drill_uuid,
        "staff_id": state.staff_id,
        "store_name": state.store_name,
        "persona_id": state.persona_id,
        "status": state.status.value,
        "started_at": state.started_at.isoformat(timespec="seconds"),
        "ended_at": state.ended_at.isoformat(timespec="seconds") if state.ended_at else None,
        "duration_seconds": state.duration_seconds,
        "disposition_reason": state.disposition_reason,
        "audio_path": state.audio_path,
        "transcript_path": state.transcript_path,
        "mode": mode,
        "model": state.model,
    }
    if mode == "voice":
        body["ws_url"] = f"/ws/trainer/drill/{state.drill_uuid}"
    else:
        body["kickoff_url"] = f"/api/trainer/drills/{state.drill_uuid}/kickoff"
        body["turn_url"] = f"/api/trainer/drills/{state.drill_uuid}/turn"
        body["end_url"] = f"/api/trainer/drills/{state.drill_uuid}/end"
    return body


@router.post("/drills/{drill_uuid}/cancel")
def cancel_drill(drill_uuid: str, actor: TrainerActor = Depends(current_actor)):
    state = drill_state.latest_state(drill_uuid)
    if state is None:
        raise HTTPException(status_code=404, detail="Drill not found")
    if state.staff_id != actor.staff_id and actor.role == "staff":
        raise HTTPException(status_code=403, detail="Not your drill")
    try:
        new_state = drill_state.transition(
            drill_uuid,
            drill_state.DrillStatus.CANCELLED,
            disposition_reason="staff_cancelled",
        )
    except drill_state.InvalidStateTransition as exc:
        raise HTTPException(status_code=409, detail=str(exc))

    audit.audit(actor.staff_id, "drills.cancelled", target=drill_uuid, actor_email=actor.email)
    return {"drill_uuid": drill_uuid, "status": new_state.status.value}


# ── Drills: Rung B text endpoints ───────────────────────────────────────────


def _load_persona_for_drill(state: drill_state.DrillState) -> Persona:
    library = persona_store.load_published()
    if library is None:
        raise HTTPException(status_code=503, detail="Persona library not published")
    for p in library.personas:
        if p.persona_id == state.persona_id:
            return p
    raise HTTPException(status_code=404, detail=f"persona '{state.persona_id}' missing from library")


def _check_drill_ownership(state: drill_state.DrillState, actor: TrainerActor) -> None:
    if state.staff_id != actor.staff_id and actor.role == "staff":
        raise HTTPException(status_code=403, detail="Not your drill")


@router.post("/drills/{drill_uuid}/kickoff")
async def drill_kickoff(drill_uuid: str, actor: TrainerActor = Depends(current_actor)):
    """Open a text session, transition STARTING -> IN_CALL, and return the AI's
    opening line. Idempotent: a second call returns the same opening."""
    state = drill_state.latest_state(drill_uuid)
    if state is None:
        raise HTTPException(status_code=404, detail="Drill not found")
    _check_drill_ownership(state, actor)

    persona = _load_persona_for_drill(state)
    handle = drill_text.open_session(drill_uuid, persona, state.model or GEMINI_DRILL_TEXT_MODEL)

    # First call only: flip the state to IN_CALL.
    if state.status == drill_state.DrillStatus.STARTING:
        try:
            drill_state.transition(drill_uuid, drill_state.DrillStatus.IN_CALL)
        except drill_state.InvalidStateTransition as exc:
            raise HTTPException(status_code=409, detail=str(exc))
    elif state.status != drill_state.DrillStatus.IN_CALL:
        raise HTTPException(
            status_code=409,
            detail=f"Drill already terminal (status={state.status.value})",
        )

    try:
        opening = await drill_text.kickoff(drill_uuid)
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("drill kickoff failed: %s", exc)
        # Mark the drill as failed so the user gets a clean retry path.
        try:
            drill_state.transition(
                drill_uuid, drill_state.DrillStatus.FAILED,
                disposition_reason=f"kickoff_error: {type(exc).__name__}",
            )
        except drill_state.InvalidStateTransition:
            pass
        raise HTTPException(status_code=502, detail=f"Gemini kickoff error: {exc}")

    return {
        "speaker": "customer",
        "text": opening,
        "model": handle.model,
    }


class TurnBody(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)


@router.post("/drills/{drill_uuid}/turn")
async def drill_turn(
    drill_uuid: str,
    body: TurnBody,
    actor: TrainerActor = Depends(current_actor),
):
    """Stream the AI's reply to a user message as Server-Sent Events.

    Emits:
        event: delta   data: {"text": "<chunk>"}
        event: done    data: {"ok": true}
        event: error   data: {"reason": "..."}
    """
    from fastapi.responses import StreamingResponse
    import json as _json

    state = drill_state.latest_state(drill_uuid)
    if state is None:
        raise HTTPException(status_code=404, detail="Drill not found")
    _check_drill_ownership(state, actor)
    if state.status != drill_state.DrillStatus.IN_CALL:
        raise HTTPException(
            status_code=409,
            detail=f"Drill not in IN_CALL (status={state.status.value}). Call /kickoff first.",
        )

    user_text = body.text.strip()

    async def event_stream():
        try:
            async for delta in drill_text.stream_user_turn(drill_uuid, user_text):
                yield f"event: delta\ndata: {_json.dumps({'text': delta}, ensure_ascii=False)}\n\n"
            yield f"event: done\ndata: {_json.dumps({'ok': True})}\n\n"
        except drill_text.SessionNotFound:
            yield f"event: error\ndata: {_json.dumps({'reason': 'session_not_found'})}\n\n"
        except drill_text.SessionAlreadyClosed:
            yield f"event: error\ndata: {_json.dumps({'reason': 'session_closed'})}\n\n"
        except Exception as exc:
            logger.exception("drill turn failed")
            yield f"event: error\ndata: {_json.dumps({'reason': f'gemini_error: {type(exc).__name__}: {exc}'}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/drills/{drill_uuid}/end")
def drill_end(
    drill_uuid: str,
    body: dict = Body(default_factory=dict),
    actor: TrainerActor = Depends(current_actor),
):
    """Close the text session and mark the drill COMPLETED."""
    state = drill_state.latest_state(drill_uuid)
    if state is None:
        raise HTTPException(status_code=404, detail="Drill not found")
    _check_drill_ownership(state, actor)

    transcript_path = drill_text.transcript_relative_path(drill_uuid)
    drill_text.close_session(drill_uuid)

    if state.status == drill_state.DrillStatus.IN_CALL:
        reason = (body or {}).get("reason") or "staff_ended"
        try:
            new_state = drill_state.transition(
                drill_uuid,
                drill_state.DrillStatus.COMPLETED,
                disposition_reason=reason,
                transcript_path=transcript_path,
            )
            from .scoring import schedule_scoring
            schedule_scoring(drill_uuid)
            return {"drill_uuid": drill_uuid, "status": new_state.status.value}
        except drill_state.InvalidStateTransition as exc:
            raise HTTPException(status_code=409, detail=str(exc))

    return {"drill_uuid": drill_uuid, "status": state.status.value}


# ── Drills: Rung C voice WebSocket ──────────────────────────────────────────


@ws_router.websocket("/ws/trainer/drill/{drill_uuid}")
async def drill_ws(websocket: WebSocket, drill_uuid: str):
    await drill_websocket(websocket, drill_uuid)


# ── Score cards (Group E) ───────────────────────────────────────────────────


@router.get("/score-cards")
def list_score_cards(
    limit: int = 100,
    actor: TrainerActor = Depends(current_actor),
):
    """List recent score-cards across the whole tenant (no role filtering, per
    MVP product direction — staff + manager + admin all see everything).

    Returns most-recent-first, capped at ``limit`` (default 100, hard max 500).
    """
    from .scoring import list_scorecards
    safe_limit = max(1, min(500, int(limit)))
    return {"items": list_scorecards(limit=safe_limit)}


@router.get("/score-cards/{drill_uuid}")
def get_score_card(drill_uuid: str, actor: TrainerActor = Depends(current_actor)):
    """Return the persisted score card for a drill, or 404 if not yet scored.

    The frontend polls this on the post-drill page until it appears (E5).
    Visibility (MVP): all logged-in trainees see all score cards. Role-based
    scoping (manager → store, cluster head → cluster) is deferred to Group F.
    """
    from .scoring import load_scorecard

    state = drill_state.latest_state(drill_uuid)
    if state is None:
        raise HTTPException(status_code=404, detail="Drill not found")

    payload = load_scorecard(drill_uuid)
    if payload is None:
        import json as _json
        # Surface drill state so the polling client can stop early on
        # terminal-but-unscoreable drills (e.g. CANCELLED, FAILED before the
        # transcript was useful). The shape is intentionally NOT wrapped in
        # `{"detail": ...}` because trainerApi.js auto-unwraps that key.
        return Response(
            status_code=404,
            media_type="application/json",
            content=_json.dumps({
                "ready": False,
                "reason": "score_card_not_ready",
                "drill_status": state.status.value,
            }),
        )
    return payload


@router.post("/admin/personas/seed")
def admin_seed_library(actor: TrainerActor = Depends(require_admin)):
    """Load the bundled hand-crafted seed library into the draft.

    Useful for instant Group-D testing without waiting on a generation run.
    The seed file is shipped with the repo at
    ``backend/trainer/personas/seed_library.json``. Idempotent: replaces the
    current draft."""
    from pathlib import Path
    import json as _json
    from trainer.personas.schema import PersonaLibrary as _Lib

    seed_path = Path(__file__).resolve().parent / "personas" / "seed_library.json"
    if not seed_path.exists():
        raise HTTPException(status_code=500, detail=f"seed_library.json missing at {seed_path}")
    try:
        data = _json.loads(seed_path.read_text(encoding="utf-8"))
        lib = _Lib.model_validate(data)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not load seed: {exc}")

    save_draft(lib, actor_staff_id=actor.staff_id, actor_email=actor.email)
    return {
        "library": lib.model_dump(mode="json"),
        "message": f"Seeded {len(lib.personas)} personas into draft. Click Publish to go live.",
    }
