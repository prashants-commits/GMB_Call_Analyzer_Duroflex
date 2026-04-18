# Insights Report Dashboard — Design & Implementation Specification

## 1. Overview

The **Insights Report Dashboard** is a new AI-powered analytical view that enables executives (CEO/CGO) to generate on-demand, LLM-synthesised reports from filtered subsets of GMB inbound sales call data. It answers the question: *"What are the key brand, store, and customer-experience takeaways from this specific slice of our call data, and what should we do next?"*

The user selects a data segment (City / Store / Product Category / Purchase Barrier) plus a date range, reviews the matched call count (hard-capped at **100 calls**), and clicks **"Generate Report"**. The backend sends the relevant columns to the **Gemini 3.1 Pro Preview** model, which returns a structured executive summary. The response is rendered on-page in a premium card layout and can be downloaded as a **PDF**.

---

## 2. Navigation & Access

*   **Entry Point**: A single prominent button on the main `Analytics Dashboard` header.
*   **Placement**: Located in the top-right header area, between the existing "View KPI Trends" button and the "Selected Calls" count box (the red-boxed area in the reference screenshot).
*   **Button Design**: A visually distinct button with a unique colour to differentiate it from the indigo "View KPI Trends" button. Suggested: a warm gradient (amber → orange) with a `Sparkles` icon (from `lucide-react`) and label **"Generate Insights"**.
*   **Route**: `/insights` (protected, same pattern as `/trends`).

---

## 3. UI/UX Design Principles

*   **Premium Glassmorphic Cards**: The report output will be displayed in beautifully styled cards with glassmorphic blur effects, not raw markdown text.
*   **Segmented Sections**: Brand, Store/Staff, and Next Steps will each occupy their own distinct visual "card" with clear iconography.
*   **Good / Bad Duality**: Use a two-column layout within each card — green-toned column for "Good Aspects" and red-toned column for "Bad Aspects" — making the report immediately scannable.
*   **Loading State**: A premium skeleton loader with pulsing animations and a status message (e.g., *"Gemini is analysing 87 calls..."*) while the LLM processes.
*   **Error Boundary**: Clear error messaging if Gemini call fails, with retry option.

---

## 4. Core Functionality & Layout

### 4.1 Filter Panel (Top Section)

#### Segment Filters — 4 Independent Multi-Select Dropdowns

| # | Dropdown Label       | Data Source Field         | Behaviour |
|---|----------------------|---------------------------|-----------|
| 1 | **City**             | `city`                    | Multi-select; filters rows to only selected cities. Empty = All. |
| 2 | **Store**            | `store_name`              | Multi-select; filters rows to only selected stores. Empty = All. |
| 3 | **Product Category** | `product_category`        | Multi-select; filters rows to only selected categories. Empty = All. |
| 4 | **Purchase Barrier** | `purchase_barrier`        | Multi-select; filters rows to only selected barriers. Empty = All. |

> **Important**: All four filters apply **simultaneously** (AND logic). For example, selecting City = "Chennai" AND Store = "COCO ANNA NAGAR" narrows to calls matching BOTH.

#### Date Range Filter

*   Two date inputs: **Start Date** and **End Date**.
*   Default: Full available date range in the dataset (from the earliest to the latest `call_date`).
*   No week-start constraint here (unlike Trends) — plain calendar date picker for maximum flexibility.

#### Selected Calls Counter (Live)

*   A prominently displayed count showing how many calls match the current filter combination in real-time.
*   **Hard Cap Enforcement (100 calls)**:
    *   If `filteredCalls.length > 100`, the "Generate Report" button becomes **disabled** with a red glow.
    *   An inline error banner appears: *"Sorry, you can select up to only 100 calls. Use filters to narrow down your search."*
    *   The counter itself turns red when exceeding the limit.

#### Generate Report Button

*   Large, prominent CTA button: **"✨ Generate Report"**
*   Disabled states:
    1.  When filtered calls > 100 (cap exceeded)
    2.  When filtered calls = 0 (no data)
    3.  When a report is already being generated (loading)

---

### 4.2 Data Columns Sent to Gemini

When the user clicks "Generate Report", the backend receives the list of `clean_number` IDs for the filtered calls, then extracts these specific columns from the CSV for each call and sends them as structured context to Gemini:

| Column (CSV Header)                                        | Purpose in Report                |
|------------------------------------------------------------|----------------------------------|
| `City`                                                     | Geographic context               |
| `Store Name`                                               | Store identification             |
| `6_Product_Intelligence_Category`                          | Product context                  |
| `8_Visit_Purchase_Barriers_Primary_Purchase_Barrier`       | Barrier context                  |
| `Call_Summary`                                              | Core call narrative              |
| `7_Customer_Needs_Description`                             | Customer needs                   |
| `3a_Customer_Experience_Agent_NPS`                         | Agent NPS score                  |
| `3a_Customer_Experience_Agent_NPS_Reason`                  | Agent NPS reasoning              |
| `3a_Customer_Experience_Agent_Good`                        | Agent positives                  |
| `3a_Customer_Experience_Agent_Bad`                         | Agent negatives                  |
| `3b_Customer_Experience_Brand_NPS`                         | Brand NPS score                  |
| `3b_Customer_Experience_Brand_NPS_Reason`                  | Brand NPS reasoning              |
| `3b_Customer_Experience_Brand_Good`                        | Brand positives                  |
| `3b_Customer_Experience_Brand_Bad`                         | Brand negatives                  |
| `8_Visit_Purchase_Barriers_Purchase_Barrier_Detail`        | Detailed barrier description     |
| `17_Agent_Learnings`                                       | Agent coaching insights          |

---

### 4.3 Gemini Prompt Template

```
Context: This is data from analysing {N} inbound sales calls at Duroflex.
Segment applied: {segment_description}
Date range: {start_date} to {end_date}

Below is the call-level data in JSON format:
{call_data_json}

Prepare an Executive-level, simple and effective Report for the CEO and CGO containing:

1. **Top 3 Good Aspects about the Brand** — with brief supporting evidence from the calls
2. **Top 3 Bad Aspects about the Brand** — with brief supporting evidence from the calls
3. **Top 3 Good Aspects about the Store & Staff** — with brief supporting evidence from the calls
4. **Top 3 Bad Aspects about the Store & Staff** — with brief supporting evidence from the calls
5. **Top 3 to 5 Overall Next Steps** to improve Business and Customer Experience — actionable recommendations

Format your response as a JSON object with this exact structure:
{
  "brand_good": [{"title": "...", "detail": "..."}, ...],
  "brand_bad": [{"title": "...", "detail": "..."}, ...],
  "store_good": [{"title": "...", "detail": "..."}, ...],
  "store_bad": [{"title": "...", "detail": "..."}, ...],
  "next_steps": [{"title": "...", "detail": "..."}, ...]
}

Return ONLY valid JSON. No markdown fences, no commentary.
```

> **Key Design Decision — Structured JSON Output**: To solve the problem of *"LLM output is not static or highly structured"*, we **force the model to respond in strict JSON format** using schema instructions in the prompt. This guarantees deterministic parsing on the frontend. The frontend maps each JSON key to its respective premium UI card with consistent styling, eliminating the need for fragile markdown parsing.

---

### 4.4 Report Display (Output Section)

The rendered output occupies the lower portion of the page, appearing with a smooth slide-down animation after generation completes.

#### Card Layout — 3 Sections

**Section 1: Brand Analysis**
```
┌─────────────────────────────────────────────────────┐
│  🏷️  BRAND ANALYSIS                                │
├────────────────────────┬────────────────────────────┤
│  ✅ Good Aspects       │  ❌ Areas of Concern       │
│  ─────────────────     │  ─────────────────         │
│  1. Title              │  1. Title                  │
│     Detail...          │     Detail...              │
│  2. Title              │  2. Title                  │
│     Detail...          │     Detail...              │
│  3. Title              │  3. Title                  │
│     Detail...          │     Detail...              │
└────────────────────────┴────────────────────────────┘
```

**Section 2: Store & Staff Analysis** (identical layout, different icon/colour)

**Section 3: Recommended Next Steps**
```
┌─────────────────────────────────────────────────────┐
│  🚀  RECOMMENDED NEXT STEPS                        │
├─────────────────────────────────────────────────────┤
│  1. [Title]                                         │
│     Detail...                                       │
│  2. [Title]                                         │
│     Detail...                                       │
│  ... (3 to 5 items)                                 │
└─────────────────────────────────────────────────────┘
```

#### Colour Palette for Report Cards
| Section          | Background                  | Good Column    | Bad Column     |
|------------------|-----------------------------|----------------|----------------|
| Brand            | White card, indigo accent   | Emerald/Green  | Rose/Red       |
| Store & Staff    | White card, amber accent    | Emerald/Green  | Rose/Red       |
| Next Steps       | White card, sky/blue accent | n/a            | n/a            |

---

### 4.5 PDF Export

*   A **"Download as PDF"** button appears alongside the report header after generation.
*   Implementation approach: Use the browser-native `window.print()` with a dedicated `@media print` CSS stylesheet that hides the filter panel and header, showing only the report cards in a clean, print-friendly layout.
*   Alternative (if higher fidelity needed): Use the `html2canvas` + `jspdf` libraries to capture the rendered report section as a pixel-perfect PDF.
*   The PDF filename follows the pattern: `Duroflex_Insights_Report_{YYYY-MM-DD}.pdf`

---

## 5. Technical Implementation Steps

### 5.1 Backend Changes

#### New File: `backend/.env`
```
GEMINI_API_KEY=your-gemini-api-key-here
```

#### Updated: `backend/requirements.txt`
```
fastapi==0.115.0
uvicorn[standard]==0.30.0
google-genai>=1.0.0
python-dotenv>=1.0.0
```

#### New File: `backend/gemini_service.py`
A dedicated service module to handle:
1.  Loading the API key from `.env`
2.  Accepting a list of call data dictionaries + segment metadata
3.  Constructing the prompt
4.  Calling `google.genai.Client.models.generate_content(model="gemini-3.1-pro-preview", ...)`
5.  Parsing the JSON response
6.  Returning structured data or error

#### Updated: `backend/csv_parser.py`
Add a new method to `CallDataStore`:
```python
def get_insight_columns(self, clean_numbers: List[str]) -> List[Dict[str, Any]]:
    """Return the specific columns needed for Gemini insight generation."""
    # Reads from raw CSV rows (or from stored _details dict)
    # Returns only the 17 columns specified in Section 4.2
```

#### Updated: `backend/main.py`
New POST endpoint:
```python
@app.post("/api/generate-insights")
async def generate_insights(request: InsightRequest):
    """
    Accepts:
      - clean_numbers: List[str]  (max 100)
      - segment_description: str
      - date_range: str
    Returns:
      - Gemini response as structured JSON
    """
```

### 5.2 Frontend Changes

#### New File: `frontend/src/pages/InsightsDashboard.jsx`
The complete React component containing:
1.  **Data fetch**: Reuses `fetchAnalyticsData()` to get full dataset
2.  **Filter state**: 4 multi-select dropdowns + date range
3.  **Call counter**: Live count with 100-cap validation
4.  **Generate handler**: POST to `/api/generate-insights` with selected `clean_number` list
5.  **Report renderer**: Maps Gemini JSON to premium cards
6.  **PDF export**: Print-friendly export function

#### Updated: `frontend/src/utils/api.js`
Add:
```javascript
export async function generateInsightsReport(cleanNumbers, segmentDescription, dateRange) {
  const res = await fetch(apiUrl('/api/generate-insights'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clean_numbers: cleanNumbers, segment_description: segmentDescription, date_range: dateRange })
  });
  if (!res.ok) throw new Error('Failed to generate insights');
  return res.json();
}
```

#### Updated: `frontend/src/App.jsx`
Add route:
```jsx
<Route path="/insights" element={<InsightsDashboard />} />
```

#### Updated: `frontend/src/pages/AnalyticsDashboard.jsx`
Add the "Generate Insights" button in the header's `flex gap-4` container, positioned before the "View KPI Trends" button.

---

## 6. Error Handling & Edge Cases

| Scenario                           | Behaviour                                                                           |
|------------------------------------|-------------------------------------------------------------------------------------|
| Filtered calls = 0                 | Disable "Generate Report" button; show "No calls match your filters" message         |
| Filtered calls > 100               | Disable button; show red error banner with cap message                              |
| Gemini API key missing             | Backend returns 500 with descriptive error; frontend shows "API key not configured" |
| Gemini API rate limit / timeout    | Show error toast with retry button; implement 60s timeout                           |
| Gemini returns malformed JSON      | Fallback: display raw text in a code block; log warning                             |
| Network error during generation    | Show "Network error. Please try again." with retry                                  |

---

## 7. Loading State UX

While Gemini is processing (typically 10-30 seconds):
1.  Button changes to a spinner with text: *"Generating..."*
2.  Three skeleton card placeholders appear below with pulsing animation
3.  A subtle progress text: *"✨ Gemini is analysing {N} calls across {segment}..."*
4.  The filter panel remains visible but becomes slightly dimmed and non-interactive

---

## 8. Security Considerations

*   The Gemini API key lives **only on the backend** in `.env` — never exposed to the frontend.
*   The 100-call cap is enforced **both** on the frontend (UI) and backend (validation) to prevent abuse.
*   Call data is sent to Gemini API — ensure this aligns with data privacy policies for Duroflex.

---

## 9. Default Experience Specification

Upon loading the Insights Dashboard:
1.  **All segment filters**: Empty (= All, no filtering applied)
2.  **Date range**: Full range available in the dataset
3.  **Selected Calls counter**: Shows total call count (e.g., 1088)
4.  **Report area**: Empty state with a large call-to-action illustration and text: *"Select your filters and click Generate Report to create an AI-powered executive summary."*

---

## 10. Open Questions for Clarification

> [!IMPORTANT]
> **Q1 — Gemini API Key Provisioning**:Yes I have the Gemini API Key

> [!IMPORTANT]
> **Q2 — Data Privacy**: Yes Send All columns to Gemini

> [!WARNING]
> **Q3 — PDF Fidelity**: use browser `window.print()` sufficient (simpler, lighter)

> [!NOTE]
> **Q4 — Cost Awareness**: Don't worry about the cost
