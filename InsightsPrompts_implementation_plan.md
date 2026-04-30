# Insights Dashboard — Volume-Driven Prompts Implementation Plan

**Goal:** Rewrite the Gemini prompts so that every "Top N" answer is grounded in **volume of theme occurrence** (% of calls), each item cites **5 representative phone numbers** that are **clickable in the UI**, and the Custom Question response gets a deep, multi-paragraph first-principles answer.

**Last updated:** 2026-04-30
**Branch to use:** `claude/elegant-merkle-8801b7`

---

## 1. Confirmed Decisions (your answers)

| # | Decision |
|---|---------|
| 1 | 5 example phone numbers per aspect — must be calls where the theme is most prominent |
| 2 | Phone numbers must render as clickable links (→ `/call/<clean_number>`) |
| 3 | Rank themes by percentage of total calls (e.g., "47% of calls mentioned X") |
| 4 | Free-form themes — Gemini clusters; no predefined buckets |
| 5 | Both single-segment and comparison prompts get the change |
| 6 | Raise per-segment cap from 100 → 250 calls |
| 7 | JSON schema gains `call_count`, `call_percentage`, `example_clean_numbers` |
| 8 | Custom Question answer is long-form first-principles analysis with cited evidence (counts + numbers) |

---

## 2. Files to be touched

| File | Change | Risk |
|------|--------|------|
| `backend/main.py` | Raise both `clean_numbers` caps from 100 → 250 | Low |
| `backend/csv_parser.py` | Include `Clean Number` field in the JSON sent to Gemini | Low |
| `backend/gemini_service.py` | Rewrite **both** prompts and JSON schema; deepen custom-question schema | Medium (prompt-engineering — needs LLM verification) |
| `frontend/src/pages/InsightsDashboard.jsx` | Render new fields: percentage, clickable phone numbers, structured custom-answer section; update upload-cap text from 100 → 250 | Medium (UI surface change) |

---

## 3. New JSON Output Schema

### 3.1 Single-segment report (no Dataset B)

```jsonc
{
  "brand_good": [
    {
      "title": "Trust in product quality",
      "detail": "Customers consistently praise mattress durability and comfort, citing long-term satisfaction with previous purchases.",
      "call_count": 87,
      "call_percentage": "35%",
      "example_clean_numbers": ["9833771501", "9892817751", "9008048032", "9876543210", "9123456789"]
    }
    // ... 2 more
  ],
  "brand_bad":  [ /* same shape — Top 3 */ ],
  "store_good": [ /* same shape — Top 3 */ ],
  "store_bad":  [ /* same shape — Top 3 */ ],
  "next_steps": [
    {
      "title": "Standardize WhatsApp follow-up within 2h",
      "detail": "Address the 41% of calls where follow-up was missed.",
      "addresses_themes": ["Lack of follow-up after store visit"],
      "call_count": 102,
      "call_percentage": "41%"
    }
    // ... 2-4 more (3-5 total)
  ],
  // Only present if user typed a custom question:
  "custom_answer": {
    "question": "Why are Hyderabad conversion rates lower than Mumbai?",
    "first_principles_analysis": "Multi-paragraph long-form analysis. Walks through the diagnostic reasoning: (a) what factors structurally drive conversion in inbound sales calls, (b) which factors show divergence between the two cities in this dataset, (c) the inferred causal chain, (d) caveats given the data. Should be 4-8 short paragraphs.",
    "key_insights": [
      {
        "insight": "Hyderabad agents probe budget 31% less than Mumbai agents",
        "call_count": 64,
        "call_percentage": "26%",
        "example_clean_numbers": ["...", "...", "...", "...", "..."]
      }
      // ... up to 5 supporting insights
    ],
    "conclusion": "Synthesis paragraph tying first-principles analysis to concrete next actions."
  }
}
```

### 3.2 Comparison report (Dataset A vs B)

Same top-level keys, but each item carries volume per dataset:

```jsonc
{
  "brand_good": [
    {
      "title": "Pricing competitiveness perception",
      "detail": "Strength comparison...",
      "dataset_a": {
        "call_count": 87, "call_percentage": "35%",
        "example_clean_numbers": ["...", "...", "...", "...", "..."]
      },
      "dataset_b": {
        "call_count": 12, "call_percentage": "5%",
        "example_clean_numbers": ["...", "..."]
      }
    }
  ],
  "brand_bad":  [ /* same shape */ ],
  "store_good": [ /* same shape */ ],
  "store_bad":  [ /* same shape */ ],
  "next_steps": [ /* unchanged but with addresses_themes + a/b counts */ ],
  // Optional:
  "custom_answer": {
    "question": "...",
    "first_principles_analysis": "long-form multi-paragraph analysis comparing A vs B from first principles",
    "dataset_a_evidence": [ { "insight":"...", "call_count":..., "call_percentage":"...", "example_clean_numbers":[...] } ],
    "dataset_b_evidence": [ { /* same */ } ],
    "comparative_synthesis": "Direct A-vs-B comparison + conclusion"
  }
}
```

### 3.3 Field rules (enforced in the prompt)

- `example_clean_numbers`: **exactly 5 entries** per item where data permits, picked as the calls where the theme is **most prominent / explicitly mentioned**. If fewer than 5 calls mention it, list all available — never invent numbers.
- `call_count`: integer, ≤ total calls in the segment.
- `call_percentage`: string, e.g. `"23%"` or `"47%"`. Round to nearest integer.
- All cited numbers MUST come from the input call list (never fabricated).

---

## 4. Detailed Tasks

### Task A — Backend: include `Clean Number` in Gemini payload

**File:** [backend/csv_parser.py:482-541](backend/csv_parser.py:482)

**Change:** Add `"Clean Number": cn` as the first row field, plus add to `INSIGHT_FIELDS` declaration.

**Why:** Today `clean_number` is the dict key but isn't inside the row payload Gemini sees. Without it, Gemini can't cite phone numbers.

**Test:** After change, verify response payload includes the `Clean Number` field for each call (manually inspect `/api/generate-insights` response).

---

### Task B — Backend: raise cap to 250

**File:** [backend/main.py:96, 119](backend/main.py:96)

**Change:** Two places — Dataset A and Dataset B caps both go from `100` to `250`.

**Test:** Send 150 calls → no error; send 251 calls → 400 error with friendly message.

---

### Task C — Backend: rewrite prompts and parser

**File:** [backend/gemini_service.py](backend/gemini_service.py)

**3 sub-changes:**

#### C1. Single-segment prompt rewrite

Full new prompt body (replaces lines 54-70 of `gemini_service.py`):

```
Context: This is data from analysing {N} inbound sales calls at Duroflex.
Segment applied: {segment_description}
Date range: {date_range}

Below is the call-level data in JSON format. Each row includes a "Clean Number"
field (10-digit phone identifier) which you MUST use when citing example calls:
{call_data_json}

You are an expert Data Analyst presenting to the CEO, CGO, and CSO. Your tone
must be highly professional, structural, business-friendly, and actionable.

Your analytical method:
  1. Read the qualitative text fields (Agent Good, Agent Bad, Brand Good,
     Brand Bad, Customer Needs, Purchase Barrier Detail, Store Visit Barrier
     Detail, Agent Learnings, Call Summary).
  2. Cluster recurring themes across calls. Themes are FREE-FORM — derive
     them from the actual language in the data, not predefined buckets.
  3. For each theme, COUNT how many calls (rows) discuss it (call_count) and
     compute the percentage of total calls (call_percentage, rounded integer).
  4. Pick 5 representative Clean Numbers from the calls where the theme is
     MOST PROMINENT (most explicit / strongest language). If fewer than 5
     calls discuss the theme, list all available — NEVER fabricate numbers.

Based ONLY on the provided data, prepare an Executive Insights Report with
these sections, EACH RANKED BY % OF CALLS (highest first):

  1. Top 3 GOOD aspects about the BRAND
  2. Top 3 BAD aspects about the BRAND
  3. Top 3 GOOD aspects about the STORE & STAFF (agents)
  4. Top 3 BAD aspects about the STORE & STAFF (agents)
  5. 3 to 5 Overall NEXT STEPS — actionable recommendations that target the
     highest-volume bad themes from sections 2 and 4.

Hard rules:
  - "Top 3" means the 3 themes with the highest call_count for that section.
  - Every example_clean_numbers value MUST be a phone number that appears in
     the input data above. Never invent numbers.
  - Themes that appear in fewer than 3 calls (~1% of N) should be excluded.
  - Aim for non-trivial, decision-grade insights — not tautologies.
```

#### C2. Comparison prompt rewrite

Replaces lines 29-52. Key additions:
- Same volume + phone number rules per dataset, separately
- "Most prominent" applies independently in A and B
- The "first principles" diagnostic framing stays, but is wrapped around volume-ranked findings

#### C3. Custom question — deep first-principles answer

Old: appended one line. New: appended block with a different schema:

```
If a custom question is provided, answer it with the following structure:
  - first_principles_analysis: 4-8 short paragraphs walking through the
    diagnostic reasoning from fundamentals (what structurally drives the
    outcome the user is asking about, then which of those drivers show
    signal in this dataset).
  - key_insights (or dataset_a_evidence/dataset_b_evidence in comparison
    mode): up to 5 supporting points each with call_count, call_percentage,
    example_clean_numbers.
  - conclusion (or comparative_synthesis in comparison mode): synthesis
    paragraph tying analysis to concrete actions.

Custom Request/Question: {custom_question}
```

#### C4. JSON output contract enforcement (rewrite end of prompt)

Replace the existing `Format your response as a JSON object...` block with the new schemas from §3.1 and §3.2 above, plus a stricter footer:

```
Return ONLY valid JSON. No markdown fences, no commentary outside the JSON.
Do NOT fabricate Clean Numbers. Every value in example_clean_numbers MUST
appear in the input data above.
```

**Test for Task C:**
- Run Insights generation in dev with ~30 calls → inspect raw JSON response → verify all `example_clean_numbers` exist in the input.
- Validate percentages sum to ≤ 100% per section (some overlap allowed since one call can hit multiple themes — soft check).
- With a custom question, confirm `first_principles_analysis` is non-trivial length (≥ 800 chars).

---

### Task D — Frontend: render new fields

**File:** [frontend/src/pages/InsightsDashboard.jsx](frontend/src/pages/InsightsDashboard.jsx)

**Sub-changes:**

#### D1. Update the cap copy
Find any "100" or "100 calls" strings in the UI text → change to 250.

#### D2. Render percentage badge per item
Where each insight bullet is currently rendered (`title` + `detail`), append:
```jsx
{item.call_percentage && (
  <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
    {item.call_percentage} of calls ({item.call_count})
  </span>
)}
```

#### D3. Render clickable phone-number list
Below each detail block:
```jsx
{item.example_clean_numbers?.length > 0 && (
  <div className="mt-2 flex flex-wrap gap-2">
    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Examples:</span>
    {item.example_clean_numbers.map(n => (
      <Link
        key={n}
        to={`/call/${n}`}
        className="text-xs font-mono text-blue-600 hover:underline bg-blue-50 px-2 py-0.5 rounded"
      >
        {n}
      </Link>
    ))}
  </div>
)}
```

(Need to import `Link` from `react-router-dom`.)

#### D4. Render structured custom-answer section
Replace the current `custom_answer` rendering block with a multi-part layout:
- "Question" header + question text
- "First Principles Analysis" section (long-form paragraphs — render with `\n\n` → paragraph breaks)
- "Supporting Evidence" — list with percentage badges + clickable numbers
- "Conclusion" / "Synthesis" — final paragraph

For comparison mode, split evidence into two columns: Dataset A | Dataset B.

#### D5. Comparison mode adaptation
When the response payload uses the comparison shape (dataset_a / dataset_b sub-objects), render two columns side-by-side per insight item, each with its own percentage badge and phone numbers.

**Test for Task D:**
- E2E click on a phone number → lands on the call detail page for that number.
- Single-segment vs comparison mode both render without layout breaks.
- Long custom answer (≥ 1500 chars) doesn't overflow card.

---

### Task E — Documentation: update README and the existing Insights prompt list

**Files:** [README.md](README.md) (mention 250 cap if currently says 100) and any internal docs.

**Risk:** None.

---

## 5. Test Plan

### Per-task unit tests

| TC | Action | Expected |
|----|--------|----------|
| T-A1 | Run `/api/generate-insights` with 1 call, inspect payload sent to Gemini | Includes `Clean Number` field in row |
| T-B1 | POST 250 calls → succeeds | 200 OK with valid report |
| T-B2 | POST 251 calls → fails | 400 with "Maximum 250 calls allowed..." |
| T-C1 | Run with 30 known calls → response | Every `example_clean_numbers` value is in input list |
| T-C2 | Run with custom question → response | `first_principles_analysis` ≥ 800 chars; `key_insights` has 1-5 entries each with valid numbers |
| T-C3 | Run comparison mode with 50 A + 50 B → response | Each item has `dataset_a` AND `dataset_b` sub-objects |
| T-D1 | Click any rendered phone number | Browser navigates to `/call/<number>` and the call detail loads |
| T-D2 | Single-segment + custom question → render | Custom-answer block shows 4 sections cleanly |
| T-D3 | Comparison mode → render | Two-column layout per insight; no overflow |

### End-to-end smoke

| TC | Action | Expected |
|----|--------|----------|
| E1 | Filter to 50 Hyderabad calls → Insights → "Generate" | Report shows top 3 brand bad themes ranked by percentage; each has 5 clickable Hyderabad numbers |
| E2 | Click first phone in section 4 (Bad Staff) → call detail | Detail page opens; you can verify the cited theme is actually present in that call's transcript/notes |
| E3 | Submit comparison Hyderabad vs Mumbai with 50 + 50 calls | Both datasets render with their own counts; comparative_synthesis is present |
| E4 | Submit a hard custom question ("What's blocking conversion in Discovery stage?") | First-principles analysis runs 4-6 paragraphs; cites 3-5 evidence points with numbers |

---

## 6. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Gemini fabricates phone numbers despite the rule | Add explicit "MUST appear in input" in prompt + post-validate in backend (filter out any clean_number not in `requested` set before returning) |
| Volume counts unstable on small N (< 50 calls) | Prompt instructs to drop themes < 3 calls; UI can additionally show a warning when N < 30 |
| Custom answer too long, blows context window on comparison + 250+250 calls | Cap each dataset at 250 (not jointly); if combined payload too big, Gemini will likely truncate response — handle as parse_error fallback (already exists) |
| Frontend renders a clean_number that doesn't actually exist in the call list (bad data) | The `Link` to `/call/<n>` will hit the backend's 404 page; existing CallDetailPage already handles this gracefully |
| Older cached Gemini responses (if any) lack new fields | Schema fields are read with optional chaining (`item.call_percentage?.`) — old shape renders without the badge, no crash |

---

## 7. Execution Order & Verification Gates

```
Task A (backend, add Clean Number) ─┐
Task B (backend, raise cap)        ─┼─▶ Task C (rewrite prompts)
                                    │       │
                                    │       ▼
                                    │   Manual prompt verification with sample
                                    │   payload (~30 calls) — inspect raw JSON
                                    ▼
Task D (frontend rendering) ──▶ E2E smoke (T-D1 → E4) ──▶ Commit + Push + PR + Merge ──▶ Vercel/Render auto-deploy
```

Each gate must be verified before moving to the next.

---

## 8. Estimated Effort

| Phase | Time |
|-------|------|
| Task A (clean_number include) | 5 min |
| Task B (cap raise) | 2 min |
| Task C (prompt rewrite + schema) | 30-40 min |
| Task D (frontend rendering) | 30 min |
| E2E manual testing in browser | 10-15 min |
| Commit + push + PR + merge + redeploy | 5 min |
| **Total** | **~90 minutes** |

---

## 9. Rollback Plan

If the new prompts produce noticeably worse output (hallucinated numbers, weak themes, broken JSON):

1. On GitHub, find the merged PR for this work → click **Revert** → merge the revert PR.
2. Vercel/Render auto-redeploy back to the previous prompts within ~5 minutes.

No data or migrations involved — fully reversible.

---

## 10. Open Questions Before Execution

None — all 8 clarifying questions resolved above. Ready to execute on confirmation.

---

## 11. The "Go" signal

When ready, reply:
> **"Go ahead — execute the plan."**

I'll do Tasks A → D, run E2E in browser, commit, push, and hand you the GitHub PR link to merge.
