"""A8 test cases — audit log helper."""

from __future__ import annotations

import json
import time

from trainer import audit, csvstore


def test_audit_appends_one_row(fresh_csvs):
    audit.audit("STF-0001", "personas.publish", target="v1", payload={"foo": "bar"},
                actor_email="admin@duroflexworld.com")

    df = csvstore.read_all("audit_log.csv")
    assert len(df) == 1
    row = df.iloc[0]
    assert row["actor_staff_id"] == "STF-0001"
    assert row["actor_email"] == "admin@duroflexworld.com"
    assert row["action"] == "personas.publish"
    assert row["target"] == "v1"
    assert json.loads(row["payload_json"]) == {"foo": "bar"}


def test_payload_round_trip_with_commas_and_quotes(fresh_csvs):
    weird = {"sentence": 'Hello, "world", with commas', "n": 42, "list": [1, 2]}
    audit.audit("STF-0001", "x", target="t", payload=weird)
    df = csvstore.read_all("audit_log.csv")
    assert json.loads(df.iloc[0]["payload_json"]) == weird


def test_audit_never_raises_when_csvstore_explodes(fresh_csvs, monkeypatch):
    """Auditing failures must not break the action being audited."""

    def boom(*a, **k):
        raise RuntimeError("disk on fire")

    monkeypatch.setattr(csvstore, "append", boom)
    audit.audit("STF-0001", "x")  # must not raise


def test_read_recent_orders_descending(fresh_csvs):
    audit.audit("STF-1", "first")
    time.sleep(1.1)  # ts column has 1-second resolution
    audit.audit("STF-1", "second")
    time.sleep(1.1)
    audit.audit("STF-1", "third")
    rows = audit.read_recent(limit=10)
    actions = [r["action"] for r in rows]
    assert actions[0] == "third"
    assert actions[-1] == "first"


def test_read_recent_filter_by_action(fresh_csvs):
    audit.audit("STF-1", "personas.publish", target="v1")
    audit.audit("STF-1", "roster.uploaded", target="/x")
    audit.audit("STF-1", "personas.publish", target="v2")

    rows = audit.read_recent(limit=10, action="personas.publish")
    assert len(rows) == 2
    assert all(r["action"] == "personas.publish" for r in rows)


def test_read_recent_limit_respected(fresh_csvs):
    for i in range(20):
        audit.audit("STF-1", f"action.{i}")
    rows = audit.read_recent(limit=5)
    assert len(rows) == 5
