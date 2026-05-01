"""Pytest fixtures for trainer Group A tests.

Each test gets a fresh ``backend/data/trainer/`` redirected to ``tmp_path``.
The trainer config module is monkey-patched so all reads/writes happen inside
the temp directory and never touch the real ``backend/data/``.
"""

from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture
def trainer_dirs(tmp_path, monkeypatch):
    """Redirect TRAINER_DATA_DIR / TRAINER_AUDIO_DIR / CITY_STORE_MAPPING_PATH to tmp_path.

    Also clears the roster module's in-memory cache and the csvstore lock map
    so previous-test state never leaks in.
    """
    data_dir = tmp_path / "data" / "trainer"
    audio_dir = data_dir / "audio"
    data_dir.mkdir(parents=True)
    audio_dir.mkdir(parents=True)
    mapping_path = tmp_path / "data" / "city_store_mapping.json"

    from trainer import config as cfg

    monkeypatch.setattr(cfg, "TRAINER_DATA_DIR", data_dir)
    monkeypatch.setattr(cfg, "TRAINER_AUDIO_DIR", audio_dir)
    monkeypatch.setattr(cfg, "CITY_STORE_MAPPING_PATH", mapping_path)

    # csvstore / roster / router / personas.store each import TRAINER_DATA_DIR
    # by name at import-time, so the patched value on `config` doesn't reach
    # them. Patch the bound names on every consumer module.
    from trainer import csvstore, roster, router as router_mod
    from trainer.personas import store as persona_store_mod
    monkeypatch.setattr(csvstore, "TRAINER_DATA_DIR", data_dir)
    monkeypatch.setattr(roster, "TRAINER_DATA_DIR", data_dir)
    monkeypatch.setattr(roster, "CITY_STORE_MAPPING_PATH", mapping_path)
    monkeypatch.setattr(router_mod, "TRAINER_DATA_DIR", data_dir)
    monkeypatch.setattr(persona_store_mod, "TRAINER_DATA_DIR", data_dir)

    # Reset module-level state.
    csvstore._locks.clear()
    roster._cached_rows = None
    roster._cached_mtime = None

    return {"data": data_dir, "audio": audio_dir, "mapping": mapping_path}


@pytest.fixture
def fresh_csvs(trainer_dirs):
    """Create header rows for all trainer CSVs (mirrors the startup hook)."""
    from trainer import csvstore
    csvstore.ensure_headers()
    return trainer_dirs


@pytest.fixture
def sample_roster_csv() -> str:
    """Valid roster CSV text covering 3 stores × 3 staff each."""
    return (
        "staff_id,full_name,store_name,role,joined_date,status,real_call_agent_name_variants,email\n"
        "STF-0001,Priya R,COCO INDIRANAGAR,staff,2025-01-15,active,Priya R; PRIYA R; Priya Ranganathan,\n"
        "STF-0002,Rajesh S,COCO INDIRANAGAR,manager,2024-06-01,active,Rajesh S,manager.indr@duroflexworld.com\n"
        "STF-0003,Anita K,COCO INDIRANAGAR,staff,2026-04-10,active,,\n"
        "STF-0004,Vikram J,COCO HSR,staff,2024-12-20,active,Vikram J; V Jain,\n"
        "STF-0005,Meena P,COCO HSR,staff,2025-08-01,active,,\n"
        "STF-0006,Suresh M,COCO HSR,manager,2023-03-15,active,Suresh M,\n"
        "STF-0007,Karthik V,COCO BANJARA HILLS,cluster_head,2022-09-01,active,,\n"
        "STF-0008,Deepa N,COCO BANJARA HILLS,staff,2026-04-20,active,,\n"
        "STF-0009,Old Account,COCO BANJARA HILLS,staff,2023-01-01,inactive,,\n"
    )


@pytest.fixture
def write_roster(trainer_dirs, sample_roster_csv):
    """Helper: write the sample roster CSV into the temp data dir."""
    target = trainer_dirs["data"] / "staff_roster.csv"
    target.write_text(sample_roster_csv, encoding="utf-8")
    return target
