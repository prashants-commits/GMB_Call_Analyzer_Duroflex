"""A7 test cases — staff roster reader."""

from __future__ import annotations

import json
import os
import time
from datetime import date

from trainer import roster


def test_valid_roster_loads(write_roster):
    rows = roster.load_roster()
    assert len(rows) == 9
    priya = next(r for r in rows if r.staff_id == "STF-0001")
    assert priya.full_name == "Priya R"
    assert priya.store_name == "COCO INDIRANAGAR"
    assert priya.role == "staff"
    assert priya.joined_date == date(2025, 1, 15)
    assert priya.real_call_agent_name_variants == ("Priya R", "PRIYA R", "Priya Ranganathan")


def test_duplicate_staff_id_is_error(trainer_dirs):
    bad = (
        "staff_id,full_name,store_name,role,joined_date,status,real_call_agent_name_variants\n"
        "STF-0001,A,COCO INDIRANAGAR,staff,2025-01-01,active,\n"
        "STF-0001,B,COCO HSR,staff,2025-01-01,active,\n"
    )
    v = roster.parse_csv_text(bad)
    codes = {e["code"] for e in v.errors}
    assert "DUPLICATE_STAFF_ID" in codes


def test_missing_columns_returns_structured_error(trainer_dirs):
    bad = "staff_id,full_name\nSTF,Foo\n"
    v = roster.parse_csv_text(bad)
    assert v.rows == []
    assert v.errors and v.errors[0]["code"] == "MISSING_COLUMNS"


def test_invalid_role(trainer_dirs):
    bad = (
        "staff_id,full_name,store_name,role,joined_date,status,real_call_agent_name_variants\n"
        "STF-0001,A,COCO INDIRANAGAR,wizard,2025-01-01,active,\n"
    )
    v = roster.parse_csv_text(bad)
    codes = {e["code"] for e in v.errors}
    assert "INVALID_ROLE" in codes


def test_invalid_date(trainer_dirs):
    bad = (
        "staff_id,full_name,store_name,role,joined_date,status,real_call_agent_name_variants\n"
        "STF-0001,A,COCO INDIRANAGAR,staff,not-a-date,active,\n"
    )
    v = roster.parse_csv_text(bad)
    codes = {e["code"] for e in v.errors}
    assert "INVALID_DATE" in codes


def test_coverage_for_store(write_roster):
    cov = roster.coverage_for_store("COCO INDIRANAGAR")
    assert cov["total"] == 3
    # Priya + Rajesh have variants; Anita does not → 2/3.
    assert cov["with_variants"] == 2
    assert cov["coverage_pct"] == 66.7


def test_coverage_unknown_store_returns_zeros(write_roster):
    cov = roster.coverage_for_store("NOT A STORE")
    assert cov["total"] == 0
    assert cov["with_variants"] == 0
    assert cov["coverage_pct"] == 0.0


def test_staff_in_unknown_store_returns_empty(write_roster):
    assert roster.staff_in_store("UNKNOWN") == []


def test_staff_in_store_excludes_inactive(write_roster):
    rows = roster.staff_in_store("COCO BANJARA HILLS")
    ids = {r.staff_id for r in rows}
    assert "STF-0009" not in ids  # inactive
    assert {"STF-0007", "STF-0008"}.issubset(ids)


def test_is_new_joiner_within_30_days(write_roster):
    # STF-0003 joined 2026-04-10; check on 2026-05-01 (21 days later).
    assert roster.is_new_joiner("STF-0003", today=date(2026, 5, 1)) is True


def test_is_not_new_joiner_after_30_days(write_roster):
    # STF-0003 joined 2026-04-10; check on 2026-06-15 (66 days later).
    assert roster.is_new_joiner("STF-0003", today=date(2026, 6, 15)) is False


def test_is_new_joiner_unknown_staff(write_roster):
    assert roster.is_new_joiner("STF-9999", today=date(2026, 5, 1)) is False


def test_cache_invalidated_on_file_change(trainer_dirs, sample_roster_csv):
    target = trainer_dirs["data"] / roster.ROSTER_FILENAME
    target.write_text(sample_roster_csv, encoding="utf-8")
    rows1 = roster.load_roster()
    assert len(rows1) == 9

    smaller = (
        "staff_id,full_name,store_name,role,joined_date,status,real_call_agent_name_variants\n"
        "STF-0099,Solo,COCO INDIRANAGAR,staff,2025-01-01,active,\n"
    )
    target.write_text(smaller, encoding="utf-8")
    new_mtime = target.stat().st_mtime + 5
    os.utime(target, (new_mtime, new_mtime))

    rows2 = roster.load_roster()
    assert len(rows2) == 1
    assert rows2[0].staff_id == "STF-0099"


def test_no_roster_file_returns_empty(trainer_dirs):
    assert roster.load_roster() == []


def test_variants_trimmed(trainer_dirs):
    csv_text = (
        "staff_id,full_name,store_name,role,joined_date,status,real_call_agent_name_variants\n"
        "STF-0001,A,COCO INDIRANAGAR,staff,2025-01-01,active,  Priya R  ;  PRIYA R  ;  ;Priya Ranganathan\n"
    )
    v = roster.parse_csv_text(csv_text)
    assert len(v.rows) == 1
    assert v.rows[0].real_call_agent_name_variants == ("Priya R", "PRIYA R", "Priya Ranganathan")
    codes = {w["code"] for w in v.warnings}
    assert "TRIMMED_VARIANTS" in codes


def test_lookup_by_id(write_roster):
    row = roster.lookup_by_id("STF-0001")
    assert row is not None and row.full_name == "Priya R"
    assert roster.lookup_by_id("STF-0XYZ") is None


def test_agent_name_variants_for(write_roster):
    assert roster.agent_name_variants_for("STF-0001") == (
        "Priya R", "PRIYA R", "Priya Ranganathan",
    )
    assert roster.agent_name_variants_for("STF-0003") == ()
    assert roster.agent_name_variants_for("STF-9999") == ()


def test_store_name_warning_when_mapping_present(trainer_dirs, sample_roster_csv):
    """If city_store_mapping.json is present, unknown stores get a warning."""
    trainer_dirs["mapping"].parent.mkdir(parents=True, exist_ok=True)
    trainer_dirs["mapping"].write_text(json.dumps({"BLR": ["COCO INDIRANAGAR"]}), encoding="utf-8")

    bad = (
        "staff_id,full_name,store_name,role,joined_date,status,real_call_agent_name_variants\n"
        "STF-0001,A,COCO MARS,staff,2025-01-01,active,\n"
    )
    v = roster.parse_csv_text(bad)
    codes = {w["code"] for w in v.warnings}
    assert "STORE_NOT_IN_MAPPING" in codes
