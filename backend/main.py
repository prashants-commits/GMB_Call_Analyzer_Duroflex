"""
FastAPI backend for GMB Calls Analyzer v3.
Serves call data from CSV via REST API.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

from csv_parser import CallDataStore
from gemini_service import generate_insights

app = FastAPI(title="GMB Calls Analyzer v3", version="1.0.0")

# CORS - allow all frontend origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load data at startup
store = CallDataStore()

# ── AI Trainer subsystem (segregated; off by default) ────────────────────────
# All trainer code lives under backend/trainer/. Mounted only when
# TRAINER_ENABLED=true in .env. See AITrainer_TechPlan_v1.md A1+A2.
from trainer.config import TRAINER_ENABLED  # noqa: E402

if TRAINER_ENABLED:
    from trainer.bootstrap import on_startup as _trainer_on_startup  # noqa: E402
    from trainer.router import router as _trainer_router, ws_router as _trainer_ws_router  # noqa: E402

    _trainer_on_startup(call_data_store=store)
    app.include_router(_trainer_router)
    app.include_router(_trainer_ws_router)


# ── Request models ────────────────────────────────────────────────────────────

class InsightRequest(BaseModel):
    clean_numbers: List[str]
    segment_description: str = "All segments"
    date_range: str = "Full range"
    custom_question: Optional[str] = ""
    clean_numbers_b: Optional[List[str]] = None
    segment_description_b: Optional[str] = None
    date_range_b: Optional[str] = None


class ExportRequest(BaseModel):
    clean_numbers: List[str]
    date_range: str = "Full range"
    custom_question: Optional[str] = ""
    clean_numbers_b: Optional[List[str]] = None
    segment_description_b: Optional[str] = None
    date_range_b: Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/api/calls")
def list_calls():
    """Return summary list of all calls for the listing page."""
    summaries = store.get_all_summaries()
    return {
        "total": len(summaries),
        "calls": summaries,
        "filters": {
            "stores": store.get_unique_stores(),
            "cities": store.get_unique_cities(),
        },
    }


@app.get("/api/analytics")
def get_analytics():
    """Return enriched analytics data for the dashboard."""
    data = store.get_analytics_data()
    return {
        "total": len(data),
        "reports": data,
        "filters": {
            "stores": store.get_unique_stores(),
            "product_categories": sorted(list(set(r["product_category"] for r in data if r["product_category"]))),
        }
    }


@app.get("/api/calls/{clean_number}")
def get_call_detail(clean_number: str):
    """Return full detail JSON for a single call."""
    detail = store.get_detail(clean_number)
    if not detail:
        raise HTTPException(status_code=404, detail=f"Call not found: {clean_number}")
    return detail


@app.post("/api/generate-insights")
async def generate_insights_endpoint(request: InsightRequest):
    """
    Accept filtered call IDs, extract insight columns, send to Gemini,
    and return the structured executive report.
    """
    # Validate cap
    if len(request.clean_numbers) > 250:
        raise HTTPException(
            status_code=400,
            detail="Maximum 250 calls allowed per insight generation. Please narrow your filters."
        )

    if len(request.clean_numbers) == 0:
        raise HTTPException(
            status_code=400,
            detail="No calls selected. Please adjust your filters."
        )

    # Extract the specific columns for Gemini
    call_data_a = store.get_insight_columns(request.clean_numbers)

    if not call_data_a:
        raise HTTPException(
            status_code=404,
            detail="No matching call data found for Dataset A."
        )

    call_data_b = None
    if request.clean_numbers_b is not None:
        if len(request.clean_numbers_b) > 250:
            raise HTTPException(
                status_code=400,
                detail="Maximum 250 calls allowed for Dataset B. Please narrow your filters."
            )
        if len(request.clean_numbers_b) == 0:
            raise HTTPException(
                status_code=400,
                detail="No calls selected for Dataset B. Please adjust your filters."
            )
        call_data_b = store.get_insight_columns(request.clean_numbers_b)

    try:
        result = await generate_insights(
            call_data=call_data_a,
            segment_description=request.segment_description,
            date_range=request.date_range,
            custom_question=request.custom_question,
            call_data_b=call_data_b,
            segment_description_b=request.segment_description_b,
            date_range_b=request.date_range_b
        )
        return {"status": "success", "report": result}
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini API error: {str(e)}")


@app.post("/api/export-calls")
def export_calls(request: ExportRequest):
    """Return raw CSV rows for the requested calls."""
    # Prevent giant requests if necessary, but returning JSON for 2000 calls is generally fine.
    # ~2000 calls * ~2KB per call = ~4MB JSON response, which is reasonable.
    rows = store.get_raw_rows(request.clean_numbers)
    return {"data": rows}


@app.get("/api/health")
def health():
    return {"status": "ok", "calls_loaded": len(store.get_all_summaries())}


# ── SWOT Reports (combined Insights-side view) ─────────────────────────────
# These endpoints share the SAME ``backend/data/trainer/swot_cache.csv``
# that the AI Trainer's per-store SWOT view writes to. A refresh from
# either UI is visible to the other immediately. Available only when the
# trainer subsystem is enabled (TRAINER_ENABLED=true) since the underlying
# generator + cache live there.

if TRAINER_ENABLED:
    from trainer.swot import (  # noqa: E402
        cache as _swot_cache,
        generate_swot as _swot_generate,
        SWOTGenerationError as _SWOTGenerationError,
    )
    from trainer.swot.input_adapter import stores_for_city as _stores_for_city  # noqa: E402
    import json as _json  # noqa: E402

    # Pilot cities for the new Insights-side SWOT Reports page. Must match
    # keys in backend/data/city_store_mapping.json.
    PILOT_CITIES = ["Bengaluru", "Hyderabad", "Chennai", "Mumbai", "Delhi NCR"]

    # Insights-side SWOT default: mattress_only. The toggle on the SWOT
    # Reports page lets users flip to all_calls. The AI Trainer side is
    # hard-coded to mattress_only in trainer/router.py.
    _INSIGHTS_DEFAULT_VERSION = "mattress_only"
    _ALLOWED_VERSIONS = ("all_calls", "mattress_only")

    class _SwotRefreshRequest(BaseModel):
        scope: str  # "city" or "store"
        name: str
        version: Optional[str] = None  # "all_calls" or "mattress_only"; defaults to mattress_only

    @app.get("/api/swot-reports/options")
    def swot_reports_options():
        """List the cities + stores available on the SWOT Reports page.

        Cities come from the pilot allow-list; stores come from the call
        data corpus (any store with at least one call).
        """
        all_stores = sorted(store.get_unique_stores())
        # Only surface cities that actually have a mapping entry.
        cities = [c for c in PILOT_CITIES if _stores_for_city(c)]
        return {
            "cities": cities,
            "stores": all_stores,
            "versions": list(_ALLOWED_VERSIONS),
            "default_version": _INSIGHTS_DEFAULT_VERSION,
        }

    @app.get("/api/swot-reports/{scope}/{name}")
    def get_swot_report(scope: str, name: str, version: Optional[str] = None):
        """Read the latest cached SWOT for (scope, name, version). 404 if
        missing. ``version`` query param defaults to mattress_only."""
        if scope not in ("city", "store"):
            raise HTTPException(status_code=400, detail="scope must be 'city' or 'store'")
        v = version or _INSIGHTS_DEFAULT_VERSION
        if v not in _ALLOWED_VERSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"version must be one of {_ALLOWED_VERSIONS}",
            )
        report = _swot_cache.get_cached(name, scope=scope, version=v)
        if report is None:
            raise HTTPException(
                status_code=404,
                detail={"reason": "not_generated", "scope": scope, "name": name, "version": v},
            )
        return {
            "scope": scope,
            "name": name,
            "version": v,
            "stale": _swot_cache.is_stale(report),
            "report": report.model_dump(mode="json"),
        }

    @app.post("/api/swot-reports/refresh")
    def refresh_swot_report(request: _SwotRefreshRequest):
        """Synchronously regenerate the SWOT for (scope, name, version).

        Open to anyone logged into the analyzer (matches the Q5 default —
        the analyzer's static admin/admin login means everyone IS admin).
        Returns the fresh report on success. Per spec, only the currently-
        selected version is regenerated (the other version stays cached).
        """
        if request.scope not in ("city", "store"):
            raise HTTPException(status_code=400, detail="scope must be 'city' or 'store'")
        v = request.version or _INSIGHTS_DEFAULT_VERSION
        if v not in _ALLOWED_VERSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"version must be one of {_ALLOWED_VERSIONS}",
            )
        try:
            report = _swot_generate(
                request.name,
                scope=request.scope,
                version=v,
                actor_email="insights-analyzer",
            )
        except _SWOTGenerationError as exc:
            raise HTTPException(status_code=500, detail=f"{exc.stage}: {exc.reason}")
        return {
            "scope": request.scope,
            "name": request.name,
            "version": v,
            "stale": False,
            "report": report.model_dump(mode="json"),
        }
