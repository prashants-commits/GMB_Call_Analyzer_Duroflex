# AI Trainer for Store Staff — Product & Business Requirements (v1)

> **Working title:** *DuroCoach — AI Sales Trainer for Duroflex/SleepyHead Retail Stores*
> **Document type:** Phase-1 PRD (vision + functional spec). No engineering implementation plan yet — that follows in Phase-2 once the open questions in §14 are closed.
> **Status:** Draft for product owner review.
> **Companion docs to follow:** `AITrainer_TechPlan_v1.md` (architecture + sequencing), `AITrainer_PromptLibrary_v1.md` (final prompt copies).

---

## 0. Document Control

| Field | Value |
| --- | --- |
| Document | `AITrainer_Idea_v1.md` |
| Version | v1 (initial brain-dump → structured PRD) |
| Owner | Product (Prashant) |
| Reviewers | Sales Head, HR/L&D Head, Store Operations Head, Engineering Lead |
| Audience | PM, Engineering, QA, Sales Leadership, Store Managers |
| Working repo context | `D:/Conversations Analyzer/Call Analyzer + Trainer Demo` (FastAPI + React/Vite + Gemini call analyzer; in-memory CSV data) |
| Existing modules referenced | `backend/main.py`, `backend/csv_parser.py` (`CallDataStore`), `backend/gemini_service.py`, `frontend/src/App.jsx`, `frontend/src/components/Header.jsx`, `frontend/src/utils/city_store_mapping.json` |
| Glossary | See Appendix D |

---

## 1. TL;DR / Executive Summary

We are adding a **standalone, audio-first AI Sales Trainer** to the existing Duroflex Call Analyzer platform. It does three things:

1. **Diagnose.** For any selected store, ingest its **latest 100 real Assisted-Sales calls**, run a Gemini-powered **Store SWOT Score Card** that surfaces strengths, weaknesses, opportunities and threats in lead-handling quality — grounded in the existing analysis schema (Agent NPS, NPS Good/Bad aspects, Agent Learnings, RELAX, Hooks, Probing, Objections).
2. **Practice.** Let store staff conduct **5-minute audio mock calls** with an AI-customer that role-plays one of **50 LLM-distilled personas** (extracted from 500 real call transcripts). The AI customer speaks **English**; the staff member can reply in **English / Hindi / Hinglish**.
3. **Improve.** After every mock call, generate a **detailed Score Card** mirroring the real-call analysis taxonomy, plus an **Adoption Panel** for managers to track training cadence, score trends, and weakest skill areas across stores and individuals.

The trainer is **architecturally segregated** from the existing analyzer (separate router, separate tables/CSV files, separate static page) so live dashboard functionality is not at risk.

**Primary outcome we are betting on:** measurable lift in Agent-NPS and Conversion-% on real calls within 60 days of staff completing ≥10 mock-call drills.

---

## 2. Problem Statement & Why Now

### 2.1 Symptoms (from existing real-call analytics)

The Assisted Sales pipeline already exposes the diseases — we now need a cure that scales:

- **Inconsistent agent quality across stores.** Agent NPS, RELAX scores and Conversion-% vary widely across the ~30 COCO stores in `city_store_mapping.json`. The Insights tab exposes this; nothing is done to *fix* it.
- **Hooks are under-deployed.** Existing analytics show several conversion hooks (Sleep Trial, Video Demo, Mattress Measurement Guidance, Store Visit Driver) are missed in a large share of calls — losing leads that were otherwise warm.
- **Probing is shallow.** `11_Probing_Questions` in the analysis schema regularly scores low across stores (Why-Buying / Whom-For / Budget rarely asked → poor Need Discovery).
- **Objection handling is reactive.** Common barriers (Price, Distance, Competitor Comparison, Family Decision Pending) repeat across stores; there is no systematic drill to inoculate staff against them.
- **Onboarding is tribal.** New joiners learn by shadowing — no standard, measurable, on-demand training rep.
- **Coaching is lopsided.** Managers only have time to listen to a handful of bad calls per week — most staff get no individual feedback.

### 2.2 Why an *AI* trainer (vs more humans, more training videos, or roleplay with manager)

| Alternative | Why it falls short |
| --- | --- |
| Hire trainers | Doesn't scale to 30 stores, fixed cost, inconsistent delivery |
| Pre-recorded video training | Passive; no practice loop; no per-staff scoring |
| Manager-led roleplay | Manager bandwidth; subjective scoring; awkward power dynamic |
| External SaaS (Second Nature etc.) | Generic personas; no Duroflex/SleepyHead product knowledge; data leaves premise; pricing per seat |

An in-house, Gemini-powered trainer:

- Speaks the **same KPI language** as the existing Insights module — staff/manager mental model is preserved.
- Is **grounded in our own product catalog** (`duroflex_sleepyhead_products.json`) and our own real-call SWOT.
- Is **available 24×7**, scoring objective and reproducible.
- Captures **its own training data** — every mock call is itself a labeled call we can audit.

### 2.3 Why now

- We already have 500+ real Assisted-Sales transcripts with rich JSON analysis sitting in `gemini_pipeline.db`. They are the raw material for both the persona library and the SWOT.
- Gemini Live API and Indic TTS providers (AI4Bharat, Sarvam) reached commodity-grade voice quality and latency in 2025–2026.
- Sales leadership has a clear KPI (uplift Agent NPS and Conversion-%) and is asking for a coaching loop.

---

## 3. Vision & Strategic Outcomes

### 3.1 Vision (one sentence)

> **A store staff member can, in any 10-minute idle slot, get a personalized, scored, audio mock-call drill that is calibrated to their store's real weaknesses — and managers can see who is improving.**

### 3.2 Strategic outcomes (12-month horizon)

1. **Time-to-Productivity** for new joiners drops from ~6 weeks of shadowing to ~3 weeks of shadow + drill.
2. **Agent NPS** (existing `3a_Customer_Experience_Agent.Experience_Score`) average across COCO stores moves up by ≥1.0 point (on the 0–10 scale).
3. **Hook deployment rate** (existing `10_Conversion_Hooks_Used.Hooks_Used_Count`) moves up from current baseline by ≥1 hook/call on average.
4. **Conversion %** on Assisted Sales lifts by ≥3 percentage points in stores with ≥80% staff adoption.
5. **Adoption** — at least 70% of frontline staff complete ≥1 mock call/week within 90 days of launch.

These are aspirational targets in v1 — the PRD doesn't commit to all five, but every feature should *move at least one of them*.

---

## 4. Goals, Non-Goals, Success Metrics

### 4.1 In-scope (v1 / MVP)

- Store selection (single store at a time per training session).
- Store SWOT Score Card generated on demand from the latest 100 Assisted-Sales calls.
- Persona library: a one-time, admin-triggered extraction of **50 personas** from up to 500 real transcripts. Stored as a reviewable JSON file. Not regenerated automatically.
- Mock-call engine for **English customer ↔ English/Hindi/Hinglish agent**, hard 5-minute cap.
- Per-call Score Card (detailed, schema-aligned with existing real-call taxonomy).
- Adoption panel: per store, per staff, per call; date-range filterable.
- Audio recordings of mock calls saved to disk in the project folder.
- New routes under `/api/trainer/*`; new static page `static/trainer.html`; **zero changes** to existing routes/services in `app/services/gmb_analytics.py`, `app/services/assisted_analytics.py`, `app/services/gemini_analyzer.py`.

### 4.2 Out-of-scope (v1; revisit in v2/v3)

- Regional language customer voice (Tamil, Telugu, Kannada, Malayalam, Marathi, Bengali). v1 is **English customer voice only** (agent can speak Hindi/Hinglish, AI replies in English). See §16.
- Multi-store batch training, leaderboards, gamification, badges.
- Adaptive curriculum that re-weights persona selection based on **individual** weakness. v1 ships a **store-level** bias instead: 60% of picks drawn from the store SWOT's `recommended_drill_focus`, 40% pure random across the library (§14 D13). Per-staff adaptive weighting waits for v3.
- Voice biometrics / staff identity verification.
- Mobile-app native experience — v1 is a responsive **web** page only, designed for store iPad/laptop on Chrome/Edge.
- Real-time coaching (whisper hints during the call).
- Offline mode.

### 4.3 Non-goals (will not do, ever, in this product)

- Replacing human coaching. The trainer augments managers, never grades-for-firing.
- Storing/reusing customer phone numbers, names, or PII inside the persona library.
- Routing real customer calls through the AI. Mock-only, always.

### 4.4 Product success metrics

| Metric | How measured | Target (90 days post-launch) |
| --- | --- | --- |
| Adoption rate | distinct staff with ≥1 mock-call last 7 days / eligible staff | ≥70% |
| Drill volume | mock calls per active staff per week | ≥2 |
| Drill quality | % drills completed (not aborted before 4 min) | ≥80% |
| Score lift | per-staff Score Card avg between week-1 and week-4 | +5 points |
| Real-call uplift | store Agent-NPS avg (real calls, post-launch − pre-launch) | +1.0 |
| Cost per drill | Gemini Live + storage | ≤ ₹15 per drill (target; see §17 — to be validated against actual Gemini Live billing in pilot week 1) |

### 4.5 Anti-metrics (watch list)

- **Score inflation.** AI scoring AI's own conversation may drift upward over time. Sample 5% of mock-call recordings for human spot-check monthly.
- **Burnout / gaming.** Staff may mock-call lazily to tick a box. Track drill-completion-rate and avg drill duration; alert if both fall.
- **Real-call regression.** If real-call NPS drops in a store while drill volume rises, investigate (training may be teaching the wrong things).

---

## 5. Target Users & Personas

### 5.1 Primary user — *Store Staff Manager / Sales Associate ("Trainee")*

- Age 22–45, English/Hindi bilingual, Hindi/Hinglish more comfortable than pure English.
- Works on the shop floor; uses store iPad/laptop in pockets of free time.
- Variable tech comfort. Needs **one-button-to-start** UX.
- Motivation: improve own metrics, climb store rankings, become Senior Associate.
- Anxiety: being judged, accent shame, mid-call panic.

### 5.2 Secondary user — *Store Manager / Cluster Head ("Coach")*

- Owns the store P&L; cares about training adoption and score trend.
- Uses the Adoption Panel; rarely the trainer itself.
- Wants to drill into a specific staff's worst-scored mock call to coach.

### 5.3 Tertiary user — *Sales/L&D Head ("Program Owner")*

- Owns the rollout across all 30+ COCO stores.
- Uses cross-store comparisons and aggregate SWOTs.
- Approves the persona library; tweaks scoring rubric weights.
- Reviews monthly real-call uplift vs drill volume.

### 5.4 Internal user — *Admin (existing role in `app/core/auth.py`)*

- Triggers persona-library generation; reviews/edits persona JSON; resets a staff's drill quota; deletes a problematic recording.

---

## 6. End-to-End User Journey

### 6.1 Trainee journey (happy path, ~7 minutes)

```
[1] Trainee opens Trainer page  → logs in (existing session middleware)
[2] Selects own Store (dropdown, default = last used)
[3] Identifies self (staff name from store roster)         ← per §14 D1
[4] Sees their Store SWOT Score Card (cached, latest 100 calls)
[5] Clicks "Start Mock Call"
[6] System picks a Persona (random / biased by SWOT weakness — see §15)
[7] Browser asks for mic permission → countdown 3-2-1
[8] AI customer speaks first line; live conversation begins (full-duplex)
[9] Live timer counts down 5:00 → 0:00. At 4:30 a soft "wrap up" cue. At 5:00 hard stop.
[10] AI customer says closing line; call ends; audio uploads.
[11] Loading screen ~30s while Gemini scores the recording.
[12] Score Card displayed: overall, sectional, top 3 strengths, top 3 gaps, replay clips, recommended next persona.
[13] Trainee can replay audio, share to manager, or "Try Again".
```

### 6.2 Coach journey (~3 minutes per drill audited)

```
[1] Coach opens Adoption Panel
[2] Filters: own Store, last 7 days
[3] Sees roster: each staff, drill count, latest score, trend arrow (↑/↓/=)
[4] Clicks a staff with a downward arrow
[5] Sees their drill list: persona, duration, date, score
[6] Clicks one drill → full Score Card + audio player + transcript
[7] Optionally posts a "Coach Note" against the drill (free-text, 200 chars).
```

### 6.3 Program Owner journey (~10 minutes weekly)

```
[1] Trainer Home → Cross-Store Adoption
[2] Sees grid: 30 stores × {drill count, avg score, real-call NPS Δ}
[3] Sorts by lowest adoption / lowest score / largest negative Δ
[4] Clicks store → store SWOT + adoption snapshot
[5] Optionally "Re-generate Persona Library" if monthly cadence is due
[6] Spot-audits a random sample of mock calls for AI scoring quality
```

### 6.4 Failure-mode journeys

- **Mic blocked.** Banner: "Microphone is blocked. Click the lock icon → allow." Cannot proceed.
- **Network drops mid-call.** Reconnect within 10s preserves session; else mock call is marked `aborted`, no score generated, drill quota refunded.
- **Trainee aborts < 60s.** Drill is `aborted`, no score, no quota deduction.
- **Trainee aborts ≥ 60s.** Drill is `aborted`, partial score generated (greyed out), counted toward quota.
- **No persona library exists.** Trainer page shows "Persona library not generated. Ask an Admin." for non-admins.
- **Store has < 30 analyzed calls.** SWOT shown with a banner "Low-confidence SWOT — only N calls analyzed in this store."

---

## 7. Functional Modules

The trainer breaks into **six modules** plus one cross-cutting Quota & Cost Guardrail.

| ID | Module | Triggered by | Output |
| --- | --- | --- | --- |
| M1 | Store Selection & Eligibility | Trainee opens page | Selected store + eligibility flag |
| M2 | Store SWOT Score Card | Trainee selects store | Cached JSON + UI card |
| M3 | Persona Library | Admin (one-time + monthly refresh) | `data/trainer/personas_v{n}.json` |
| M4 | Mock Call Engine | Trainee clicks Start | Audio recording + transcript |
| M5 | Per-Call Score Card | Mock call ends | Score Card JSON + UI |
| M6 | Adoption Panel | Coach / Program Owner | Aggregated views |
| X1 | Quota & Cost Guardrails | Every drill start/end | Allow/deny + cost log |

Each module spelled out below.

---

### M1 — Store Selection & Eligibility

**Inputs.**
- City→Store mapping from existing `city_store_mapping.json`.
- Staff roster keyed by store, per §14 D1.

**Behaviour.**
- Two-step picker: City → Store. Default to last selection per staff (localStorage).
- For non-admin trainees: only their own store is selectable (resolved via the post-login picker, §14 D1).
- Eligibility flag computed: `store_eligible_for_swot = analyzed_call_count(store) >= 30`. If false, M2 still runs but flags low-confidence.
- Eligibility flag computed: `store_eligible_for_drill = persona_library_exists() AND mic_capable_browser()`.

**UI.**
- City dropdown (alphabetical), Store dropdown (alphabetical inside city), large "Continue" button.
- "Last used: COCO INDIRANAGAR, Bengaluru — Continue" shortcut.

**Edge cases.**
- New store added to `city_store_mapping.json` but no calls yet → eligible for drill, not SWOT.
- Staff is in city A but visiting store in city B → allow override with confirmation.

---

### M2 — Store SWOT Score Card

**Purpose.** A diagnostic snapshot of the store's lead-handling quality. The single most important screen; sets the curriculum.

**Data source.** Latest 100 *completed* (`status='completed'`) Assisted Sales recordings for the selected store, ordered by `call_start_datetime DESC`. If <30 calls, badge as low-confidence. If <10 calls, refuse to generate.

**Critical columns extracted from each call (already in `AssistedAnalysis.analysis_json`).** This is the explicit answer to the user's brief — bare-minimum columns to feed the SWOT prompt:

| Bucket | Column / JSON path | Why it matters for SWOT |
| --- | --- | --- |
| Identity | `store_name`, `agent_name`, `call_start_datetime`, `is_converted` | Aggregation key + outcome label |
| Customer experience | `3a_Customer_Experience_Agent.Experience_Score` (Agent NPS, 0-10) | Headline KPI |
| Customer experience | `3a_Customer_Experience_Agent.Good` (NPS Good Aspects) | What works — extract themes |
| Customer experience | `3a_Customer_Experience_Agent.Bad` (NPS Bad Aspects) | What hurts — extract themes |
| Coaching | `13_Agent_Learnings` | Already-distilled learnings; cluster these |
| Need discovery | `11_Probing_Questions.*.Asked` and `.Score` | Probing maturity signal |
| Process | `16_RELAX_Framework.{R,E,L,A,X}.Score` | Sales process adherence |
| Process | `10_Conversion_Hooks_Used.*.Used` and `Hooks_Used_Count` | Hook deployment |
| Skill | `12_Agent_Evaluation.Main_Skills.*` and `.Secondary_Traits.*` (Product Knowledge, Sales Skills, Upsell, Need Discovery, Objection Handling, Agent Nature) | Skill matrix |
| Customer | `2_Lead_Qualification.Lead_Relevance`, `.Customer_Reachability` | Lead quality vs lost-on-quality |
| Customer | `5_Purchase_Readiness.Score` (1–5) | Pipeline strength |
| Customer | `4_Funnel_Analysis.Stage`, `.Timeline_to_Purchase` | Funnel mix |
| Friction | `8_Barriers_And_Objections.{Engagement, StoreVisit, Purchase}` (3 barrier types) | Recurring objections |
| Demand | `6_Product_Intelligence.Category`, `.Sub_Category`, `.Collection`, `.Customer_Verbatim_Product`, `.Budget_Mentioned`, `.Size_Mentioned` | Demand mix; pitch-correctness signal |
| Outcome | `is_converted`, `Hooks_Relevant_Count`, `5_Purchase_Readiness.Follow_Up_Priority` | Outcome KPIs |

**Aggregation rules.**

- Numeric columns → mean, median, p10, p90, std.
- Categorical → frequency table, top-3 values.
- Free-text Good/Bad/Learnings → group all 100 calls into a single text block, **sent verbatim to Gemini** for thematic clustering. Don't pre-summarize on the client.
- Hook usage → % of calls where `Used == 'Yes'` for each hook; flag any hook with <30% as a Weakness.
- Probing → % of calls where each probing question was `Asked == 'Yes'`; flag any with <40% as a Weakness.

**SWOT prompt strategy** (full prompt skeleton in Appendix A). Two-stage call to keep cost predictable and reasoning grounded:

- **Stage 1 (Map / Cheap — Gemini Flash).** Per-call sentence-level extraction of "what worked" and "what hurt" from the free-text fields. Output a JSON list of micro-themes per call. Skipped if `Good`/`Bad`/`Learnings` are empty.
- **Stage 2 (Reduce / Pro — Gemini Pro).** Single Gemini Pro call with: numeric aggregates, categorical aggregates, the union of micro-themes, and a fixed system prompt. Outputs the SWOT JSON below. Cached in `data/trainer/store_swot/{store}_{date}.json`. Re-generated on demand or weekly automatically.

**SWOT output schema (UI-rendered as a Score Card).**

```json
{
  "store_name": "COCO INDIRANAGAR",
  "generated_at": "2026-04-30T11:42:00Z",
  "calls_analyzed": 100,
  "date_range": {"from": "2026-02-15", "to": "2026-04-29"},
  "headline_kpis": {
    "agent_nps_avg": 7.2,
    "agent_nps_p10": 4.0,
    "agent_nps_p90": 9.0,
    "conversion_pct": 18.4,
    "hooks_used_avg": 2.1,
    "relax_avg": 6.8,
    "purchase_readiness_avg": 2.9,
    "bad_calls_pct": 14.0
  },
  "strengths": [
    {"theme": "Warm opening", "evidence_count": 71, "example_calls": [123, 456, 789], "supporting_columns": ["3a.Good", "RELAX.R"]}
  ],
  "weaknesses": [
    {"theme": "Sleep Trial hook missed", "deployment_pct": 12, "lost_revenue_signal": "high", "drill_priority": 1}
  ],
  "opportunities": [
    {"theme": "Latex / Cooling sub-category demand rising", "evidence_count": 34}
  ],
  "threats": [
    {"theme": "Competitor (Wakefit) mentioned in 22% of low-NPS calls", "evidence_count": 22}
  ],
  "skill_matrix": {
    "product_knowledge": {"score": 7.1, "rank_in_company": "P40"},
    "objection_handling": {"score": 5.4, "rank_in_company": "P15"},
    "..." : "..."
  },
  "recommended_drill_focus": [
    {"persona_id": 17, "reason": "Targets Sleep Trial + Price objection; store deploys Sleep Trial in only 12% of calls"},
    {"persona_id": 24, "reason": "Tests Spouse-Decision-Maker handling; store has 31% lost calls on this barrier"},
    {"persona_id": 33, "reason": "Tests Wakefit comparison; store has high competitor-mention rate"}
  ],
  "confidence": "high",
  "caveats": ["Persona-distilled themes may over-index on negative calls."]
}
```

**UI rendering.**

- Top: 4 large KPI tiles (Agent NPS, Conversion%, Hooks/call, Bad-call%). Coloured by tertile vs company benchmark.
- Middle: 2×2 SWOT grid. Each cell a stack of theme cards with evidence count and a "View calls" link that deep-links to the existing Insights tab pre-filtered.
- Bottom: Skill Radar chart (6 skills), Top-3 Recommended Personas (cards with "Drill this" CTA).

**Refresh policy.**

- Auto-refresh weekly (background job).
- Manual refresh button (rate-limited to 1/hour per store) for admin.
- Cache key includes store name + max(call_id) of the 100 calls — auto-invalidates when new calls appear.

---

### M3 — Persona Library

**Purpose.** A curated set of **50 distinct customer personas/queries** that drive every mock call. Built **once** by an admin from the corpus of 500 latest analyzed Assisted-Sales transcripts.

**Why 50, not 30 or 100?** 50 gives ≥1 persona per axis combination across the diversity matrix in §10 without becoming exhausting to maintain. Tunable.

**Generation pipeline.**

- **Input.** Up to 500 Assisted-Sales `analysis_json` blobs, ordered by `call_start_datetime DESC`, filtered to `status='completed'`. Strip PII (Customer_Name, Customer_Verbatim_Product if it contains a phone number).
- **Stage A — Per-call signature extraction (Gemini Flash, parallel via existing key-rotation in `gemini_analyzer.py`).** Per call → `{persona_signature_v1: {language, gender_signal, age_band_signal, decision_maker, use_case, pain_point, product_category, product_specifics, budget_band, urgency, primary_objection, secondary_objection, research_depth, emotional_tone, hook_that_worked, hook_that_failed, conversion_outcome, brand_orientation}}`. Note explicitly: gender/age are *signals from speech*, not certainties — flagged as such.
- **Stage B — Cluster + persona synthesis (Gemini Pro, single call with the full signature list).** Asks Gemini to: (a) deduplicate, (b) bucket by axis, (c) sample 50 personas with **explicit diversity constraints from §10**, (d) write each persona's backstory + opening line + secret context.
- **Stage C — Admin review UI.** A table view of all 50 with edit/disable/regenerate-one buttons. Admin must mark the library `published` before trainees can use it.

**Persona JSON schema (one entry; full list in `data/trainer/personas_v{n}.json`).**

```json
{
  "persona_id": 17,
  "version": 1,
  "title": "Mid-30s mother, back pain, ₹35k budget, weekend buyer",
  "language_preference": "Hinglish",  // English | Hindi | Hinglish — agent side; AI always speaks English
  "demographic_signal": {"gender_hint": "female", "age_band": "31-40"},
  "decision_maker": "Joint with husband",
  "use_case": "Self — chronic back pain",
  "pain_or_need": "Orthopedic Support + Cooling",
  "product_category_interest": "DUROPEDIC MATTRESS",
  "product_specifics_known": ["Heard of Duropedic Back Magic", "Saw an Instagram ad"],
  "budget_band": "₹30k-₹40k",
  "urgency": "Within 2 weeks",
  "research_depth": "Medium — compared Wakefit and SleepyHead online",
  "primary_objection": "Price — wants to bring it under ₹30k",
  "secondary_objection": "Wants to consult husband before deciding",
  "winning_moves": ["Sleep Trial hook", "Mattress Measurement Guidance", "EMI option", "Need Discovery: ask about back pain history"],
  "trap_moves": ["Pushing premium upgrade without addressing price", "Skipping spouse-decision question"],
  "opening_line_for_ai": "Hi, I saw an ad for Duroflex Back Magic mattresses. Can you tell me the price for a queen size?",
  "secret_context": "She has been self-medicating for back pain for 2 years; sleeps poorly; husband is the financial decision-maker but she initiates research.",
  "emotional_arc": "Starts polite and curious; gets cautious when price is mentioned; warms up if agent asks about pain history first.",
  "expected_call_difficulty": "Medium",
  "expected_score_band": {"low": 50, "high": 80},
  "tags": ["mattress", "back-pain", "spouse-decision", "price-sensitive", "duropedic"],
  "approved_by": "admin@duroflex.com",
  "approved_at": "2026-04-29T16:11:00Z"
}
```

**Diversity guarantees** (enforced in Stage B prompt; see §10 for the full matrix).

- Gender signal: ~50/50 male/female.
- Language preference: ~40% English-first, ~30% Hindi-first, ~30% Hinglish.
- Product category mix mirrors real-call distribution but ensures ≥3 personas per major category.
- Budget bands span Mass (<₹15k), Mid (₹15-30k), Premium (₹30-60k), Luxury (₹60k+).
- Decision-maker: Self / Spouse / Joint / Parents / Family — each ≥4 personas.
- Difficulty: Easy (~15), Medium (~25), Hard (~10).

**Persona maintenance.**

- Library is **versioned** (`v1`, `v2` …); every version is immutable once published. Generating a new version is an explicit admin action.
- Score Cards always reference the persona version used (`persona_v1.id=17`) so historical scores stay interpretable.
- Suggested cadence: regenerate quarterly, or whenever real-call distribution shifts materially.

---

### M4 — Mock Call Engine (realtime audio)

**This is the highest-risk module. UX must feel like a real phone call.**

#### 4.1 Architecture decision — **Gemini Live API** as primary; open-source fallback documented

We considered three paths:

| Path | Latency | Hindi/English mix quality | Cost | Open-source-ness | Verdict |
| --- | --- | --- | --- | --- | --- |
| **A. Gemini Live API** (`wss://generativelanguage.googleapis.com/.../BidiGenerateContent`) | <500 ms turn-taking | Good for English; Hindi mediocre but acceptable for v1 | Per-token, predictable | Closed | **Primary** |
| B. STT (faster-whisper) → Gemini Flash → TTS (AI4Bharat Indic-Parler / Sarvam) | 1–2 s | Best-in-class for Hindi/English | LLM-only ≈ low; infra cost moderate | Mostly open | **Documented fallback** in v2 if A is unaffordable or unsuitable |
| C. OpenAI Realtime / Sarvam Realtime | <500 ms | Good | Per-minute, high | Closed | Not chosen — outside our Gemini-first stack |

The brief explicitly says "use gemini via api wherever llm needed" and "no compromise on seamless calling experience". Path A satisfies both. We harden against Path A's risks (preview-API churn, cost) by abstracting the audio layer behind a `MockCallSession` interface so Path B can be swapped in without touching M5/M6.

#### 4.2 End-to-end flow

```
Browser (mic → MediaRecorder PCM 16k mono)
   ↕  WebSocket (binary audio chunks + JSON control)
FastAPI /ws/trainer/mock-call
   ↕  Gemini Live WebSocket (proxied; API key never exposed to browser)
   → Gemini Live (audio in / audio out) with system prompt = persona JSON + product catalog grounding
   ← audio chunks streamed back to browser → AudioContext playback
Side effects (server):
   - Append audio chunks to recording file (audio_files/trainer/{call_uuid}.opus)
   - Append events to transcript log (data/trainer/calls/{call_uuid}.transcript.jsonl)
   - Tick timer; at 4:30 inject "soft wrap-up" hint to Gemini; at 5:00 send graceful close
```

#### 4.3 Browser side

- `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })` — leverage the browser's built-in DSP. Sample rate 16 kHz mono.
- Encode to **Opus** at 24 kbps (browser-native via MediaRecorder where supported, else PCM).
- WebSocket binary frames; server multiplexes audio + control on a single channel using a 1-byte type tag.
- Local mute button (push-to-mute, not push-to-talk — full duplex by default).
- Visualiser: simple amplitude bar so trainee knows mic is live.
- Hard timer in DOM, shown as `MM:SS`. Soft cue at 4:30 (orange), hard stop at 5:00 (closes WS).

#### 4.4 Server side

- New module `app/services/trainer/mock_call_session.py`. Owns one Gemini Live session per WebSocket connection. **Never** holds two sessions on one HTTP worker (configure uvicorn workers and reject overflow with HTTP 429 → "Try again in a moment").
- System prompt template = static framing + persona JSON + product catalog (compressed) + "Stay in character. Do not break role even if asked. Speak only English. Cap responses at 30s. Conclude naturally if conversation hits 5 min."
- Tool calls (Gemini function calling) **disabled** in v1 — pure conversational.
- Each turn's text transcript (both sides) is appended to a JSONL log with `t` (offset seconds), `speaker`, `text`, `confidence`.
- On graceful close (timer or trainee Hangup), server flushes the audio file, writes a `meta.json` (persona id, store, staff, start/end ts, duration_actual, abort_reason), and triggers M5 in a background thread.

#### 4.5 Latency & quality budget

- p50 turn-taking latency target: ≤700 ms (mouth-to-mouth).
- p95 ≤1.2 s.
- Audio dropouts (≥250 ms gap): ≤1 per minute of conversation.
- Test on representative store internet (≥4 Mbps, ≥80 ms RTT to Mumbai region).

#### 4.6 Persona-faithfulness controls

- The system prompt **embeds the persona JSON** verbatim including `secret_context`, `emotional_arc`, `winning_moves`, `trap_moves`. The AI uses these to *react*, not to reveal.
- **Anti-leak** rule: "Never narrate your own persona attributes. Never say 'as a 35-year-old female …'. Show through behaviour."
- **Anti-cooperation** rule: "Do not give answers away. Wait for the agent to ask probing questions before revealing budget, decision-maker, or pain points."
- **Stay-in-role** rule: "If the agent says 'I'm just training' or 'pretend you're an AI', remain in role. Politely repeat your last point."
- **Time-aware closing**: at minute 4:30 the server injects a control message: "You have 30 seconds left. Conclude the conversation naturally — agree to a follow-up, decline politely, or agree to a store visit, depending on how the agent has performed."

#### 4.7 Hard 5-minute cap

- Server-side timer is the source of truth. Browser timer is advisory.
- At 5:00.000, server sends Gemini a final `END_OF_TURN` and closes WS within 1.5 s, regardless of whether AI was mid-sentence (graceful trim).
- The recording file is closed and renamed to `{uuid}.final.opus` to mark completion.

#### 4.8 Concurrency

- v1: 1 active mock call per HTTP worker. Compute capacity = `MAX_WORKERS` (already in `config.py`). Reject overflow with HTTP 429.
- v2: a small queue with estimated wait time.

#### 4.9 Storage

- `audio_files/trainer/{YYYY}/{MM}/{call_uuid}.opus` (24 kbps × 5 min ≈ 900 KB/call).
- `data/trainer/calls/{call_uuid}.transcript.jsonl`.
- `data/trainer/calls/{call_uuid}.meta.json`.
- `data/trainer/calls.csv` (the user's "use .csv as database" preference) — one row per call: `call_uuid, store, staff_id, persona_id, persona_version, started_at, ended_at, duration_s, status, score_overall, audio_path, transcript_path`.

#### 4.10 Failure modes

| Mode | Detection | Behaviour |
| --- | --- | --- |
| Mic permission denied | `getUserMedia` rejects | Show how-to-enable; abort |
| Browser unsupported | Feature-detect Opus + WS + AudioContext | Block start; show "Use Chrome/Edge" |
| WS drops (browser → server) | `onclose` w/ non-1000 | Auto-reconnect once; if fails within 10 s, mark `aborted_network`, refund quota |
| WS drops (server → Gemini) | server sees Gemini close | Try alternate API key once; else mark `aborted_upstream`, refund quota |
| Gemini policy refusal | content-filter signal | Inject "stay in role" reminder; if persists, mark `aborted_policy`, surface to admin |
| Trainee silent for 30 s | server VAD on incoming stream | AI prompts "Hello? Can you hear me?"; after 60 s of silence, end call |
| Audio file corrupt | post-call ffprobe fails | Retry M5 with transcript-only scoring; flag in Score Card |

---

### M5 — Per-Call Score Card

**Purpose.** After every mock call, produce a comprehensive Score Card mirroring the existing real-call analysis schema so coaches and trainees use the same vocabulary on real and mock calls.

**Inputs.**
- `audio_files/trainer/.../*.opus` (the recording).
- `*.transcript.jsonl` (turn-by-turn text from Gemini Live).
- `*.meta.json` (persona, store, staff).
- The persona JSON (for "did the agent recognise the trap moves / use the winning moves").

**Process.**
- Re-use **the existing `gemini_analyzer.py` Assisted-Sales prompt** as the *primary* scoring backbone. This guarantees vocabulary parity with real-call scoring — managers see identical fields. Mock-call output is **never** written into the existing `AssistedRecording`/`AssistedAnalysis` tables; it lives in `data/trainer/scorecards/{call_uuid}.json` and the summary row in `data/trainer/calls.csv` (per §14 D17 and §15 A1).
- Augment with **trainer-specific scoring overlay** (a second Gemini Pro call) that takes the transcript + persona JSON and returns:

```json
{
  "drill_overlay": {
    "winning_moves_detected": ["Sleep Trial hook", "Need Discovery: pain history"],
    "winning_moves_missed": ["Mattress Measurement Guidance"],
    "trap_moves_committed": [],
    "persona_faithfulness_check": "AI persona stayed in character: yes",
    "agent_language_mix": {"english_pct": 55, "hindi_pct": 30, "hinglish_pct": 15},
    "talk_to_listen_ratio": "62/38",
    "filler_words_per_min": 4.1,
    "interruptions_by_agent": 2,
    "interruptions_by_customer": 5,
    "time_to_first_probing_question_s": 48,
    "objection_handling_quality": {"score": 6, "evidence": "Agent acknowledged price concern but did not pivot to EMI."},
    "closing_strength": {"score": 7, "evidence": "Agent secured a store visit commitment for Saturday."},
    "section_scores": {
      "opening": 8,
      "need_discovery": 6,
      "product_pitch": 7,
      "objection_handling": 6,
      "hook_usage": 5,
      "closing": 7,
      "soft_skills": 8,
      "brand_compliance": 9,
      "time_management": 7
    },
    "overall_score": 70,
    "overall_band": "Good — needs hook discipline",
    "top_3_strengths": ["Warm opening", "Empathy on pain history", "Confirmed visit"],
    "top_3_gaps": ["Did not deploy Sleep Trial hook", "Missed cross-sell pillow", "Late probing"],
    "moment_clips": [
      {"t_start": 73, "t_end": 92, "label": "Strong empathy moment"},
      {"t_start": 201, "t_end": 224, "label": "Missed Sleep Trial hook"}
    ],
    "next_recommended_persona_id": 24,
    "next_recommended_reason": "Test spouse-decision-maker handling — current weak area."
  }
}
```

**Scoring rubric weights** (default; admin-tunable):

| Section | Weight | Source signal |
| --- | --- | --- |
| Opening | 10 | Greeting, brand intro, permission to speak |
| Need Discovery | 15 | Probing-question count + quality |
| Product Pitch | 15 | Catalog-faithful product mention + fit to need |
| Objection Handling | 15 | Each objection in persona's list — addressed? |
| Hook Usage | 15 | # winning_moves used / # winning_moves expected |
| Closing | 10 | Concrete next step (visit / WA / callback) |
| Soft Skills | 10 | Tone, listening, no-interruption ratio |
| Brand Compliance | 5 | No false claims, no over-promising |
| Time Management | 5 | Used 5 min well — neither rushed nor wasted |
| **Total** | **100** | |

**Output.**
- Persisted to `data/trainer/scorecards/{call_uuid}.json` and a flat row in `data/trainer/calls.csv`.
- Rendered in the Trainee post-call screen (see §12.4).

**Calibration plan.**
- For the first 4 weeks of operation, sample 5% of mock calls; have the L&D Head listen and re-score blind. Compare to AI score. If correlation < 0.7, retune weights / prompt.

---

### M6 — Adoption Panel

**Purpose.** Manager and Program Owner view of training engagement and outcomes.

**Filters.**
- Date range (default last 7 days; presets: today, 7d, 30d, custom).
- Store (default: own store for managers; "All" for Program Owner).
- Staff (multi-select dropdown).
- Persona difficulty (Easy/Medium/Hard).
- Score band (≤50, 51–70, 71–85, 86+).

**Views (sub-tabs).**

1. **Overview.** KPI tiles — Total Drills, Active Staff, Avg Score, Avg Score Δ vs prior period, Hours of practice. Sparkline of drills/day.
2. **Stores.** Table of stores: Drills, Active Staff, Avg Score, Real-call NPS Δ (joined to existing `assisted_analytics`). Sortable.
3. **Staff.** Table of staff for the selected store(s): Drills, Avg Score, Latest Score, Trend Arrow, Worst Section (e.g., "Hook Usage 4.1/15").
4. **Calls.** Paginated list of every drill: timestamp, store, staff, persona title, duration, score band, abort_reason if any. Click → drill detail.
5. **Drill Detail.** The same Score Card screen as the trainee sees, plus: audio player with timeline markers for moment_clips, transcript, "Coach Note" composer, link to a similar real-call.

**Cross-link to real-call analytics.** From the Drill Detail page a "View this staff's real calls" button deep-links into the existing Insights page pre-filtered to that agent name. Resolved via the roster's `real_call_agent_name_variants` column (§14 D1, D2). Where the column is empty for a staff member, the button is hidden gracefully — the rest of the Drill Detail page still renders.

**Permissions.**
- Trainee: only own drills.
- Coach: own store's drills.
- Program Owner / Admin: all drills.

---

### X1 — Quota & Cost Guardrails (cross-cutting)

- Per-staff quota: default **5 drills/day**, soft cap (warning + admin override).
- Per-store quota: default **30 drills/day** across all staff.
- Per-tenant daily cost cap (₹) — pulled from a config var; on breach, new drills queue with a polite "Daily training capacity reached, try after midnight" message. No silent failures.
- Cost log per drill: `cost_inr_estimate` computed from input/output audio seconds × Gemini-Live unit rates (kept in `config.py` so finance can update without redeploy).

---

## 8. Data Model

The brief asks for **CSV-as-database** for v1. We honour that for trainer data only — the existing SQLite/Azure SQL stack is untouched.

### 8.1 Files (new — under `data/trainer/`)

| File | Purpose | Approx columns |
| --- | --- | --- |
| `personas_v{n}.json` | Persona library (immutable per version) | See §M3 schema |
| `personas_active.json` | Pointer file (`{ "active_version": 1 }`) | tiny |
| `store_swot/{store_slug}_{date}.json` | Cached SWOT outputs | See §M2 schema |
| `staff_roster.csv` | Store ↔ Staff mapping | `staff_id, full_name, store_name, role, status, real_call_agent_name` |
| `calls.csv` | Master log of all mock calls | `call_uuid, store, staff_id, persona_id, persona_version, started_at, ended_at, duration_s, status, abort_reason, score_overall, score_band, audio_path, transcript_path, scorecard_path, cost_inr` |
| `scorecards/{call_uuid}.json` | Full per-call scorecard | See §M5 schema |
| `quota_log.csv` | Per-staff per-day drill counter | `staff_id, date, drills_started, drills_completed, drills_aborted, cost_inr` |
| `coach_notes.csv` | Coach annotations on drills | `note_id, call_uuid, author, posted_at, body` |
| `audit_log.csv` | Admin actions (regenerate persona, refund quota …) | `ts, actor, action, target, payload` |

### 8.2 Why CSV (and where it'll hurt)

- Pros: zero schema migrations; easy export; matches existing `outputs/call_analysis.csv` convention; admins can spot-edit personas in Excel.
- Cons: no atomic concurrent writes (mitigation: append-only files + per-day rotation), no indices (mitigation: panel does in-memory pandas filtering, fine up to ~50k drill rows), no foreign keys (mitigation: integrity check job nightly).

If/when drill volume crosses ~10k/month, **migrate `calls.csv` → a new `trainer_calls` table in the existing SQLite DB**, but keep persona library and scorecards as JSON files. (Recommended threshold; not a v1 promise.)

### 8.3 Existing-app touch points (read-only)

- Reads `AssistedRecording` + `AssistedAnalysis` from `gemini_pipeline.db` for SWOT and persona-extraction inputs.
- Reads `city_store_mapping.json`.
- Reads `duroflex_sleepyhead_products.json`.
- **No writes** to any existing table or file.

---

## 9. Technical Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Existing App  (UNCHANGED)                                           │
│  static/index.html, /api/recordings, /api/analytics, /api/chat,...   │
│  app/services/{gmb_analytics, assisted_analytics, gemini_analyzer}   │
│  Local SQLite (gemini_pipeline.db), Azure SQL (read-only)            │
└──────────────────────────────────────────────────────────────────────┘
                  ▲ read-only (SWOT inputs, persona corpus)
                  │
┌──────────────────────────────────────────────────────────────────────┐
│  AI Trainer (NEW — segregated)                                       │
│                                                                      │
│  static/trainer.html  +  static/trainer.js  +  static/trainer.css    │
│                            │                                         │
│  app/api/trainer_router.py (FastAPI sub-router under /api/trainer/*) │
│     ├── /api/trainer/stores                  (GET)                   │
│     ├── /api/trainer/swot/{store}            (GET, POST refresh)     │
│     ├── /api/trainer/personas                (GET; POST = admin)     │
│     ├── /api/trainer/personas/regenerate     (POST admin)            │
│     ├── /api/trainer/drill/start             (POST → call_uuid)      │
│     ├── /api/trainer/drill/{uuid}/audio      (GET stream)            │
│     ├── /api/trainer/drill/{uuid}/scorecard  (GET)                   │
│     ├── /api/trainer/adoption                (GET aggregations)      │
│     ├── /ws/trainer/drill/{uuid}             (WebSocket — mock call) │
│     └── /api/trainer/coach-note              (POST)                  │
│                                                                      │
│  app/services/trainer/                                               │
│     ├── store_swot.py        (M2)                                    │
│     ├── persona_builder.py   (M3)                                    │
│     ├── mock_call_session.py (M4 — owns Gemini Live WS proxy)        │
│     ├── scorecard.py         (M5 — re-uses existing prompt + overlay)│
│     ├── adoption.py          (M6 — pandas aggregations)              │
│     └── quota.py             (X1)                                    │
│                                                                      │
│  data/trainer/   audio_files/trainer/   logs/trainer/                │
└──────────────────────────────────────────────────────────────────────┘
```

**Segregation principles.**

- New router is included in `app/main.py` with a single line; no existing route is altered.
- New static files are siblings of existing ones; the navigation menu in `static/index.html` gains one new entry "AI Trainer" (the only existing-file edit needed).
- Persona generation re-uses `_get_next_client()` round-robin and `MAX_WORKERS` from existing `gemini_analyzer.py` but does not touch its prompts/queries.
- The existing `SessionAuthMiddleware` already protects `/api/*` and `/static/*` — trainer endpoints inherit it for free.
- A separate `TRAINER_ENABLED` feature flag in `.env` (default `false`) lets ops kill the trainer without redeploy. When false: the menu item is hidden, all `/api/trainer/*` return 503.

**Tech choices summary.**

| Concern | Choice | Why |
| --- | --- | --- |
| Web framework | FastAPI (existing) | Same stack |
| LLM | Gemini 2.5 Pro for SWOT/persona/scorecard, Gemini Flash for per-call extraction, Gemini Live for mock-call audio | Brief mandate + best fit |
| Audio capture | Browser MediaRecorder + Opus | Native, low-friction |
| Audio transport | WebSocket (binary) | Required for Gemini Live |
| Storage | CSV + JSON files under `data/trainer/` and `audio_files/trainer/` | Brief mandate |
| Auth | Existing session middleware | Reuse |
| TTS/STT (fallback path) | AI4Bharat Indic-Parler-TTS + faster-whisper | Open-source, India-tuned |
| Charts | Plotly (already in `requirements.txt`) | Reuse |
| Frontend framework | Vanilla JS (existing convention) | Reuse |

---

## 10. The 50 Personas — Diversity Matrix

Diversity is enforced by Stage-B prompt constraints. Below is the **target distribution** the prompt must satisfy (ranges allow some flex).

| Axis | Buckets | Target count (out of 50) |
| --- | --- | --- |
| Gender signal | Male / Female | ~25 / ~25 |
| Age band | 22–30 / 31–45 / 46–60 / 60+ | ~12 / ~22 / ~12 / ~4 |
| Income / Budget band | Mass <₹15k / Mid ₹15-30k / Premium ₹30-60k / Luxury ₹60k+ | ~10 / ~18 / ~14 / ~8 |
| Use case | Self / Spouse / Parents / Child / Family / Guest / Office | ~16 / ~10 / ~10 / ~5 / ~5 / ~3 / ~1 |
| Pain / need | Back pain / Soft comfort / Firm / Cooling / Orthopedic / Space-saving / Durability / Generic | ~10 / ~6 / ~6 / ~6 / ~8 / ~4 / ~5 / ~5 |
| Product category interest | Duropedic Mattress / Energise Mattress / Essential Mattress / Natural Living / SleepyHead / Sofa / Recliner / Cot / Adjustable Bed / Pillow / Protector | mirrors real-call mix; ≥3 each for major categories |
| Decision-maker | Caller / Spouse / Joint / Family / Someone Else | ~14 / ~10 / ~14 / ~8 / ~4 |
| Research depth | Well-researched / Medium / Casual browser | ~14 / ~22 / ~14 |
| Buying-style | Value-for-money / Offers-oriented / Luxury buyer / Brand-loyal / Brand-neutral / Skeptical | ~12 / ~12 / ~6 / ~6 / ~10 / ~4 |
| Urgency | Immediate (≤7d) / Short (1–4w) / Long (>1m) / Exploring (no timeline) | ~12 / ~16 / ~12 / ~10 |
| Primary objection | Price / Distance / Family decision / Wants discount / Already purchased / Trust / Comparison / Delivery / Size / No barrier | even spread; ≥3 per major objection |
| Language preference (agent-side) | English / Hindi / Hinglish | ~20 / ~15 / ~15 |
| Difficulty | Easy / Medium / Hard | ~15 / ~25 / ~10 |
| Emotional tone | Polite / Curious / Anxious / Skeptical / Aggressive / Distracted / Warm | spread |

**Worked persona examples (sketches — final list comes from M3):**

1. *"Sleep Trial Test."* 28F, mid-budget, back pain, never heard of Duropedic, polite. Tests Sleep Trial hook + Need Discovery. Easy.
2. *"Spouse Gate."* 38M, premium budget, says "let me ask my wife" twice. Tests joint-decision handling. Medium.
3. *"Wakefit Comparison."* 32M, well-researched, opens with "Wakefit is ₹X cheaper". Tests competitor-comparison handling. Hard.
4. *"Senior Parent."* 62F (daughter calling on her behalf), orthopedic need, low tech. Tests empathy + simple language. Medium.
5. *"Distance Deflection."* 45M, wants store visit but says "store is too far". Tests Video Demo + WhatsApp Follow-up hooks. Medium.
6. *"Discount Hunter."* 30M, opens with "what's the maximum discount". Tests offer framing + value pitch. Hard.
7. *"Already-Bought-from-Competitor"* — wrong-lead handling. Easy (handle politely + WA follow-up for future).
8. *"Cooling Mattress for Hyderabad summer."* 35F, very specific need. Tests product-knowledge depth (Energise / Arctic). Medium.
9. *"Office Bulk."* 41M, 6 mattresses for guest house. Tests B2B handling + escalation. Hard.
10. *"Hindi-only auntie."* 55F, no English, pain-point clear. Tests Hindi sales skills + simplification. Medium.

… and 40 more, generated by Stage B and reviewed by admin.

---

## 11. Prompts (specifications, not final copy)

Final prompt copy will live in `app/services/trainer/prompts.py` and a companion `AITrainer_PromptLibrary_v1.md`. Below are skeletons.

### 11.1 SWOT prompt skeleton (Gemini Pro)

- **Role:** "You are a senior retail sales coach for Duroflex Group, auditing one store's last 100 sales calls."
- **Inputs:** numeric aggregates table + categorical frequency tables + the union of `Good`/`Bad`/`Agent_Learnings` from all 100 calls (deduplicated).
- **Constraints:** Cite evidence. Quantify everything in % or counts. Use the existing skill vocabulary (RELAX, Hooks, Probing, Skills). Output the JSON in §M2. Keep total themes ≤4 per quadrant. Identify top-3 personas (by `persona_id`) the store should drill, with reasoning.
- **Anti-hallucination:** "Do not invent calls. Every theme must reference an evidence_count derived from the inputs."

### 11.2 Persona-extraction prompt skeleton (two stages)

- **Stage A (per-call signature, Flash):** Strict JSON output. Skip if call has too few words. Mark uncertain fields as `null`.
- **Stage B (cluster + synthesise, Pro):** Receives ≤500 signatures. Outputs 50 personas honouring the §10 distribution. Each persona must include `winning_moves`, `trap_moves`, `secret_context`, `opening_line_for_ai`, `expected_call_difficulty`. Forbid PII; replace with archetypal names ("Priya", "Rajesh", "Suresh uncle").

### 11.3 Mock-customer system prompt skeleton (Gemini Live)

- **Role:** "You are a real prospective customer (the persona below). You are speaking on the phone with a Duroflex store representative."
- **Persona JSON** (verbatim).
- **Behaviour rules:** Stay strictly in role. Speak only English. Reveal information only when asked. React to good probing with warmth, to push-selling with friction. Do not narrate emotions — show them. Conversation must end naturally within 5 minutes. If the agent is silent for 30 s, prompt them once.
- **Brand-safety rules:** Do not invent prices or warranties; if pressed, say "I'm not sure, can you tell me?". Don't disparage real competitors by name beyond what the persona allows.
- **Time-aware appendix** (server injects at 4:30): "You have 30 seconds left. Conclude naturally."

### 11.4 Scoring overlay prompt skeleton (Gemini Pro, post-call)

- **Inputs:** transcript JSONL + persona JSON + audio metadata (duration, talk-listen).
- **Outputs:** `drill_overlay` JSON in §M5, plus the standard Assisted-Sales analysis JSON (re-using the existing prompt verbatim for vocabulary parity).
- **Constraints:** Cite timestamps for every "moment_clip". Top-3 strengths/gaps must each have evidence quotes from transcript.

---

## 12. UX / UI Specifications

A new top-level menu item **"AI Trainer"** in the existing nav (`static/index.html` line ~22). Single-page-app pattern (SPA) consistent with current site.

### 12.1 Trainer Home (Trainee landing)

- City + Store picker (M1).
- Required "Identify yourself" dropdown sourced from `staff_roster.csv` (§14 D1); blocks Start until selected.
- Two big tiles:
  - **"View My Store SWOT"** → opens M2 panel.
  - **"Start a Mock Call"** → opens persona picker (or random) → M4.
- Right sidebar: "My Last 5 Drills" (date, persona, score chip).

### 12.2 Store SWOT Panel (M2)

- 4 KPI tiles (Agent NPS, Conversion%, Hooks/call, Bad-call%).
- 2×2 SWOT grid; each cell is a vertical stack of theme cards.
- Skill radar (6 skills).
- "Recommended Drills" carousel — 3 persona cards with **Drill this →** buttons.
- "View underlying calls" deep-link to existing Insights tab pre-filtered.
- Last refreshed timestamp + admin Refresh button.

### 12.3 Mock Call Screen (M4)

- Pre-call checklist: mic test + headphone reminder + "stay quiet for 5 minutes" tip.
- Persona card (revealed at start) showing only the public bits — title, 1-line context — never the `secret_context`.
- Big call timer (5:00 → 0:00). Soft amber at 4:30, hard red at 4:55.
- Two waveform bars (you / customer) for engagement feedback.
- Mute and Hangup buttons. No transcript shown live (avoids reading instead of listening).
- Post-hangup: 30-second loading "Generating your Score Card…".

### 12.4 Score Card Screen (M5)

- Hero: overall score (e.g., 72/100), band ("Good — needs hook discipline"), persona title.
- Audio player with timeline markers for `moment_clips` (click to jump).
- Section bars (9 sections) with weight, score, and an explanation tooltip.
- Top-3 strengths / top-3 gaps cards with quoted evidence.
- "Try this next" persona suggestion card.
- Buttons: **Replay**, **Try Again with same persona**, **New random persona**, **Share with manager**.

### 12.5 Adoption Panel (M6)

- Filters bar (top).
- 5 KPI tiles.
- Sub-tabs: Overview / Stores / Staff / Calls / Drill Detail.
- Tables are sortable, filterable, exportable to CSV.
- Drill Detail page = Score Card + audio + transcript + Coach Note composer.

### 12.6 Visual language

- Reuse existing CSS variables (`var(--gold)`, `var(--text)` from `style.css`).
- Reuse existing component classes (`dash-metric-card`, `dash-btn`, `dash-tab`).
- New components only where unavoidable (call timer, waveform, persona card).

---

## 13. Risks, Blindspots, Edge Cases

### 13.1 Product / behavioural risks

- **Score-anxiety side effect.** Public scores can demotivate. Mitigation: managers see scores; staff see only their own + cohort percentile.
- **Teaching to the test.** Staff may learn the personas' "winning moves" and parrot them on real customers. Mitigation: persona library refresh (quarterly), trap_moves measurement, periodic surprise personas.
- **AI scoring drift.** Mitigation: monthly human spot-check (5%); alert on sudden score-shift.
- **Persona stereotype risk.** Persona templates can reinforce caste/region/gender stereotypes from the source corpus. Mitigation: admin review gate; explicit anti-stereotype clause in Stage B prompt; legal/HR sign-off on the published library.
- **Manager weaponisation.** Coach uses scores to penalise rather than coach. Mitigation: programme governance — no scores in HR file in v1.

### 13.2 Technical risks

- **Gemini Live preview-API churn.** Mitigation: abstract behind `MockCallSession`; document Path-B fallback (faster-whisper + Gemini Flash + AI4Bharat TTS) as v2 escape hatch.
- **Cost blow-up.** Mitigation: per-staff/store quotas (X1); daily cap; cost-per-drill telemetry.
- **Hindi/Hinglish recognition quality.** Gemini Live's Indian-English is acceptable; mixed Hindi-English mid-sentence can be brittle. Mitigation: agent-side speech is recognised by Gemini for the Score Card; fallback to faster-whisper for offline re-transcription if confidence is low.
- **Browser audio quirks.** Safari has Opus and getUserMedia quirks. Mitigation: v1 supports Chrome/Edge only on desktop; Firefox best-effort.
- **WebSocket through corporate firewalls.** Some store networks block WSS. Mitigation: use port 443; document a "test your network" pre-flight in the home page.
- **Concurrent training during real-call answering.** Staff with mic on and headphones might miss real customer queues. Mitigation: training is opt-in only; recommend manager-approved time slots.

### 13.3 Compliance / privacy risks

- **Staff voice recording = personal data under DPDP Act 2023.** Mitigation: explicit consent at first use; configurable retention (default 90 days); delete-on-request workflow.
- **Customer data in persona corpus.** Mitigation: PII strip (Customer_Name, phone-like substrings); persona names are archetypal not real.
- **Power asymmetry.** Mitigation: training data not used for performance reviews in v1; explicit policy stated in onboarding.

### 13.4 Edge cases

- Store with <30 analyzed calls → low-confidence SWOT, drilling still allowed.
- Persona library never published → hide drill button for non-admins.
- Two trainees on same machine → reject 2nd start.
- Trainee's `staff_id` not in roster → fallback to "Guest" — drill runs but doesn't roll up to manager view.
- Audio file disk full → reject new drills with clear error; admin alert.
- Gemini API key exhausted → next-key rotation; if all exhausted, 503 with "Service paused, try later".
- Staff toggles persona difficulty to "Easy" repeatedly → adoption panel flags pattern.
- Catastrophic moderation block → mark `aborted_policy`, surface in Admin audit log.

---

## 14. Decisions Log (committed for v1)

The Phase-1 reviewer asked me to make the calls. Below is what v1 ships with. Items needing external validation (cost ceiling, roster delivery) are flagged in §19 — they don't block design, only billing/onboarding.

> **How to read this:** each entry has a one-line **Decision**, a **Rationale** explaining the trade-off taken, and an **Owner / next-action** for who has to do something to honour the decision.

### D1. Staff identity = roster CSV + post-login picker

**Decision.** Add `data/trainer/staff_roster.csv` with columns `staff_id, full_name, store_name, role, joined_date, status, real_call_agent_name_variants` (semicolon-separated). After existing session login, trainee picks their name from a dropdown filtered to the selected store. `staff_id` becomes the canonical identity for every drill row, every quota counter, every audit-log entry.

**Rationale.** Cheapest path that meets attribution requirements. Avoids building per-staff auth, password resets, lockout flows. Reuses the existing `SessionAuthMiddleware` unchanged — the post-login picker is a UI step, not an auth step.

**Owner / next-action.** L&D Head owns the roster; produces v1 by pilot start, refreshes monthly. Engineering ships the picker UI + a small admin upload form (`POST /api/trainer/admin/roster`).

### D2. Real-call ↔ mock-call linkage uses `real_call_agent_name_variants`

**Decision.** The roster column `real_call_agent_name_variants` holds every spelling variant of the agent's name as it appears in `AssistedRecording.agent_name` (e.g., `"Priya R; PRIYA R; Priya Ranganathan"`). The Adoption Panel uses this to compute per-staff real-call NPS Δ. Where the column is empty, the cross-link is hidden gracefully — the rest of the panel still works.

**Rationale.** Real-call agent names are dirty (initials, partial spellings) and not worth force-cleaning at source. A roster-side mapping is the only pragmatic fix.

**Owner / next-action.** L&D Head fills variants on a best-effort basis using the existing Insights tab's `agent` filter dropdown as the universe of distinct values. Engineering builds a small "Diagnose mapping coverage" admin tool that flags rosters with <80% coverage.

### D3. Score visibility — trainee + manager + Program Owner; HR excluded; non-disciplinary

**Decision.**

| Role | Sees | Cannot see |
| --- | --- | --- |
| Trainee | Own scores; own anon percentile vs same-store cohort | Other staff's named scores |
| Coach (Store Manager) | Own store's staff drill list, scores, drill detail | Other stores |
| Program Owner / Sales Head / L&D Head | All stores, all staff | — |
| HR | Nothing in v1 | All scores |
| Admin | Everything (including audit log) | — |

Every Score Card screen and the consent form carry the footer: *"Drill scores are coaching signals only. They are not used in performance reviews, appraisals, or HR decisions in v1."*

**Rationale.** Removes the biggest behavioural risk (score-anxiety, manager weaponisation). Keeps the door open for opt-in HR integration later.

**Owner / next-action.** PM publishes the visibility policy in onboarding deck. Engineering enforces in API authz layer (role check on every adoption endpoint). HR informed, not granted access.

### D4. Quotas — 5 staff/day soft, 30 store/day, ₹3,000/day tenant cap (provisional)

**Decision.**

| Quota | Soft | Hard | Override |
| --- | --- | --- | --- |
| Per staff per day | 5 drills | 7 drills | Admin one-click + audit-log entry |
| Per staff per day (new joiner, ≤30 days since `joined_date`) | 10 drills | 12 drills | Admin override |
| Per store per day | 30 drills | 40 drills | Admin override |
| Per tenant per day (cost) | ₹3,000 | hard stop | Admin override + reason logged |

Soft = warning banner; hard = drill-start refused with the message "Daily training capacity reached, try after midnight".

Per-drill cost target ≤ **₹15** (5 minutes Gemini Live + scorecard pass). Validated against actual billing in pilot week 1; if real cost is materially different, quotas re-derived from the same ₹3,000/day ceiling without changing UX.

**Rationale.** Numbers are sized so a typical store (~5 staff) can comfortably do 25 drills/day under the soft cap and 50 under the hard cap, while the cost ceiling caps tenant-wide spend at ~₹90k/month. Gives finance a clear budgetable line.

**Owner / next-action.** Finance signs off ₹3,000/day before pilot. Engineering implements `app/services/trainer/quota.py` with all four counters reading/writing `data/trainer/quota_log.csv`. Numbers are config vars in `.env`, not constants.

### D5. AI customer speaks English only in v1

**Decision.** Mock-customer voice is English. Agent free to mix English/Hindi/Hinglish. AI does **not** switch to Hindi even if asked — it stays in role and continues English. No Hindi-initiated personas in v1.

**Rationale.** Gemini Live's English (incl. Indian-English voice) is production-quality today; its Hindi handling is uneven. v1 ships predictably; v3 introduces Hindi/regional via AI4Bharat / Sarvam once that integration is hardened.

**Owner / next-action.** PM communicates this in onboarding ("you can speak Hindi/Hinglish, the AI will reply in English — that's fine"). Engineering hard-codes the language constraint in the mock-customer system prompt.

### D6. Persona library — quarterly cadence, 1-of-2 approver, immutable versions

**Decision.** Default cadence is **every 90 days**. The trainer page shows a banner to admins when the active library is older than 90 days: *"Persona library v{n} is 92 days old — consider regenerating from latest 500 calls."* Approval to publish a new version requires sign-off from **Sales Head OR L&D Head** (1-of-2). Each published version is immutable; old versions are archived (`personas_v1.json`, `personas_v2.json`, …) and historical Score Cards retain their `persona_version` reference forever.

**Rationale.** Quarterly matches typical retail seasonality. 1-of-2 keeps the cadence achievable while preserving accountability. 2-of-2 was rejected as a politeness tax.

**Owner / next-action.** Sales Head + L&D Head agree on which of them is primary approver per quarter (alternating works). Engineering ships an admin "Regenerate library" button + a "Publish v{n+1}" gated on a signed-in approver.

### D7. Adoption is voluntary + manager-encouraged in v1

**Decision.** Drilling is opt-in. The Adoption Panel emails (or generates a downloadable digest, depending on email infra) a weekly summary to each Store Manager: *"Your store: {n} drills done by {k} staff this week, avg score {x}, last week: {y}."* For new joiners, HR onboarding checklist adds: *"Complete 5 mock-call drills in your first 2 weeks."* This is enforced socially by the manager, not by the system.

**Rationale.** Mandatory adoption + scores risks the worst outcomes (gaming, anxiety, unionised pushback). Voluntary + visibility gets us to ≥70% adoption without coercion (per industry baseline for similar tools).

**Owner / next-action.** L&D Head amends the new-joiner checklist. Engineering ships a CSV export from the Adoption Panel; auto-emailing is a v2 nice-to-have.

### D8. Hardware standard = Chrome 120+ on store iPad / Windows laptop, wired earbuds, network preflight

**Decision.**
- **Supported:** Chrome 120+ / Edge 120+ on iPadOS 17+ or Windows 10+. Firefox best-effort. Safari **not supported** in v1 (Opus / getUserMedia / WS quirks).
- **Hardware:** Wired earbuds or over-ear headset **mandatory** (UI shows a one-time reminder + a 5-second mic test that detects echo). Speakerphone refused (echo destroys Gemini Live turn-taking).
- **Network:** ≥4 Mbps down, ≤120 ms RTT to `generativelanguage.googleapis.com`. First-time-use runs a 10-second preflight (timed WS echo) and shows a clear pass/fail badge.

**Rationale.** Locking the hardware stack is the cheapest way to keep p95 latency under 1.2 s. Trying to support speakerphone or Safari triples QA cost for marginal coverage.

**Owner / next-action.** Store Ops procures a wired earbud per store (one-time cost). Engineering implements the preflight + the unsupported-browser banner.

### D9. Retention — audio 90d, transcript 365d, scorecard 3y; trainee delete-my-audio anytime

**Decision.**

| Artefact | Retention | Delete trigger |
| --- | --- | --- |
| Audio file (`*.opus`) | 90 days, then auto-deleted by nightly job | Trainee "Delete my audio" button (any time) |
| Transcript JSONL | 365 days | Auto + admin |
| Score Card JSON + `calls.csv` summary row | 3 years (analytics value) | Admin only, with reason logged |
| Coach notes | 3 years | Admin |
| Audit log | Forever | Never |

When a trainee deletes their audio, the corresponding `calls.csv` row is preserved but `audio_path` is nulled and a `deletion_event` is recorded. The Score Card remains viewable (it doesn't depend on audio).

**Rationale.** 90 days covers the typical coaching feedback loop (manager listens within 1–2 weeks); longer audio retention has weak coaching value and high DPDP exposure. Score Cards are anonymisable analytics, retained longer.

**Owner / next-action.** Legal/DPDP officer confirms the 90/365/3y windows are compatible with the consent form text. Engineering ships the nightly cleanup job + the trainee delete button.

### D10. SWOT thresholds — refuse <10, low-confidence 10–29, full ≥30

**Decision.** As proposed in §M2. Refuse generation below 10 calls (banner: "Insufficient data — need ≥10 analysed Assisted-Sales calls in this store"). 10–29: low-confidence badge across the SWOT, with a tooltip explaining "Themes may not be representative." ≥30: full confidence.

**Rationale.** 10 is the floor below which Gemini's thematic clustering is unreliable; 30 is the cohort size at which percentile statements become defensible.

**Owner / next-action.** Engineering enforces in `store_swot.py`. PM writes the banner copy.

### D11. Adoption Panel scope = M6 as designed + CSV export; cost dashboard deferred to v2

**Decision.** M6 ships exactly the five sub-tabs in §M6 (Overview / Stores / Staff / Calls / Drill Detail), plus a "Export current view to CSV" button on every table view. Training cost dashboard is **v2** — cost is logged per drill but not surfaced in v1.

**Rationale.** Confirming the brief without scope creep. CSV export is one day of work and unblocks any analytics the L&D team wants to do externally.

**Owner / next-action.** Engineering ships the panel + CSV export. PM confirms no other artefacts requested.

### D12. Vanna chat integration = deferred to v2

**Decision.** Out of scope for v1. v2 will add a small "Ask DuroCoach" widget on the Adoption Panel that uses Vanna over `data/trainer/calls.csv` for natural-language queries.

**Rationale.** Vanna is currently wired against the existing SQLite tables. Wiring it against CSV files plus persona JSON requires retraining and adding new tables to its catalogue — net new build, not a reuse. Defer.

**Owner / next-action.** Tracked for v2.

### D13. New-joiner curated path = deferred to v2; v1 uses uniform-random + SWOT bias

**Decision.** v1 persona picker:
- Default mode: **uniform random** from active library, optionally biased toward `recommended_drill_focus` from the trainee's store SWOT (60% biased, 40% pure random by default; admin-tunable).
- Alternative mode: trainee picks a specific persona from a browseable list (filtered by tags).
- v2 will add a curated **10-persona ramp** for new joiners (≤30 days since `joined_date`), in fixed difficulty order.

**Rationale.** The 60/40 split delivers most of the curriculum benefit (coaching where the store hurts most) without the build cost of a full adaptive engine. Pure-random would waste ~half of practice on already-strong areas.

**Owner / next-action.** Engineering implements the picker with the bias parameter as a config var. L&D Head decides per-store bias percentage if they want to override the default.

### D14. Catalog freshness owned by L&D Head; trainer reads file directly

**Decision.** `duroflex_sleepyhead_products.json` is the single source of truth. The trainer reads it on every persona generation and on every Score Card pass — no caching, no parallel copy. L&D Head reviews the file monthly and updates discontinued/added SKUs. The admin UI shows the file's `mtime` ("Catalog last modified: 2026-04-12") so freshness is visible. If `mtime` >60 days, a soft warning appears.

**Rationale.** Single source of truth wins. The mtime warning makes neglect visible without being obnoxious.

**Owner / next-action.** L&D Head adds the catalog review to monthly checklist. Engineering surfaces the mtime in the admin panel.

### D15. Anti-cheating in v1 = light-touch (surprise pivot 10%, drill pattern flags); no biometrics

**Decision.**
- In ~10% of drills (random), the AI customer injects a **surprise mid-call pivot** at minute 2:00–3:00 — e.g., "Actually, my husband just messaged — he wants pillows too. What pillows do you have?" — to defeat scripted answers.
- The Adoption Panel surfaces **pattern flags** to managers: a staff with ≥5 drills all under 100 s, all between 95–100 score, or all the same persona, gets a small ⚑ icon. Manager judgement, not automatic enforcement.
- No voice biometrics, no playback detection. Stakes too low to justify the build.

**Rationale.** Cheating mostly harms the cheater (no real-call uplift). Catching the worst cases at managerial level is enough.

**Owner / next-action.** Engineering implements the surprise pivot in the mock-customer prompt + the pattern-flag heuristic in the panel.

### D16. One persona library, brand-tagged

**Decision.** Single `personas_v{n}.json` file. Each persona has `brand: "Duroflex" | "SleepyHead" | "Both"`. Stores are tagged with their primary brand affiliation in the roster (or the city-store mapping — see §M1). The drill picker filters personas to `persona.brand IN (store_brand, "Both")`. "Both" personas are always available everywhere.

**Rationale.** One library is simpler to govern, version, and review than two. Tag-based filtering covers the use case without duplication.

**Owner / next-action.** Engineering adds the `brand` field to the persona schema + the picker filter. L&D Head tags each store's brand affiliation during roster setup.

### D17. Mock-call recordings are NOT re-analysed via existing `/api/upload`

**Decision.** M5 overlay is the sole evaluator. Mock-call audio, transcripts and Score Cards live in `data/trainer/` and `audio_files/trainer/` and never enter the existing `/api/upload` → `gemini_pipeline.db` pipeline. The existing real-call analytics tabs never count mock calls.

**Rationale.** Mixing the two would corrupt real-call analytics (mock NPS dragging real averages), violate the "keep it as separate as possible" brief, and burn double-cost on every drill.

**Owner / next-action.** Engineering enforces by having no code path from M5 to `run_batch_analysis`. QA test: count rows in `local_recordings`/`assisted_recordings` before and after a drill — must not change.

### D18. Live coaching is OUT of v1

**Decision.** Confirmed not in scope. v1 evaluates after the drill, never during. Earliest reconsideration: v3.

**Rationale.** Live coaching adds latency budget (a second LLM in the loop), cognitive load on the trainee (reading hints while talking), and design cost (when to whisper, how loud, how much). Better drilled in v3 once we have data on what staff actually struggle with.

**Owner / next-action.** None in v1.

---

## 15. Decisions — quick-reference summary

One-line restatements of §14 for skimmers.

| # | Decision | Owner |
| --- | --- | --- |
| D1 | Staff identity = roster CSV + post-login picker; `staff_id` is canonical | L&D Head + Eng |
| D2 | Roster has `real_call_agent_name_variants` for cross-link to real-call NPS | L&D Head |
| D3 | Visibility: trainee + manager + Program Owner; HR excluded; non-disciplinary | PM |
| D4 | Quotas: 5/staff/day soft, 7 hard; 30/store/day; ₹3,000/day tenant cap; ≤₹15/drill target | Finance + Eng |
| D5 | AI customer = English only; agent free to mix; no Hindi AI in v1 | Eng |
| D6 | Persona library cadence = 90 days; 1-of-2 approver (Sales OR L&D Head); versions immutable | Sales Head + L&D Head |
| D7 | Adoption = voluntary, manager-encouraged; new-joiner checklist adds 5 drills in 2 weeks | L&D Head |
| D8 | Hardware = Chrome 120+ on iPad/laptop, wired earbuds mandatory, network preflight | Store Ops + Eng |
| D9 | Retention: audio 90d, transcript 365d, scorecard 3y; trainee delete-my-audio anytime | Legal + Eng |
| D10 | SWOT: refuse <10, low-confidence 10–29, full ≥30 | Eng |
| D11 | Adoption Panel = M6 as designed + CSV export; cost dashboard = v2 | Eng |
| D12 | Vanna integration = v2 | Eng |
| D13 | Picker = 60% biased to SWOT focus, 40% random; no curated new-joiner path in v1 | Eng |
| D14 | Catalog freshness owned by L&D Head; trainer reads file directly; mtime visible to admin | L&D Head |
| D15 | Anti-cheating = surprise pivot 10%, manager pattern flags; no biometrics | Eng |
| D16 | One persona library, brand-tagged (`Duroflex`/`SleepyHead`/`Both`); store has brand affiliation | L&D Head + Eng |
| D17 | Mock recordings never re-enter `/api/upload` pipeline; trainer data fully segregated | Eng |
| D18 | No live coaching in v1; revisit in v3 | — |

Beyond these 18, two architectural decisions worth re-stating:

| # | Decision | Why |
| --- | --- | --- |
| A1 | All trainer artefacts under `data/trainer/` and `audio_files/trainer/`; no writes to existing `gemini_pipeline.db` | Honours "keep it as separate as possible" |
| A2 | Mock-call audio path uses Gemini Live API as primary; open-source fallback (faster-whisper + Gemini Flash + AI4Bharat TTS) abstracted behind `MockCallSession` | Brief mandate + future flexibility |

---

## 16. Phased Rollout

### v1 — MVP (this PRD)

- M1, M2, M3 (with admin-published v1 library), M4 (Gemini Live, English-only AI), M5, M6 (basic), X1.
- 1 pilot store (recommended: COCO INDIRANAGAR — high call volume + tech-savvy manager).
- 2-week soak; success criterion = 5 staff complete ≥3 drills each, AI scoring correlates ≥0.7 with human spot-check.

### v2 — Scale

- Roll out to all COCO stores in 3 waves (10 / 10 / 11).
- Open-source TTS/STT fallback path productionised (cost guardrail).
- Adoption Panel adds Cost Dashboard.
- Curated new-joiner path (10 personas in fixed order).
- Persona library v2 (auto-refresh cadence).

### v3 — Adaptive & Multilingual

- Hindi/regional AI customer voice (AI4Bharat / Sarvam).
- Adaptive curriculum: persona pick weighted by individual weakness vector.
- Cross-store leaderboards (cohort percentile only, not raw scores).
- Manager whisper-coach (live nudges).
- Mobile-app-installable PWA.

### v4 — Beyond the trainer

- Real-time agent assist on **real** calls (next-best-hook suggestion).
- Personalised micro-courses (bite-size video lessons targeting weakest section).

---

## 17. Cost Model & Guardrails

### 17.1 Per-drill cost stack (provisional — validated in pilot week 1)

| Component | Driver | Per-drill estimate |
| --- | --- | --- |
| Gemini Live (audio in + audio out, ~5 min) | seconds of bidi audio | ~₹10–13 |
| Gemini Pro scorecard overlay | ~5k input + 2k output tokens | ~₹1–2 |
| Storage (audio + JSON, 90-day) | ~1 MB/drill | <₹0.01 |
| Compute (FastAPI worker) | self-hosted | nil |
| **Per-drill total target** | | **≤ ₹15** |

One-time costs (amortised): per-call signature extraction during persona generation (~500 calls × Gemini Flash) ≈ ₹500 per library version. Negligible at quarterly cadence.

### 17.2 Guardrails

The **₹3,000/day tenant cap** (D4) is the load-bearing guardrail. All quota numbers are derived from it:

```
₹3,000/day ÷ ₹15/drill ≈ 200 drills/day theoretical max
30 stores × 30 drills/day store cap = 900 drills/day soft ceiling   <-- soft cap higher than theoretical
                                                                       on purpose: rare burst tolerance
₹3,000/day reaches hard stop at ~200 actual drills                  <-- this is the actual ceiling
```

### 17.3 Validation plan

Pilot week 1 (single store, ~50 drills): record actual `cost_inr` per drill from Gemini billing. If real cost is materially different (>±30% of ₹15), recompute the ₹3,000/day implied drill count and refresh quotas without changing UX.

### 17.4 Cost telemetry

Every drill writes a `cost_inr` column to `data/trainer/calls.csv`. The Admin panel surfaces:
- Today's spend / today's cap (progress bar)
- Last 7 days spend by store
- Drills closest to the cost cap (anomaly detection)

Cost dashboard for managers is a **v2** item (D11).

---

## 18. Privacy, Security, Compliance

- **Auth.** Reuse `SessionAuthMiddleware`. Trainee actions logged with session_id → staff_id.
- **PII.** No customer phone/name in personas. Staff names stored only in roster + drill log.
- **Consent.** First-time use shows a consent screen: "Your voice will be recorded for training feedback. You can delete recordings any time. Recordings are not used for performance reviews in v1." Explicit acceptance required.
- **Storage.** Audio in `audio_files/trainer/` excluded from any future backup-to-cloud unless reviewed; respects DPDP Act 2023 storage-limitation principle.
- **Access control.** Drill detail accessible only to: drill owner, owner's store manager, Program Owner, Admin.
- **Data deletion.** Trainee → "Delete my audio" button → audio file zeroed, transcript redacted of speaker labels for trainee's turns, score row preserved (anonymised).
- **Audit.** All admin actions (regenerate persona, refund quota, delete) appended to `data/trainer/audit_log.csv`.
- **Secret management.** Gemini API keys stay in `.env`; never reach the browser; the WebSocket proxy on the server is the only thing that talks to Gemini Live.
- **Rate limits.** Per-IP and per-session WS limits to prevent abuse.

---

## 19. Outstanding items (need external action, do not block design)

The 18 product decisions in §14 are all committed. What remains is operational:

- [ ] **OS-1. Roster delivery.** L&D Head produces `staff_roster.csv` (with `real_call_agent_name_variants`) by pilot start. Without it, drill attribution falls back to a generic "Trainee" label and the Adoption Panel cross-link to real calls is hidden. — *Blocks pilot, not design.*
- [ ] **OS-2. ₹3,000/day cost cap sign-off.** Finance confirms the daily cap is acceptable. If lower, quotas re-derived. — *Blocks pilot launch.*
- [ ] **OS-3. Pilot-week cost validation.** Engineering captures actual Gemini Live billing per drill in pilot week 1; reports back. If >₹20/drill, escalate; if <₹10/drill, raise quotas. — *Pilot week 1 deliverable.*
- [ ] **OS-4. DPDP consent text final review.** Legal confirms the consent screen wording in §18 is sufficient for the 90/365/3y retention windows. — *Blocks first real user.*
- [ ] **OS-5. Persona library v1 admin review.** Sales Head OR L&D Head signs off the first auto-generated 50 personas. — *Blocks first drill.*
- [ ] **OS-6. Pilot store selection.** Recommended COCO INDIRANAGAR (high call volume + tech-savvy manager). Store Ops confirms or proposes alternative. — *Blocks pilot kickoff.*
- [ ] **OS-7. Wired earbud procurement.** Store Ops orders one wired earbud per pilot store. — *Blocks pilot UX.*
- [ ] **OS-8. AI scoring calibration.** L&D Head listens to ~5 mock calls in pilot week 1, re-scores blind, compares to AI score. If correlation <0.7, Engineering retunes the M5 overlay prompt. — *Pilot week 2 deliverable.*

None of these block the Phase-2 engineering plan from being written and started — they block specific later milestones.

---

## Appendix A. Sample SWOT prompt skeleton

```
ROLE
You are a senior retail sales coach for Duroflex Group, auditing one store's
last 100 outbound sales calls. Your output drives a Score Card visible to
store managers and the Sales Head.

INPUTS
- store_name: {store}
- calls_analyzed: {n}
- date_range: {from} → {to}
- numeric_aggregates_table:
    agent_nps_avg, agent_nps_p10, agent_nps_p90,
    conversion_pct, hooks_used_avg, relax_avg,
    purchase_readiness_avg, bad_calls_pct,
    skill_matrix: { product_knowledge, sales_skills, upsell, need_discovery,
                    objection_handling, agent_nature }
- categorical_frequency_tables:
    funnel_stage_distribution, timeline_distribution, hook_deployment_pct,
    primary_purchase_barriers (top 5), product_category_demand_mix
- free_text_corpus:
    good_aspects[], bad_aspects[], agent_learnings[]    (deduplicated)

CONSTRAINTS
1. Cite evidence. Quantify everything in % or counts.
2. Use the existing skill vocabulary (RELAX, Hooks, Probing, Skills).
3. Maximum 4 themes per SWOT quadrant.
4. Identify exactly 3 personas (by persona_id from the active library) the
   store should drill, with one-line reasoning each. Bias toward weaknesses.
5. Do NOT invent calls or numbers; only reason from the inputs.

OUTPUT
{ JSON object exactly matching the schema in PRD §M2 }
```

## Appendix B. Sample Mock-Customer system prompt skeleton

```
ROLE
You are a real prospective customer of Duroflex / SleepyHead. You are on a
phone call with a sales agent at a Duroflex store.

YOUR PERSONA
{persona JSON verbatim, including secret_context, winning_moves, trap_moves}

PRODUCT REALITY
You may reference the products in this catalog. Do NOT invent prices,
warranties, or features that are not in the catalog. If asked something you
don't know, say "I'm not sure, can you tell me?".
{ compressed catalog }

BEHAVIOUR
- Speak only ENGLISH. The agent may speak English, Hindi, or a mix; you
  reply in English regardless.
- Stay strictly in role. Do not say "as an AI" or break character even if
  the agent asks. If pressed to break character, repeat your last statement.
- Reveal information only when asked. Hide your budget, decision-maker and
  pain-point until the agent probes.
- React naturally — warmth to good probing, friction to push-selling.
- Do not narrate emotions. Show them.
- Keep each turn under ~30 seconds.
- If the agent is silent for 30 seconds, prompt once: "Hello? Are you there?"

ENDING
- The conversation must end naturally within 5 minutes.
- When the system message "WRAP UP" arrives, you have 30 seconds. Conclude
  by either (a) agreeing to a store visit, (b) agreeing to a WA follow-up,
  (c) agreeing to a callback, or (d) declining politely — depending on how
  the agent has performed.

OPENING LINE
{persona.opening_line_for_ai}
```

## Appendix C. Sample Score Card output (truncated)

```json
{
  "call_uuid": "a1b2c3d4-…",
  "store": "COCO INDIRANAGAR",
  "staff_id": "STF-0042",
  "persona_id": 17,
  "persona_version": 1,
  "persona_title": "Mid-30s mother, back pain, ₹35k budget",
  "started_at": "2026-04-30T10:11:02Z",
  "duration_s": 297,
  "status": "completed",

  "real_call_aligned_analysis": {
    "3a_Customer_Experience_Agent": { "Experience_Score": 7, "Good": "...", "Bad": "..." },
    "10_Conversion_Hooks_Used": { "Sleep_Trial": { "Used": "No", "Evidence": "Not mentioned" }, "...": "..." },
    "11_Probing_Questions": { "Why_Buying": { "Asked": "Yes", "Score": 3 }, "...": "..." },
    "12_Agent_Evaluation": { "Main_Skills": { "Product_Knowledge": "Medium", "...": "..." } },
    "16_RELAX_Framework": { "R_Reach_Out": { "Score": "Medium" }, "...": "..." },
    "13_Agent_Learnings": ["Open with empathy on pain history.", "Always offer Sleep Trial when budget is the objection."]
  },

  "drill_overlay": {
    "winning_moves_detected": ["Need Discovery: pain history"],
    "winning_moves_missed": ["Sleep Trial hook", "Mattress Measurement Guidance"],
    "trap_moves_committed": ["Pushed premium upgrade before addressing price"],
    "agent_language_mix": {"english_pct": 55, "hindi_pct": 30, "hinglish_pct": 15},
    "talk_to_listen_ratio": "62/38",
    "time_to_first_probing_question_s": 48,
    "section_scores": {"opening": 8, "need_discovery": 11, "product_pitch": 11, "objection_handling": 9, "hook_usage": 6, "closing": 7, "soft_skills": 8, "brand_compliance": 5, "time_management": 7},
    "overall_score": 72,
    "overall_band": "Good — needs hook discipline",
    "top_3_strengths": ["Warm opening", "Empathy on pain history", "Confirmed visit"],
    "top_3_gaps": ["Did not deploy Sleep Trial hook", "Pushed premium too early", "Late probing"],
    "moment_clips": [
      {"t_start": 73, "t_end": 92, "label": "Strong empathy moment"},
      {"t_start": 201, "t_end": 224, "label": "Missed Sleep Trial hook"},
      {"t_start": 245, "t_end": 268, "label": "Premium-push moment"}
    ],
    "next_recommended_persona_id": 24,
    "next_recommended_reason": "Test spouse-decision-maker handling — currently weak."
  }
}
```

## Appendix D. Glossary

- **Agent NPS** — `3a_Customer_Experience_Agent.Experience_Score`, 0–10. The headline experience score for the agent on a single call.
- **NPS Good Aspects / Bad Aspects** — `3a.Good`, `3a.Bad`. Free-text reasons.
- **Agent Learnings** — `13_Agent_Learnings`, list of bullet learnings extracted by Gemini per real call.
- **RELAX** — Reach Out, Explore Needs, Link Product, Add Value, eXpress Closing. Sales process framework already scored on real calls.
- **Hooks** — Conversion hooks (Store Visit Driver, WhatsApp Follow-up, Callback Scheduling, Video Demo, Offers/EMI, Mattress Measurement, Need-Based Recommendation). Already taxonomised in real-call schema.
- **Probing Questions** — Requirement, Why-Buying, Whom-For, Budget, Size, Timeline, etc. Already scored on real calls.
- **Drill** — One mock call session.
- **Persona Library** — The 50 distilled customer archetypes used as drill content.
- **SWOT Score Card** — Per-store diagnostic produced by M2 from latest 100 real calls.
- **Drill Score Card** — Per-mock-call evaluation produced by M5.
- **Adoption Panel** — Manager/Program Owner view (M6).
- **COCO** — Company Owned Company Operated store; the universe defined in `city_store_mapping.json`.

---

*End of `AITrainer_Idea_v1.md`. All 18 product decisions are committed (§14). Outstanding items in §19 are operational and do not block engineering. Next deliverable: `AITrainer_TechPlan_v1.md` — a sequenced engineering plan in the same task/test-case style as `ListingPageautofilters_ImplementationPlan.md`, broken into Group A (data + roster) → B (SWOT) → C (persona library) → D (mock-call engine) → E (scorecard) → F (adoption panel) → G (guardrails) → H (pilot rollout).*
