"""A2 + A5 + A7 — end-to-end tests for the Group A endpoints."""

from __future__ import annotations

import io
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from trainer import auth, config
from trainer.router import router as trainer_router


@pytest.fixture
def client(fresh_csvs, sample_roster_csv, monkeypatch):
    """Build a FastAPI app with the trainer router mounted on a tmp data dir."""
    # Write sample roster so /auth/login can find rows.
    roster_path = fresh_csvs["data"] / "staff_roster.csv"
    roster_path.write_text(sample_roster_csv, encoding="utf-8")

    # Promote one email to admin for admin-endpoint tests.
    monkeypatch.setattr(auth, "TRAINER_ADMIN_EMAILS", ["admin@duroflexworld.com"])

    # Ensure city_store mapping exists.
    fresh_csvs["mapping"].parent.mkdir(parents=True, exist_ok=True)
    fresh_csvs["mapping"].write_text(
        json.dumps({"BLR": ["COCO INDIRANAGAR", "COCO HSR"], "HYD": ["COCO BANJARA HILLS"]}),
        encoding="utf-8",
    )

    app = FastAPI()
    app.include_router(trainer_router)
    return TestClient(app)


def _login(client, staff_id, email=""):
    return client.post("/api/trainer/auth/login", json={"staff_id": staff_id, "email": email})


def test_health_open(client):
    res = client.get("/api/trainer/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "version": "v1"}


def test_me_401_without_cookie(client):
    res = client.get("/api/trainer/me")
    assert res.status_code == 401


def test_login_unknown_staff(client):
    res = _login(client, "STF-9999")
    assert res.status_code == 404


def test_login_inactive_staff(client):
    res = _login(client, "STF-0009")  # inactive in fixture
    assert res.status_code == 403


def test_login_then_me(client):
    res = _login(client, "STF-0001")
    assert res.status_code == 200
    body = res.json()
    assert body["actor"]["staff_id"] == "STF-0001"
    assert body["actor"]["role"] == "staff"

    res = client.get("/api/trainer/me")
    assert res.status_code == 200
    assert res.json()["actor"]["staff_id"] == "STF-0001"


def test_admin_login_promotes_role(client):
    res = _login(client, "STF-0002", email="admin@duroflexworld.com")
    assert res.status_code == 200
    assert res.json()["actor"]["role"] == "admin"


def test_logout_clears_cookie(client):
    _login(client, "STF-0001")
    res = client.post("/api/trainer/auth/logout")
    assert res.status_code == 200
    res = client.get("/api/trainer/me")
    assert res.status_code == 401


def test_admin_roster_403_for_non_admin(client):
    _login(client, "STF-0001")
    res = client.get("/api/trainer/admin/roster")
    assert res.status_code == 403


def test_admin_roster_returns_rows(client):
    _login(client, "STF-0002", email="admin@duroflexworld.com")
    res = client.get("/api/trainer/admin/roster")
    assert res.status_code == 200
    body = res.json()
    assert body["exists"] is True
    assert len(body["rows"]) == 9
    assert body["errors"] == []


def test_admin_roster_coverage(client):
    _login(client, "STF-0002", email="admin@duroflexworld.com")
    res = client.get("/api/trainer/admin/roster/coverage")
    assert res.status_code == 200
    body = res.json()
    coverage = {s["store_name"]: s for s in body["stores"]}
    assert coverage["COCO INDIRANAGAR"]["with_variants"] == 2
    assert coverage["COCO INDIRANAGAR"]["total"] == 3


def test_admin_upload_replaces_file(client, fresh_csvs):
    _login(client, "STF-0002", email="admin@duroflexworld.com")

    new_csv = (
        "staff_id,full_name,store_name,role,joined_date,status,real_call_agent_name_variants\n"
        "STF-0042,New Hire,COCO INDIRANAGAR,staff,2026-04-25,active,New Hire\n"
    ).encode("utf-8")

    res = client.post(
        "/api/trainer/admin/roster",
        files={"file": ("staff_roster.csv", new_csv, "text/csv")},
    )
    assert res.status_code == 200
    assert res.json()["row_count"] == 1

    # File on disk should match what we uploaded.
    target = fresh_csvs["data"] / "staff_roster.csv"
    assert target.read_bytes() == new_csv


def test_admin_upload_rejects_invalid_csv(client):
    _login(client, "STF-0002", email="admin@duroflexworld.com")
    bad = b"staff_id,full_name\nSTF-0001,Foo\n"
    res = client.post(
        "/api/trainer/admin/roster",
        files={"file": ("bad.csv", bad, "text/csv")},
    )
    assert res.status_code == 422
    detail = res.json()["detail"]
    codes = {e["code"] for e in detail["errors"]}
    assert "MISSING_COLUMNS" in codes


def test_cities_endpoint(client):
    res = client.get("/api/trainer/cities")
    assert res.status_code == 200
    body = res.json()
    assert "BLR" in body
    assert "COCO INDIRANAGAR" in body["BLR"]


def test_admin_audit_endpoint(client):
    """Login emits an audit row → admin can read it."""
    _login(client, "STF-0001")
    _login(client, "STF-0002", email="admin@duroflexworld.com")
    res = client.get("/api/trainer/admin/audit?limit=10")
    assert res.status_code == 200
    rows = res.json()["rows"]
    assert any(r["action"] == "auth.login" for r in rows)
