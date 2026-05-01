"""D9 — Recording-to-disk for drills.

Two raw PCM streams are captured live (browser->Gemini, Gemini->browser) and
on finalize we write a single mixed WAV at 24 kHz mono. We don't ffmpeg-mix
the two channels for v1 — the staff and the customer have different sample
rates (16k vs 24k), so we resample staff up to 24k and sum samples element-
wise. Quality is acceptable for review playback.
"""

from __future__ import annotations

import logging
import wave
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from ..config import TRAINER_AUDIO_DIR

logger = logging.getLogger("trainer.drill.recorder")

OUTPUT_RATE = 24_000


class Recorder:
    """Append-only PCM accumulators for a single drill."""

    def __init__(self, drill_uuid: str):
        self.drill_uuid = drill_uuid
        self._staff_pcm = bytearray()   # 16-bit mono @ 16 kHz
        self._customer_pcm = bytearray()  # 16-bit mono @ 24 kHz

    def append_staff(self, pcm16_16k: bytes) -> None:
        if pcm16_16k:
            self._staff_pcm.extend(pcm16_16k)

    def append_customer(self, pcm16_24k: bytes) -> None:
        if pcm16_24k:
            self._customer_pcm.extend(pcm16_24k)

    def finalize(self) -> Optional[str]:
        """Write a mixed WAV. Returns the relative path or None if no audio."""
        if not self._staff_pcm and not self._customer_pcm:
            return None

        out_dir = Path(TRAINER_AUDIO_DIR) / datetime.now(timezone.utc).strftime("%Y/%m")
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"{self.drill_uuid}.wav"

        try:
            customer_samples = _bytes_to_int16(self._customer_pcm)
            staff_samples = _resample_int16(_bytes_to_int16(self._staff_pcm), 16_000, OUTPUT_RATE)
            mixed = _mix_int16(staff_samples, customer_samples)

            with wave.open(str(out_path), "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(OUTPUT_RATE)
                wf.writeframes(_int16_to_bytes(mixed))
        except Exception as exc:
            logger.warning("recorder.finalize failed for %s: %s", self.drill_uuid, exc)
            return None

        try:
            rel = out_path.relative_to(Path(TRAINER_AUDIO_DIR).parent.parent)
            return str(rel).replace("\\", "/")
        except ValueError:
            return str(out_path)


# ── Helpers (no numpy — recorder runs on the WS event loop) ──────────────────


def _bytes_to_int16(buf: bytearray) -> list[int]:
    if not buf:
        return []
    n = len(buf) // 2
    if n == 0:
        return []
    import array
    a = array.array("h")
    a.frombytes(bytes(buf[: n * 2]))
    return list(a)


def _int16_to_bytes(samples: list[int]) -> bytes:
    import array
    a = array.array("h", samples)
    return a.tobytes()


def _resample_int16(samples: list[int], src_rate: int, dst_rate: int) -> list[int]:
    """Cheap linear-interpolation resampler. Good enough for voice review."""
    if not samples or src_rate == dst_rate:
        return samples
    ratio = dst_rate / src_rate
    out_len = int(len(samples) * ratio)
    if out_len == 0:
        return []
    out = [0] * out_len
    for i in range(out_len):
        src_pos = i / ratio
        i0 = int(src_pos)
        i1 = min(i0 + 1, len(samples) - 1)
        frac = src_pos - i0
        v = int(samples[i0] * (1 - frac) + samples[i1] * frac)
        # Clip to int16
        if v > 32767:
            v = 32767
        elif v < -32768:
            v = -32768
        out[i] = v
    return out


def _mix_int16(a: list[int], b: list[int]) -> list[int]:
    n = max(len(a), len(b))
    out = [0] * n
    for i in range(n):
        v = (a[i] if i < len(a) else 0) + (b[i] if i < len(b) else 0)
        if v > 32767:
            v = 32767
        elif v < -32768:
            v = -32768
        out[i] = v
    return out
