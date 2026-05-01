"""B2/B3/B4 test cases — SWOT pipeline with mocked Gemini.

We never hit the real Gemini API in these tests. ``call_text_model`` is
monkey-patched to return canned JSON so the pipeline can be exercised
deterministically.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from trainer import auth, config, csvstore
from trainer.router import router as trainer_router
from trainer.swot import cache as swot_cache
from trainer.swot import gemini_client, input_adapter, jobs, orchestrator
from trainer.swot.gemini_client import GeminiCall


# ── Stage-1 mock canned response ─────────────────────────────────────────────


def _stage1_canned(batch_index: int) -> str:
    return json.dumps({
        "strengths": [
            {
                "theme": f"Strong product knowledge (batch {batch_index})",
                "detail": "Agents quote the right specs without prompting.",
                "evidence": [{"clean_number": "9999999999", "quote": "Agent confidently described coil count"}],
            }
        ],
        "weaknesses": [
            {
                "theme": f"Weak follow-up cadence (batch {batch_index})",
                "detail": "Customers leave the call without a clear next step.",
                "evidence": [],
            }
        ],
        "opportunities": [],
        "threats": [],
    })


def _stage2_canned() -> str:
    return json.dumps({
        "strengths": [
            {
                "theme": "Strong product knowledge",
                "detail": "Across batches, agents demonstrate confident command of mattress specs.",
                "severity": "low",
                "evidence_count": 3,
                "representative_quotes": ["Agent confidently described coil count"],
            }
        ],
        "weaknesses": [
            {
                "theme": "Weak follow-up cadence",
                "detail": "Calls end without a clear next step in 60% of analysed cases.",
                "severity": "high",
                "evidence_count": 5,
                "representative_quotes": [],
            }
        ],
        "opportunities": [],
        "threats": [],
        "notes": None,
    })


@pytest.fixture
def patch_gemini(monkeypatch):
    """Replace gemini_client.call_text_model with a deterministic stub.

    Stage-1 prompts (which contain "Strengths/Weaknesses" structure for a
    batch) get the per-batch canned reply; Stage-2 prompts (containing
    "synthesising a Store SWOT") get the merged reply.
    """
    counters = {"stage1_calls": 0, "stage2_calls": 0}

    def fake_call(model: str, prompt: str, **kwargs) -> GeminiCall:
        if "synthesising a Store SWOT" in prompt:
            counters["stage2_calls"] += 1
            return GeminiCall(text=_stage2_canned(), input_tokens=2000, output_tokens=400)
        counters["stage1_calls"] += 1
        return GeminiCall(text=_stage1_canned(counters["stage1_calls"]), input_tokens=5000, output_tokens=500)

    monkeypatch.setattr(gemini_client, "call_text_model", fake_call)
    # Also patch the references inside the stage modules — they imported the
    # name at import-time.
    from trainer.swot import stage1_map, stage2_reduce
    monkeypatch.setattr(stage1_map, "call_text_model", fake_call)
    monkeypatch.setattr(stage2_reduce, "call_text_model", fake_call)
    return counters


@pytest.fixture
def fake_call_data_store(monkeypatch):
    """Stub out CallDataStore with synthetic per-store calls so input_adapter
    has something to read without loading the real 2620-row CSV."""

    class FakeStore:
        def __init__(self):
            self._calls = [
                {
                    "clean_number": f"90000{i:05d}",
                    "store_name": "COCO ANNA NAGAR" if i < 80 else "COCO HSR",
                    "call_date": f"2026-04-{(i % 28) + 1:02d} 10:00:00",
                }
                for i in range(120)
            ]

        def get_analytics_data(self):
            return self._calls

        def get_insight_columns(self, clean_numbers):
            wanted = set(clean_numbers)
            return [
                {
                    "Clean Number": c["clean_number"],
                    "Store Name": c["store_name"],
                    "Agent Good": "Knowledgeable",
                    "Agent Bad": "Did not follow up",
                    "Brand Good": "Comfortable mattresses",
                    "Brand Bad": "Pricing perceived high",
                    "Customer Needs": "Looking for back support",
                    "Call Summary": f"Call summary {c['clean_number']}",
                    "Agent NPS": 8,
                    "Brand NPS": 7,
                    "Purchase Barrier": "Price",
                }
                for c in self._calls if c["clean_number"] in wanted
            ]

    fake = FakeStore()
    from trainer import bootstrap
    monkeypatch.setattr(bootstrap, "_call_data_store", fake)
    return fake


# ── B1 input adapter ─────────────────────────────────────────────────────────


def test_input_adapter_returns_top_n_for_store(fake_call_data_store, fresh_csvs):
    rows = input_adapter.latest_calls_for_store("COCO ANNA NAGAR", n=50)
    assert len(rows) == 50
    assert all(r["Store Name"] == "COCO ANNA NAGAR" for r in rows)


def test_input_adapter_unknown_store_returns_empty(fake_call_data_store, fresh_csvs):
    assert input_adapter.latest_calls_for_store("DOES NOT EXIST") == []


def test_input_adapter_rejects_oversized_n(fake_call_data_store, fresh_csvs):
    with pytest.raises(ValueError):
        input_adapter.latest_calls_for_store("COCO ANNA NAGAR", n=300)


def test_chunk_into_batches_splits_evenly():
    batches = input_adapter.chunk_into_batches(list(range(45)), batch_size=20)
    assert [len(b) for b in batches] == [20, 20, 5]


# ── B2/B3 end-to-end via orchestrator ────────────────────────────────────────


def test_orchestrator_happy_path(patch_gemini, fake_call_data_store, fresh_csvs):
    report = orchestrator.generate_swot("COCO ANNA NAGAR", n=60)

    assert report.store_name == "COCO ANNA NAGAR"
    assert report.input_call_count == 60
    assert len(report.strengths) == 1
    assert len(report.weaknesses) == 1
    assert report.weaknesses[0].severity == "high"
    # Cost = stage1 (3 batches × cost) + stage2 (1 × cost). Just sanity-check it's > 0.
    assert report.cost_inr > 0

    # Stage1 was called 3 times (60 / 20) and Stage2 once.
    assert patch_gemini["stage1_calls"] == 3
    assert patch_gemini["stage2_calls"] == 1

    # Cache row written.
    cached = swot_cache.get_cached("COCO ANNA NAGAR")
    assert cached is not None
    assert cached.store_name == "COCO ANNA NAGAR"


def test_orchestrator_no_calls_for_store_records_failure(patch_gemini, fake_call_data_store, fresh_csvs):
    from trainer.swot import SWOTGenerationError
    with pytest.raises(SWOTGenerationError) as exc:
        orchestrator.generate_swot("COCO MARS")
    assert "No calls" in str(exc.value)

    # Failure landed in cache as status='failed'.
    df = csvstore.read_filtered("swot_cache.csv", store_name="COCO MARS")
    assert len(df) == 1
    assert df.iloc[0]["status"] == "failed"


def test_orchestrator_handles_invalid_json_from_stage1(monkeypatch, fake_call_data_store, fresh_csvs):
    """Stage-1 returning malformed JSON → SWOTGenerationError stage='stage1', cache row 'failed'."""
    from trainer.swot import SWOTGenerationError, gemini_client, stage1_map

    def bad_call(model, prompt, **kwargs):
        return GeminiCall(text="not-json {{", input_tokens=100, output_tokens=10)

    monkeypatch.setattr(gemini_client, "call_text_model", bad_call)
    monkeypatch.setattr(stage1_map, "call_text_model", bad_call)

    with pytest.raises(SWOTGenerationError) as exc:
        orchestrator.generate_swot("COCO ANNA NAGAR", n=20)
    assert exc.value.stage == "stage1"

    df = csvstore.read_filtered("swot_cache.csv", store_name="COCO ANNA NAGAR")
    assert (df["status"] == "failed").any()


# ── B4 cache ─────────────────────────────────────────────────────────────────


def test_cache_returns_latest_ok_row(fresh_csvs):
    from trainer.swot.schema import SWOTReport

    report = SWOTReport(
        store_name="COCO ANNA NAGAR",
        generated_at=datetime.now(timezone.utc),
        input_call_count=42,
        model_map="m1",
        model_reduce="m2",
        cost_inr=1.5,
        strengths=[],
        weaknesses=[],
        opportunities=[],
        threats=[],
    )
    swot_cache.put_cache(report)
    cached = swot_cache.get_cached("COCO ANNA NAGAR")
    assert cached is not None
    assert cached.input_call_count == 42


def test_cache_skips_failed_rows(fresh_csvs):
    swot_cache.put_failure("COCO ANNA NAGAR", "boom")
    assert swot_cache.get_cached("COCO ANNA NAGAR") is None


def test_list_cached_returns_latest_per_store(fresh_csvs):
    from trainer.swot.schema import SWOTReport

    for store in ("COCO ANNA NAGAR", "COCO HSR"):
        for n in (1, 2, 3):
            swot_cache.put_cache(
                SWOTReport(
                    store_name=store,
                    generated_at=datetime.now(timezone.utc),
                    input_call_count=n * 10,
                    model_map="m1",
                    model_reduce="m2",
                    cost_inr=0.0,
                )
            )

    items = swot_cache.list_cached()
    assert len(items) == 2
    by_name = {x["store_name"]: x for x in items}
    # Latest = the n=3 row → 30 calls.
    assert by_name["COCO ANNA NAGAR"]["input_call_count"] == 30
    assert by_name["COCO HSR"]["input_call_count"] == 30


# ── Router endpoints ─────────────────────────────────────────────────────────


@pytest.fixture
def swot_client(fresh_csvs, sample_roster_csv, monkeypatch, patch_gemini, fake_call_data_store):
    roster_path = fresh_csvs["data"] / "staff_roster.csv"
    roster_path.write_text(sample_roster_csv, encoding="utf-8")
    monkeypatch.setattr(auth, "TRAINER_ADMIN_EMAILS", ["admin@duroflexworld.com"])
    fresh_csvs["mapping"].parent.mkdir(parents=True, exist_ok=True)
    fresh_csvs["mapping"].write_text(
        json.dumps({"BLR": ["COCO INDIRANAGAR"], "CHN": ["COCO ANNA NAGAR"]}),
        encoding="utf-8",
    )

    # Add COCO ANNA NAGAR-store rows to the fake data — staff_roster.csv has
    # only Bengaluru/Hyderabad stores, but the orchestrator pulls calls by
    # store_name so we just need the fake CallDataStore to know about it
    # (the fake_call_data_store fixture already does).

    app = FastAPI()
    app.include_router(trainer_router)
    return TestClient(app)


def _login(client, staff_id, email=""):
    return client.post("/api/trainer/auth/login", json={"staff_id": staff_id, "email": email})


def test_swot_endpoint_401_without_cookie(swot_client):
    res = swot_client.get("/api/trainer/swot")
    assert res.status_code == 401


def test_swot_get_creates_first_cache_entry(swot_client):
    _login(swot_client, "STF-0001")
    res = swot_client.get("/api/trainer/swot/COCO ANNA NAGAR")
    assert res.status_code == 200
    body = res.json()
    assert body["report"]["store_name"] == "COCO ANNA NAGAR"
    assert body["stale"] is False


def test_swot_get_serves_from_cache_on_second_call(swot_client, patch_gemini):
    _login(swot_client, "STF-0001")
    swot_client.get("/api/trainer/swot/COCO ANNA NAGAR")
    s1 = patch_gemini["stage1_calls"]
    s2 = patch_gemini["stage2_calls"]
    swot_client.get("/api/trainer/swot/COCO ANNA NAGAR")
    # No new Gemini calls — second request hit the cache.
    assert patch_gemini["stage1_calls"] == s1
    assert patch_gemini["stage2_calls"] == s2


def test_swot_refresh_403_for_staff(swot_client):
    _login(swot_client, "STF-0001")  # role=staff
    res = swot_client.post("/api/trainer/swot/COCO ANNA NAGAR/refresh")
    assert res.status_code == 403


def test_swot_refresh_202_for_manager(swot_client):
    _login(swot_client, "STF-0002")  # role=manager
    res = swot_client.post("/api/trainer/swot/COCO ANNA NAGAR/refresh")
    assert res.status_code == 202
    body = res.json()
    assert body["job"]["status"] in ("queued", "running", "completed")
    assert body["deduped"] is False


def test_swot_list_returns_summaries(swot_client):
    _login(swot_client, "STF-0001")
    # Generate one to populate cache.
    swot_client.get("/api/trainer/swot/COCO ANNA NAGAR")
    res = swot_client.get("/api/trainer/swot")
    assert res.status_code == 200
    items = res.json()["items"]
    assert any(i["store_name"] == "COCO ANNA NAGAR" for i in items)
