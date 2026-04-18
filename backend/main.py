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


# ── Request models ────────────────────────────────────────────────────────────

class InsightRequest(BaseModel):
    clean_numbers: List[str]
    segment_description: str = "All segments"
    date_range: str = "Full range"


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
    if len(request.clean_numbers) > 100:
        raise HTTPException(
            status_code=400,
            detail="Maximum 100 calls allowed per insight generation. Please narrow your filters."
        )

    if len(request.clean_numbers) == 0:
        raise HTTPException(
            status_code=400,
            detail="No calls selected. Please adjust your filters."
        )

    # Extract the specific columns for Gemini
    call_data = store.get_insight_columns(request.clean_numbers)

    if not call_data:
        raise HTTPException(
            status_code=404,
            detail="No matching call data found for the provided IDs."
        )

    try:
        result = await generate_insights(
            call_data=call_data,
            segment_description=request.segment_description,
            date_range=request.date_range
        )
        return {"status": "success", "report": result}
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini API error: {str(e)}")


@app.get("/api/health")
def health():
    return {"status": "ok", "calls_loaded": len(store.get_all_summaries())}
