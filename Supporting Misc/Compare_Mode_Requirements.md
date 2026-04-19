# Insights Dashboard: Single vs Compare Mode Requirements & Implementation Plan

## Objective
Provide a toggle on the top right of the Insights Dashboard to switch between "Single" and "Compare" mode. In Compare mode, users can define two distinct sets of calls using two separate filter panels, ask a custom question, and generate an AI-powered comparison report.

## Defined Requirements & Assumptions

### 1. Call Volume Limit
* Each filter set (Set A and Set B) will maintain the existing **100 call limit** (total max 200 calls sent to the LLM). This ensures sufficient data for comparison while remaining safely within token limits.

### 2. Report Output Structure & UI Reusability
* The comparison report will utilize the **same JSON structure** as the Single report (`brand_good`, `brand_bad`, `store_good`, `store_bad`, `next_steps`, `custom_answer`).
* The system prompt will instruct the LLM to write the content of these sections as a **direct comparison** (e.g., highlighting how Set A differs from Set B). This allows us to seamlessly reuse the existing, beautiful `InsightCard` UI components without introducing complex new layout structures.

### 3. Filter Panel UI Layout
* In Compare mode, a second filter panel will appear. 
* To maintain a clean, responsive design on all screen sizes, the panels will be **stacked vertically** (Set A above, Set B below). Each panel will have its own distinct header, call count, and limit validation.

### 4. Custom Question Behavior
* When a custom question is asked in Compare mode, the AI will be explicitly instructed to answer the question by contrasting Set A against Set B.

---

## Implementation Plan

### 1. Frontend: State Management & UI Updates (`InsightsDashboard.jsx`)
* **State**: Add a `mode` toggle (`'single'` | `'compare'`).
* **Filters**: Split the filter state into `filtersA` and `filtersB` (or `selectedCitiesA`, `selectedCitiesB`, etc.).
* **Filtered Calls**: Compute `filteredCallsA` and `filteredCallsB` independently.
* **UI - Toggle**: Add a sleek toggle button in the top right of the header to switch modes.
* **UI - Panels**: Render two `<FilterPanel>` components when in compare mode. Pass them clear labels ("Dataset A", "Dataset B").
* **UI - Action Bar**: Update the bottom action bar to aggregate the counts (e.g., "Set A: 45 Calls | Set B: 80 Calls") and check the 100-call limit for both sets independently before enabling the "Generate Report" button.
* **API Call**: Update the `handleGenerate` method to pass `cleanNumbersB` and `segmentDescB` when in compare mode.

### 2. Frontend & Backend: API Bridge (`api.js` & `main.py`)
* **`api.js`**: Update `generateInsightsReport` to optionally accept `cleanNumbersB` and `segmentDescB`.
* **`main.py`**: Update the `InsightRequest` Pydantic model to include `clean_numbers_b` (List[str]) and `segment_description_b` (Optional[str]).

### 3. Backend: Gemini Service & Prompting (`gemini_service.py`)
* Update `generate_insights` to accept the new Set B parameters.
* **Prompt Logic**: If `call_data_b` is provided, use the new **Compare Prompt Template** (detailed below). Otherwise, fall back to the existing Single Prompt Template.

---

## The Comparison Prompt Template

```python
COMPARE_PROMPT_TEMPLATE = """Context: This is data from analysing inbound sales calls at Duroflex. You are being asked to compare two distinct segments of calls.

Dataset A (Segment: {segment_description_a}) - {n_calls_a} calls
Below is the call-level data for Dataset A in JSON format:
{call_data_json_a}

Dataset B (Segment: {segment_description_b}) - {n_calls_b} calls
Below is the call-level data for Dataset B in JSON format:
{call_data_json_b}

You are an expert Data Analyst presenting to the CEO, CGO, and CSO. Your tone should be highly professional, structural, business-friendly, and actionable.

Based ONLY on the provided call data, prepare an Executive Comparison Insights Report. Your goal is to highlight the KEY DIFFERENCES, advantages, or relative weaknesses between Dataset A and Dataset B. 

Your report must contain:
1. **Top 3 Good Aspects about the Brand (Comparison)** — contrasting A vs B with brief supporting evidence.
2. **Top 3 Bad Aspects about the Brand (Comparison)** — contrasting A vs B with brief supporting evidence.
3. **Top 3 Good Aspects about the Store & Staff (Comparison)** — contrasting A vs B with brief supporting evidence.
4. **Top 3 Bad Aspects about the Store & Staff (Comparison)** — contrasting A vs B with brief supporting evidence.
5. **Top 3 to 5 Overall Next Steps** to improve Business and Customer Experience based on these comparisons.
{custom_question_instruction}

Format your response as a JSON object with this exact structure:
{{
  "brand_good": [{{"title": "...", "detail": "..."}}],
  "brand_bad": [{{"title": "...", "detail": "..."}}],
  "store_good": [{{"title": "...", "detail": "..."}}],
  "store_bad": [{{"title": "...", "detail": "..."}}],
  "next_steps": [{{"title": "...", "detail": "..."}}],
  {custom_answer_json}
}}

Return ONLY valid JSON. No markdown fences, no commentary outside the JSON."""