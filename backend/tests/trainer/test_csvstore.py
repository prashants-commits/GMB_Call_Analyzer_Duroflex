"""A6 test cases — append-only CSV store."""

from __future__ import annotations

import csv
import threading

import pytest

from trainer import csvstore


# ── A6-T1 / A6-T2 ─────────────────────────────────────────────


def test_first_boot_creates_files_with_headers(trainer_dirs):
    csvstore.ensure_headers()
    for filename, columns in csvstore.FILES.items():
        path = trainer_dirs["data"] / filename
        assert path.exists()
        with path.open() as f:
            header = next(csv.reader(f))
        assert header == columns


def test_second_boot_does_not_modify(fresh_csvs):
    path = fresh_csvs["data"] / "calls.csv"
    csvstore.append("calls.csv", {"drill_uuid": "x", "store_name": "S"})
    mtime_before_second_boot = path.stat().st_mtime
    csvstore.ensure_headers()  # second call should be a no-op
    df = csvstore.read_all("calls.csv")
    assert len(df) == 1
    assert path.stat().st_mtime == mtime_before_second_boot


# ── A6-T3 ─────────────────────────────────────────────────────


def test_append_then_read_roundtrip(fresh_csvs):
    csvstore.append(
        "calls.csv",
        {
            "drill_uuid": "uuid-1",
            "store_name": "COCO INDIRANAGAR",
            "staff_id": "STF-0001",
            "status": "completed",
            "score_overall": 72,
        },
    )
    df = csvstore.read_all("calls.csv")
    assert len(df) == 1
    assert df.iloc[0]["drill_uuid"] == "uuid-1"
    assert df.iloc[0]["score_overall"] == "72"


# ── A6-T3 ─────────────────────────────────────────────────────


def test_concurrent_appends_no_interleaving(fresh_csvs):
    rows_written = 50
    barrier = threading.Barrier(rows_written)

    def writer(i: int):
        barrier.wait()
        csvstore.append(
            "calls.csv",
            {"drill_uuid": f"uuid-{i:03d}", "store_name": "S"},
        )

    threads = [threading.Thread(target=writer, args=(i,)) for i in range(rows_written)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    df = csvstore.read_all("calls.csv")
    assert len(df) == rows_written
    assert df["drill_uuid"].is_unique


# ── A6-T4 ─────────────────────────────────────────────────────


def test_missing_optional_columns_default_to_empty(fresh_csvs):
    csvstore.append("audit_log.csv", {"action": "test.action"})
    df = csvstore.read_all("audit_log.csv")
    assert df.iloc[0]["action"] == "test.action"
    assert df.iloc[0]["actor_staff_id"] == ""
    assert df.iloc[0]["target"] == ""


# ── A6-T4 (unknown column) ────────────────────────────────────


def test_unknown_column_raises(fresh_csvs):
    with pytest.raises(csvstore.CSVStoreError, match="unknown columns"):
        csvstore.append("calls.csv", {"not_a_real_column": "value"})


def test_unknown_filename_raises(trainer_dirs):
    with pytest.raises(csvstore.CSVStoreError, match="Unknown trainer CSV"):
        csvstore.append("does_not_exist.csv", {})


# ── Filtering + tombstone resolution ──────────────────────────


def test_read_filtered(fresh_csvs):
    for sid in ["STF-0001", "STF-0001", "STF-0002"]:
        csvstore.append("calls.csv", {"drill_uuid": sid, "staff_id": sid})

    df = csvstore.read_filtered("calls.csv", staff_id="STF-0001")
    assert len(df) == 2


# ── A6-T7 ─────────────────────────────────────────────────────


def test_read_latest_per_resolves_tombstones(fresh_csvs):
    csvstore.append("calls.csv", {
        "drill_uuid": "u1", "started_at": "2026-04-30T10:00:00", "status": "starting",
    })
    csvstore.append("calls.csv", {
        "drill_uuid": "u1", "started_at": "2026-04-30T10:00:01", "status": "in_call",
    })
    csvstore.append("calls.csv", {
        "drill_uuid": "u1", "started_at": "2026-04-30T10:05:00", "status": "completed",
    })

    df = csvstore.read_latest_per("calls.csv", key_col="drill_uuid", order_col="started_at")
    assert len(df) == 1
    assert df.iloc[0]["status"] == "completed"


# ── A6-T8 ─────────────────────────────────────────────────────


def test_lists_and_dicts_serialise_as_json(fresh_csvs):
    csvstore.append("audit_log.csv", {
        "action": "test", "payload_json": {"k": "v", "n": 1, "list": [1, 2, 3]},
    })
    df = csvstore.read_all("audit_log.csv")
    import json
    assert json.loads(df.iloc[0]["payload_json"]) == {"k": "v", "n": 1, "list": [1, 2, 3]}


def test_newlines_stripped(fresh_csvs):
    csvstore.append("audit_log.csv", {"action": "weird", "target": "line1\nline2\nline3"})
    df = csvstore.read_all("audit_log.csv")
    assert "\n" not in df.iloc[0]["target"]
    assert "line1" in df.iloc[0]["target"] and "line3" in df.iloc[0]["target"]
