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
