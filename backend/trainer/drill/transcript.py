"""D10 — Transcript JSONL writer.

One file per drill at ``audio_files/trainer/{YYYY}/{MM}/{drill_uuid}.jsonl``
(yes, lives next to the WAV — same date sharding so retention treats them
as a unit). Lines are JSON dicts: ``{t_ms, speaker, text, partial}``.

We write partials as they arrive so a crash mid-drill still leaves a
useful trace.
"""

from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from ..config import TRAINER_AUDIO_DIR

logger = logging.getLogger("trainer.drill.transcript")


class Transcript:
    def __init__(self, drill_uuid: str):
        self.drill_uuid = drill_uuid
        out_dir = Path(TRAINER_AUDIO_DIR) / datetime.now(timezone.utc).strftime("%Y/%m")
        out_dir.mkdir(parents=True, exist_ok=True)
        self.path = out_dir / f"{drill_uuid}.jsonl"
        self._fh = None
        self._lock = threading.Lock()
        self._t_zero_ns: Optional[int] = None

    def __enter__(self):
        self._fh = self.path.open("a", encoding="utf-8")
        return self

    def __exit__(self, *exc):
        try:
            if self._fh:
                self._fh.flush()
                self._fh.close()
        finally:
            self._fh = None

    def _now_ms(self) -> int:
        import time
        ns = time.monotonic_ns()
        if self._t_zero_ns is None:
            self._t_zero_ns = ns
        return (ns - self._t_zero_ns) // 1_000_000

    def write(self, *, speaker: str, text: str, partial: bool = False) -> None:
        if not self._fh or not text:
            return
        line = {
            "t_ms": self._now_ms(),
            "speaker": speaker,
            "text": text,
            "partial": partial,
        }
        with self._lock:
            self._fh.write(json.dumps(line, ensure_ascii=False) + "\n")
            self._fh.flush()

    def relative_path(self) -> str:
        try:
            rel = self.path.relative_to(Path(TRAINER_AUDIO_DIR).parent.parent)
            return str(rel).replace("\\", "/")
        except ValueError:
            return str(self.path)
