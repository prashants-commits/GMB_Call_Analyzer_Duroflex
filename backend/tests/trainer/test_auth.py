"""A5 test cases — HMAC signed cookie auth."""

from __future__ import annotations

import time

from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.requests import Request

from trainer import auth, config


def _make_actor(role="staff", iat=None):
    return auth.TrainerActor(
        staff_id="STF-0001",
        full_name="Priya R",
        store_name="COCO INDIRANAGAR",
        role=role,
        email="priya@duroflexworld.com",
        issued_at=iat or int(time.time()),
    )


def test_sign_then_verify_round_trip():
    actor = _make_actor()
    token = auth.sign(actor)
    decoded = auth.verify(token)
    assert decoded is not None
    assert decoded.staff_id == actor.staff_id
    assert decoded.role == actor.role
    assert decoded.email == actor.email


def test_verify_rejects_tampered_signature():
    actor = _make_actor()
    token = auth.sign(actor)
    # Flip the last char of the signature half.
    payload, sig = token.split(".")
    bad_sig = sig[:-1] + ("A" if sig[-1] != "A" else "B")
    assert auth.verify(f"{payload}.{bad_sig}") is None


def test_verify_rejects_garbage():
    assert auth.verify("") is None
    assert auth.verify("not-a-token") is None
    assert auth.verify("a.b") is None
    assert auth.verify(None) is None


def test_verify_rejects_expired_token(monkeypatch):
    # iat 30 days ago > 14d max age
    actor = _make_actor(iat=int(time.time()) - 60 * 60 * 24 * 30)
    token = auth.sign(actor)
    assert auth.verify(token) is None


def test_verify_rejects_invalid_role(monkeypatch):
    actor = _make_actor(role="staff")
    token = auth.sign(actor)
    decoded = auth.verify(token)
    assert decoded.role == "staff"

    # Now fabricate a token with a bogus role and ensure verify rejects it.
    import base64, hmac, hashlib, json
    payload = json.dumps({
        "staff_id": "S", "full_name": "S", "store_name": "S",
        "role": "wizard", "email": "", "iat": int(time.time()),
    }, separators=(",", ":"), sort_keys=True).encode()
    sig = hmac.new(config.TRAINER_COOKIE_SECRET.encode(), payload, hashlib.sha256).digest()
    bogus = base64.urlsafe_b64encode(payload).decode().rstrip("=") + "." + base64.urlsafe_b64encode(sig).decode().rstrip("=")
    assert auth.verify(bogus) is None


def test_resolve_role_promotes_admin_email(monkeypatch):
    monkeypatch.setattr(auth, "TRAINER_ADMIN_EMAILS", ["admin@duroflexworld.com"])
    assert auth.resolve_role("staff", "admin@duroflexworld.com") == "admin"
    assert auth.resolve_role("manager", "ADMIN@duroflexworld.com") == "admin"  # case-insensitive
    assert auth.resolve_role("staff", "user@duroflexworld.com") == "staff"
    assert auth.resolve_role("manager", "") == "manager"


def test_current_actor_dependency_401_without_cookie():
    app = FastAPI()

    @app.get("/protected")
    def _ep(actor: auth.TrainerActor = auth.Depends(auth.current_actor)):
        return {"staff_id": actor.staff_id}

    client = TestClient(app)
    res = client.get("/protected")
    assert res.status_code == 401


def test_current_actor_dependency_with_valid_cookie():
    app = FastAPI()

    @app.get("/protected")
    def _ep(actor: auth.TrainerActor = auth.Depends(auth.current_actor)):
        return actor.to_public_dict()

    client = TestClient(app)
    actor = _make_actor()
    token = auth.sign(actor)
    client.cookies.set(config.TRAINER_COOKIE_NAME, token)
    res = client.get("/protected")
    assert res.status_code == 200
    assert res.json()["staff_id"] == "STF-0001"


def test_require_role_403_for_wrong_role():
    app = FastAPI()

    @app.get("/admin-only")
    def _ep(actor: auth.TrainerActor = auth.Depends(auth.require_admin)):
        return {"ok": True}

    client = TestClient(app)
    actor = _make_actor(role="staff")
    client.cookies.set(config.TRAINER_COOKIE_NAME, auth.sign(actor))
    res = client.get("/admin-only")
    assert res.status_code == 403


def test_require_role_200_for_admin():
    app = FastAPI()

    @app.get("/admin-only")
    def _ep(actor: auth.TrainerActor = auth.Depends(auth.require_admin)):
        return {"ok": True}

    client = TestClient(app)
    actor = _make_actor(role="admin")
    client.cookies.set(config.TRAINER_COOKIE_NAME, auth.sign(actor))
    res = client.get("/admin-only")
    assert res.status_code == 200
