# Filters Issue — Implementation Plan

**Status:** Draft
**Owner:** Engineering
**Last updated:** 2026-04-30
**Scope:** Frontend only (`frontend/src/pages/AnalyticsDashboard.jsx`, `frontend/src/pages/CallListPage.jsx`)

---

## 1. Goals

1. Seamless landing from Analytics Dashboard → Call Listing page with **all** active dashboard filters auto-applied.
2. Add `is_converted` filter on the Analytics Dashboard page.
3. Filter parity: every filter present on Analytics Dashboard must also exist on Call Listing page.
4. All filters on Call Listing page must work correctly (multi-select arrays, city↔store mapping honored).

---

## 2. Root-Cause Summary (from prior audit)

| # | Defect | Location |
|---|--------|----------|
| D1 | `handleMatrixClick` forwards only `intentFilter`, `expFilter`, dates — drops `cityFilter`, `storeFilter`, `npsAgentFilter`, `visitFilter`, `categoryFilter`, `callTypeFilter`, `npsBrandFilter` | [AnalyticsDashboard.jsx:392-394](frontend/src/pages/AnalyticsDashboard.jsx) |
| D2 | `navigateToListWithFilter` forwards only the single clicked filter + dates — drops all other active dashboard filters | [AnalyticsDashboard.jsx:396-398](frontend/src/pages/AnalyticsDashboard.jsx) |
| D3 | Filter values sent as **strings** (e.g. `'Hyderabad'`) instead of **arrays** (e.g. `['Hyderabad']`); CallListPage treats them as arrays via `.includes()` — works by accident for substring matches but breaks downstream (city↔store validation, multi-select UI, etc.) | [AnalyticsDashboard.jsx:392-398](frontend/src/pages/AnalyticsDashboard.jsx), [CallListPage.jsx:38-49](frontend/src/pages/CallListPage.jsx) |
| D4 | `handleMatrixClick` overrides any pre-existing `intentFilter` from dashboard with a single value (replace not merge) — but spec says preserve+add. Special semantics: matrix click means user wants **only** that intent×exp combo, not the union with previous intent filter. Needs explicit narrowing logic. | [AnalyticsDashboard.jsx:392-394](frontend/src/pages/AnalyticsDashboard.jsx) |
| D5 | "View All Reports" button forwards only dates — drops all dashboard filters | [AnalyticsDashboard.jsx:475](frontend/src/pages/AnalyticsDashboard.jsx) |
| D6 | Filters on dashboard but missing on Call Listing page: `callTypeFilter`, `visitFilter` (visit intent), `npsAgentFilter`, `npsBrandFilter` | [CallListPage.jsx:17-26](frontend/src/pages/CallListPage.jsx) |
| D7 | `is_converted` filter doesn't exist on Analytics Dashboard | [AnalyticsDashboard.jsx:30-39](frontend/src/pages/AnalyticsDashboard.jsx) |

---

## 3. Filter Parity Matrix (target state)

| Filter | Analytics Dashboard | Call Listing | Notes |
|---|:---:|:---:|---|
| City | ✅ existing | ✅ existing | multi-select |
| Store | ✅ existing | ✅ existing | constrained by city via `city_store_mapping.json` |
| Call Type | ✅ existing | ➕ **ADD** | multi-select from `data.calls[].call_type` |
| Purchase Intent | ✅ existing | ✅ existing | HIGH/MEDIUM/LOW |
| Visit Intent | ✅ existing | ➕ **ADD** | HIGH/MEDIUM/LOW; field = `visit_rating` |
| Experience | ➕ **ADD** (toolbar) | ✅ existing | HIGH/MEDIUM/LOW; field = `experience_rating` (currently only set via matrix click) |
| Agent NPS | ✅ existing | ➕ **ADD** | HIGH(≥8) / MEDIUM(5–7) / LOW(<5); bucket logic |
| Brand NPS | ✅ existing | ➕ **ADD** | same bucket logic |
| Category | ✅ existing | ✅ existing | multi-select |
| Funnel Stage | ➕ **ADD** (toolbar) | ✅ existing | for parity |
| Price Bucket | ➕ **ADD** (toolbar) | ✅ existing | for parity |
| Purchase Barrier | ➕ **ADD** (toolbar) | ✅ existing | for parity |
| Is Converted | ➕ **ADD** | ➕ **ADD** | YES / NO; matches existing normalization (`"1"`/`"true"`/`"yes"`) |
| Date range | ✅ existing | ✅ existing | start + end |

> **Decision needed (confirm before implementation):** Should we add Funnel/Price/Barrier/Experience to the Analytics Dashboard toolbar for *full* parity (Goal #3 says yes)? My recommendation: **yes** — the spec is explicit. Flagged here so it's not a surprise.

---

## 4. Implementation Tasks

Each task has: **What**, **Where**, **Acceptance Criteria**, and **Test Cases**.

---

### Task 1 — Centralize filter state & build a shared filter payload

**What:** Refactor `handleMatrixClick` and `navigateToListWithFilter` to build a single payload that includes **all** currently-active dashboard filters as arrays, then merge in the click-specific narrowing.

**Where:** [AnalyticsDashboard.jsx:392-398](frontend/src/pages/AnalyticsDashboard.jsx)

**Implementation sketch:**
```js
const buildActiveFiltersPayload = () => ({
  cityFilter,
  storeFilter,
  callTypeFilter,
  intentFilter,
  visitFilter,
  expFilter,         // new dashboard filter (Task 4)
  npsAgentFilter,
  npsBrandFilter,
  categoryFilter,
  funnelFilter,      // new (Task 4)
  priceFilter,       // new (Task 4)
  barrierFilter,     // new (Task 4)
  convertedFilter,   // new (Task 3)
  startDate,
  endDate,
});

const handleMatrixClick = (intent, exp) => {
  navigate('/listing', {
    state: {
      ...buildActiveFiltersPayload(),
      intentFilter: [intent],   // narrow to clicked cell
      expFilter: [exp],
    },
  });
};

const navigateToListWithFilter = (key, value) => {
  const base = buildActiveFiltersPayload();
  const existing = Array.isArray(base[key]) ? base[key] : [];
  navigate('/listing', {
    state: {
      ...base,
      [key]: existing.includes(value) ? existing : [...existing, value],   // preserve + add
    },
  });
};

// "View All Reports" button: forward all active filters
onClick={() => navigate('/listing', { state: buildActiveFiltersPayload() })}
```

**Acceptance criteria:**
- Every navigation from dashboard → list carries all active filter state as arrays.
- Matrix click *narrows* intent/exp to the clicked cell (single-element array), regardless of prior multi-select state.
- Table-row click for `cityFilter='Hyderabad'` when dashboard has `cityFilter=['Mumbai']` → result is `['Mumbai','Hyderabad']` (preserve + add). For row clicks where the filter type is the same as a pre-existing one, **the user's intent is to add a sibling**, not replace.
- All values sent as arrays.

**Test cases:**

| TC# | Scenario | Steps | Expected |
|---|---|---|---|
| T1.1 | Empty dashboard → matrix click | Open dashboard with no filters → click HIGH×LOW cell | List page opens with `intentFilter=['HIGH']`, `expFilter=['LOW']`, all other filters empty |
| T1.2 | Hyderabad active → matrix click | Set city=Hyderabad → click HIGH×LOW | List page: `cityFilter=['Hyderabad']`, `intentFilter=['HIGH']`, `expFilter=['LOW']` |
| T1.3 | Multi-city + multi-cat → matrix click | city=[Hyd,Mum], cat=[Mattress] → click MED×HIGH | List page receives all three sets correctly as arrays |
| T1.4 | City row click with city already set | city=[Mum] active → click "Hyderabad" row | List page: `cityFilter=['Mumbai','Hyderabad']` |
| T1.5 | Category row click with city set | city=[Hyd] → click "Bedding" category row | List page: `cityFilter=['Hyd']`, `categoryFilter=['Bedding']` |
| T1.6 | "View All Reports" button | Set 4 different filters → click button | List page receives all 4 filter sets unchanged |
| T1.7 | Date range carryover | Set startDate, endDate, click any element | Dates round-trip correctly |
| T1.8 | Reset state preserved | Reset dashboard → click matrix | Only intent/exp on list page; no leftover state |

---

### Task 2 — Fix CallListPage to receive arrays defensively

**What:** `CallListPage.jsx:38-49` blindly does `setIntentFilter(location.state.intentFilter)`. If a string slips through (legacy/bug), state breaks downstream. Add a `toArray()` guard so any incoming string OR array is normalized to an array.

**Where:** [CallListPage.jsx:37-49](frontend/src/pages/CallListPage.jsx)

**Implementation sketch:**
```js
const toArray = (v) => (Array.isArray(v) ? v : v != null ? [v] : []);

if (location.state) {
  if (location.state.intentFilter)   setIntentFilter(toArray(location.state.intentFilter));
  if (location.state.expFilter)      setExpFilter(toArray(location.state.expFilter));
  if (location.state.storeFilter)    setStoreFilter(toArray(location.state.storeFilter));
  if (location.state.cityFilter)     setCityFilter(toArray(location.state.cityFilter));
  if (location.state.priceFilter)    setPriceFilter(toArray(location.state.priceFilter));
  if (location.state.categoryFilter) setCategoryFilter(toArray(location.state.categoryFilter));
  if (location.state.barrierFilter)  setBarrierFilter(toArray(location.state.barrierFilter));
  if (location.state.funnelFilter)   setFunnelFilter(toArray(location.state.funnelFilter));
  // NEW filters from Task 5:
  if (location.state.callTypeFilter)  setCallTypeFilter(toArray(location.state.callTypeFilter));
  if (location.state.visitFilter)     setVisitFilter(toArray(location.state.visitFilter));
  if (location.state.npsAgentFilter)  setNpsAgentFilter(toArray(location.state.npsAgentFilter));
  if (location.state.npsBrandFilter)  setNpsBrandFilter(toArray(location.state.npsBrandFilter));
  if (location.state.convertedFilter) setConvertedFilter(toArray(location.state.convertedFilter));
  if (location.state.startDate) setStartDate(location.state.startDate);
  if (location.state.endDate)   setEndDate(location.state.endDate);
}
```

**Acceptance criteria:**
- `cityFilter` state is always `string[]` after navigation, regardless of input shape.
- `cityFilter.length > 0` correctly triggers the city↔store validation effect at [CallListPage.jsx:162-169](frontend/src/pages/CallListPage.jsx).

**Test cases:**

| TC# | Scenario | Expected |
|---|---|---|
| T2.1 | Receive `cityFilter='Hyderabad'` (string) | State becomes `['Hyderabad']` |
| T2.2 | Receive `cityFilter=['Hyd','Mum']` | State unchanged: `['Hyd','Mum']` |
| T2.3 | Receive `cityFilter=undefined` | State stays `[]` (no setter called) |
| T2.4 | Receive `cityFilter=null` | State stays `[]` |
| T2.5 | Hyderabad navigated → store dropdown | Only Hyderabad's 4 stores appear in dropdown |

---

### Task 3 — Add `is_converted` filter to Analytics Dashboard

**What:** New `convertedFilter` state, `FilterSelect` in toolbar, applied in `filteredCalls` memo, included in payload (Task 1).

**Where:** [AnalyticsDashboard.jsx:30-39](frontend/src/pages/AnalyticsDashboard.jsx) (state), [AnalyticsDashboard.jsx:71-129](frontend/src/pages/AnalyticsDashboard.jsx) (filter logic), [AnalyticsDashboard.jsx:526-619](frontend/src/pages/AnalyticsDashboard.jsx) (toolbar), [AnalyticsDashboard.jsx:609-618](frontend/src/pages/AnalyticsDashboard.jsx) (Reset All).

**Implementation sketch:**
```js
const [convertedFilter, setConvertedFilter] = useState([]);   // ['YES'] | ['NO'] | ['YES','NO'] | []

// helper — single source of truth
const isConverted = (r) => {
  const v = String(r.is_converted ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
};

// inside filteredCalls memo:
if (convertedFilter.length > 0) {
  result = result.filter(r => {
    const conv = isConverted(r);
    if (convertedFilter.includes('YES') && conv) return true;
    if (convertedFilter.includes('NO')  && !conv) return true;
    return false;
  });
}

// toolbar:
<FilterSelect label="Converted" value={convertedFilter}
  onChange={setConvertedFilter} options={['YES', 'NO']} />

// reset:
setConvertedFilter([]);
```

**Acceptance criteria:**
- Selecting `YES` shows only converted calls in dashboard metrics.
- Selecting `NO` shows only non-converted.
- Selecting both = no narrowing (equivalent to empty).
- Filter participates in payload sent to Call Listing.

**Test cases:**

| TC# | Scenario | Expected |
|---|---|---|
| T3.1 | Apply Converted=YES on dashboard | KPIs show only converted; conversion% = 100% |
| T3.2 | Apply Converted=NO | Conversion% = 0%, Total Revenue should be ≈₹0 (sanity check; non-converted may still have revenue field if data is dirty — log if so) |
| T3.3 | Click matrix HIGH×HIGH with Converted=YES | Land on list page with `convertedFilter=['YES']`, intent=HIGH, exp=HIGH |
| T3.4 | Reset All → Converted clears | `convertedFilter=[]` |
| T3.5 | Source data with `is_converted="1"`, `"true"`, `"yes"`, `"Yes"` | All recognized as converted |
| T3.6 | Source data with `is_converted=""`, `null`, `"0"`, `"no"` | All recognized as not converted |

---

### Task 4 — Add missing dashboard-toolbar filters: Experience, Funnel, Price, Barrier

**What:** Add `expFilter`, `funnelFilter`, `priceFilter`, `barrierFilter` to dashboard toolbar (Goal #3 parity).

**Where:** [AnalyticsDashboard.jsx:30-39](frontend/src/pages/AnalyticsDashboard.jsx), [AnalyticsDashboard.jsx:71-129](frontend/src/pages/AnalyticsDashboard.jsx), [AnalyticsDashboard.jsx:526-619](frontend/src/pages/AnalyticsDashboard.jsx).

**Implementation sketch:**
```js
const [expFilter,    setExpFilter]    = useState([]);
const [funnelFilter, setFunnelFilter] = useState([]);
const [priceFilter,  setPriceFilter]  = useState([]);
const [barrierFilter,setBarrierFilter]= useState([]);

// memos for option lists
const funnelStages   = useMemo(() => [...new Set((data.reports||[]).map(r=>r.funnel_stage).filter(Boolean))].sort(), [data.reports]);
const priceBuckets   = useMemo(() => [...new Set((data.reports||[]).map(r=>r.price_bucket).filter(Boolean))].sort(), [data.reports]);
const barriers       = useMemo(() => [...new Set((data.reports||[]).map(r=>r.purchase_barrier).filter(Boolean))].sort(), [data.reports]);

// in filteredCalls memo:
if (expFilter.length > 0)     result = result.filter(r => expFilter.includes(r.experience_rating));
if (funnelFilter.length > 0)  result = result.filter(r => funnelFilter.includes(r.funnel_stage));
if (priceFilter.length > 0)   result = result.filter(r => priceFilter.includes(r.price_bucket));
if (barrierFilter.length > 0) result = result.filter(r => barrierFilter.includes(r.purchase_barrier));

// reset:
setExpFilter([]); setFunnelFilter([]); setPriceFilter([]); setBarrierFilter([]);
```

**Acceptance criteria:**
- Each new filter narrows dashboard metrics correctly.
- Each is included in payload to Call Listing (Task 1).
- Reset All clears them.

**Test cases:**

| TC# | Scenario | Expected |
|---|---|---|
| T4.1 | Apply Experience=HIGH → KPIs | Only HIGH-experience calls counted |
| T4.2 | Apply Funnel=Discovery → city table | Only Discovery-stage calls in city aggregations |
| T4.3 | Apply Price=`₹50K-1L` + click matrix cell | List page receives `priceFilter=['₹50K-1L']` + intent/exp |
| T4.4 | Apply Barrier=Price + click city row | List page receives both `barrierFilter` and `cityFilter` |
| T4.5 | Reset All | All four cleared |

---

### Task 5 — Add missing list-page filters: CallType, Visit, AgentNPS, BrandNPS, Converted

**What:** Add the 5 missing filters on Call Listing page so dashboard parity is achieved.

**Where:** [CallListPage.jsx:11-26](frontend/src/pages/CallListPage.jsx) (state), [CallListPage.jsx:51-96](frontend/src/pages/CallListPage.jsx) (filter logic), [CallListPage.jsx:264-322](frontend/src/pages/CallListPage.jsx) (toolbar), [CallListPage.jsx:171-175](frontend/src/pages/CallListPage.jsx) (reset).

**Implementation sketch:**
```js
const [callTypeFilter,  setCallTypeFilter]  = useState([]);
const [visitFilter,     setVisitFilter]     = useState([]);
const [npsAgentFilter,  setNpsAgentFilter]  = useState([]);
const [npsBrandFilter,  setNpsBrandFilter]  = useState([]);
const [convertedFilter, setConvertedFilter] = useState([]);

const callTypes = useMemo(() => [...new Set((data.calls||[]).map(c=>c.call_type).filter(Boolean))].sort(), [data.calls]);

// inside filteredCalls:
if (callTypeFilter.length > 0) result = result.filter(c => callTypeFilter.includes(c.call_type));
if (visitFilter.length > 0)    result = result.filter(c => visitFilter.includes(c.visit_rating));

if (npsAgentFilter.length > 0) {
  result = result.filter(c => {
    const v = c.nps_agent;
    const bucket = v >= 8 ? 'HIGH' : v >= 5 ? 'MEDIUM' : 'LOW';
    return npsAgentFilter.includes(bucket);
  });
}
if (npsBrandFilter.length > 0) {
  result = result.filter(c => {
    const v = c.nps_brand;
    const bucket = v >= 8 ? 'HIGH' : v >= 5 ? 'MEDIUM' : 'LOW';
    return npsBrandFilter.includes(bucket);
  });
}
if (convertedFilter.length > 0) {
  result = result.filter(c => {
    const v = String(c.is_converted ?? '').toLowerCase();
    const conv = v === '1' || v === 'true' || v === 'yes';
    if (convertedFilter.includes('YES') && conv) return true;
    if (convertedFilter.includes('NO')  && !conv) return true;
    return false;
  });
}

// toolbar (add 5 FilterSelects with appropriate options)
// reset (add 5 setters to []
```

**Acceptance criteria:**
- All 5 new filters present on toolbar with multi-select.
- Logic mirrors dashboard for NPS bucket boundaries (HIGH≥8, MEDIUM 5–7, LOW<5).
- `is_converted` truth check matches dashboard exactly (`isConverted` helper preferably extracted to `utils/api.js` to avoid drift).

**Test cases:**

| TC# | Scenario | Expected |
|---|---|---|
| T5.1 | Land on list with `npsAgentFilter=['LOW']` from dashboard | Only calls with `nps_agent < 5` shown |
| T5.2 | Manually select Agent NPS=HIGH on list | Only `nps_agent ≥ 8` shown |
| T5.3 | Boundary: `nps_agent=5` → MEDIUM bucket | ✅ |
| T5.4 | Boundary: `nps_agent=8` → HIGH bucket | ✅ |
| T5.5 | Visit filter MEDIUM | Only `visit_rating==='MEDIUM'` |
| T5.6 | Call Type = Service | Only matching call_type rows |
| T5.7 | Converted=YES | Only converted rows; Conversion% KPI = 100% |
| T5.8 | Reset on list page | All 5 cleared |

---

### Task 6 — Refactor: extract shared `isConverted()` and bucket helpers to `utils/api.js`

**What:** Avoid logic drift between dashboard and list page. Move to single source of truth.

**Where:** [frontend/src/utils/api.js](frontend/src/utils/api.js)

**Implementation sketch:**
```js
export const isConverted = (r) => {
  const v = String(r?.is_converted ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
};

export const npsBucket = (n) => {
  if (n >= 8) return 'HIGH';
  if (n >= 5) return 'MEDIUM';
  return 'LOW';
};
```

**Acceptance criteria:**
- Both pages import and use the helpers; no duplicate inline logic.

**Test cases:**

| TC# | Scenario | Expected |
|---|---|---|
| T6.1 | Grep `is_converted` in pages | Should only appear inside helper invocations / data shape, not in inline parsers (acceptable: existing `convertedCount` accumulators may continue to exist but should call `isConverted`) |
| T6.2 | NPS bucket thresholds | Identical results dashboard vs list for same input |

---

### Task 7 — End-to-End test pass

**What:** Once Tasks 1–6 land, run the full E2E flow against `frontend` dev server and verify the user's original bug is fixed plus regressions absent.

**How:**
- Start backend (`cd backend && python main.py` or equivalent — confirm command from project README).
- Start frontend (`cd frontend && npm run dev`).
- Walk through all test cases in §5 below in a real browser.

---

## 5. End-to-End Test Plan (final acceptance)

### 5.1 Original bug — must be fixed

| TC# | Steps | Expected |
|---|---|---|
| E1 | Dashboard → set City=Hyderabad → click "Low Agent NPS" matrix cell (HIGH×LOW) | Lands on list page with: City filter chip = Hyderabad, Intent=HIGH, Exp=LOW; Store dropdown shows ONLY Hyderabad's 4 stores from `city_store_mapping.json`; Table rows all have city=Hyderabad |
| E2 | Same as E1 but multi-city (Hyd + Mum) | Both cities preserved; Store dropdown = Hyd + Mum stores only |

### 5.2 All 7 navigation entry points carry filters

| TC# | Entry point | Pre-set filters | Expected on list page |
|---|---|---|---|
| E3 | "View All Reports" button | city=Hyd, intent=HIGH, dates set | All 3 forwarded |
| E4 | City row "Mumbai" click | city=Hyd active | List shows `cityFilter=['Hyd','Mum']` (preserve+add) |
| E5 | Store row click | city=Hyd, store=COCO BANJARA HILLS in dashboard | List shows both filters |
| E6 | Price row "₹50K+" click | city=Hyd, intent=HIGH | List has all three |
| E7 | Category row "Mattress" | barrier=Price | Both filters present |
| E8 | Barrier row "Pricing" | category=Bedding, city=Mum | All three on list |
| E9 | Matrix HIGH×HIGH | All 12 dashboard filters set | List receives all + intent/exp narrowed to single values |

### 5.3 Filter parity verified

| TC# | Action | Expected |
|---|---|---|
| E10 | Inspect Analytics Dashboard toolbar | Has: City, Store, Call Type, Intent, Visit, Experience, Agent NPS, Brand NPS, Category, Funnel, Price, Barrier, Converted, Date range = 14 filters |
| E11 | Inspect Call Listing toolbar | Same 14 filters present (search box additionally) |

### 5.4 Filters work standalone on Call Listing

| TC# | Action | Expected |
|---|---|---|
| E12 | Open list page directly (no nav state) → toggle each of the 14 filters individually | Each correctly narrows the table; matched count updates |
| E13 | Combine 5+ filters | Logical AND across all; table count consistent |
| E14 | Reset button | All filters and search cleared |
| E15 | City→Store dependency | Set City=Hyd → store dropdown limited to Hyd stores; previously selected non-Hyd stores auto-removed |

### 5.5 Edge cases

| TC# | Action | Expected |
|---|---|---|
| E16 | Navigate twice in sequence (back-forward) | `useEffect` on `location.state` doesn't re-apply stale state; user-modified filters preserved or reset cleanly (clarify: spec says re-apply on each new navigation) |
| E17 | Empty dashboard data | No crashes; all filter dropdowns gracefully show "No Data" |
| E18 | `is_converted` field missing on a row | Treated as "not converted"; no NaN |
| E19 | Date range alone | KPIs and table both narrow correctly |

---

## 6. Execution Order & Verification Gates

```
Task 6  (helpers)       ──┐
Task 3  (Converted dash)──┤
Task 4  (Exp/Funnel/...) ─┼─→ Task 1 (centralized payload) ──→ Task 2 (defensive parser) ──→ Task 5 (list-page filters) ──→ Task 7 (E2E)
                          │
```

After each task: run targeted test cases for that task before moving on.
After all tasks: run §5 (E2E) end-to-end in browser before marking done.

---

## 7. Out of Scope

- Backend changes (none required — all data is already on `data.calls` / `data.reports`).
- Persisting filter state across full page reloads (URL query params instead of `location.state`) — would be a nice follow-up, not part of this plan.
- Trends Dashboard / Insights Dashboard navigation paths.

---

## 8. Open Questions (please confirm before starting)

1. **Q1:** Confirm decision in §3 — add Experience/Funnel/Price/Barrier to dashboard toolbar for full parity? (Recommended: yes.)
2. **Q2:** For matrix click semantics — when user has `intentFilter=['HIGH','MEDIUM']` already set and clicks the LOW×HIGH cell, should we (a) **narrow** to `intentFilter=['LOW']` (matches user's pointed click intent), or (b) **add** to `['HIGH','MEDIUM','LOW']`? Plan currently uses (a) — confirm.
3. **Q3:** Persist via URL query string vs `location.state`? Current plan keeps `location.state`. URL would survive refresh but is a bigger change.
