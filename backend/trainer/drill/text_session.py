"""Rung-B drill session: text-in / text-out via Gemini text API.

Lives parallel to ``ws.py`` (Rung C — audio bridge to Gemini Live). Both
share ``state.py``, ``prompt.py``, ``transcript.py`` so the drill state
machine, system instruction, and JSONL transcript are identical regardless
of transport.

In-memory session store. If the process restarts mid-drill the session is
lost — acceptable for the MVP. Server-side history is the source of truth;
the frontend only renders what the server sends back.

Public surface:
    open_session(drill_uuid, persona, model)         -> SessionHandle
    kickoff(drill_uuid)                              -> str  (AI's opening)
    stream_user_turn(drill_uuid, user_text)          -> AsyncIterator[str]
    close_session(drill_uuid)                        -> None
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import AsyncIterator, Dict, List, Optional

from ..personas.schema import Persona
from ..swot.gemini_client import get_client
from .prompt import build_system_prompt
from .transcript import Transcript

logger = logging.getLogger("trainer.drill.text_session")


@dataclass
class _ChatTurn:
    role: str   # "user" | "model"
    text: str


@dataclass
class SessionHandle:
    drill_uuid: str
    persona: Persona
    model: str
    system_instruction: str
    history: List[_ChatTurn] = field(default_factory=list)
    transcript: Optional[Transcript] = None
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    kicked_off: bool = False
    closed: bool = False


_sessions: Dict[str, SessionHandle] = {}
_lock = threading.RLock()


class SessionNotFound(RuntimeError):
    pass


class SessionAlreadyClosed(RuntimeError):
    pass


def open_session(drill_uuid: str, persona: Persona, model: str) -> SessionHandle:
    """Create + register a session. Idempotent — returns the existing handle
    if one already exists for this drill."""
    with _lock:
        existing = _sessions.get(drill_uuid)
        if existing is not None and not existing.closed:
            return existing

        transcript = Transcript(drill_uuid)
        transcript.__enter__()  # open the file handle for the lifetime of the session

        handle = SessionHandle(
            drill_uuid=drill_uuid,
            persona=persona,
            model=model,
            system_instruction=build_system_prompt(persona),
            transcript=transcript,
        )
        _sessions[drill_uuid] = handle
        logger.info("text_session.open uuid=%s persona=%s model=%s",
                    drill_uuid, persona.persona_id, model)
        return handle


def get_session(drill_uuid: str) -> SessionHandle:
    with _lock:
        h = _sessions.get(drill_uuid)
    if h is None:
        raise SessionNotFound(f"No text session for drill {drill_uuid!r}")
    if h.closed:
        raise SessionAlreadyClosed(f"Text session for drill {drill_uuid!r} is closed")
    return h


def close_session(drill_uuid: str) -> None:
    """Idempotent — flushes the transcript and removes the entry."""
    with _lock:
        h = _sessions.pop(drill_uuid, None)
    if h is None:
        return
    h.closed = True
    try:
        if h.transcript is not None:
            h.transcript.__exit__(None, None, None)
    except Exception:  # pragma: no cover  - shutdown best-effort
        logger.exception("close_session: transcript flush failed")
    logger.info("text_session.close uuid=%s", drill_uuid)


def transcript_relative_path(drill_uuid: str) -> Optional[str]:
    """Return the on-disk relative path of the transcript file (for state row)."""
    with _lock:
        h = _sessions.get(drill_uuid)
    if h is None or h.transcript is None:
        return None
    return h.transcript.relative_path()


# ── Gemini call helpers ──────────────────────────────────────────────────────


def _build_contents(handle: SessionHandle, *, append_user: Optional[str] = None) -> list:
    """Convert chat history to the SDK's `contents` list. Appends an optional
    pending user turn (not persisted yet — only on success)."""
    from google.genai import types  # lazy import

    contents: list = []
    for turn in handle.history:
        contents.append(types.Content(
            role=turn.role,
            parts=[types.Part.from_text(text=turn.text)],
        ))
    if append_user is not None:
        contents.append(types.Content(
            role="user",
            parts=[types.Part.from_text(text=append_user)],
        ))
    return contents


def _build_config(handle: SessionHandle):
    from google.genai import types  # lazy import

    return types.GenerateContentConfig(
        system_instruction=handle.system_instruction,
        temperature=0.85,    # warmer — character-driven dialog, not a Q&A bot
        max_output_tokens=400,  # a few sentences per turn; keeps cost bounded
    )


async def kickoff(drill_uuid: str) -> str:
    """Generate the AI's opening line. Idempotent — if already kicked off,
    returns the cached opening from history."""
    handle = get_session(drill_uuid)

    if handle.kicked_off and handle.history and handle.history[0].role == "model":
        return handle.history[0].text

    # Seed turn: a fake user nudge so the model produces the FIRST line in
    # character. The persona prompt already says "Start the conversation
    # with..." but text models need a user turn to respond to. We don't add
    # this nudge to the visible transcript.
    nudge = "[The store staff just picked up. You're the customer; greet them and start your call.]"

    client = get_client()
    config = _build_config(handle)
    contents = _build_contents(handle, append_user=nudge)

    resp = await client.aio.models.generate_content(
        model=handle.model, contents=contents, config=config,
    )
    text = (resp.text or "").strip()
    if not text:
        raise RuntimeError("Empty kickoff from Gemini")

    handle.history.append(_ChatTurn(role="model", text=text))
    handle.kicked_off = True
    if handle.transcript is not None:
        handle.transcript.write(speaker="customer", text=text, partial=False)
    logger.info("text_session.kickoff uuid=%s len=%d", drill_uuid, len(text))
    return text


async def stream_user_turn(drill_uuid: str, user_text: str) -> AsyncIterator[str]:
    """Stream the AI's reply to a user message. Yields text deltas. On
    completion, persists both turns to history + transcript.

    Caller MUST consume the iterator (or the user/AI turns won't be saved).
    """
    handle = get_session(drill_uuid)
    user_text = (user_text or "").strip()
    if not user_text:
        return

    client = get_client()
    config = _build_config(handle)
    contents = _build_contents(handle, append_user=user_text)

    full = ""
    stream = await client.aio.models.generate_content_stream(
        model=handle.model, contents=contents, config=config,
    )
    async for chunk in stream:
        delta = (chunk.text or "")
        if delta:
            full += delta
            yield delta

    full = full.strip()
    if not full:
        # Don't persist a half-state if the model returned nothing.
        logger.warning("text_session.turn empty reply uuid=%s", drill_uuid)
        return

    handle.history.append(_ChatTurn(role="user", text=user_text))
    handle.history.append(_ChatTurn(role="model", text=full))
    if handle.transcript is not None:
        handle.transcript.write(speaker="staff", text=user_text, partial=False)
        handle.transcript.write(speaker="customer", text=full, partial=False)
    logger.info("text_session.turn uuid=%s in=%d out=%d",
                drill_uuid, len(user_text), len(full))
