# Implementation Plan - Analytics Dashboard

This plan outlines the creation of a new "Analytics Dashboard" as the entry point of the application, along with the necessary backend and frontend updates to support it.

## User Review Required

> [!IMPORTANT]
> The hierarchy will change from `Listing -> Detail` to `Dashboard -> Listing -> Detail`. The Dashboard will now be the home page (`/`).

> [!NOTE]
> I will add a new backend endpoint `/api/analytics` to serve enriched summary data specifically for the dashboard, avoiding the overhead of fetching full transcripts and details for all calls.

## Proposed Changes

### Backend

#### [MODIFY] [csv_parser.py](file:///e:/AntiGravity/GMB%20Calls%20Analyzer%20v3/backend/csv_parser.py)
- Create `_build_analytics_summary(row)` to extract:
  - `clean_number`, `store_name`, `city`, `brand`
  - `call_type`, `call_date`
  - `intent_to_purchase` (`5_Purchase_Readiness_Score`)
  - `intent_to_visit` (`2_Intent_to_Visit_Store_Rating`)
  - `nps_agent` (`3a_Customer_Experience_Agent_NPS`)
  - `nps_brand` (`3b_Customer_Experience_Brand_NPS`)
  - `product_category` (`6_Product_Intelligence_Category`)
  - `price_bucket` (`MetaData_Customer_Income_Group`)
  - `relax_scores` (R, E, L, A, X from `16_RELAX_Framework`)
- Add `get_analytics_data()` to `CallDataStore` class.

#### [MODIFY] [main.py](file:///e:/AntiGravity/GMB%20Calls%20Analyzer%20v3/backend/main.py)
- Add `@app.get("/api/analytics")` endpoint.

---

### Frontend

#### [MODIFY] [api.js](file:///e:/AntiGravity/GMB%20Calls%20Analyzer%20v3/frontend/src/utils/api.js)
- Add `fetchAnalyticsRecord()` to fetch data from the new endpoint.

#### [NEW] [AnalyticsDashboard.jsx](file:///e:/AntiGravity/GMB%20Calls%20Analyzer%20v3/frontend/src/pages/AnalyticsDashboard.jsx)
- Implement the dashboard with:
  - **Filter Strip**: Store, Call Type, Intent to Purchase, Intent to Visit, NPS Agent, NPS Brand, Product Category.
  - **KPI Cards**: Total Calls, Sales Leads, Bad Calls.
  - **Purchase Intent x Agent NPS Matrix**: 
    - 3x3 Grid (High/Medium/Low Intent vs High/Medium/Low Agent NPS).
    - Cells clickable -> navigate to `/listing` with filtered state.
  - **Store Performance Matrix**: 
    - Table columns: Store Name, # Calls, # Bad Calls, Avg Agent NPS, Avg Brand NPS, RELAX scores.
  - **Price Bucket Performance Matrix**:
    - Based on `price_bucket` (Income Group).
- Logic for "Bad Calls": Intent = `HIGH` and (NPS Agent = `LOW` OR Experience Rating = `LOW`).

#### [MODIFY] [App.jsx](file:///e:/AntiGravity/GMB%20Calls%20Analyzer%20v3/frontend/src/App.jsx)
- Set `AnalyticsDashboard` as `/`.
- Move `CallListPage` to `/listing`.

#### [MODIFY] [CallListPage.jsx](file:///e:/AntiGravity/GMB%20Calls%20Analyzer%20v3/frontend/src/pages/CallListPage.jsx)
- Update `useEffect` to check for `location.state` for initial filter values (from Dashboard clicks).
- Add "Go back to Dashboard" button/link.

## Open Questions

- **RELAX Scores Calculation**: The reference code calculates a numeric average (1-10) from H/M/L scores. Our backend `csv_parser` currently maps scores to labels. I'll implement a mapping to recover numeric values for averaging in the dashboard. Is this acceptable?
- **Bad Call Definition**: I have defined it as "High Purchase Intent but Low Agent NPS/Customer Experience". Does this match your expectation?

## Verification Plan

### Automated Tests
- N/A (Manual verification via Browser)

### Manual Verification
1. Open the application (Home page should be Dashboard).
2. Verify KPIs update correctly based on filters.
3. Click a Matrix cell (e.g., High Intent x Low Agent NPS) and ensure it navigates to the listing page showing only those calls.
4. Verify Store Performance and Price Bucket tables show accurate counts and averages.
5. Verify filters (Store, Intent to Visit, etc.) correctly filter all dashboard components.
