"""Diagnostic smoke for the drill WS bridge.

Generates ~3 s of voiced-shaped audio, opens an authenticated WS, lets the
AI speak its kickoff, then injects the synth audio and watches for any
response (audio bytes / staff transcript / debug events).

Run:
    python backend/scripts/drill_smoke.py <staff_id> <cookie_value> <drill_uuid>
"""

from __future__ import annotations

import asyncio
import json
import math
import random
import struct
import sys
import time

import websockets


def synth_voiced_audio(seconds: float, rate: int = 16000) -> bytes:
    n = int(rate * seconds)
    samples = []
    rng = random.Random(42)
    for i in range(n):
        t = i / rate
        envelope = 0.35 * (0.6 + 0.4 * math.sin(2 * math.pi * 4.5 * t))
        noise = (rng.random() * 2 - 1)
        formant = 0.5 * math.sin(2 * math.pi * 700 * t) + 0.25 * math.sin(2 * math.pi * 1400 * t)
        s = envelope * (0.5 * noise + 0.5 * formant)
        samples.append(int(max(-1.0, min(1.0, s)) * 28000))
    return struct.pack("<" + "h" * n, *samples)


async def main(cookie: str, drill_uuid: str) -> None:
    headers = [("Cookie", f"trainer_session={cookie}")]
    speech = synth_voiced_audio(3.0)
    chunk_size = 16000 * 2 // 5  # 200 ms
    chunks = [speech[i : i + chunk_size] for i in range(0, len(speech), chunk_size)]

    audio_pre = audio_post = 0
    debug_events = []
    customer_first: list[str] = []
    customer_post: list[str] = []
    staff: list[str] = []
    user_audio_at: float | None = None
    started = time.time()

    async with websockets.connect(
        f"ws://localhost:8000/ws/trainer/drill/{drill_uuid}",
        additional_headers=headers,
        open_timeout=30,
    ) as ws:

        async def receive() -> None:
            nonlocal audio_pre, audio_post
            while time.time() - started < 22:
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=1.5)
                except asyncio.TimeoutError:
                    continue
                except websockets.ConnectionClosed:
                    return
                if isinstance(msg, bytes):
                    if user_audio_at is None:
                        audio_pre += len(msg)
                    else:
                        audio_post += len(msg)
                else:
                    ev = json.loads(msg)
                    t = ev.get("type")
                    if t == "transcript":
                        sp = ev.get("speaker")
                        text = ev.get("text", "")
                        if sp == "customer":
                            (customer_post if user_audio_at else customer_first).append(text)
                        else:
                            staff.append(text)
                    elif t == "debug":
                        debug_events.append(ev)
                    elif t == "state":
                        print(f'  STATE: {ev["status"]}')
                    elif t == "error":
                        print(f"  ERROR: {ev}")
                        return

        async def send_audio() -> None:
            nonlocal user_audio_at
            await asyncio.sleep(7.0)
            user_audio_at = time.time()
            print(f"  [t=7s] sending {len(chunks)} synthetic mic chunks (~3s)")
            for c in chunks:
                if not c:
                    continue
                await ws.send(c)
                await asyncio.sleep(0.2)
            print(f"  [t=10s] all chunks sent. Listening for AI response...")

        await asyncio.gather(receive(), send_audio())
        try:
            await ws.send(json.dumps({"type": "end"}))
        except websockets.ConnectionClosed:
            pass
        await asyncio.sleep(0.3)

    print()
    print(f"  AI audio BEFORE my turn : {audio_pre:>8,} bytes  customer transcripts: {len(customer_first)}")
    print(f"  AI audio AFTER my turn  : {audio_post:>8,} bytes  customer transcripts: {len(customer_post)}")
    print(f"  Staff transcripts (Gemini's view of MY audio): {len(staff)}")
    if staff:
        print(f"    -> first: \"{staff[0][:140]}\"")
    print(f"  Debug events from server: {len(debug_events)}")
    if debug_events:
        last = debug_events[-1]
        print(f"    -> last: upstream_chunks={last.get('upstream_chunks')} upstream_bytes={last.get('upstream_bytes')}")


if __name__ == "__main__":
    cookie = sys.argv[1]
    drill_uuid = sys.argv[2]
    asyncio.run(main(cookie, drill_uuid))
