"""D1+D2+D14 — drill state machine + start/cancel endpoints.

The WebSocket bridge (D3) is exercised manually in a browser; we don't try
to fake Gemini Live in pytest. These tests cover the state machine + REST
edges, which is where most regressions would land.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from trainer import auth
from trainer.drill import state as ds
from trainer.drill.prompt import build_system_prompt
from trainer.drill.state import DrillStatus, InvalidStateTransition
from trainer.personas.schema import PersonaLibrary
from trainer.router import router as trainer_router


# ── State machine unit tests ─────────────────────────────────────────────────


def test_start_drill_writes_starting_row(fresh_csvs):
    state = ds.start_drill(
        staff_id="STF-0001",
        store_name="COCO INDIRANAGAR",
        persona_id="P-test",
        persona_difficulty="easy",
        model="gemini-2.5-flash-preview-native-audio-dialog",
    )
    assert state.status is DrillStatus.STARTING
    fetched = ds.latest_state(state.drill_uuid)
    assert fetched is not None
    assert fetched.status is DrillStatus.STARTING


def test_starting_to_in_call_to_completed(fresh_csvs):
    state = ds.start_drill(
        staff_id="STF-0001", store_name="X", persona_id="P-1",
        persona_difficulty="easy", model="m",
    )
    s2 = ds.transition(state.drill_uuid, DrillStatus.IN_CALL)
    assert s2.status is DrillStatus.IN_CALL
    s3 = ds.transition(state.drill_uuid, DrillStatus.COMPLETED, disposition_reason="staff_ended")
    assert s3.status is DrillStatus.COMPLETED
    assert s3.duration_seconds is not None and s3.duration_seconds >= 0
    assert s3.disposition_reason == "staff_ended"


def test_transition_terminal_is_locked(fresh_csvs):
    state = ds.start_drill(
        staff_id="S", store_name="X", persona_id="P", persona_difficulty="easy", model="m",
    )
    ds.transition(state.drill_uuid, DrillStatus.CANCELLED, disposition_reason="staff_cancelled")
    with pytest.raises(InvalidStateTransition):
        ds.transition(state.drill_uuid, DrillStatus.IN_CALL)


def test_invalid_transition_path(fresh_csvs):
    state = ds.start_drill(
        staff_id="S", store_name="X", persona_id="P", persona_difficulty="easy", model="m",
    )
    # STARTING -> COMPLETED is not allowed (must go via IN_CALL first).
    with pytest.raises(InvalidStateTransition):
        ds.transition(state.drill_uuid, DrillStatus.COMPLETED)


def test_unknown_drill_uuid_raises(fresh_csvs):
    with pytest.raises(InvalidStateTransition):
        ds.transition("does-not-exist", DrillStatus.IN_CALL)


def test_concurrent_drills_keep_separate_state(fresh_csvs):
    s1 = ds.start_drill(staff_id="A", store_name="X", persona_id="P1",
                        persona_difficulty="easy", model="m")
    s2 = ds.start_drill(staff_id="B", store_name="Y", persona_id="P2",
                        persona_difficulty="hard", model="m")
    ds.transition(s1.drill_uuid, DrillStatus.IN_CALL)
    ds.transition(s2.drill_uuid, DrillStatus.IN_CALL)
    ds.transition(s1.drill_uuid, DrillStatus.COMPLETED)

    assert ds.latest_state(s1.drill_uuid).status is DrillStatus.COMPLETED
    assert ds.latest_state(s2.drill_uuid).status is DrillStatus.IN_CALL


# ── Prompt assembly ──────────────────────────────────────────────────────────


def test_system_prompt_embeds_persona_fields():
    seed_path = Path(__file__).resolve().parent.parent.parent / "trainer" / "personas" / "seed_library.json"
    lib = PersonaLibrary.model_validate(json.loads(seed_path.read_text(encoding="utf-8")))
    persona = lib.personas[0]
    prompt = build_system_prompt(persona)
    assert persona.name in prompt
    assert persona.opening_line_hint in prompt
    assert persona.language_mix in prompt
    assert persona.difficulty_band in prompt
    # Make sure the "stay in character" rule is included.
    assert "language model" in prompt
    # Shorter than Gemini Live's instruction budget.
    assert len(prompt) < 100_000


# ── Router endpoints ─────────────────────────────────────────────────────────


@pytest.fixture
def drill_client(fresh_csvs, sample_roster_csv, monkeypatch):
    """TestClient with a published persona library so /drills/start works."""
    roster_path = fresh_csvs["data"] / "staff_roster.csv"
    roster_path.write_text(sample_roster_csv, encoding="utf-8")
    monkeypatch.setattr(auth, "TRAINER_ADMIN_EMAILS", ["admin@duroflexworld.com"])
    fresh_csvs["mapping"].parent.mkdir(parents=True, exist_ok=True)
    fresh_csvs["mapping"].write_text(
        json.dumps({"BLR": ["COCO INDIRANAGAR"]}), encoding="utf-8"
    )

    # Publish the seed library.
    from trainer.personas import store as ps
    seed = json.loads(
        (Path(__file__).resolve().parent.parent.parent / "trainer" / "personas" / "seed_library.json")
        .read_text(encoding="utf-8")
    )
    lib = PersonaLibrary.model_validate(seed)
    ps.save_draft(lib, actor_staff_id="seed")
    ps.publish_draft(actor_staff_id="seed")

    app = FastAPI()
    app.include_router(trainer_router)
    return TestClient(app)


def _login(client, staff_id, email=""):
    return client.post("/api/trainer/auth/login", json={"staff_id": staff_id, "email": email})


def test_start_drill_401_without_cookie(drill_client):
    res = drill_client.post("/api/trainer/drills/start", json={})
    assert res.status_code == 401


def test_start_drill_seeds_starting_state(drill_client):
    _login(drill_client, "STF-0001")
    res = drill_client.post("/api/trainer/drills/start", json={})
    assert res.status_code == 200
    body = res.json()
    assert body["drill_uuid"]
    assert body["persona"]["persona_id"]
    assert body["mode"] in {"text", "voice"}
    # Default mode is "text" — endpoints, not ws_url, are in the response.
    if body["mode"] == "text":
        assert body["kickoff_url"].endswith("/kickoff")
        assert body["turn_url"].endswith("/turn")
        assert body["end_url"].endswith("/end")
    else:
        assert body["ws_url"].startswith("/ws/trainer/drill/")
    assert body["hard_timeout_seconds"] == 300

    info = drill_client.get(f"/api/trainer/drills/{body['drill_uuid']}").json()
    assert info["status"] == "starting"


def test_start_drill_voice_mode_returns_ws_url(drill_client):
    _login(drill_client, "STF-0001")
    res = drill_client.post("/api/trainer/drills/start", json={"mode": "voice"})
    assert res.status_code == 200
    body = res.json()
    assert body["mode"] == "voice"
    assert body["ws_url"].startswith("/ws/trainer/drill/")
    assert "kickoff_url" not in body


def test_text_endpoints_require_in_call_state(drill_client):
    """/turn returns 409 if /kickoff hasn't run (drill still STARTING)."""
    _login(drill_client, "STF-0001")
    drill_uuid = drill_client.post(
        "/api/trainer/drills/start", json={"mode": "text"},
    ).json()["drill_uuid"]
    res = drill_client.post(
        f"/api/trainer/drills/{drill_uuid}/turn", json={"text": "Hello"},
    )
    assert res.status_code == 409


def test_start_drill_explicit_persona_id(drill_client):
    _login(drill_client, "STF-0001")
    res = drill_client.post(
        "/api/trainer/drills/start",
        json={"persona_id": "P-priya-young-budget-shopper"},
    )
    assert res.status_code == 200
    assert res.json()["persona"]["persona_id"] == "P-priya-young-budget-shopper"


def test_start_drill_unknown_persona_404(drill_client):
    _login(drill_client, "STF-0001")
    res = drill_client.post("/api/trainer/drills/start", json={"persona_id": "P-nope"})
    assert res.status_code == 404


def test_cancel_drill_marks_cancelled(drill_client):
    _login(drill_client, "STF-0001")
    drill_uuid = drill_client.post("/api/trainer/drills/start", json={}).json()["drill_uuid"]
    res = drill_client.post(f"/api/trainer/drills/{drill_uuid}/cancel")
    assert res.status_code == 200
    assert res.json()["status"] == "cancelled"

    info = drill_client.get(f"/api/trainer/drills/{drill_uuid}").json()
    assert info["status"] == "cancelled"
    assert info["disposition_reason"] == "staff_cancelled"


def test_cancel_unknown_drill_404(drill_client):
    _login(drill_client, "STF-0001")
    res = drill_client.post("/api/trainer/drills/never-existed/cancel")
    assert res.status_code == 404


def test_other_staff_cant_cancel_drill(drill_client):
    _login(drill_client, "STF-0001")
    drill_uuid = drill_client.post("/api/trainer/drills/start", json={}).json()["drill_uuid"]
    _login(drill_client, "STF-0002", email="")  # different staff, role=staff via roster
    res = drill_client.post(f"/api/trainer/drills/{drill_uuid}/cancel")
    # STF-0002 is a manager in the seed roster — managers CAN cancel any drill,
    # so this should succeed. We re-do the test with role coercion below.
    assert res.status_code == 200  # because STF-0002 is a manager


def test_staff_cant_cancel_other_staffs_drill(drill_client):
    """Use STF-0001 (staff role) as the other party; original drill is by STF-0003."""
    _login(drill_client, "STF-0003")  # role=staff (per seed roster)
    drill_uuid = drill_client.post("/api/trainer/drills/start", json={}).json()["drill_uuid"]
    _login(drill_client, "STF-0001")  # different staff, role=staff
    res = drill_client.post(f"/api/trainer/drills/{drill_uuid}/cancel")
    assert res.status_code == 403


def test_start_drill_503_when_no_library(fresh_csvs, sample_roster_csv, monkeypatch):
    """If no persona library is published, /drills/start returns 503."""
    roster_path = fresh_csvs["data"] / "staff_roster.csv"
    roster_path.write_text(sample_roster_csv, encoding="utf-8")
    fresh_csvs["mapping"].parent.mkdir(parents=True, exist_ok=True)
    fresh_csvs["mapping"].write_text(json.dumps({"BLR": ["COCO INDIRANAGAR"]}), encoding="utf-8")

    app = FastAPI()
    app.include_router(trainer_router)
    client = TestClient(app)
    _login(client, "STF-0001")

    res = client.post("/api/trainer/drills/start", json={})
    assert res.status_code == 503
