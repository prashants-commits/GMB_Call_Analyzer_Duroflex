# GMB Calls Analyzer v3 — Implementation Plan

## Project Overview

Build a **FastAPI + React (Vite)** web application for the Duroflex GMB Calls Analyzer with two core views:

1. **Call Listing Page** — Tabular view of all calls with filters, linking to individual detail pages.
2. **Call Details Page** — Rich, multi-section analysis page (modeled after the reference HTML) for each call.

**Data source**: `GMB Calls Analyzer - Call details (sample).csv` (49 rows × 134 columns).  
**Unique ID**: `CleanNumber` (Customer Phone Number, column index 2).  
**Persistence**: Re-read CSV on every server startup (no persistent DB).  
**Analysis data**: Only use what exists in the CSV — no AI generation.

---

## 1. Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | **FastAPI** (Python) |
| Frontend | **React** (Vite) + **TailwindCSS** (matching reference HTML) |
| Routing | `react-router-dom` v6 |
| Data | In-memory — CSV parsed at startup into a Python list of dicts |
| Fonts | DM Sans + Fraunces (Google Fonts, same as reference) |

---

## 2. CSV Column Map (134 columns)

### Core / Identity (Columns 0–14)

| Index | CSV Column | Purpose |
|-------|-----------|---------|
| 0 | `Brand` | Brand name (e.g. "Duroflex") |
| 1 | `Store Name` | Store name |
| 2 | `CleanNumber` | **Primary Key** — Customer phone number |
| 3 | `CallDateTime` | Call date/time |
| 4 | `Duration` | Duration in seconds |
| 5 | `Recording URL` | Audio file URL for "Listen to Call" button |
| 6 | `Locality` | Store locality |
| 7 | `City` | Store city |
| 8 | `State` | Store state |
| 9 | `Dtmf label` | DTMF label / call classification |
| 10 | `is_Converted` | Conversion flag (0/1) |
| 11 | `Revenue` | Revenue amount |
| 12 | `Products_purchased` | Products purchased |
| 13 | `Call Type` | Call type (e.g. "PRE_PURCHASE") |
| 14 | `Transcript_Log` | Full transcript text |

### Customer Metadata (Columns 15–23)

| Index | CSV Column | UI Section |
|-------|-----------|-----------|
| 15 | `MetaData_Customer_Name` | Customer Name |
| 16 | `MetaData_Customer_Location` | Customer Location |
| 17 | `MetaData_Customer_Language` | Language |
| 18 | `MetaData_Customer_Gender` | Gender |
| 19 | `MetaData_Customer_Age_Group` | Age Group |
| 20 | `MetaData_Customer_Income_Group` | Income Group |
| 21 | `MetaData_Customer_Persona` | Persona |
| 22 | `MetaData_Call_Quality_Overall` | Overall Call Quality score |
| 23 | `MetaData_Customer_Enthusiasm` | Customer Enthusiasm score |

### Call Summary & Objective (Columns 24–27)

| Index | CSV Column | UI Section |
|-------|-----------|-----------|
| 24 | `Call_Summary` | Call Summary paragraph |
| 25 | `1_Call_Objective_Type` | Call Objective type |
| 26 | `1_Call_Objective_Primary_Inquiry` | Primary inquiry |
| 27 | `1_Call_Objective_Type_Reason` | Objective reason |

### Intent & Experience (Columns 28–37)

| Index | CSV Column | UI Section |
|-------|-----------|-----------|
| 28 | `2_Intent_to_Visit_Store_Rating` | Intent to Visit — rating (1-3) |
| 29 | `2_Intent_to_Visit_Store_Reason` | Intent to Visit — reason text |
| 30 | `3a_Customer_Experience_Agent_NPS` | Agent Experience NPS (1-10) |
| 31 | `3a_Customer_Experience_Agent_NPS_Reason` | Agent NPS reason |
| 32 | `3a_Customer_Experience_Agent_Good` | Agent — what went well |
| 33 | `3a_Customer_Experience_Agent_Bad` | Agent — what was missed |
| 34 | `3b_Customer_Experience_Brand_NPS` | Brand Experience NPS (1-10) |
| 35 | `3b_Customer_Experience_Brand_NPS_Reason` | Brand NPS reason |
| 36 | `3b_Customer_Experience_Brand_Good` | Brand — positive signal |
| 37 | `3b_Customer_Experience_Brand_Bad` | Brand — friction |

### Funnel & Purchase Readiness (Columns 38–44)

| Index | CSV Column | UI Section |
|-------|-----------|-----------|
| 38 | `4_Funnel_Analysis_Stage` | Funnel stage (Awareness/Consideration/Action/Already Purchased) |
| 39 | `4_Funnel_Analysis_Reason` | Funnel stage reason |
| 40 | `4_Funnel_Analysis_Timeline_to_Purchase` | Timeline to purchase |
| 41 | `4_Funnel_Analysis_Timeline_to_Purchase_Reason` | Timeline reason |
| 42 | `5_Purchase_Readiness_Score` | Purchase readiness (1-5) |
| 43 | `5_Purchase_Readiness_Scoring_Evidence` | Purchase readiness evidence |
| 44 | `5_Purchase_Readiness_Follow_Up_Priority` | Follow-up priority |

### Product Intelligence (Columns 45–52)

| Index | CSV Column | UI Section |
|-------|-----------|-----------|
| 45 | `6_Product_Intelligence_Category` | Product category |
| 46 | `6_Product_Intelligence_Sub_Category` | Sub category |
| 47 | `6_Product_Intelligence_Collection` | Collection |
| 48 | `6_Product_Intelligence_Customer_Verbatim_Product` | Customer verbatim |
| 49 | `6_Product_Intelligence_Narrow_Down_Stage` | Narrow down stage |
| 50 | `6_Product_Intelligence_Approx_Order_Value` | Approx order value |
| 51 | `6_Product_Intelligence_Size_Mentioned` | Size mentioned |

### Customer Needs & Barriers (Columns 52–57)

| Index | CSV Column | UI Section |
|-------|-----------|-----------|
| 52 | `7_Customer_Needs_Description` | Customer needs description |
| 53 | `8_Visit_Purchase_Barriers_Primary_StoreVisit_Barrier` | Store visit barrier type |
| 54 | `8_Visit_Purchase_Barriers_StoreVisit_Barrier_Detail` | Store visit barrier detail |
| 55 | `8_Visit_Purchase_Barriers_Primary_Purchase_Barrier` | Purchase barrier type |
| 56 | `8_Visit_Purchase_Barriers_Purchase_Barrier_Detail` | Purchase barrier detail |
| 57 | `9_Decision_Maker` | Decision maker |

### Conversion Hooks (Columns 58–73)

| Index | CSV Column | UI Section |
|-------|-----------|-----------|
| 58 | `10_Conversion_Hooks_Used_Store_Footfall_Driver_Used` | Store Visit Invite — Yes/No |
| 59 | `10_Conversion_Hooks_Used_Store_Footfall_Driver_Evidence` | Store Visit evidence |
| 60 | `10_Conversion_Hooks_Used_WhatsApp_Connection_Used` | WhatsApp — Yes/No |
| 61 | `10_Conversion_Hooks_Used_WhatsApp_Connection_Evidence` | WhatsApp evidence |
| 62 | `10_Conversion_Hooks_Used_Video_Demo_Used` | Video Demo — Yes/No |
| 63 | `10_Conversion_Hooks_Used_Video_Demo_Evidence` | Video Demo evidence |
| 64 | `10_Conversion_Hooks_Used_Mattress_Measurement_Used` | Measurement — Yes/No |
| 65 | `10_Conversion_Hooks_Used_Mattress_Measurement_Evidence` | Measurement evidence |
| 66 | `10_Conversion_Hooks_Used_In_Store_Offers_EMI_Used` | Store Offers — Yes/No |
| 67 | `10_Conversion_Hooks_Used_In_Store_Offers_EMI_Evidence` | Store Offers evidence |
| 68 | `10_Conversion_Hooks_Hooks_Used_Count` | Hooks used count |
| 69 | `10_Conversion_Hooks_Hooks_Relevant_Count` | Hooks relevant count |
| 70 | `10_Conversion_Hooks_Most_Relevant_Missed_Hook_1` | Top missed hook 1 |
| 71 | `10_Conversion_Hooks_Most_Relevant_Missed_Hook_1_Reason` | Missed hook 1 reason |
| 72 | `10_Conversion_Hooks_Most_Relevant_Missed_Hook_2` | Top missed hook 2 |
| 73 | `10_Conversion_Hooks_Most_Relevant_Missed_Hook_2_Reason` | Missed hook 2 reason |

### Probing Questions (Columns 74–93)

| Index | CSV Column | UI Section |
|-------|-----------|-----------|
| 74–77 | `11_Probing_Questions_Visit_Intent_ETA_*` | Visit Intent (Asked/Score/Detail/Reason) |
| 78–81 | `11_Probing_Questions_Why_Buying_*` | Why Buying |
| 82–85 | `11_Probing_Questions_Whom_For_*` | Whom For |
| 86–89 | `11_Probing_Questions_Current_Product_*` | Current Product |
| 90–93 | `11_Probing_Questions_Budget_Explored_*` | Budget Explored |

### Cross-Sell & Explanation (Columns 94–103)

| Index | CSV Column | UI Section |
|-------|-----------|-----------|
| 94–98 | `12_Cross_Sell_*` | Cross-sell opportunity/attempted/product/score/reason |
| 99–100 | `13_Explanation_Quality_*` | Explanation quality score & reason |
| 101–103 | `14_Upsell_Skills_*` | Upsell attempted/score/reason |

### Agent Evaluation (Columns 104–115)

| Index | CSV Column | UI Section |
|-------|-----------|-----------|
| 104–105 | `15_Agent_Evaluation_Agent_Nature*` | Agent Nature + reason |
| 106–107 | `15_Agent_Evaluation_Local_Store_Knowledge*` | Local Store Knowledge |
| 108–109 | `15_Agent_Evaluation_Product_Knowledge*` | Product Knowledge |
| 110–111 | `15_Agent_Evaluation_Footfall_Driving_Skills*` | Footfall Driving |
| 112–113 | `15_Agent_Evaluation_Need_Discovery*` | Need Discovery |
| 114–115 | `15_Agent_Evaluation_Objection_Handling*` | Objection Handling |

### RELAX Framework (Columns 116–125)

| Index | CSV Column | UI Section |
|-------|-----------|-----------|
| 116–117 | `16_RELAX_Framework_R_Reach_Out_*` | R — Reach Out (score + reason) |
| 118–119 | `16_RELAX_Framework_E_Explore_Needs_*` | E — Explore Needs |
| 120–121 | `16_RELAX_Framework_L_Link_Product_*` | L — Link Product |
| 122–123 | `16_RELAX_Framework_A_Add_Value_*` | A — Add Value |
| 124–125 | `16_RELAX_Framework_X_Express_Closing_*` | X — Express Closing |

### Closing Intelligence (Columns 126–133)

| Index | CSV Column | UI Section |
|-------|-----------|-----------|
| 126 | `17_Agent_Learnings` | Agent Learnings (bullet list) |
| 127 | `18_Next_Actions` | Next Actions |
| 128 | `19_Airboost_Tracking_Agent_Airboost` | Airboost — Agent mention |
| 129 | `19_Airboost_Tracking_Customer_Airboost` | Airboost — Customer mention |
| 130 | `19_Airboost_Tracking_Airboost_Upsell_Possible` | Airboost — Upsell possible |
| 131 | `19_Airboost_Tracking_Airboost_Upsell_Attempted` | Airboost — Upsell attempted |
| 132 | `19_Airboost_Tracking_Airboost_Upsell_Attempt_Score` | Airboost — Attempt score |
| 133 | `Customer Airboost First` | Customer Airboost first flag |

---

## 3. Score Conversion Rules

All numeric scores from CSV must be converted for display:

| Raw Score | Display Label | CSS Class |
|-----------|--------------|-----------|
| 1 | LOW | `score-low` (red) |
| 2 | MEDIUM | `score-med` (yellow) |
| 3 | HIGH | `score-high` (green) |
| 4–5 | HIGH | `score-high` (green) |

**NPS-based Experience rating:**
- NPS 1–4 → LOW
- NPS 5–7 → MEDIUM  
- NPS 8–10 → HIGH

**Yes/No fields**: Display as YES (green badge) or NO (red badge).

**Duration**: Convert seconds → `mm:ss` format.

---

## 4. Backend Design (FastAPI)

### Startup Flow

```
1. Read CSV (latin-1 encoding) on server start
2. Parse each row into a dict keyed by column headers
3. Store as in-memory list: CALLS_DATA = [dict, dict, ...]
4. Index by CleanNumber for O(1) lookup
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/calls` | Returns list of call summaries (subset of fields for listing table) |
| `GET` | `/api/calls/{clean_number}` | Returns full call detail JSON for one call |

### Call Summary Response (for listing)

```json
{
  "calls": [
    {
      "clean_number": "9833771501",
      "brand": "Duroflex",
      "store_name": "COCO ANDHERI",
      "call_date": "########",
      "duration": 128,
      "city": "Mumbai",
      "state": "MAHARASHTRA",
      "call_objective": "Sales Lead (Pre-Store Visit)",
      "intent_rating": "MEDIUM",
      "experience_rating": "HIGH",
      "funnel_stage": "Consideration",
      "is_converted": 0,
      "revenue": 0,
      "call_quality": "2"
    }
  ]
}
```

### Call Detail Response (for detail page)

Full JSON with all 134 columns mapped into nested sections matching the UI blocks:

```json
{
  "identity": { "clean_number", "brand", "store_name", "locality", "city", "state", "call_date", "duration", "recording_url", "call_type" },
  "customer_metadata": { "name", "location", "language", "gender", "age_group", "income_group", "persona", "decision_maker" },
  "summary_signals": { "call_quality", "enthusiasm", "is_converted", "revenue", "call_summary" },
  "call_objective": { "type", "primary_inquiry", "reason" },
  "intent": { "visit_rating", "visit_reason", "purchase_score", "purchase_evidence" },
  "experience": { "agent": { "nps", "reason", "good", "bad" }, "brand": { "nps", "reason", "good", "bad" } },
  "funnel": { "stage", "reason", "timeline", "timeline_reason", "follow_up_priority" },
  "product_intelligence": { "category", "sub_category", "collection", "verbatim", "narrow_down_stage", "order_value", "size_mentioned" },
  "customer_needs": { "description" },
  "barriers": { "store_visit": { "type", "detail" }, "purchase": { "type", "detail" } },
  "conversion_hooks": { "store_visit", "whatsapp", "video_demo", "measurement", "offers", "hooks_used_count", "hooks_relevant_count", "missed_hooks" },
  "probing": { "visit_intent", "why_buying", "whom_for", "current_product", "budget" },
  "agent_scorecard": { "nature", "footfall", "objection_handling", "explanation_quality", "product_knowledge", "local_knowledge", "need_discovery", "learnings" },
  "relax_framework": { "reach_out", "explore_needs", "link_product", "add_value", "express_closing" },
  "closing": { "next_actions" },
  "airboost": { "agent_mentioned", "customer_mentioned", "upsell_possible", "upsell_attempted", "attempt_score" },
  "transcript": [ { "speaker": "Agent", "text": "...", "timestamp": "00:00" }, ... ]
}
```

### Transcript Parsing

The `Transcript_Log` column contains entries like:
```
[00:00] Agent: Hello...
[00:04] Customer: Hello...
```

Parse via regex: `\[(\d{2}:\d{2})\]\s*(Agent|Customer):\s*(.+)` into structured array.

---

## 5. Frontend Design (React + Vite)

### Pages & Routes

| Route | Component | Description |
|-------|----------|-------------|
| `/` | `CallListPage` | Tabular listing with filters |
| `/call/:cleanNumber` | `CallDetailPage` | Full analysis page |

### Call Listing Page — Features

- **KPI Summary Row**: Total Calls, High Intent %, Sales Leads, Post Purchase
- **Filter Strip**: Store, City/State, Intent, Experience, Funnel Stage, Time range
- **Table Columns**: Call ID (masked), Date, Store, Duration, Intent, Experience, Objective, Funnel Stage
- **Row Click → Navigate** to `/call/{cleanNumber}`
- Simple search bar for store name or customer number

### Call Details Page — UI Sections (from reference HTML)

1. **Top Navigation Bar**: Back link, Call ID, Objective, Intent badge, Experience badge, Funnel badge, Listen to Call button
2. **Header Block**: Store Call Analysis title, store info subtitle
3. **3-Column Grid**:
   - Col 1: Call Snapshot (brand, store, location, date, duration, customer number, call type)
   - Col 2: Meta Data (customer name, location, language, gender, age, income, persona, decision maker)
   - Col 3: Summary & Signals (call quality, enthusiasm, converted, revenue, call summary)
4. **Critical Sales Intelligence**: Product Intelligence + Customer Needs + Intent + Barriers + Funnel & Timeline + Follow-up Priority
5. **Customer Experience**: Agent Experience (NPS, good/bad) + Brand Experience (NPS, good/bad)
6. **Conversion Hooks Utilization**: 5 hooks (store visit, whatsapp, video demo, measurement, offers) + missed hooks
7. **Probing Quality**: 5 probing areas (why buying, whom for, visit intent, current product, budget)
8. **Agent Scorecard + RELAX Framework**: Side-by-side cards
9. **Next Actions + Airboost Tracking**: Side-by-side cards
10. **Call Transcript**: Chat-style bubble UI parsed from transcript text

### Component Breakdown

```
src/
├── App.jsx                    # Router setup
├── pages/
│   ├── CallListPage.jsx       # Listing with filters & table
│   └── CallDetailPage.jsx     # Full detail page
├── components/
│   ├── ScoreBadge.jsx         # Reusable HIGH/MED/LOW badge
│   ├── YesNoBadge.jsx         # Reusable YES/NO badge
│   ├── FunnelSteps.jsx        # Funnel visualization (CSS clip-path)
│   ├── TranscriptChat.jsx     # Chat bubble transcript
│   ├── SectionCard.jsx        # Reusable section container
│   └── FilterBar.jsx          # Filter strip component
└── utils/
    └── formatters.js          # Score conversion, date formatting, duration formatting
```

---

## 6. Implementation Order

### Phase 1 — Backend Foundation
1. Set up FastAPI project with CORS
2. Write CSV parser (latin-1 encoding, 134 columns)
3. Build in-memory data store indexed by `CleanNumber`
4. Implement transcript parser (regex-based)
5. Create `/api/calls` endpoint (summary list)
6. Create `/api/calls/{clean_number}` endpoint (full detail)

### Phase 2 — Frontend Foundation
1. Scaffold Vite + React project with TailwindCSS
2. Set up react-router-dom with `/` and `/call/:cleanNumber`
3. Build shared utility functions (score conversion, formatters)
4. Build reusable components (ScoreBadge, YesNoBadge, FunnelSteps)

### Phase 3 — Call Details Page (Priority)
1. Build the full detail page matching the reference HTML layout
2. Connect to `/api/calls/{clean_number}` endpoint
3. Map all 134 CSV fields to their respective UI sections
4. Build TranscriptChat component with parsed messages

### Phase 4 — Call Listing Page
1. Build basic listing table with columns
2. Add filter bar (store, intent, experience, funnel)
3. Add KPI summary row
4. Wire row clicks to navigate to detail page

### Phase 5 — Polish
1. Responsive design adjustments
2. Loading states and error handling
3. Testing with all 49 rows

---

## 7. Key Design Decisions

- **TailwindCSS**: Used because the reference HTML is already built with Tailwind — preserves exact visual fidelity.
- **No database**: CSV is re-read on each server startup into memory. 49 rows × 134 columns is trivially small.
- **CleanNumber as ID**: Each call's phone number is the unique identifier used in URLs and API lookups.
- **Encoding**: CSV requires `latin-1` encoding (contains special characters that break UTF-8).
- **Transcript parsing**: Regex-based extraction of `[timestamp] Speaker: message` blocks into structured JSON.
