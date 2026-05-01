# What does this Application DO and How

A two-app suite for **Duroflex / SleepyHead** retail stores — sharing one backend, one call-data corpus, and one frontend.

| App | Audience | One-line value |
|---|---|---|
| **1. Insights Analyzer** | Sales leadership (CSO, CGO, L&D Head) | Convert raw inbound-sales call transcripts into searchable analytics, trends, and AI-summarised executive insights. |
| **2. AI Trainer** | Store staff + their managers | Practice mock sales calls against AI customer personas, then receive an AI-graded score card with concrete coaching gaps. |

Both apps live in the same React frontend (different routes) and the same FastAPI backend (different routers), so the data feeding analytics also feeds the AI trainer (e.g. SWOT and persona generation).

---

## App #1 — Insights Analyzer

**Input:** A CSV of analyzed inbound sales calls (`backend/GMB Calls Analyzer - Call details (sample).csv`, ~2,620 calls). Each row is a call with metadata plus rich qualitative fields (Agent NPS, Brand NPS, Call Summary, Customer Needs, Hooks Used, Probing Quality, Barriers, Conversion Readiness, etc.).

**Modules** (routes under the main app):

- **Analytics Dashboard** (`/`) — KPI tiles (calls / conversions / revenue), brand × store × city slicers, agent leaderboard, hook-usage funnel.
- **Calls List** (`/listing`) — Paginated, filterable table of every call with deep links to call detail.
- **Call Detail** (`/call/:cleanNumber`) — Full call card: transcript, persona signature, all 100+ analysis fields, agent verbatims, score breakdown.
- **Trends** (`/trends`) — Time-series of conversion rate, hook adoption, NPS movement.
- **Insights** (`/insights`) — Click-to-generate AI executive report. Single segment or **A vs B comparison**. Built on **Gemini 3.1 Pro Preview** with phone-number citations linking each cited theme to the originating call.

**How it works:**
- On boot, `backend/main.py` loads the CSV via `csv_parser.py` into an in-memory `CallDataStore`.
- API endpoints (`/api/calls`, `/api/analytics`, `/api/trends`, `/api/generate-insights`) serve filtered slices.
- Insights endpoint sends the filtered call data + a structural prompt to Gemini Pro and validates the JSON response against a strict schema; fabricated phone numbers are stripped post-parse.

---

## App #2 — AI Trainer

A 3-module sub-system, gated behind the `TRAINER_ENABLED=true` flag.

### 2.1 Diagnose — Store SWOT

Per-store reports built by **2-stage Map+Reduce** on Gemini 3.1 Pro:

- **Stage 1 (Map):** chunk the store's latest 100 calls into batches; extract per-batch S/W/O/T candidates with verbatim evidence quotes tagged to clean numbers.
- **Stage 2 (Reduce):** two parallel Pro calls merge the partials into:
  - The classic **SWOT** (4 quadrants, ranked by frequency × severity, with phone-number citations linking to the originating call).
  - **Function Improvement Areas** — themes scoped to the team that owns the fix: *Sales Team · Marketing · Supply Chain & Delivery · Product Team · Omnichannel Team*. Each item has a concrete recommended action (≤20 words).
  - **Quick Stats** strip (computed server-side) — calls analysed, top blocker theme + volume, biggest strength, count of high-severity items.

Routes: `/trainer/swot/:storeName`. Cached in `backend/data/trainer/swot_cache.csv`.

### 2.2 Practice — Mock Drill (5-minute role-play)

The trainee logs in (cookie-signed staff identity), starts a drill, and gets paired with an AI customer persona drawn from the published persona library. **Two transports** depending on `DRILL_DEFAULT_MODE`:

- **Voice (default):** WebSocket bridge to **Gemini 3.1 Flash Live Preview**. Half-duplex strict push-to-talk — agent holds Spacebar to speak, AI customer cannot be interrupted, audio is transcribed both ways. 5-min hard cap.
- **Text:** HTTP+SSE turn-based drill with browser TTS (fallback for hardware without mic).

The persona system prompt enforces *multi-aspect customer behaviour* — each persona has a **primary buying-journey stage** + **2-3 secondary stages** (needs discovery / product discovery / availability / price & offers / delivery timeline / warranty), and the prompt explicitly forbids one-note customer behaviour.

Persona libraries can be seeded from a hand-crafted `seed_library.json` OR generated from real-call data per store via the admin "Generate from real calls" button (also Pro-powered, two-stage signature → synthesis pipeline).

Routes: `/trainer/drill/new`, `/trainer/drill/:drillUuid`.

### 2.3 Improve — Score Card + Drill History

After drill end, a fire-and-forget background task scores the transcript via **Gemini 3.1 Pro** against a 9-axis rubric (Opening / Need Discovery / Product Pitch / Objection Handling / Hook Usage / Closing / Soft Skills / Brand Compliance / Time Management). Output: server-recomputed weighted overall score (0–100), top-3 strengths, top-3 gaps, verbatim moment clips, recommended next focus area.

Persistence: rich JSON to `backend/data/trainer/scorecards/{drill_uuid}.json` + flat row to `score_cards.csv`.

UI: post-drill auto-redirect to `/trainer/score-cards/:drillUuid` with a polling spinner ("Scoring your drill…"). A separate `/trainer/drills` page lists every scored drill across all agents — Date · Agent · Store · Persona · Overall · Band — clickable rows open the score card.

---

## Architecture (one-page sketch)

```
                  ┌──────────────────────────────────┐
                  │  React + Vite frontend (port 5173)│
                  │  (Insights routes + Trainer routes)│
                  └──────────────┬───────────────────┘
                                 │  HTTP / WebSocket
                                 ▼
        ┌────────────────────────────────────────────────────┐
        │          FastAPI backend (port 8000)               │
        │                                                    │
        │  ┌──────────────────┐    ┌─────────────────────┐   │
        │  │ Insights router  │    │ Trainer router      │   │
        │  │ /api/calls       │    │ /api/trainer/*      │   │
        │  │ /api/insights    │    │ /ws/trainer/drill/* │   │
        │  └────────┬─────────┘    └──────────┬──────────┘   │
        │           │                         │              │
        │           ▼                         ▼              │
        │  CallDataStore (in-memory)   CSV-store (per-file   │
        │  ← single CSV at boot         lock, append-only)   │
        │                              + JSON sidecar files  │
        └─────────┬──────────────────────────────┬───────────┘
                  │                              │
                  ▼                              ▼
        Gemini 3.1 Pro Preview         Gemini 3.1 Flash Live Preview
        (insights, SWOT, score card,   (voice mock drill —
         persona generation)            audio in / audio out)
```

---

## Tech stack

| Layer | What | Why |
|---|---|---|
| Backend | Python 3.10+, **FastAPI**, **Uvicorn** | Async + WebSocket support out of the box. |
| Storage | CSV + JSONL on disk (`backend/data/trainer/`) | Local-first, no DB to install. `portalocker` guards multi-process writes. |
| LLM | **google-genai** SDK | Insights / SWOT / scoring on Pro 3.1; voice drill on Flash 3.1 Live Preview. |
| Frontend | **React 19**, **Vite 8**, **React Router 7**, **Tailwind 4**, lucide-react | Standard modern SPA. |
| Auth | HMAC-signed httpOnly session cookie | Trainer-only; the analyzer side uses static credentials. |
| Audio | AudioWorklet + WebSocket binary frames | 16kHz s16le upstream → Gemini Live → 24kHz s16le downstream → Web Audio. |

---

## AI models per feature

| Feature | Model | Why this one |
|---|---|---|
| Insights report (analyzer) | `gemini-3.1-pro-preview` | Long-form synthesis with citations; high recall on themes. |
| Store SWOT (Map + Reduce) | `gemini-3.1-pro-preview` | Same — quality > cost since SWOTs are cached and re-used. |
| Score card extraction | `gemini-3.1-pro-preview` | Strict 9-axis rubric needs deterministic structured output. |
| Persona library generation | `gemini-3.1-pro-preview` | One-time generation per store; quality matters most. |
| Voice mock drill | `gemini-3.1-flash-live-preview` | Only Live model with audio in / audio out. Manual VAD via the SDK. |
| Text mock drill (Rung B) | `gemini-2.5-flash` | Fast, cheap; only used as fallback when audio unavailable. |
