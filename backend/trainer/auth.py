"""HMAC-signed cookie identity for the trainer subsystem.

Why a separate auth layer? The base app trusts the frontend's
``localStorage.isAuthenticated`` flag and never checks identity server-side.
That's fine for the public dashboard but unsafe for trainer endpoints, where
*server-trusted* identity is needed to enforce daily quotas (G1) and visibility
rules (D3 in the PRD).

Token format: ``base64url(payload_json) + "." + base64url(hmac_sha256(payload))``.
Payload is a JSON object: ``{staff_id, full_name, store_name, role, email, iat}``.
``iat`` is unix-seconds; tokens older than ``TRAINER_COOKIE_MAX_AGE_SECONDS`` are
rejected.

This module has no FastAPI imports beyond ``Request``/``Response`` so it can be
unit-tested without standing up the full app.
"""

from __future__ import annotations

import base64
import hmac
import hashlib
import json
import logging
import time
from dataclasses import asdict, dataclass, field
from typing import Optional

from fastapi import Depends, HTTPException, Request

from .config import (
    TRAINER_ADMIN_EMAILS,
    TRAINER_COOKIE_MAX_AGE_SECONDS,
    TRAINER_COOKIE_NAME,
    TRAINER_COOKIE_SECRET,
)

logger = logging.getLogger("trainer.auth")

VALID_ROLES = ("staff", "manager", "cluster_head", "admin")


@dataclass(frozen=True)
class TrainerActor:
    staff_id: str
    full_name: str
    store_name: str
    role: str
    email: str = ""
    issued_at: int = field(default_factory=lambda: int(time.time()))

    def to_public_dict(self) -> dict:
        return asdict(self)


# ── Token sign/verify ────────────────────────────────────────────────────────


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64url_decode(text: str) -> bytes:
    padded = text + "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(padded.encode("ascii"))


def sign(actor: TrainerActor) -> str:
    payload = {
        "staff_id": actor.staff_id,
        "full_name": actor.full_name,
        "store_name": actor.store_name,
        "role": actor.role,
        "email": actor.email,
        "iat": int(actor.issued_at or time.time()),
    }
    payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    sig = hmac.new(TRAINER_COOKIE_SECRET.encode("utf-8"), payload_bytes, hashlib.sha256).digest()
    return f"{_b64url_encode(payload_bytes)}.{_b64url_encode(sig)}"


def verify(token: str) -> Optional[TrainerActor]:
    """Return the actor if ``token`` parses, signature matches, and is not expired."""
    if not token or "." not in token:
        return None
    try:
        payload_b64, sig_b64 = token.split(".", 1)
        payload_bytes = _b64url_decode(payload_b64)
        sig = _b64url_decode(sig_b64)
    except (ValueError, base64.binascii.Error):
        return None

    expected = hmac.new(TRAINER_COOKIE_SECRET.encode("utf-8"), payload_bytes, hashlib.sha256).digest()
    if not hmac.compare_digest(sig, expected):
        return None

    try:
        payload = json.loads(payload_bytes.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None

    iat = int(payload.get("iat", 0))
    if iat <= 0 or (int(time.time()) - iat) > TRAINER_COOKIE_MAX_AGE_SECONDS:
        return None

    role = payload.get("role")
    if role not in VALID_ROLES:
        return None

    return TrainerActor(
        staff_id=payload.get("staff_id", ""),
        full_name=payload.get("full_name", ""),
        store_name=payload.get("store_name", ""),
        role=role,
        email=payload.get("email", ""),
        issued_at=iat,
    )


# ── Role helpers ─────────────────────────────────────────────────────────────


def resolve_role(roster_role: str, email: str) -> str:
    """Upgrade roster role to ``admin`` if the email is in the admin allowlist."""
    if email and email.strip().lower() in TRAINER_ADMIN_EMAILS:
        return "admin"
    if roster_role in VALID_ROLES:
        return roster_role
    return "staff"


# ── FastAPI dependencies ─────────────────────────────────────────────────────


def current_actor(request: Request) -> TrainerActor:
    """Dependency: 401 unless the request carries a valid signed trainer cookie."""
    token = request.cookies.get(TRAINER_COOKIE_NAME)
    actor = verify(token) if token else None
    if not actor:
        raise HTTPException(status_code=401, detail="Trainer session required")
    return actor


def optional_actor(request: Request) -> Optional[TrainerActor]:
    """Dependency: returns the actor if present, ``None`` otherwise. No 401."""
    token = request.cookies.get(TRAINER_COOKIE_NAME)
    return verify(token) if token else None


def require_role(*roles: str):
    """Dependency factory: 403 unless ``actor.role`` is in ``roles``."""

    def _dep(actor: TrainerActor = Depends(current_actor)) -> TrainerActor:
        if actor.role not in roles:
            raise HTTPException(
                status_code=403,
                detail=f"Role '{actor.role}' not permitted; needs one of {list(roles)}",
            )
        return actor

    return _dep


# Convenience aliases — read as English in route signatures.
require_admin = require_role("admin")
require_manager_or_above = require_role("manager", "cluster_head", "admin")
