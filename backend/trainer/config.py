"""Trainer configuration loaded from .env.

Read at import time. All callers should `from .config import X` — never re-read
env vars at runtime, so a process restart is the contract for changing them.

The two values that MUST be set in .env for production:
    TRAINER_ENABLED=true
    TRAINER_COOKIE_SECRET=<32 random bytes, urlsafe-b64>

Generate a secret with:
    python -c "import secrets; print(secrets.token_urlsafe(32))"
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


# ── Directories ──────────────────────────────────────────────────────────────

BACKEND_DIR = Path(__file__).resolve().parent.parent
TRAINER_DATA_DIR = BACKEND_DIR / "data" / "trainer"
TRAINER_AUDIO_DIR = TRAINER_DATA_DIR / "audio"
CITY_STORE_MAPPING_PATH = BACKEND_DIR / "data" / "city_store_mapping.json"


# ── Feature flag ────────────────────────────────────────────────────────────

TRAINER_ENABLED = os.getenv("TRAINER_ENABLED", "false").lower() == "true"


# ── Auth (HMAC-signed cookie; see auth.py) ──────────────────────────────────

TRAINER_COOKIE_SECRET = os.getenv("TRAINER_COOKIE_SECRET", "change-me-in-production")
TRAINER_COOKIE_NAME = os.getenv("TRAINER_COOKIE_NAME", "trainer_session")
TRAINER_COOKIE_MAX_AGE_SECONDS = int(os.getenv("TRAINER_COOKIE_MAX_AGE_SECONDS", str(60 * 60 * 24 * 14)))
TRAINER_COOKIE_SECURE = os.getenv("TRAINER_COOKIE_SECURE", "false").lower() == "true"
TRAINER_ADMIN_EMAILS = [
    e.strip().lower() for e in os.getenv("TRAINER_ADMIN_EMAILS", "").split(",") if e.strip()
]


# ── Cost guardrails (D4 + §17) — tunable via .env ───────────────────────────

TRAINER_DAILY_TENANT_CAP_INR = int(os.getenv("TRAINER_DAILY_TENANT_CAP_INR", "3000"))
TRAINER_PER_DRILL_COST_TARGET_INR = int(os.getenv("TRAINER_PER_DRILL_COST_TARGET_INR", "15"))
TRAINER_STAFF_DAILY_SOFT = int(os.getenv("TRAINER_STAFF_DAILY_SOFT", "5"))
TRAINER_STAFF_DAILY_HARD = int(os.getenv("TRAINER_STAFF_DAILY_HARD", "7"))
TRAINER_NEW_JOINER_DAILY_SOFT = int(os.getenv("TRAINER_NEW_JOINER_DAILY_SOFT", "10"))
TRAINER_NEW_JOINER_DAILY_HARD = int(os.getenv("TRAINER_NEW_JOINER_DAILY_HARD", "12"))
TRAINER_STORE_DAILY_SOFT = int(os.getenv("TRAINER_STORE_DAILY_SOFT", "30"))
TRAINER_STORE_DAILY_HARD = int(os.getenv("TRAINER_STORE_DAILY_HARD", "40"))
TRAINER_PERSONA_BIAS_PCT = int(os.getenv("TRAINER_PERSONA_BIAS_PCT", "60"))


# ── Retention windows (D9) ──────────────────────────────────────────────────

TRAINER_AUDIO_RETENTION_DAYS = int(os.getenv("TRAINER_AUDIO_RETENTION_DAYS", "90"))
TRAINER_TRANSCRIPT_RETENTION_DAYS = int(os.getenv("TRAINER_TRANSCRIPT_RETENTION_DAYS", "365"))


# ── Gemini Live (D3 — Rung C, audio-in/audio-out) ──────────────────────────

GEMINI_LIVE_MODEL = os.getenv("GEMINI_LIVE_MODEL", "gemini-3.1-flash-live-preview")
TRAINER_AUDIO_BACKEND = os.getenv("TRAINER_AUDIO_BACKEND", "gemini_live")

# ── Drill text mode (Rung B — text-in / TTS-out) ───────────────────────────
# Default mode the /drills/start endpoint returns to the client. "text" uses
# the HTTP+SSE turn endpoints below; "voice" uses the WebSocket bridge in
# trainer/drill/ws.py. Frontend reads `mode` to pick the transport.
DRILL_DEFAULT_MODE = os.getenv("DRILL_DEFAULT_MODE", "text")  # "text" | "voice"

# Standard text-completion model used for the persona's dialog turns. Fast +
# cheap. Override via env if your key only has access to a different SKU.
GEMINI_DRILL_TEXT_MODEL = os.getenv("GEMINI_DRILL_TEXT_MODEL", "gemini-2.5-flash")


# ── SWOT (Group B) ──────────────────────────────────────────────────────────

# Stage-1 Map runs in parallel over batches of ~20 calls; Stage-2 Reduce
# synthesises the partials. Per request, both stages use the Pro preview model
# so SWOT quality is uniformly high. (Trade-off: ~2× slower and ~5× more
# expensive than running Stage-1 on Flash — still under the ₹15/drill target.)
SWOT_MAP_MODEL = os.getenv("SWOT_MAP_MODEL", "gemini-3.1-pro-preview")

# ── Score-card scoring (Group E) ────────────────────────────────────────────
# One Gemini Pro call per completed drill produces the 9-section rubric scores
# defined in AITrainer_Idea_v1.md §11.3 (PRD).
GEMINI_SCORING_MODEL = os.getenv("GEMINI_SCORING_MODEL", "gemini-3.1-pro-preview")
# Approximate INR cost rates for usage-metadata accounting. Defaults mirror
# SWOT_*_RATE_INR_PER_1M values; override via env if billing docs change.
SCORING_INPUT_RATE_INR_PER_1M = float(os.getenv("SCORING_INPUT_RATE_INR_PER_1M", "120"))
SCORING_OUTPUT_RATE_INR_PER_1M = float(os.getenv("SCORING_OUTPUT_RATE_INR_PER_1M", "1000"))
SWOT_REDUCE_MODEL = os.getenv("SWOT_REDUCE_MODEL", "gemini-3.1-pro-preview")

# Token rates in INR per 1M tokens (rough Gemini pricing × ~83 INR/USD).
# Used only for the cost telemetry shown in the SWOT card; not a billing hook.
# Both stages use Pro now, so the rates match.
SWOT_MAP_INR_PER_1M_IN = float(os.getenv("SWOT_MAP_INR_PER_1M_IN", "104"))
SWOT_MAP_INR_PER_1M_OUT = float(os.getenv("SWOT_MAP_INR_PER_1M_OUT", "415"))
SWOT_REDUCE_INR_PER_1M_IN = float(os.getenv("SWOT_REDUCE_INR_PER_1M_IN", "104"))
SWOT_REDUCE_INR_PER_1M_OUT = float(os.getenv("SWOT_REDUCE_INR_PER_1M_OUT", "415"))

# Cache TTL — older entries trigger stale-while-revalidate.
SWOT_CACHE_TTL_DAYS = int(os.getenv("SWOT_CACHE_TTL_DAYS", "7"))


# ── Persona Library (Group C) ───────────────────────────────────────────────

# Per-call signature extraction model + cluster+synthesise model. Both default
# to the Pro preview to keep persona quality uniformly high (per request).
PERSONA_SIGNATURE_MODEL = os.getenv("PERSONA_SIGNATURE_MODEL", "gemini-3.1-pro-preview")
PERSONA_SYNTHESIS_MODEL = os.getenv("PERSONA_SYNTHESIS_MODEL", "gemini-3.1-pro-preview")

# Default sample size for a generation run. The plan calls for 500 calls
# producing 50 personas; for the demo we shrink so a run completes in
# ~3 minutes. Admin can override via the API body.
PERSONA_DEFAULT_N_CALLS = int(os.getenv("PERSONA_DEFAULT_N_CALLS", "100"))
PERSONA_DEFAULT_K_PERSONAS = int(os.getenv("PERSONA_DEFAULT_K_PERSONAS", "12"))
PERSONA_MAX_N_CALLS = int(os.getenv("PERSONA_MAX_N_CALLS", "500"))

# Token rates (same as SWOT — both stages run on Pro).
PERSONA_INR_PER_1M_IN = float(os.getenv("PERSONA_INR_PER_1M_IN", "104"))
PERSONA_INR_PER_1M_OUT = float(os.getenv("PERSONA_INR_PER_1M_OUT", "415"))


# ── Pilot rollout allowlist (H1) ────────────────────────────────────────────

TRAINER_PILOT_STORES = [
    s.strip() for s in os.getenv("TRAINER_PILOT_STORES", "").split(",") if s.strip()
]
