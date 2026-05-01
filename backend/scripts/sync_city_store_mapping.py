"""One-time sync of city_store_mapping.json from frontend → backend.

The React frontend imports the JSON statically (it lives in
``frontend/src/utils/``); the trainer backend needs its own copy so admin
endpoints and the identify-page API can consult store names without any
frontend coupling. Run this manually after editing the frontend file.

Usage:
    python backend/scripts/sync_city_store_mapping.py
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
SRC = ROOT / "frontend" / "src" / "utils" / "city_store_mapping.json"
DST = ROOT / "backend" / "data" / "city_store_mapping.json"


def main() -> int:
    if not SRC.exists():
        print(f"[error] source missing: {SRC}", file=sys.stderr)
        return 1
    DST.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(SRC, DST)
    print(f"copied {SRC} -> {DST}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
