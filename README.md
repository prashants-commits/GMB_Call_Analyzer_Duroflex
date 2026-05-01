# Stores Call Analyser + AI Trainer

A two-app suite for **Duroflex / SleepyHead** retail stores — built on one shared FastAPI backend + one React frontend, fed by the same inbound-sales-call corpus.

| App | Audience | What it does |
|---|---|---|
| **Insights Analyzer** | CSO · CGO · L&D Head | Dashboards, calls listing, call detail, trends, and AI-generated executive Insights reports (single-segment or A/B comparison). |
| **AI Trainer** | Store staff + their managers | Per-store SWOT (with phone citations + per-function action items) → 5-min mock-call drills against AI customer personas → 9-axis AI-graded score cards → drill history. |

Both apps share the same call-data store, so the data feeding analytics also feeds the AI trainer (e.g. SWOT generation and persona library generation read from the same CSV).

---

## Quick links

- 📘 **[What does this Application DO and How.md](./What%20does%20this%20Application%20DO%20and%20How.md)** — module-by-module overview + architecture sketch + AI-model choices.
- 🛠 **[How to Run.md](./How%20to%20Run.md)** — clone-to-running-app in two terminals.

For the underlying product spec and engineering plan see [`AITrainer_Idea_v1.md`](./AITrainer_Idea_v1.md) and [`AITrainer_TechPlan_v1.md`](./AITrainer_TechPlan_v1.md).

---

## What's in this repo

```
Stores-Call-Analyser-plus-Trainer/
├── backend/                                # FastAPI (Python 3.10+)
│   ├── main.py                             # entry — mounts both routers
│   ├── csv_parser.py                       # loads call CSV into in-memory store
│   ├── gemini_service.py                   # Insights endpoint
│   ├── trainer/                            # AI Trainer subsystem
│   │   ├── auth.py · roster.py             # HMAC cookie auth + roster
│   │   ├── drill/                          # mock-call engine (voice WS + text)
│   │   ├── scoring/                        # 9-axis Pro-graded score cards
│   │   ├── swot/                           # per-store Map+Reduce SWOT
│   │   ├── personas/                       # signature → synthesise pipeline
│   │   └── csvstore.py                     # append-only file-locked CSV store
│   ├── tests/                              # pytest suites
│   ├── scripts/                            # one-off utilities (e.g. mapping sync)
│   ├── requirements.txt
│   └── GMB Calls Analyzer - Call details (sample).csv
├── frontend/                               # React 19 + Vite 8 + Tailwind 4
│   ├── src/pages/                          # AnalyticsDashboard, TrendsDashboard,
│   │                                       # InsightsDashboard, CallList, CallDetail,
│   │                                       # trainer/{TrainerHome, DrillPage,
│   │                                       # ScoreCardPage, DrillsListPage,
│   │                                       # StoreSwotPage, admin/PersonaLibraryPage}
│   ├── src/components/                     # shared UI + trainer-specific
│   └── src/utils/                          # trainerApi, useDrillSocket, useMic, …
├── README.md                               # ← this file
├── How to Run.md
├── What does this Application DO and How.md
├── AITrainer_Idea_v1.md                    # original PRD
└── AITrainer_TechPlan_v1.md                # engineering plan (Groups A–H)
```

---

## Tech stack

| Layer | Choice |
|---|---|
| Backend | Python 3.10+ · FastAPI · Uvicorn · pandas · portalocker (file locks) · websockets |
| Frontend | React 19 · Vite 8 · React Router 7 · Tailwind 4 · lucide-react |
| LLM | google-genai SDK · `gemini-3.1-pro-preview` (synthesis) · `gemini-3.1-flash-live-preview` (voice drills) |
| Storage | CSV + JSON sidecars on disk under `backend/data/trainer/` (no DB) |
| Auth | HMAC-signed httpOnly session cookie (trainer); static credentials (analyzer) |

---

## Status

The end-to-end flow is working: the analyzer ships sample data for ~2,620 calls across 30+ stores, and the AI Trainer is rolled out to **6 pilot stores** (COCO INDIRANAGAR · WHITEFIELD · BANJARA HILLS · AIRPORT ROAD BLR · ANNA NAGAR · KONDAPUR) with persona libraries, SWOTs, and a per-staff demo roster.

For roadmap items deferred to a later phase (manager Adoption Panel, daily quotas, retention janitor) see [`AITrainer_TechPlan_v1.md`](./AITrainer_TechPlan_v1.md).

---

## Get started

See **[How to Run.md](./How%20to%20Run.md)** — fresh clone → running app in ~5 minutes.
