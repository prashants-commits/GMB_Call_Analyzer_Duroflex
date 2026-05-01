"""C1/C2/C4/C6/C7 — Persona library tests with mocked Gemini."""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from trainer import auth, csvstore
from trainer.router import router as trainer_router
from trainer.personas import (
    schema as ps,
    signature as psig,
    synthesise as psyn,
    diversity as pdiv,
    store as pstore,
    picker as ppick,
)
from trainer.personas.orchestrator import PersonaGenerationError, generate_library
from trainer.swot.gemini_client import GeminiCall


# ── Canned mocks ────────────────────────────────────────────────────────────


def _signature_canned(idx: int) -> dict:
    """Cycle through diverse signatures so the synthesis prompt has a real
    variety to cluster from."""
    languages = ["english_only", "hinglish", "regional_dominant", "english_dominant_hindi"]
    age_bands = ["26_35", "36_45", "46_55", "56_plus"]
    decision_roles = ["self", "spouse", "parent", "household_head"]
    return {
        "clean_number": f"90000{idx:05d}",
        "language": languages[idx % len(languages)],
        "regional_origin": ["Mumbai", "Chennai", "Bengaluru", "Hyderabad"][idx % 4],
        "gender_hint": "female" if idx % 2 == 0 else "male",
        "age_band": age_bands[idx % len(age_bands)],
        "income_band": ["budget", "mid", "premium", "luxury"][idx % 4],
        "brand_recall_strength": ["none", "weak", "strong", "loyalist"][idx % 4],
        "product_pref_keywords": ["king-size", "back-pain"],
        "urgency": ["low", "medium", "high"][idx % 3],
        "price_sensitivity": ["low", "medium", "high"][idx % 3],
        "decision_role": decision_roles[idx % len(decision_roles)],
        "objections_emitted": ["price-too-high"],
        "hooks_responded_to": ["weekend-discount"],
    }


def _synthesis_canned(k: int) -> dict:
    diff_bands = ["easy", "medium", "medium", "hard"]
    languages = ["english_only", "hinglish", "regional_dominant", "english_dominant_hindi"]
    decision_roles = ["self", "spouse", "parent", "household_head"]
    age_bands = ["26_35", "36_45", "46_55", "56_plus"]
    return {
        "personas": [
            {
                "persona_id": f"P-test-{i:02d}",
                "name": f"Test Persona {i}",
                "summary": f"Synthetic persona #{i} for testing.",
                "opening_line_hint": "Hi, I'm looking for a mattress.",
                "language_mix": languages[i % len(languages)],
                "voice_profile": "warm_chatty",
                "age_band": age_bands[i % len(age_bands)],
                "gender_hint": "female" if i % 2 == 0 else "male",
                "income_band": ["budget", "mid", "premium", "luxury"][i % 4],
                "decision_role": decision_roles[i % len(decision_roles)],
                "urgency_profile": "medium",
                "price_sensitivity": "medium",
                "brand_affinity": "weak",
                "difficulty_band": diff_bands[i % len(diff_bands)],
                "target_skill_focus": ["needs_discovery", "objection_handling"],
                "objections_likely": ["price-too-high"],
                "hooks_to_try": ["weekend-discount"],
                "surprise_pivot": None,
                "backstory": "",
            }
            for i in range(k)
        ],
        "notes": None,
    }


@pytest.fixture
def patch_persona_gemini(monkeypatch):
    counters = {"sig_calls": 0, "synth_calls": 0}

    def fake_call(model: str, prompt: str, **kwargs) -> GeminiCall:
        if "synthesise EXACTLY" in prompt:
            counters["synth_calls"] += 1
            # Extract requested k from the prompt header.
            import re
            m = re.search(r"synthesise EXACTLY (\d+) distinct", prompt)
            k = int(m.group(1)) if m else 8
            return GeminiCall(text=json.dumps(_synthesis_canned(k)),
                              input_tokens=4000, output_tokens=2000)
        # Per-call signature
        counters["sig_calls"] += 1
        return GeminiCall(text=json.dumps(_signature_canned(counters["sig_calls"])),
                          input_tokens=800, output_tokens=200)

    from trainer.swot import gemini_client as _gc
    monkeypatch.setattr(_gc, "call_text_model", fake_call)
    monkeypatch.setattr(psig, "call_text_model", fake_call)
    monkeypatch.setattr(psyn, "call_text_model", fake_call)
    return counters


@pytest.fixture
def fake_corpus(monkeypatch):
    """Minimal in-memory CallDataStore with rich enough text to pass the
    MIN_TRANSCRIPT_CHARS gate."""
    LONG_TEXT = "Customer wants a king-size mattress under 30k. " * 10  # > 200 chars

    class FakeStore:
        def __init__(self):
            self._calls = [
                {
                    "clean_number": f"90000{i:05d}",
                    "store_name": "COCO INDIRANAGAR",
                    "call_date": f"2026-04-{(i % 28) + 1:02d} 10:00:00",
                }
                for i in range(60)
            ]

        def get_analytics_data(self):
            return self._calls

        def get_insight_columns(self, clean_numbers):
            wanted = set(clean_numbers)
            return [
                {
                    "Clean Number": c["clean_number"],
                    "Store Name": c["store_name"],
                    "Call Summary": LONG_TEXT,
                    "Customer Needs": LONG_TEXT,
                    "Agent Bad": LONG_TEXT,
                    "Brand Bad": LONG_TEXT,
                }
                for c in self._calls if c["clean_number"] in wanted
            ]

    fake = FakeStore()
    from trainer import bootstrap
    monkeypatch.setattr(bootstrap, "_call_data_store", fake)
    return fake


# ── C1 unit ─────────────────────────────────────────────────────────────────


def test_extract_signatures_skips_short_transcripts(patch_persona_gemini, fresh_csvs):
    calls = [
        {"Clean Number": "1", "Call Summary": "x", "Customer Needs": "y"},  # too short
        {"Clean Number": "2", "Call Summary": "long " * 50, "Customer Needs": "long " * 50},
    ]
    out = psig.extract_signatures(calls)
    assert out.skipped == 1
    assert len(out.signatures) == 1


def test_latest_calls_for_signatures(fake_corpus, fresh_csvs):
    rows = psig.latest_calls_for_signatures(20)
    assert len(rows) == 20


# ── C2 + diversity ──────────────────────────────────────────────────────────


def test_synthesise_returns_k_personas(patch_persona_gemini):
    sigs = [ps.PersonaSignature.model_validate(_signature_canned(i)) for i in range(20)]
    out = psyn.synthesise_personas(sigs, k=8)
    assert len(out.personas) == 8
    assert all(isinstance(p, ps.Persona) for p in out.personas)


def test_synthesise_rejects_too_small_k(patch_persona_gemini):
    sigs = [ps.PersonaSignature.model_validate(_signature_canned(i)) for i in range(10)]
    with pytest.raises(psyn.SynthesisError):
        psyn.synthesise_personas(sigs, k=2)


def test_diversity_passes_minimums_with_seed(monkeypatch):
    seed_path = Path(__file__).resolve().parent.parent.parent / "trainer" / "personas" / "seed_library.json"
    data = json.loads(seed_path.read_text(encoding="utf-8"))
    lib = ps.PersonaLibrary.model_validate(data)
    coverage = pdiv.compute_coverage(lib.personas)
    assert coverage.passes_minimums()


# ── Orchestrator ────────────────────────────────────────────────────────────


def test_orchestrator_happy_path(patch_persona_gemini, fake_corpus, fresh_csvs):
    library = generate_library(n_calls=20, k_personas=8)
    assert library.status == "draft"
    assert len(library.personas) == 8
    assert library.cost_inr > 0
    # Draft persisted.
    draft = pstore.load_draft()
    assert draft is not None
    assert len(draft.personas) == 8


def test_orchestrator_too_few_calls_raises(patch_persona_gemini, fake_corpus, fresh_csvs):
    with pytest.raises(PersonaGenerationError):
        generate_library(n_calls=4)  # below the 5-call minimum


# ── Store: save/publish/version ──────────────────────────────────────────────


def test_publish_promotes_draft_to_v1(patch_persona_gemini, fake_corpus, fresh_csvs):
    generate_library(n_calls=10, k_personas=4)
    published = pstore.publish_draft(actor_staff_id="STF-ADMIN", actor_email="admin@x.com")
    assert published.version == 1
    assert published.status == "published"
    assert pstore.load_published().version == 1
    # Second publish bumps to v2 (draft is still there).
    published2 = pstore.publish_draft(actor_staff_id="STF-ADMIN")
    assert published2.version == 2
    assert pstore.list_published_versions() == [1, 2]


def test_publish_without_draft_raises(fresh_csvs):
    with pytest.raises(FileNotFoundError):
        pstore.publish_draft(actor_staff_id="STF-ADMIN")


# ── Picker (C7) ──────────────────────────────────────────────────────────────


def _publish_seed(fresh_csvs):
    """Helper: install the bundled seed library as the published library."""
    seed_path = Path(__file__).resolve().parent.parent.parent / "trainer" / "personas" / "seed_library.json"
    lib = ps.PersonaLibrary.model_validate(json.loads(seed_path.read_text(encoding="utf-8")))
    pstore.save_draft(lib, actor_staff_id="seed")
    pstore.publish_draft(actor_staff_id="seed")


def test_picker_unpublished_raises(fresh_csvs, write_roster):
    with pytest.raises(ppick.PickerError):
        ppick.pick_persona(staff_id="STF-0001", store_name="COCO INDIRANAGAR")


def test_picker_returns_persona(fresh_csvs, write_roster):
    _publish_seed(fresh_csvs)
    persona, why = ppick.pick_persona(
        staff_id="STF-0001",
        store_name="COCO INDIRANAGAR",
        today=date(2025, 6, 1),  # Priya joined 2025-01-15 → not new joiner
    )
    assert isinstance(persona, ps.Persona)
    assert why["strategy"] in ("uniform", "swot_biased")


def test_picker_new_joiner_forced_easy(fresh_csvs, write_roster):
    _publish_seed(fresh_csvs)
    # STF-0003 (Anita K) joined 2026-04-10 → new joiner on 2026-05-01.
    import random
    persona, why = ppick.pick_persona(
        staff_id="STF-0003",
        store_name="COCO INDIRANAGAR",
        today=date(2026, 5, 1),
        rng=random.Random(42),
    )
    assert persona.difficulty_band == "easy"
    assert why["strategy"] == "new_joiner_easy"


# ── Router endpoints ─────────────────────────────────────────────────────────


@pytest.fixture
def persona_client(fresh_csvs, sample_roster_csv, monkeypatch, patch_persona_gemini, fake_corpus):
    roster_path = fresh_csvs["data"] / "staff_roster.csv"
    roster_path.write_text(sample_roster_csv, encoding="utf-8")
    monkeypatch.setattr(auth, "TRAINER_ADMIN_EMAILS", ["admin@duroflexworld.com"])
    fresh_csvs["mapping"].parent.mkdir(parents=True, exist_ok=True)
    fresh_csvs["mapping"].write_text(
        json.dumps({"BLR": ["COCO INDIRANAGAR"]}),
        encoding="utf-8",
    )
    app = FastAPI()
    app.include_router(trainer_router)
    return TestClient(app)


def _login(client, staff_id, email=""):
    return client.post("/api/trainer/auth/login", json={"staff_id": staff_id, "email": email})


def test_personas_endpoint_empty_when_unpublished(persona_client):
    _login(persona_client, "STF-0001")
    res = persona_client.get("/api/trainer/personas")
    assert res.status_code == 200
    body = res.json()
    assert body["library"] is None
    assert body["personas"] == []


def test_admin_seed_then_publish(persona_client):
    _login(persona_client, "STF-0002", email="admin@duroflexworld.com")

    res = persona_client.post("/api/trainer/admin/personas/seed")
    assert res.status_code == 200
    assert "personas" in res.json()["library"]

    res = persona_client.post("/api/trainer/admin/personas/publish")
    assert res.status_code == 200
    assert res.json()["library"]["version"] == 1

    # Public listing now shows it.
    res = persona_client.get("/api/trainer/personas")
    body = res.json()
    assert body["library"]["version"] == 1
    assert body["library"]["persona_count"] >= 8


def test_admin_seed_403_for_staff(persona_client):
    _login(persona_client, "STF-0001")  # role=staff
    res = persona_client.post("/api/trainer/admin/personas/seed")
    assert res.status_code == 403


def test_admin_publish_409_when_no_draft(persona_client):
    _login(persona_client, "STF-0002", email="admin@duroflexworld.com")
    res = persona_client.post("/api/trainer/admin/personas/publish")
    assert res.status_code == 409


def test_pick_returns_persona_after_publish(persona_client):
    _login(persona_client, "STF-0002", email="admin@duroflexworld.com")
    persona_client.post("/api/trainer/admin/personas/seed")
    persona_client.post("/api/trainer/admin/personas/publish")
    _login(persona_client, "STF-0001")  # plain staff
    res = persona_client.post("/api/trainer/personas/pick", json={})
    assert res.status_code == 200
    body = res.json()
    assert "persona" in body
    assert "why" in body


def test_pick_503_when_no_library(persona_client):
    _login(persona_client, "STF-0001")
    res = persona_client.post("/api/trainer/personas/pick", json={})
    assert res.status_code == 503
