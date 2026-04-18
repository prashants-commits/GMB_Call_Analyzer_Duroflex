"""
FastAPI backend for GMB Calls Analyzer v3.
Serves call data from CSV via REST API.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from csv_parser import CallDataStore

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


@app.get("/api/health")
def health():
    return {"status": "ok", "calls_loaded": len(store.get_all_summaries())}
