"""D3 — WebSocket bridge between the browser and Gemini Live.

Wire protocol:
  Browser -> server  : binary frame = raw PCM s16le @ 16 kHz mono (mic chunks)
                       text frame    = JSON event ({"type": "end"} for clean stop)
  Server  -> browser : binary frame = raw PCM s16le @ 24 kHz mono (Gemini audio)
                       text frame    = JSON event:
                                       {"type": "transcript", "speaker": "customer"|"staff",
                                        "text": "...", "partial": bool}
                                       {"type": "state", "status": "in_call"|"completed"|...}
                                       {"type": "error", "reason": "..."}

5-minute hard cap is enforced via ``asyncio.wait_for`` on the bridge.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from fastapi import WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from ..auth import TrainerActor, verify
from ..config import GEMINI_LIVE_MODEL, TRAINER_COOKIE_NAME
from ..personas.store import load_published
from ..scoring import schedule_scoring
from ..swot.gemini_client import get_client
from . import state as drill_state
from .prompt import build_system_prompt
from .recorder import Recorder
from .transcript import Transcript

logger = logging.getLogger("trainer.drill.ws")

# ── Diagnostic file log (separate from the main app logger which routes
# elsewhere). One line per pump event so we can verify the flow live.
import os as _os
from pathlib import Path as _Path
from ..config import TRAINER_DATA_DIR as _DATA_DIR
_DIAG_PATH = _Path(_DATA_DIR) / "drill_debug.log"
try:
    _Path(_DATA_DIR).mkdir(parents=True, exist_ok=True)
except OSError:
    pass


def _diag(fmt: str, *args) -> None:
    """Append a single timestamped line to ``drill_debug.log``. Best-effort."""
    try:
        from datetime import datetime as _dt
        line = f"{_dt.utcnow().isoformat(timespec='milliseconds')} {fmt % args}\n"
        with _DIAG_PATH.open("a", encoding="utf-8") as f:
            f.write(line)
    except OSError:
        pass


DRILL_MAX_SECONDS = 5 * 60  # hard cap (per PRD §4.2)
INPUT_SAMPLE_RATE = 16_000
OUTPUT_SAMPLE_RATE = 24_000


@dataclass
class _BridgeContext:
    drill_uuid: str
    actor: TrainerActor
    persona_name: str
    recorder: Recorder
    transcript: Transcript
    upstream_audio_received: int = 0
    downstream_audio_sent: int = 0
    fatal_reason: Optional[str] = None
    # Per-speaker transcript buffers for the current turn. Gemini Live emits
    # transcription as deltas (e.g. "only", "if you", "can"); we accumulate
    # here and flush as ONE message per speaker on turn_complete (Q1A in
    # MockCallEngine_implementation_plan.md). Both the WS event and the JSONL
    # transcript file get one entry per speaker per turn.
    staff_text_buffer: str = ""
    customer_text_buffer: str = ""
    # The first user turn we send Gemini is 200 ms of silence (kickoff —
    # required to make the persona greet first). Gemini's input transcriber
    # hallucinates random phrases like "¿Qué es el número de serie?" for
    # silence. Drop the staff buffer once on the first turn_complete instead
    # of flushing it, so neither the UI nor the score-card extractor see it.
    is_kickoff_turn: bool = True


# ── Auth ─────────────────────────────────────────────────────────────────────


def _actor_from_ws(ws: WebSocket) -> Optional[TrainerActor]:
    cookie = ws.cookies.get(TRAINER_COOKIE_NAME)
    return verify(cookie) if cookie else None


# ── JSON helpers ─────────────────────────────────────────────────────────────


async def _send_json(ws: WebSocket, payload: dict) -> None:
    if ws.application_state != WebSocketState.CONNECTED:
        return
    try:
        await ws.send_text(json.dumps(payload, ensure_ascii=False))
    except Exception as exc:  # pragma: no cover (network)
        logger.warning("send_json failed: %s", exc)


async def _send_audio(ws: WebSocket, pcm: bytes) -> None:
    if not pcm or ws.application_state != WebSocketState.CONNECTED:
        return
    try:
        await ws.send_bytes(pcm)
    except Exception as exc:  # pragma: no cover (network)
        logger.warning("send_audio failed: %s", exc)


# ── Per-direction pumps ──────────────────────────────────────────────────────


async def _pump_browser_to_gemini(
    ws: WebSocket,
    session,
    ctx: _BridgeContext,
):
    """Receive one PTT-buffered turn at a time from the browser and forward
    each as a complete user turn to Gemini Live.

    Wire contract (P1, half-duplex strict PTT):
      - Each binary frame from the browser = one whole user turn (PCM s16le @ 16 kHz),
        already buffered client-side during the PTT-hold window.
      - Each frame triggers exactly one ``send_client_content(..., turn_complete=True)``.
      - Text frame ``{"type": "end"}`` cleanly terminates the bridge.
      - Other text frames are ignored (legacy turn_start/turn_end clients are tolerated
        but their events are no-ops under turn-based input).
    """
    from google.genai import types as gtypes

    turns_received = 0
    try:
        while True:
            msg = await ws.receive()

            if "bytes" in msg and msg["bytes"] is not None:
                pcm = msg["bytes"]
                if not pcm:
                    continue
                ctx.recorder.append_staff(pcm)
                ctx.upstream_audio_received += len(pcm)
                turns_received += 1

                _diag(
                    "pump.upstream uuid=%s turn=%d bytes=%d total=%d",
                    ctx.drill_uuid, turns_received, len(pcm), ctx.upstream_audio_received,
                )

                # Whole turn → single send_realtime_input(audio=Blob) framed
                # by activity_start / activity_end. Same call shape as the
                # working kickoff. Streaming many small chunks per turn was
                # the original failure mode; one big PCM blob per turn keeps
                # the VAD framing clean.
                try:
                    await session.send_realtime_input(activity_start=gtypes.ActivityStart())
                    await session.send_realtime_input(
                        audio=gtypes.Blob(
                            data=pcm,
                            mime_type=f"audio/pcm;rate={INPUT_SAMPLE_RATE}",
                        ),
                    )
                    await session.send_realtime_input(activity_end=gtypes.ActivityEnd())
                except Exception as exc:
                    logger.warning(
                        "drill.ws upstream turn forward failed (turn %d, %d bytes): %s",
                        turns_received, len(pcm), exc,
                    )
                    raise
                continue

            if "text" in msg and msg["text"] is not None:
                try:
                    event = json.loads(msg["text"])
                except json.JSONDecodeError:
                    continue
                if event.get("type") == "end":
                    logger.info("drill.ws client requested end uuid=%s", ctx.drill_uuid)
                    return
                # Anything else (turn_start/turn_end/force_reply from older
                # clients) is silently dropped — turn boundary is the binary
                # frame itself now.
                continue

            if msg.get("type") == "websocket.disconnect":
                logger.info("drill.ws client disconnected uuid=%s", ctx.drill_uuid)
                return
    except WebSocketDisconnect:
        logger.info("drill.ws WebSocketDisconnect uuid=%s", ctx.drill_uuid)
        return
    except Exception as exc:
        logger.warning("pump_browser_to_gemini failed: %s", exc)
        ctx.fatal_reason = ctx.fatal_reason or f"upstream_error: {type(exc).__name__}"


async def _pump_gemini_to_browser(
    ws: WebSocket,
    session,
    ctx: _BridgeContext,
):
    """Receive Gemini Live messages and forward audio + transcripts to the browser.

    ``session.receive()`` is a per-turn async iterator on the Live SDK — it
    yields messages for the current model turn and then exits. We wrap it in
    an outer ``while True`` to keep listening across multiple turns; the loop
    exits naturally when the session/WS closes (caught by the outer except).
    """
    _diag("pump_gemini.start uuid=%s", ctx.drill_uuid)
    msg_count = 0
    turn_iter = 0
    try:
        while True:
            turn_iter += 1
            messages_in_this_iter = 0
            async for message in session.receive():
                msg_count += 1
                messages_in_this_iter += 1
                sc = getattr(message, "server_content", None)
                # Diagnostic: log first 5 messages overall to confirm shape;
                # throttled afterwards. Per-turn-iter shape logged below.
                if msg_count <= 5:
                    attrs = [a for a in ("server_content", "tool_call", "setup_complete",
                                         "go_away", "session_resumption_update")
                             if getattr(message, a, None) is not None]
                    _diag("pump_gemini.msg#%d uuid=%s attrs=%s sc_present=%s",
                          msg_count, ctx.drill_uuid, ",".join(attrs) or "none", sc is not None)
                if sc is None:
                    continue

                # Audio + text parts of the model's turn. Audio bytes go to
                # the browser + recorder immediately; any text part goes into
                # the customer buffer (flushed on turn_complete).
                mt = getattr(sc, "model_turn", None)
                if mt is not None and getattr(mt, "parts", None):
                    for part in mt.parts:
                        inline = getattr(part, "inline_data", None)
                        if inline is not None and getattr(inline, "data", None):
                            audio = inline.data
                            if ctx.downstream_audio_sent == 0:
                                _diag("server.first_audio uuid=%s bytes=%d", ctx.drill_uuid, len(audio))
                            ctx.recorder.append_customer(audio)
                            ctx.downstream_audio_sent += len(audio)
                            await _send_audio(ws, audio)
                        text = getattr(part, "text", None)
                        if text:
                            ctx.customer_text_buffer += text

                # Live API surfaces incremental transcription separately. We
                # accumulate into per-speaker buffers and emit ONE bubble per
                # speaker on turn_complete (Q1A): "one whole message, not
                # word-by-word".
                for attr, speaker in (("input_transcription", "staff"),
                                      ("output_transcription", "customer")):
                    t = getattr(sc, attr, None)
                    if t is None:
                        continue
                    t_text = getattr(t, "text", None) or ""
                    if not t_text:
                        continue
                    if speaker == "staff":
                        ctx.staff_text_buffer += t_text
                    else:
                        ctx.customer_text_buffer += t_text

                if getattr(sc, "turn_complete", False):
                    # Flush per-speaker buffers as one transcript message each.
                    # Order: staff first (user's audio transcribed) then customer
                    # (AI's reply). This matches conversational order in the UI.
                    if ctx.is_kickoff_turn:
                        # Kickoff turn: discard the staff buffer (it's the
                        # transcriber hallucinating against 200 ms of silence,
                        # not real agent speech). Customer buffer flushes normally.
                        if ctx.staff_text_buffer:
                            _diag("kickoff.dropped_staff_hallucination uuid=%s text=%r",
                                  ctx.drill_uuid, ctx.staff_text_buffer[:120])
                        ctx.staff_text_buffer = ""
                        ctx.is_kickoff_turn = False
                    elif ctx.staff_text_buffer.strip():
                        text_out = ctx.staff_text_buffer
                        ctx.transcript.write(speaker="staff", text=text_out, partial=False)
                        await _send_json(ws, {
                            "type": "transcript",
                            "speaker": "staff",
                            "text": text_out,
                            "partial": False,
                        })
                        ctx.staff_text_buffer = ""
                    if ctx.customer_text_buffer.strip():
                        text_out = ctx.customer_text_buffer
                        ctx.transcript.write(speaker="customer", text=text_out, partial=False)
                        await _send_json(ws, {
                            "type": "transcript",
                            "speaker": "customer",
                            "text": text_out,
                            "partial": False,
                        })
                        ctx.customer_text_buffer = ""

                    _diag("server.turn_complete uuid=%s turn=%d downstream_bytes=%d",
                          ctx.drill_uuid, turn_iter, ctx.downstream_audio_sent)
                    await _send_json(ws, {"type": "turn_complete"})
                if getattr(sc, "interrupted", False):
                    _diag("server.interrupted uuid=%s", ctx.drill_uuid)
                    await _send_json(ws, {"type": "interrupted"})

            # The per-turn iterator from session.receive() exited. Loop back to
            # await the next turn. If the iter returned no messages at all,
            # break to avoid a hot loop (shouldn't happen on a healthy session).
            _diag("pump_gemini.iter_done uuid=%s turn=%d msgs_this_iter=%d total=%d",
                  ctx.drill_uuid, turn_iter, messages_in_this_iter, msg_count)
            if messages_in_this_iter == 0:
                _diag("pump_gemini.empty_iter_break uuid=%s", ctx.drill_uuid)
                break
    except Exception as exc:
        logger.warning("pump_gemini_to_browser failed: %s", exc)
        _diag("pump_gemini.exception uuid=%s err=%r", ctx.drill_uuid, exc)
        ctx.fatal_reason = ctx.fatal_reason or f"downstream_error: {type(exc).__name__}"
    finally:
        _diag("pump_gemini.exit uuid=%s msg_count=%d downstream_bytes=%d",
              ctx.drill_uuid, msg_count, ctx.downstream_audio_sent)


# ── Main bridge entrypoint ──────────────────────────────────────────────────


async def drill_websocket(ws: WebSocket, drill_uuid: str) -> None:
    """Handle one /ws/trainer/drill/{drill_uuid} session."""
    actor = _actor_from_ws(ws)
    if actor is None:
        await ws.close(code=4401, reason="auth_required")
        return

    state = drill_state.latest_state(drill_uuid)
    if state is None:
        await ws.accept()
        await _send_json(ws, {"type": "error", "reason": "unknown_drill"})
        await ws.close(code=4404, reason="unknown_drill")
        return
    if state.staff_id != actor.staff_id:
        await ws.accept()
        await _send_json(ws, {"type": "error", "reason": "not_owner"})
        await ws.close(code=4403, reason="not_owner")
        return
    if state.status is not drill_state.DrillStatus.STARTING:
        await ws.accept()
        await _send_json(ws, {"type": "error", "reason": f"bad_state:{state.status.value}"})
        await ws.close(code=4409, reason="bad_state")
        return

    library = load_published()
    persona = None
    if library is not None:
        for p in library.personas:
            if p.persona_id == state.persona_id:
                persona = p
                break
    if persona is None:
        await ws.accept()
        await _send_json(ws, {"type": "error", "reason": "persona_not_in_library"})
        await ws.close(code=4404, reason="persona_not_in_library")
        return

    await ws.accept()
    logger.info("drill.ws.accepted uuid=%s staff=%s persona=%s", drill_uuid, actor.staff_id, persona.persona_id)
    _diag("ws.accepted uuid=%s staff=%s persona=%s", drill_uuid, actor.staff_id, persona.persona_id)

    system_prompt = build_system_prompt(persona, store_name=state.store_name)
    recorder = Recorder(drill_uuid)
    ctx = _BridgeContext(
        drill_uuid=drill_uuid,
        actor=actor,
        persona_name=persona.name,
        recorder=recorder,
        transcript=Transcript(drill_uuid),
    )

    transitioned_in_call = False
    try:
        with ctx.transcript:
            try:
                client = get_client()
            except Exception as exc:
                await _send_json(ws, {"type": "error", "reason": f"gemini_unavailable: {exc}"})
                drill_state.transition(drill_uuid, drill_state.DrillStatus.FAILED,
                                       disposition_reason="gemini_unavailable")
                await ws.close(code=1011, reason="gemini_unavailable")
                return

            from google.genai import types as gtypes

            # Manual VAD is required because:
            #   1. Auto VAD on gemini-3.1-flash-live-preview has been observed
            #      to never close user turns (no replies after audio input).
            #   2. send_client_content text turns produce no audio response on
            #      this model (verified empirically — kickoff was silent).
            # So we use the proven path: send_realtime_input(audio=Blob) +
            # explicit activity_start/activity_end framing. The kickoff and
            # each user turn are now a single audio call (not streamed), which
            # matches the call shape that worked previously for kickoff.
            try:
                vad = gtypes.AutomaticActivityDetection(disabled=True)
                realtime_input_config = gtypes.RealtimeInputConfig(
                    automatic_activity_detection=vad,
                )
            except (AttributeError, TypeError):
                realtime_input_config = None

            live_config = gtypes.LiveConnectConfig(
                response_modalities=["AUDIO"],
                system_instruction=gtypes.Content(
                    parts=[gtypes.Part.from_text(text=system_prompt)],
                    role="user",
                ),
                input_audio_transcription=gtypes.AudioTranscriptionConfig(),
                output_audio_transcription=gtypes.AudioTranscriptionConfig(),
                **({"realtime_input_config": realtime_input_config} if realtime_input_config else {}),
            )

            try:
                async with client.aio.live.connect(model=GEMINI_LIVE_MODEL, config=live_config) as session:
                    drill_state.transition(drill_uuid, drill_state.DrillStatus.IN_CALL)
                    transitioned_in_call = True
                    await _send_json(ws, {
                        "type": "state",
                        "status": "in_call",
                        "model": GEMINI_LIVE_MODEL,
                        "max_seconds": DRILL_MAX_SECONDS,
                        "persona_name": persona.name,
                    })

                    # Kickoff: send a brief silent "user turn" framed by
                    # activity_start / activity_end. Gemini interprets it as
                    # an empty user turn and generates the persona's greeting
                    # per the system_instruction. This is the proven kickoff
                    # shape — verified working on gemini-3.1-flash-live-preview.
                    try:
                        silence_kickoff = b"\x00\x00" * (INPUT_SAMPLE_RATE // 5)  # 200 ms
                        await session.send_realtime_input(activity_start=gtypes.ActivityStart())
                        await session.send_realtime_input(
                            audio=gtypes.Blob(
                                data=silence_kickoff,
                                mime_type=f"audio/pcm;rate={INPUT_SAMPLE_RATE}",
                            ),
                        )
                        await session.send_realtime_input(activity_end=gtypes.ActivityEnd())
                        _diag("kickoff.silence uuid=%s", drill_uuid)
                    except Exception as exc:
                        logger.warning("drill.ws kickoff failed: %s", exc)
                        _diag("kickoff.failed uuid=%s err=%s", drill_uuid, exc)

                    bridge = asyncio.gather(
                        _pump_browser_to_gemini(ws, session, ctx),
                        _pump_gemini_to_browser(ws, session, ctx),
                    )
                    try:
                        await asyncio.wait_for(bridge, timeout=DRILL_MAX_SECONDS)
                        timed_out = False
                    except asyncio.TimeoutError:
                        bridge.cancel()
                        with contextlib.suppress(asyncio.CancelledError, Exception):
                            await bridge
                        timed_out = True
            except Exception as exc:
                logger.exception("drill.ws gemini connect failed uuid=%s", drill_uuid)
                ctx.fatal_reason = ctx.fatal_reason or f"gemini_error: {type(exc).__name__}"
                timed_out = False

        # ── Finalisation ────────────────────────────────────────────────
        audio_path = recorder.finalize()
        transcript_path = ctx.transcript.relative_path() if (ctx.transcript.path.exists()) else None

        if not transitioned_in_call:
            # Never reached IN_CALL — surface as FAILED.
            with contextlib.suppress(drill_state.InvalidStateTransition):
                drill_state.transition(
                    drill_uuid,
                    drill_state.DrillStatus.FAILED,
                    disposition_reason=ctx.fatal_reason or "ws_setup_failed",
                    audio_path=audio_path,
                    transcript_path=transcript_path,
                )
            await _send_json(ws, {"type": "error", "reason": ctx.fatal_reason or "ws_setup_failed"})
        elif ctx.fatal_reason:
            with contextlib.suppress(drill_state.InvalidStateTransition):
                drill_state.transition(
                    drill_uuid,
                    drill_state.DrillStatus.FAILED,
                    disposition_reason=ctx.fatal_reason,
                    audio_path=audio_path,
                    transcript_path=transcript_path,
                )
            await _send_json(ws, {"type": "state", "status": "failed", "reason": ctx.fatal_reason})
        elif timed_out:
            with contextlib.suppress(drill_state.InvalidStateTransition):
                drill_state.transition(
                    drill_uuid,
                    drill_state.DrillStatus.TIMED_OUT,
                    disposition_reason="5min_elapsed",
                    audio_path=audio_path,
                    transcript_path=transcript_path,
                )
            schedule_scoring(drill_uuid)
            await _send_json(ws, {"type": "state", "status": "timed_out", "reason": "5min_elapsed"})
        else:
            with contextlib.suppress(drill_state.InvalidStateTransition):
                drill_state.transition(
                    drill_uuid,
                    drill_state.DrillStatus.COMPLETED,
                    disposition_reason="staff_ended",
                    audio_path=audio_path,
                    transcript_path=transcript_path,
                )
            schedule_scoring(drill_uuid)
            await _send_json(ws, {"type": "state", "status": "completed"})

    finally:
        if ws.application_state == WebSocketState.CONNECTED:
            with contextlib.suppress(Exception):
                await ws.close()
        logger.info(
            "drill.ws.closed uuid=%s up_bytes=%d down_bytes=%d reason=%s",
            drill_uuid, ctx.upstream_audio_received, ctx.downstream_audio_sent, ctx.fatal_reason,
        )
