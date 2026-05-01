# AI Trainer — Engineering Implementation Plan (v1)

> **Companion to** [`AITrainer_Idea_v1.md`](AITrainer_Idea_v1.md). Product decisions are referenced as `D1`–`D18` (§14 of the PRD), architectural decisions as `A1`/`A2` (§15).
> **Style note.** Mirrors the format of [`FiltersIssue_implementation_plan.md`](FiltersIssue_implementation_plan.md) and [`InsightsPrompts_implementation_plan.md`](InsightsPrompts_implementation_plan.md): each task carries **Files**, **Steps**, **Test cases**. A task is **Done** only when every listed test passes.
> **Goal.** Ship an audio-first AI trainer that diagnoses each store's call quality (Store SWOT), drills staff against 50 LLM-distilled personas via realtime audio, scores each drill, and exposes adoption to managers — without touching any existing route, page, filter, or insight.

---

## 0. How this plan differs from the PRD's original assumptions

The PRD was written against a different codebase (FastAPI + SQLite + vanilla HTML). This repo is **FastAPI + React/Vite + in-memory CSV**. The functional spec is unchanged, but several structural decisions had to be re-derived:

| # | PRD assumption | This repo | Plan adaptation |
|---|---|---|---|
| R1 | `app/` + `static/` co-located backend & vanilla JS | Separate `backend/` (FastAPI) + `frontend/` (React + Vite + Tailwind + React Router 7) | Trainer backend lives in new `backend/trainer/` subpackage; trainer frontend lives in new `frontend/src/pages/trainer/` + `frontend/src/components/trainer/` trees |
| R2 | Routes registered inline in `main.py` | Same — but no `APIRouter` pattern exists yet | Introduce `backend/trainer/router.py` exposing one `APIRouter`; mount it from `main.py` with a single conditional `include_router` line. Touch `main.py` in **exactly one place**. |
| R3 | Existing `SessionAuthMiddleware` enforces backend session | **No backend auth.** Frontend uses `localStorage.isAuthenticated` only. CORS is wide-open. | Trainer adds its own minimal **HMAC-SHA256 signed cookie** layer — required because cost guardrails (D4) need server-trusted identity. Existing pages keep working unchanged; only `/api/trainer/*` endpoints check the cookie. |
| R4 | SQLite/Postgres `AssistedRecording` table for SWOT input | In-memory `CallDataStore` populated from `backend/GMB Calls Analyzer - Call details (sample).csv` at boot | SWOT extractor reads via `CallDataStore.get_insight_columns(...)` and `CallDataStore.get_analytics_data()`. No new DB. |
| R5 | `data/`, `outputs/`, `audio_files/` directories already exist | None of these exist | Trainer creates `backend/data/trainer/` for CSV state and `backend/data/trainer/audio/` for drill recordings on first boot when `TRAINER_ENABLED=true`. |
| R6 | `pandas`, `portalocker`, `python-multipart` already installed | Only `fastapi`, `uvicorn`, `google-genai`, `python-dotenv` in `backend/requirements.txt` | Add `pandas>=2.2`, `portalocker>=2.10`, `python-multipart>=0.0.9`, `websockets>=13`, `pytest>=8`, `pytest-asyncio>=0.24` to `backend/requirements.txt`. |
| R7 | Existing logger via `get_step_logger` | None — bare `print` | Trainer uses Python `logging.getLogger("trainer.<module>")` only; no app-wide logger refactor. |
| R8 | `city_store_mapping.json` lives at project root | Lives at `frontend/src/utils/city_store_mapping.json` | Backend keeps its own copy at `backend/data/city_store_mapping.json`, populated by a one-time `scripts/sync_city_store_mapping.py` (A1) that reads from the frontend file. The trainer router exposes `GET /api/trainer/cities` so the React frontend never has to import the JSON twice. |
| R9 | Audio playback in vanilla `<audio>` element | React + Tailwind | Trainer mock-call UI uses `WebAudio` via a small custom hook `useGeminiLiveSocket.js`; React component re-renders are throttled via `requestAnimationFrame` for the volume meter. |
| R10 | WebSocket pattern present | None | New WS endpoint `/ws/trainer/drill/{drill_uuid}` in `backend/trainer/ws.py`. Vite dev config gets a one-line `/ws` proxy entry so the React dev server forwards to FastAPI. |
| R11 | Pytest layout exists | None | Plan creates `backend/tests/trainer/` from scratch, with `pyproject.toml` pytest config. Existing code has no tests; we don't retro-test it — we only test trainer code. |

These deltas are why the task list is ~62 tasks (vs. ~50 if the repo had matched the PRD). Most extras are environmental: adding a router pattern, adding the auth layer, wiring up React Router, adding pytest, etc.

---

## 1. Sequencing rule

```
A (foundation + roster + auth)        ← blocks everything
   ├── B (Store SWOT)                ┐
   ├── C (Persona Library)           ├── parallel after A
   └── G (Guardrails — partial)      ┘
        │
        ├── D (Mock Call Engine)     ← needs C's persona schema
        │      │
        │      └── E (Score Card)
        │              │
        │              └── F (Adoption Panel)
        │
        └── H (Pilot rollout)        ← needs everything
```

Within a group, tasks run in parallel unless a dependency is called out. **Cross-group fast paths:**
- D5 + D6 (browser audio plumbing) can start in parallel with C as soon as A is done — they just need a stub persona JSON to test against (TD-6 below).
- F1 (manager dashboard skeleton) can start as soon as the `calls.csv` schema is frozen (A6), even before E is complete — it can read a hand-seeded CSV.

## 2. Done rule

A task is **Done** only after every listed test case passes. Failing tests stay `in_progress`. Manual UI tests must run on Chrome 120+ on Windows or iPadOS 17+ (per D8). Backend tests run via `pytest` from the `backend/` directory — add a new `backend/tests/trainer/` tree mirroring `backend/trainer/`.

---

## 3. Test data prerequisites (one-time, before any task starts)

These must exist before *any* task in this plan can be verified end-to-end. Capture the exact counts up front and reuse as expected values.

- **TD-1.** Existing `backend/GMB Calls Analyzer - Call details (sample).csv` contains ≥1 store with ≥30 rows. Record the store name + exact count for B-group test assertions. *(Recommended seed store: pick whichever store in the CSV has the most rows — confirm via a one-liner pandas query in B1-T0.)*
- **TD-2.** Existing CSV contains ≥500 rows total across all stores combined for C-group persona generation. If <500, the persona-extraction tests must be parametrised with the actual count and we accept lower diversity. Record the actual total count in `tests/trainer/conftest.py` as `EXPECTED_TOTAL_CALLS`.
- **TD-3.** Hand-built `backend/data/trainer/staff_roster.csv` with ≥3 stores, ≥3 staff per store, ≥1 row carrying a populated `real_call_agent_name_variants` matched against an actual `Agent_Name` field in the calls CSV. *(Used for D2 cross-link tests.)*
- **TD-4.** A `.env` flag `GEMINI_API_KEY` populated with a key that has Gemini Live API access enabled. Verify by running the throwaway WS smoke client `backend/scripts/test_gemini_live.py` (built in D3-T1).
- **TD-5.** A browser test rig: Chrome 120+ + wired earbuds + microphone access granted to `http://localhost:5173` and `https://<staging>` (per D8).
- **TD-6.** A "small library" persona JSON (`backend/tests/fixtures/personas_test.json`) with 5 personas covering distinct difficulty/language/brand combos. Used as a stand-in until C7 publishes the real v1 library.
- **TD-7.** A "frozen" copy of any product catalog file checked in at `backend/tests/fixtures/products_v1.json` so prompt-grounding tests are deterministic across catalog edits. *(If the repo doesn't yet have a product catalog, we ship one in C2; in that case TD-7 is satisfied by C2's output.)*

---

## 4. Naming conventions used throughout

- **New backend package:** `backend/trainer/` for trainer-only Python.
- **New React tree:** `frontend/src/pages/trainer/` for routed pages, `frontend/src/components/trainer/` for shared components, `frontend/src/utils/trainerApi.js` for fetch wrappers.
- **New CSV/JSON dir:** `backend/data/trainer/` (created on first boot if `TRAINER_ENABLED=true`).
- **New audio dir:** `backend/data/trainer/audio/{YYYY}/{MM}/` (UTC year/month).
- **API prefix:** all endpoints under `/api/trainer/*` and the WS at `/ws/trainer/drill/{drill_uuid}`.
- **Logger:** `logging.getLogger("trainer.<module>")` (e.g. `trainer.swot`, `trainer.ws`).
- **Drill IDs:** `drill_uuid` is a `uuid4().hex` string (32 chars). Used as both CSV row key and audio/transcript file basename.
- **Pytest layout:** `backend/tests/trainer/test_<module>.py` mirroring `backend/trainer/<module>.py`. Fixtures in `backend/tests/trainer/conftest.py`.
- **React route prefix:** all trainer pages under `/trainer/*` (e.g. `/trainer`, `/trainer/identify`, `/trainer/drill/:drillUuid`, `/trainer/admin`).

---

## 5. Cross-cutting acceptance criteria

These apply to every task; tests in each group reference them by ID.

- **AC-1 (segregation).** With `TRAINER_ENABLED=false`, every existing route (`/api/calls`, `/api/analytics`, `/api/calls/{n}`, `/api/generate-insights`, `/api/export-calls`, `/api/health`) returns the same status + identical body it returned before the trainer PR landed. Verified by a recorded baseline (B0-T1).
- **AC-2 (no shared state).** No code in `backend/trainer/*` mutates `store: CallDataStore` or anything in `backend/main.py`. The trainer reads from `CallDataStore` only. Greppable: `grep -RE "store\.[a-z_]+\(" backend/trainer/` returns ≤ readonly methods only.
- **AC-3 (feature flag honored).** Setting `TRAINER_ENABLED=false` in `.env` removes every `/api/trainer/*` and `/ws/trainer/*` route from `GET /openapi.json` and removes the "AI Trainer" link from the React `Header`.
- **AC-4 (no localstorage drift).** Trainer never reads or writes the existing `localStorage` keys (`isAuthenticated`, `userEmail`). It uses its own `trainer_staff_id_cookie` (signed, server-set) and an in-memory React context for staff identity.
- **AC-5 (cost ceiling).** No drill-start endpoint succeeds when `staff_today_count >= TRAINER_STAFF_DAILY_HARD` or `tenant_today_inr >= TRAINER_DAILY_TENANT_CAP_INR`. Verified by G1-T1, G1-T2.
- **AC-6 (CSV durability).** No CSV write loses data under 50 concurrent appenders (A6-T3). No reader sees a half-written row (A6-T6). Verified by `portalocker`-based concurrency tests.
- **AC-7 (audio retention).** Drills older than `TRAINER_AUDIO_RETENTION_DAYS` are deleted by a startup-time janitor; transcripts older than `TRAINER_TRANSCRIPT_RETENTION_DAYS` are deleted by the same job (G6).
- **AC-8 (zero existing-test regression).** The trainer PR does not introduce a regression to existing functionality. Since the repo currently has no automated tests, this is verified by a manual smoke checklist captured in H4.
- **AC-9 (admin-gated mutations).** Every `POST/PATCH/DELETE` under `/api/trainer/admin/*` requires the admin role on the cookie (A8). HTTP 403 otherwise. The admin role is granted only to emails in `TRAINER_ADMIN_EMAILS`.
- **AC-10 (no Gemini key in browser).** No frontend code ever sees `GEMINI_API_KEY`. The Gemini Live socket is server-proxied (D3); the browser only talks to our `/ws/trainer/drill/{uuid}`. Verified by `grep -R "AIzaSy" frontend/` returning nothing and by D3-T4 (proxy round-trip).

---

## 6. Group A — Foundation, segregation, roster, auth

Group A is the load-bearing scaffolding. **Every later task depends on A1+A2+A6+A7+A8.** Ship A in one PR if possible.

### A1. Feature flag + segregation scaffolding + dependency bump

**Files.** [backend/requirements.txt](backend/requirements.txt) (new deps), new [backend/trainer/__init__.py](backend/trainer/__init__.py), new [backend/trainer/config.py](backend/trainer/config.py), [backend/main.py](backend/main.py) (1 startup hook + 1 conditional include), new `backend/data/trainer/.gitkeep`, new `backend/data/trainer/audio/.gitkeep`, new [backend/scripts/sync_city_store_mapping.py](backend/scripts/sync_city_store_mapping.py).

**Steps.**
1. Append to `backend/requirements.txt`:
   ```
   pandas>=2.2
   portalocker>=2.10
   python-multipart>=0.0.9
   websockets>=13
   pytest>=8
   pytest-asyncio>=0.24
   ```
2. Create `backend/trainer/config.py`:
   ```python
   import os
   from pathlib import Path
   from dotenv import load_dotenv

   load_dotenv()

   BACKEND_DIR = Path(__file__).resolve().parent.parent
   TRAINER_DATA_DIR = BACKEND_DIR / "data" / "trainer"
   TRAINER_AUDIO_DIR = TRAINER_DATA_DIR / "audio"

   TRAINER_ENABLED = os.getenv("TRAINER_ENABLED", "false").lower() == "true"
   TRAINER_COOKIE_SECRET = os.getenv("TRAINER_COOKIE_SECRET", "change-me-in-production")
   TRAINER_COOKIE_NAME = os.getenv("TRAINER_COOKIE_NAME", "trainer_session")
   TRAINER_ADMIN_EMAILS = [e.strip().lower() for e in os.getenv("TRAINER_ADMIN_EMAILS", "").split(",") if e.strip()]

   # Cost guardrails (D4 + §17). Tunable.
   TRAINER_DAILY_TENANT_CAP_INR = int(os.getenv("TRAINER_DAILY_TENANT_CAP_INR", "3000"))
   TRAINER_PER_DRILL_COST_TARGET_INR = int(os.getenv("TRAINER_PER_DRILL_COST_TARGET_INR", "15"))
   TRAINER_STAFF_DAILY_SOFT = int(os.getenv("TRAINER_STAFF_DAILY_SOFT", "5"))
   TRAINER_STAFF_DAILY_HARD = int(os.getenv("TRAINER_STAFF_DAILY_HARD", "7"))
   TRAINER_NEW_JOINER_DAILY_SOFT = int(os.getenv("TRAINER_NEW_JOINER_DAILY_SOFT", "10"))
   TRAINER_NEW_JOINER_DAILY_HARD = int(os.getenv("TRAINER_NEW_JOINER_DAILY_HARD", "12"))
   TRAINER_STORE_DAILY_SOFT = int(os.getenv("TRAINER_STORE_DAILY_SOFT", "30"))
   TRAINER_STORE_DAILY_HARD = int(os.getenv("TRAINER_STORE_DAILY_HARD", "40"))
   TRAINER_PERSONA_BIAS_PCT = int(os.getenv("TRAINER_PERSONA_BIAS_PCT", "60"))
   TRAINER_AUDIO_RETENTION_DAYS = int(os.getenv("TRAINER_AUDIO_RETENTION_DAYS", "90"))
   TRAINER_TRANSCRIPT_RETENTION_DAYS = int(os.getenv("TRAINER_TRANSCRIPT_RETENTION_DAYS", "365"))
   GEMINI_LIVE_MODEL = os.getenv("GEMINI_LIVE_MODEL", "gemini-2.5-flash-preview-native-audio-dialog")
   ```
3. In `backend/main.py`, **after** `store = CallDataStore()` and **before** the first endpoint:
   ```python
   from trainer.config import TRAINER_ENABLED
   from trainer.bootstrap import on_startup as trainer_on_startup
   from trainer.router import router as trainer_router

   if TRAINER_ENABLED:
       trainer_on_startup(call_data_store=store)
       app.include_router(trainer_router)
   ```
   This is the **only** edit to `main.py` for the trainer. Confirm via `git diff backend/main.py` showing exactly these added lines.
4. Create `backend/scripts/sync_city_store_mapping.py`:
   ```python
   """One-time sync from frontend/src/utils/city_store_mapping.json to backend/data/city_store_mapping.json.
   Run manually after editing the frontend file. Trainer reads only the backend copy."""
   import json, shutil
   from pathlib import Path
   ROOT = Path(__file__).resolve().parent.parent.parent
   src = ROOT / "frontend" / "src" / "utils" / "city_store_mapping.json"
   dst = ROOT / "backend" / "data" / "city_store_mapping.json"
   dst.parent.mkdir(parents=True, exist_ok=True)
   shutil.copy(src, dst)
   print(f"Copied {src} → {dst}")
   ```
5. Add `backend/data/trainer/.gitkeep`, `backend/data/trainer/audio/.gitkeep`. Add `backend/data/trainer/audio/` to `.gitignore` (recordings are ephemeral, ≤90 days).

**Test cases.**
- **A1-T1.** Boot with `TRAINER_ENABLED=false`: log line "Trainer feature disabled" appears (added in A2 bootstrap); `backend/data/trainer/` is **not** auto-populated; existing `/api/calls`, `/api/analytics` continue to return 200.
- **A1-T2.** Boot with `TRAINER_ENABLED=true`: `backend/data/trainer/` directory exists; `backend/data/trainer/audio/` exists; `GET /openapi.json` shows `/api/trainer/health` route.
- **A1-T3.** With trainer disabled, `curl /api/trainer/anything` → HTTP 404 (router not mounted).
- **A1-T4.** `pip install -r backend/requirements.txt` succeeds on a clean venv with Python 3.11 on Windows. `python -c "import portalocker, pandas, websockets"` succeeds.
- **A1-T5.** `python backend/scripts/sync_city_store_mapping.py` copies the file; subsequent `cat backend/data/city_store_mapping.json` returns the same JSON keys as `frontend/src/utils/city_store_mapping.json`.

---

### A2. Trainer FastAPI sub-router + bootstrap

**Files.** New [backend/trainer/router.py](backend/trainer/router.py), new [backend/trainer/bootstrap.py](backend/trainer/bootstrap.py).

**Steps.**
1. Create `backend/trainer/router.py`:
   ```python
   import logging
   from fastapi import APIRouter
   logger = logging.getLogger("trainer.router")
   router = APIRouter(prefix="/api/trainer", tags=["trainer"])

   @router.get("/health")
   def health():
       return {"status": "ok", "version": "v1"}
   ```
2. Create `backend/trainer/bootstrap.py`:
   ```python
   import logging
   from pathlib import Path
   from .config import (TRAINER_DATA_DIR, TRAINER_AUDIO_DIR,
                        TRAINER_COOKIE_SECRET, TRAINER_ADMIN_EMAILS)
   logger = logging.getLogger("trainer.bootstrap")

   _CSV_STORE = None  # set in on_startup

   def on_startup(call_data_store):
       """Called once from main.py at boot when TRAINER_ENABLED=true."""
       Path(TRAINER_DATA_DIR).mkdir(parents=True, exist_ok=True)
       Path(TRAINER_AUDIO_DIR).mkdir(parents=True, exist_ok=True)

       if TRAINER_COOKIE_SECRET == "change-me-in-production":
           logger.warning("TRAINER_COOKIE_SECRET is the default; set a real value in .env before production")
       if not TRAINER_ADMIN_EMAILS:
           logger.warning("TRAINER_ADMIN_EMAILS is empty; admin endpoints will be inaccessible")

       global _CSV_STORE
       _CSV_STORE = call_data_store
       from . import csvstore
       csvstore.ensure_headers()  # idempotent; created in A6
       logger.info("Trainer feature ENABLED (call_data_store=%s)", type(call_data_store).__name__)

   def get_call_data_store():
       """Used by SWOT/Score-Card modules to pull from the existing in-memory CSV without circular imports."""
       return _CSV_STORE
   ```
3. **Crucial.** Do NOT touch any existing route in `backend/main.py`. The trainer router lives entirely in its own file.

**Test cases.**
- **A2-T1.** With trainer enabled, `GET /api/trainer/health` → `200 {"status": "ok", "version": "v1"}`.
- **A2-T2.** With trainer disabled, `GET /api/trainer/health` → 404 (router not included).
- **A2-T3.** Run `grep -n "trainer" backend/main.py` — exactly one block of trainer-related lines (the conditional import + include). No other edits.
- **A2-T4.** OpenAPI schema (`GET /openapi.json`) only contains `/api/trainer/*` paths when `TRAINER_ENABLED=true`.
- **A2-T5.** When called with no admin emails set, log warning is emitted exactly once at boot.

---

### A3. React Router setup for trainer pages + nav link

**Files.** [frontend/src/App.jsx](frontend/src/App.jsx) (add 4 routes), [frontend/src/components/Header.jsx](frontend/src/components/Header.jsx) (add 1 nav link), new [frontend/src/pages/trainer/TrainerHome.jsx](frontend/src/pages/trainer/TrainerHome.jsx), new [frontend/src/pages/trainer/TrainerIdentify.jsx](frontend/src/pages/trainer/TrainerIdentify.jsx), new [frontend/src/pages/trainer/TrainerDisabled.jsx](frontend/src/pages/trainer/TrainerDisabled.jsx), new [frontend/src/pages/trainer/TrainerAdmin.jsx](frontend/src/pages/trainer/TrainerAdmin.jsx), new [frontend/src/utils/trainerApi.js](frontend/src/utils/trainerApi.js).

**Steps.**
1. In `App.jsx`, add inside the protected `<Routes>` block (alongside `/listing`, `/insights`, etc.):
   ```jsx
   <Route path="/trainer" element={<ProtectedRoute><TrainerHome /></ProtectedRoute>} />
   <Route path="/trainer/identify" element={<ProtectedRoute><TrainerIdentify /></ProtectedRoute>} />
   <Route path="/trainer/admin/*" element={<ProtectedRoute><TrainerAdmin /></ProtectedRoute>} />
   <Route path="/trainer/disabled" element={<ProtectedRoute><TrainerDisabled /></ProtectedRoute>} />
   ```
   (Drill, Score Card, Adoption routes are added later in D, E, F.)
2. In `Header.jsx`, add an `AI Trainer` link inside the `<nav>` block, **conditionally rendered** based on the `trainerEnabled` flag fetched once from `/api/trainer/health` (200 = enabled, 404 = disabled):
   ```jsx
   const [trainerEnabled, setTrainerEnabled] = useState(false);
   useEffect(() => {
       fetch('/api/trainer/health').then(r => setTrainerEnabled(r.ok)).catch(() => {});
   }, []);
   {trainerEnabled && <HeaderLink to="/trainer" label="AI Trainer" />}
   ```
3. `trainerApi.js` exports a typed-ish wrapper:
   ```js
   const TRAINER_BASE = '/api/trainer';
   export async function trainerFetch(path, options = {}) {
     const res = await fetch(`${TRAINER_BASE}${path}`, { credentials: 'include', ...options });
     if (!res.ok) {
       const detail = await res.json().catch(() => ({ detail: res.statusText }));
       throw new Error(detail.detail || `HTTP ${res.status}`);
     }
     return res.json();
   }
   export const trainer = {
     health: () => trainerFetch('/health'),
     me: () => trainerFetch('/me'),
     login: (staffId) => trainerFetch('/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({staff_id: staffId}) }),
     logout: () => trainerFetch('/auth/logout', { method: 'POST' }),
     // ... extended in later groups
   };
   ```
4. `TrainerDisabled.jsx`: renders "AI Trainer is not enabled in this environment." Reachable only via direct navigation when feature flag is off.
5. `TrainerHome.jsx`, `TrainerIdentify.jsx`, `TrainerAdmin.jsx`: stubs that render `<h1>` placeholders. They get filled out in C/D/F.

**Test cases.**
- **A3-T1.** `npm run dev` starts cleanly; navigating to `http://localhost:5173/trainer` while logged in renders the placeholder.
- **A3-T2.** With trainer disabled (backend), the `<HeaderLink>` does not appear in the rendered nav; `getElementsByText('AI Trainer')` returns nothing.
- **A3-T3.** With trainer enabled (backend) but logged out, `/trainer` redirects to `/login` (existing `<ProtectedRoute>` behaviour).
- **A3-T4.** Vite dev proxy forwards `/api/trainer/health` to backend correctly (no CORS error in console).
- **A3-T5.** Build (`npm run build`) succeeds; the trainer files are bundled.

---

### A4. Vite WebSocket proxy + dev-mode HMR safety

**Files.** [frontend/vite.config.js](frontend/vite.config.js) (add `/ws` proxy entry).

**Steps.**
1. Extend the `proxy` block:
   ```js
   server: {
     proxy: {
       '/api': 'http://127.0.0.1:8000',
       '/ws': { target: 'ws://127.0.0.1:8000', ws: true, changeOrigin: true },
     },
   },
   ```
2. Document in the README a one-liner: "Trainer WS endpoints work in dev because Vite forwards `/ws/*` → backend; in production, your reverse proxy must do the same."

**Test cases.**
- **A4-T1.** With backend running and trainer enabled, a manual `wscat -c ws://localhost:5173/ws/trainer/drill/test` returns the same handshake response as `wscat -c ws://localhost:8000/ws/trainer/drill/test`. (Endpoint built in D3; until then this test is skipped.)
- **A4-T2.** Vite HMR still works for non-trainer pages after the config change (visual smoke).

---

### A5. Trainer staff-identity cookie (HMAC signed) + auth utilities

**Files.** New [backend/trainer/auth.py](backend/trainer/auth.py), [backend/trainer/router.py](backend/trainer/router.py) (add `/auth/login`, `/auth/logout`, `/me` endpoints).

**Steps.**
1. `auth.py` exports:
   ```python
   from dataclasses import dataclass
   from typing import Optional
   import hmac, hashlib, base64, json, time
   from fastapi import Request, HTTPException, Depends
   from .config import TRAINER_COOKIE_SECRET, TRAINER_COOKIE_NAME, TRAINER_ADMIN_EMAILS

   @dataclass(frozen=True)
   class TrainerActor:
       staff_id: str
       full_name: str
       store_name: str
       role: str            # "staff" | "manager" | "cluster_head" | "admin"
       email: Optional[str] = None
       issued_at: int = 0   # epoch seconds

   _MAX_AGE_SECONDS = 60 * 60 * 24 * 14  # 14d

   def sign(actor: TrainerActor) -> str:
       payload = json.dumps({**actor.__dict__, "iat": int(time.time())}, separators=(",", ":")).encode()
       sig = hmac.new(TRAINER_COOKIE_SECRET.encode(), payload, hashlib.sha256).digest()
       return base64.urlsafe_b64encode(payload).decode().rstrip("=") + "." + base64.urlsafe_b64encode(sig).decode().rstrip("=")

   def verify(token: str) -> Optional[TrainerActor]:
       try:
           p_b64, s_b64 = token.split(".")
           payload = base64.urlsafe_b64decode(p_b64 + "===")
           sig = base64.urlsafe_b64decode(s_b64 + "===")
           expected = hmac.new(TRAINER_COOKIE_SECRET.encode(), payload, hashlib.sha256).digest()
           if not hmac.compare_digest(sig, expected): return None
           data = json.loads(payload)
           if int(time.time()) - data.get("iat", 0) > _MAX_AGE_SECONDS: return None
           return TrainerActor(staff_id=data["staff_id"], full_name=data["full_name"],
                               store_name=data["store_name"], role=data["role"],
                               email=data.get("email"), issued_at=data["iat"])
       except Exception:
           return None

   def current_actor(request: Request) -> TrainerActor:
       token = request.cookies.get(TRAINER_COOKIE_NAME)
       actor = verify(token) if token else None
       if not actor:
           raise HTTPException(status_code=401, detail="Trainer session required")
       return actor

   def require_role(*roles: str):
       def _dep(actor: TrainerActor = Depends(current_actor)) -> TrainerActor:
           if actor.role not in roles:
               raise HTTPException(status_code=403, detail=f"Role {actor.role} not in {roles}")
           return actor
       return _dep
   ```
2. In `router.py`:
   ```python
   @router.post("/auth/login")
   def login(body: LoginBody, response: Response):
       """Bind a trainer session to the picked staff_id. Reads the roster, sets the signed cookie."""
       row = roster.lookup_by_id(body.staff_id)
       if not row or row.status != "active":
           raise HTTPException(404, "staff_id not found or inactive")
       email = body.email or ""
       role = "admin" if email.lower() in TRAINER_ADMIN_EMAILS else row.role
       actor = TrainerActor(staff_id=row.staff_id, full_name=row.full_name,
                            store_name=row.store_name, role=role, email=email)
       response.set_cookie(TRAINER_COOKIE_NAME, sign(actor), max_age=14*24*3600,
                           httponly=True, samesite="lax", secure=False)  # secure=True in prod
       return {"actor": actor.__dict__}

   @router.post("/auth/logout")
   def logout(response: Response):
       response.delete_cookie(TRAINER_COOKIE_NAME)
       return {"ok": True}

   @router.get("/me")
   def me(actor: TrainerActor = Depends(current_actor)):
       return {"actor": actor.__dict__}
   ```

**Test cases.**
- **A5-T1.** `POST /api/trainer/auth/login` with a valid `staff_id` from a seeded roster sets the `trainer_session` cookie and returns the actor JSON.
- **A5-T2.** `POST /api/trainer/auth/login` with `staff_id="STF-9999"` (unknown) → 404.
- **A5-T3.** `GET /api/trainer/me` without cookie → 401.
- **A5-T4.** `GET /api/trainer/me` with a tampered cookie (last byte flipped) → 401.
- **A5-T5.** Cookie issued 15 days ago (mock `iat`) → `verify()` returns None.
- **A5-T6.** `email` matching `TRAINER_ADMIN_EMAILS` upgrades the role to `admin`; non-matching email keeps the roster role.
- **A5-T7.** Logging out clears the cookie; subsequent `GET /me` → 401.

---

### A6. Append-only CSV store

**Files.** New [backend/trainer/csvstore.py](backend/trainer/csvstore.py).

**Steps.**
1. Define schemas (single source of truth; A7 + downstream tasks reference these column lists):
   ```python
   FILES = {
       "staff_roster.csv":   ["staff_id","full_name","store_name","role","joined_date","status","real_call_agent_name_variants","email"],
       "calls.csv":          ["drill_uuid","staff_id","store_name","persona_id","persona_difficulty","status","started_at","ended_at","duration_seconds","score_overall","score_json","cost_inr","model","disposition_reason","audio_path","transcript_path"],
       "personas.csv":       ["persona_id","version","name","summary","payload_json","status","created_at","approved_by","published_at"],
       "swot_cache.csv":     ["store_name","generated_at","input_call_count","swot_json","model","cost_inr","status"],
       "audit_log.csv":      ["ts","actor_staff_id","actor_email","action","target","payload_json"],
       "score_cards.csv":    ["drill_uuid","staff_id","store_name","persona_id","scored_at","score_overall","strengths_json","gaps_json","framework_scores_json","cost_inr","model"],
   }
   ```
2. Implement `append`, `append_many`, `read_all`, `read_filtered`, `read_latest_per` (same surface as the previous repo's csvstore, adapted to use only `pandas` + `portalocker`). Per-filename `threading.Lock` + `portalocker.LOCK_EX` for cross-process safety.
3. `_serialise(value)`: bool → `"true"/"false"`, list/dict → compact JSON, newlines stripped to `" "`, `None` → `""`.
4. `read_latest_per(filename, key_col, order_col)`: sort by `order_col`, `drop_duplicates(subset=[key_col], keep='last')`. Used for state-machine resolution on `calls.csv`.
5. `ensure_headers()`: idempotent; called from `bootstrap.on_startup`. Creates each file with the right header row if missing.

**Test cases.**
- **A6-T1.** First boot creates all 6 CSVs with correct headers.
- **A6-T2.** Second boot does not modify any file (mtime preserved if file already has rows).
- **A6-T3.** `threading.Barrier(50)` + 50 concurrent `append("calls.csv", ...)` → final file has exactly 50 rows + 1 header; no row interleaving (regex check: every line has the right comma count).
- **A6-T4.** `append` with an unknown column → `CSVStoreError`.
- **A6-T5.** Append with missing optional columns → defaults to `""`.
- **A6-T6.** A reader concurrent with a writer never sees a half-written line: under load, `read_all().shape[1]` always equals `len(columns)`.
- **A6-T7.** `read_latest_per("calls.csv", "drill_uuid", "started_at")` resolves three tombstone rows (`starting`→`in_call`→`completed`) to the latest one per uuid.
- **A6-T8.** Lists/dicts round-trip via JSON; commas and quotes inside strings survive a write+read cycle.

---

### A7. Staff roster reader + admin upload endpoint

**Files.** New [backend/trainer/roster.py](backend/trainer/roster.py), extend [backend/trainer/router.py](backend/trainer/router.py) with `/admin/roster` endpoints.

**Steps.**
1. `StaffRow` frozen dataclass (matches `staff_roster.csv` schema).
2. Module-level `_cached_rows` + `_cached_mtime`; invalidated when file mtime changes.
3. Implement:
   ```python
   def parse_csv_text(text: str) -> Validation: ...   # returns (rows, errors[], warnings[])
   def load_roster() -> List[StaffRow]: ...
   def staff_in_store(store_name: str) -> List[StaffRow]: ...
   def lookup_by_id(staff_id: str) -> Optional[StaffRow]: ...
   def is_new_joiner(staff_id: str, today: date) -> bool: ...   # joined_date within 30d
   def coverage_for_store(store_name: str) -> dict: ...         # {"total","with_variants","coverage_pct"}
   def agent_name_variants_for(staff_id: str) -> Tuple[str, ...]: ...
   ```
4. Validator detects: `DUPLICATE_STAFF_ID`, `MISSING_COLUMNS`, `INVALID_ROLE`, `INVALID_DATE`, `INVALID_STATUS`, warnings: `TRIMMED_VARIANTS`, `STORE_NOT_IN_MAPPING`.
5. Admin endpoints (gated on `require_role("admin")`):
   ```python
   POST /api/trainer/admin/roster        # multipart upload; atomic write via tempfile + os.replace
   GET  /api/trainer/admin/roster        # parsed rows + validation report
   GET  /api/trainer/admin/roster/coverage   # coverage_for_store across all stores
   ```
6. Atomic write: write to `staff_roster.csv.tmp`, fsync, `os.replace`. Old file deleted only after replace succeeds.

**Test cases.** (mirrors existing repo's `tests/trainer/test_roster.py`, adapted)
- **A7-T1.** Valid 9-row sample loads → 9 rows, fields parsed correctly (incl. semicolon-split variants).
- **A7-T2.** Duplicate `staff_id` → error code `DUPLICATE_STAFF_ID`.
- **A7-T3.** Missing required columns → `MISSING_COLUMNS`, `rows == []`.
- **A7-T4.** `role="wizard"` → `INVALID_ROLE`.
- **A7-T5.** `joined_date="not-a-date"` → `INVALID_DATE`.
- **A7-T6.** Cache invalidated on mtime change: replacing the file mid-test produces fresh rows on next `load_roster()`.
- **A7-T7.** `is_new_joiner` returns True within 30d of `joined_date`, False after.
- **A7-T8.** Variants with leading/trailing whitespace are trimmed; warning code `TRIMMED_VARIANTS` surfaces.
- **A7-T9.** `coverage_for_store("COCO INDIRANAGAR")` returns `{total, with_variants, coverage_pct}` with the right pct.
- **A7-T10.** `POST /admin/roster` without admin cookie → 403.
- **A7-T11.** Admin upload with malformed CSV → 422 with structured error list; original file unchanged.
- **A7-T12.** Admin upload with valid CSV → 200, file replaced, mtime updated.

---

### A8. Audit log helper

**Files.** New [backend/trainer/audit.py](backend/trainer/audit.py).

**Steps.**
1. `audit(actor_staff_id, action, target=None, payload=None, actor_email=None)` — never raises (wraps `csvstore.append` in try/except + logs the failure).
2. `read_recent(limit=100, action=None, since=None)` — descending by `ts`, optional filter by action prefix.
3. Called from every state-changing endpoint (drill start/end, persona publish, roster upload, etc.). Action keys: dotted snake_case (`drills.started`, `drills.completed`, `personas.published`, `roster.uploaded`, `swot.generated`, `auth.login`).

**Test cases.**
- **A8-T1.** `audit("STF-1", "personas.publish", target="v1", payload={"foo":"bar"})` appends one row to `audit_log.csv` with parsed payload.
- **A8-T2.** Even when underlying csvstore raises, `audit(...)` returns cleanly.
- **A8-T3.** `read_recent(limit=10)` returns descending by ts.
- **A8-T4.** Filter by `action="personas.publish"` returns only matching rows.
- **A8-T5.** Limit respected (limit=5 → 5 rows even when 20 written).

---

## 7. Group B — Store SWOT (depends on A)

### B0. SWOT prerequisites — pick canonical store + freeze input columns

**Files.** New [backend/tests/trainer/conftest.py](backend/tests/trainer/conftest.py) (constants), new `backend/trainer/swot/__init__.py`.

**Steps.**
1. Run `python -c "import pandas as pd; df = pd.read_csv('backend/GMB Calls Analyzer - Call details (sample).csv'); print(df['Store Name'].value_counts().head())"`. Record the top store and its row count as `EXPECTED_SWOT_STORE` and `EXPECTED_SWOT_ROWS_TOTAL`.
2. Define the **input column whitelist** the SWOT extractor will use, sourced from the existing CSV header — these are the columns the PRD's Stage-1 Map prompt grounds in:
   ```
   3a_Customer_Experience_Agent_NPS, 3b_Customer_Experience_Brand_NPS,
   5_Purchase_Readiness_Score, 10_Conversion_Hooks_*, 11_Probing_Questions_*,
   15_Agent_Evaluation_*, 16_RELAX_Framework_*, 17_Agent_Learnings,
   2_Intent_to_Visit_Store_Rating, Call Type, Transcript_Log
   ```
3. Capture a **byte-baseline** of `/api/calls`, `/api/analytics`, `/api/calls/{n}`, `/api/health` responses (md5 of body) before any B-group code lands, and store it in `backend/tests/trainer/baselines/api_v0.md5`. AC-1 verification depends on this.

**Test cases.**
- **B0-T1.** Recorded baseline file exists; running existing endpoints after B lands matches the baseline byte-for-byte.

---

### B1. SWOT input adapter (read 100 latest calls for a store)

**Files.** New [backend/trainer/swot/input_adapter.py](backend/trainer/swot/input_adapter.py).

**Steps.**
1. `latest_calls_for_store(store_name: str, n: int = 100) -> list[dict]`:
   - Pulls from `bootstrap.get_call_data_store()` via `get_analytics_data()` and `get_insight_columns(...)` (mimicking the pattern used by `/api/generate-insights`).
   - Sorts by `CallDateTime` desc, takes top `n`.
   - Returns the whitelisted columns only (B0 step 2).
2. Handle stores with <100 calls: return whatever is available; B3 prompt template adapts to actual count.
3. Reject input where `n > 250` (matches existing `/api/generate-insights` cap).

**Test cases.**
- **B1-T1.** For `EXPECTED_SWOT_STORE`, returns ≤100 dicts; first row's `CallDateTime` is the most recent.
- **B1-T2.** Unknown store → returns `[]` (not an error).
- **B1-T3.** All returned dicts have the same key set; only whitelisted columns present.
- **B1-T4.** `n=300` → raises `ValueError`.

---

### B2. SWOT Stage-1 Map prompt (Flash) — per-batch reduce

**Files.** New [backend/trainer/swot/prompts.py](backend/trainer/swot/prompts.py), new [backend/trainer/swot/stage1_map.py](backend/trainer/swot/stage1_map.py).

**Steps.**
1. Stage-1 prompt (`STAGE1_MAP_PROMPT`) — see PRD §6.1 for skeleton. Inputs: 20-call JSON batch. Output: tight JSON with `strengths[]`, `weaknesses[]`, `opportunities[]`, `threats[]`, each with evidence anchors (clean_number + quote span).
2. `run_stage1(batches: list[list[dict]]) -> list[dict]`: parallel-call Gemini Flash via `google.genai.Client`. Reuse the same `genai.Client` initialised in `gemini_service.py` rather than instantiating a new one (one shared module-level client per process).
3. Token-budget guard: if any batch JSON exceeds 80k tokens, halve the batch and retry. Log + audit on every retry.

**Test cases.**
- **B2-T1.** With 100 calls split into 5 batches of 20, returns 5 stage-1 result objects.
- **B2-T2.** Batch with 0 valid scored calls → returns `{strengths:[], weaknesses:[], …}` (not an error).
- **B2-T3.** Mocked Gemini that times out twice then succeeds → final result returned, retry count audited.
- **B2-T4.** Token-overflow test: synthetic batch >80k → split logic triggers; logs show `swot.stage1.split`.

---

### B3. SWOT Stage-2 Reduce prompt (Pro) — synthesised SWOT

**Files.** [backend/trainer/swot/prompts.py](backend/trainer/swot/prompts.py) (`STAGE2_REDUCE_PROMPT`), new [backend/trainer/swot/stage2_reduce.py](backend/trainer/swot/stage2_reduce.py).

**Steps.**
1. Stage-2 prompt synthesises 5 stage-1 results into a single Store SWOT JSON: `strengths[≤7]`, `weaknesses[≤7]`, `opportunities[≤5]`, `threats[≤5]`, each with `theme`, `evidence_count`, `representative_quotes[≤3]`, `severity` (low/med/high).
2. Pydantic schema (`SWOTReport`) for return value — strict; fail loudly on shape mismatch.
3. Cost accounting: tally tokens-in × tokens-out × per-model rate from a config lookup. Persist `cost_inr` on `swot_cache.csv`.

**Test cases.**
- **B3-T1.** Given 5 mock stage-1 outputs, returns a `SWOTReport` with the right shape.
- **B3-T2.** Schema-violating LLM output → `ValidationError`; nothing written to cache.
- **B3-T3.** `cost_inr` recorded > 0 and < 100 (sanity bounds for a single Pro call).

---

### B4. SWOT cache + API

**Files.** New [backend/trainer/swot/cache.py](backend/trainer/swot/cache.py), extend [backend/trainer/router.py](backend/trainer/router.py).

**Steps.**
1. `cache.get(store_name) -> Optional[SWOTReport]`: reads `swot_cache.csv`; returns the latest row by `generated_at` if `< 7 days old` and `status == 'ok'`.
2. `cache.put(store_name, report, input_call_count, model, cost_inr)`: appends a new row; never overwrites.
3. Endpoints:
   ```
   GET  /api/trainer/swot/{store_name}                  # cached or stale-while-revalidate
   POST /api/trainer/swot/{store_name}/refresh          # admin or manager only; forces regeneration
   GET  /api/trainer/swot                               # list all cached SWOTs (manager+ scope)
   ```
4. `/refresh` runs B1 → B2 → B3 inside a `BackgroundTask`; returns `202 Accepted` immediately with a `job_id`. Polling endpoint `GET /api/trainer/swot/jobs/{job_id}` returns `{status, progress}`.

**Test cases.**
- **B4-T1.** Cold `GET /swot/<store>` → triggers a sync call to B3 only if no cached row exists; otherwise returns cache hit (≤200 ms).
- **B4-T2.** `POST /swot/<store>/refresh` returns 202 with a `job_id`; later `GET /swot/jobs/{id}` returns `{status:"completed"}`.
- **B4-T3.** Non-manager → `POST /refresh` → 403.
- **B4-T4.** Cache age > 7 days → `GET /swot/<store>` triggers a stale-while-revalidate refresh in the background.

---

### B5. SWOT React UI (read-only display)

**Files.** New [frontend/src/pages/trainer/StoreSwotPage.jsx](frontend/src/pages/trainer/StoreSwotPage.jsx), new [frontend/src/components/trainer/SwotCard.jsx](frontend/src/components/trainer/SwotCard.jsx), [frontend/src/utils/trainerApi.js](frontend/src/utils/trainerApi.js) (add `swot.get`, `swot.refresh`, `swot.jobs`).

**Steps.**
1. Page route `/trainer/swot/:storeName` (added in App.jsx).
2. Layout: 4-quadrant grid (Tailwind `grid-cols-2`), each quadrant shows top items with severity badge + click-to-expand evidence quotes.
3. "Refresh" button calls `swot.refresh(store)`, then polls `swot.jobs(jobId)` every 2s, then re-fetches `swot.get(store)`.
4. Empty state: "No SWOT yet. Click Refresh to generate."

**Test cases.**
- **B5-T1.** Page renders 4 quadrants with seeded SWOT data.
- **B5-T2.** Refresh button disabled while a job is in flight.
- **B5-T3.** Manager role sees the Refresh button; staff role does not.
- **B5-T4.** Empty state shows correct CTA.

---

### B6. SWOT weekly auto-refresh job

**Files.** New [backend/trainer/swot/scheduler.py](backend/trainer/swot/scheduler.py), [backend/trainer/bootstrap.py](backend/trainer/bootstrap.py) (start scheduler).

**Steps.**
1. Use a simple `asyncio.create_task` loop that wakes every hour, reads `swot_cache.csv`, refreshes any store whose latest entry is >7 days old. No Celery/RQ — keep it lightweight.
2. Refreshes are sequential (one at a time) to avoid API rate spikes; bounded by `TRAINER_DAILY_TENANT_CAP_INR`.
3. Each refresh is audited (`swot.auto_refresh.start`, `swot.auto_refresh.completed`).

**Test cases.**
- **B6-T1.** With one store cache aged 8 days, scheduler fires a refresh exactly once per cycle.
- **B6-T2.** Cap exceeded → scheduler skips remaining refreshes for the day; log warning.
- **B6-T3.** Scheduler shut down on app shutdown signal cleanly (no `Task was destroyed but it is pending` warnings).

---

### B7. SWOT integration test (end-to-end)

**Files.** New [backend/tests/trainer/test_swot_e2e.py](backend/tests/trainer/test_swot_e2e.py).

**Steps.**
1. Mock the Gemini client with deterministic responses (recorded fixtures in `tests/fixtures/gemini_swot_*.json`).
2. Drive `POST /swot/<store>/refresh` end to end; assert `swot_cache.csv` has the right row, `audit_log.csv` has 3 rows (started, stage1_done, completed).
3. Verify AC-1: existing endpoints still match baseline.

**Test cases.**
- **B7-T1.** End-to-end refresh + read returns a `SWOTReport` with non-empty strengths.
- **B7-T2.** AC-1 baseline matches.

---

## 8. Group C — Persona Library (depends on A)

### C1. Per-call persona signature extraction

**Files.** New [backend/trainer/personas/signature.py](backend/trainer/personas/signature.py), new [backend/trainer/personas/prompts.py](backend/trainer/personas/prompts.py).

**Steps.**
1. For each call in the corpus, run a Gemini Flash prompt that emits a 12-field `PersonaSignature`: `{language, regional_origin, gender_hint, age_band, income_band, brand_recall_strength, product_pref_keywords, urgency, price_sensitivity, decision_role, objections_emitted[], hooks_responded_to[]}`. PRD §7.2.
2. Persist signatures to `backend/data/trainer/persona_signatures.parquet` (compact). One row per call.
3. Skip calls with `Transcript_Log` shorter than 200 chars.

**Test cases.**
- **C1-T1.** With 50 mock transcripts, 50 signatures emitted; all 12 fields populated.
- **C1-T2.** Short transcripts (<200 chars) skipped; count logged.

---

### C2. Cluster + synthesise 50 personas

**Files.** New [backend/trainer/personas/cluster.py](backend/trainer/personas/cluster.py), new [backend/trainer/personas/synthesise.py](backend/trainer/personas/synthesise.py).

**Steps.**
1. Cluster signatures using a simple weighted Hamming distance over the 12 fields (no sklearn — `numpy` only). Pick `k=50`.
2. For each cluster, send the cluster centroid + 5 representative signatures to Gemini Pro to synthesise a final `Persona` (PRD §7 schema): `id, name, summary, language_mix, opening_line_hint, brand_affinity, urgency_profile, objections_likely, surprise_pivot, difficulty_band, voice_profile, target_skill_focus`.
3. Store as a single JSON file `backend/data/trainer/personas_v_draft.json`.

**Test cases.**
- **C2-T1.** With 500 fixture signatures, produces exactly 50 persona objects.
- **C2-T2.** No two personas have identical `name`.
- **C2-T3.** Each persona validates against `Persona` Pydantic schema (C3).

---

### C3. Persona Pydantic schema + validation

**Files.** New [backend/trainer/personas/schema.py](backend/trainer/personas/schema.py).

**Steps.**
1. `Persona` Pydantic model + `PersonaLibrary` (versioned wrapper: `version, generated_at, personas: list[Persona]`).
2. `validate_library(json_path) -> list[ValidationIssue]` — checks ID uniqueness, required fields, difficulty band coverage (PRD requires ≥10 easy, ≥10 medium, ≥10 hard), language mix coverage.

**Test cases.**
- **C3-T1.** Valid library passes.
- **C3-T2.** Library missing hard-difficulty personas → issue with code `INSUFFICIENT_DIFFICULTY_COVERAGE`.
- **C3-T3.** Duplicate persona IDs → issue.

---

### C4. Diversity enforcement post-pass

**Files.** New [backend/trainer/personas/diversity.py](backend/trainer/personas/diversity.py).

**Steps.**
1. Compute coverage matrix across (language × age_band × difficulty × decision_role). PRD requires every cell to have ≥1 persona where the matrix is "must-cover" (24 cells of 96 total).
2. If any must-cover cell is empty, run a targeted re-synthesis prompt that *requests* a persona for that exact cell (Gemini Pro). Append to the library. Increment `version`.

**Test cases.**
- **C4-T1.** Library with one missing cell triggers exactly one re-synthesis call; new persona slots into the cell.
- **C4-T2.** All cells covered → no re-synthesis; library unchanged.

---

### C5. Admin review UI (persona library)

**Files.** New [frontend/src/pages/trainer/admin/PersonaLibraryPage.jsx](frontend/src/pages/trainer/admin/PersonaLibraryPage.jsx), new [frontend/src/components/trainer/PersonaCard.jsx](frontend/src/components/trainer/PersonaCard.jsx), extend `trainerApi.js` (`personas.draft`, `personas.publish`, `personas.list`).

**Steps.**
1. Renders a paginated grid of all 50 draft personas, each with name, summary, difficulty badge, language mix, `Edit JSON` button.
2. JSON editor uses a plain `<textarea>` + client-side schema validation (re-run a stripped-down Zod schema in JS, or just a structural check); errors highlight inline.
3. "Publish v1" button → `POST /api/trainer/admin/personas/publish` (admin-only). Optimistic UI; rollback on failure.

**Test cases.**
- **C5-T1.** Admin sees 50 cards; non-admin → 403 / redirect to `/trainer`.
- **C5-T2.** Editing a persona to violate the schema → save button disabled.
- **C5-T3.** Publish flips the library status; published personas appear under `GET /api/trainer/personas`.

---

### C6. Persona publish flow + versioning

**Files.** Extend [backend/trainer/router.py](backend/trainer/router.py) with persona endpoints, new [backend/trainer/personas/publisher.py](backend/trainer/personas/publisher.py).

**Steps.**
1. Endpoints:
   ```
   GET   /api/trainer/personas                       # list published personas (any auth role)
   GET   /api/trainer/personas/{persona_id}          # detail (any auth)
   GET   /api/trainer/admin/personas/draft           # current draft (admin only)
   POST  /api/trainer/admin/personas/publish         # promote draft → vN published
   ```
2. Publish writes `personas_v{N}.json`, copies it to `personas_published.json`, appends to `personas.csv` audit row, audits `personas.published`.
3. Older versions retained for replay (per D9 retention).

**Test cases.**
- **C6-T1.** First publish creates `personas_v1.json` and `personas_published.json`.
- **C6-T2.** Second publish bumps to `personas_v2.json`; v1 file retained.
- **C6-T3.** Public `GET /personas` returns the published set; never the draft.

---

### C7. Persona picker (server-side biased random)

**Files.** New [backend/trainer/personas/picker.py](backend/trainer/personas/picker.py), extend [backend/trainer/router.py](backend/trainer/router.py).

**Steps.**
1. Endpoint:
   ```
   POST /api/trainer/personas/pick   # body: {staff_id, store_name}; returns {persona_id, why}
   ```
2. With probability `TRAINER_PERSONA_BIAS_PCT/100`, pick a persona whose `target_skill_focus` overlaps the store's top SWOT weakness; otherwise random uniform across the published set.
3. New-joiner staff (`is_new_joiner == true`) get a forced "easy" pick for their first 5 drills.

**Test cases.**
- **C7-T1.** With bias=100 and one weakness, the picked persona has matching `target_skill_focus`.
- **C7-T2.** With bias=0, distribution over 1000 picks is uniform across published IDs.
- **C7-T3.** New joiner first 5 drills → all easy difficulty.

---

### C8. Persona-side smoke tests with stub library

**Files.** New `backend/tests/fixtures/personas_test.json` (TD-6), new [backend/tests/trainer/test_personas_picker.py](backend/tests/trainer/test_personas_picker.py).

**Test cases.**
- **C8-T1.** With the 5-persona stub, picker still respects bias logic.
- **C8-T2.** Picker handles empty published library → 503 with helpful message.

---

## 9. Group D — Mock Call Engine (depends on A + C)

### D1. Drill state machine + drill record

**Files.** New [backend/trainer/drill/state.py](backend/trainer/drill/state.py), [backend/trainer/csvstore.py](backend/trainer/csvstore.py) (`calls.csv` already in schema).

**Steps.**
1. State enum: `STARTING → IN_CALL → COMPLETED | FAILED | TIMED_OUT | CANCELLED`. State transitions append a *new* row to `calls.csv`; never edit in place.
2. `start_drill(staff_id, persona_id, store_name) -> drill_uuid`: writes `STARTING` row.
3. `transition(drill_uuid, new_status, **fields)`: appends row.
4. `latest_state(drill_uuid)`: `read_latest_per`.
5. Disposition reasons: `network_drop`, `mic_revoked`, `quota_exceeded`, `staff_cancelled`, `5min_elapsed`, `gemini_error`.

**Test cases.**
- **D1-T1.** Three transitions on one uuid → `latest_state` returns the third.
- **D1-T2.** Concurrent transitions on different uuids never cross-contaminate.
- **D1-T3.** Invalid transition (e.g. `STARTING → STARTING`) → `InvalidStateTransition`.

---

### D2. Drill start endpoint + persona binding

**Files.** Extend [backend/trainer/router.py](backend/trainer/router.py), new [backend/trainer/drill/start.py](backend/trainer/drill/start.py).

**Steps.**
1. `POST /api/trainer/drills/start` body `{persona_id?}` (optional; if absent, use C7 picker). Returns `{drill_uuid, persona, ws_url, hard_timeout_seconds: 300}`.
2. Pre-flight checks (G1):
   - staff daily soft cap warning (returned but not blocking)
   - staff daily hard cap (block, 429)
   - tenant daily cap (block, 429)
   - store daily cap (block, 429)
3. Logs `drills.started` audit row.

**Test cases.**
- **D2-T1.** Successful start → 200 with non-empty `ws_url`, `drill_uuid`.
- **D2-T2.** Hard cap exceeded → 429 with `cap_kind` in body.
- **D2-T3.** No published persona library → 503.

---

### D3. WebSocket endpoint — Gemini Live proxy

**Files.** New [backend/trainer/ws.py](backend/trainer/ws.py), [backend/main.py](backend/main.py) does **not** change (the WS is registered on the trainer router via `add_api_websocket_route`).

**Steps.**
1. Endpoint `/ws/trainer/drill/{drill_uuid}`:
   - On connect: validate cookie + that the drill is in `STARTING` state and belongs to this `staff_id`.
   - Open a *server-side* connection to Gemini Live with the assembled system prompt (D4).
   - Bidirectional pump: browser PCM → Gemini; Gemini PCM → browser. Use `asyncio.gather` of two pumps.
   - Tag every audio chunk and transcript line with monotonic offsets for later replay.
   - On any pump error → close client with code 1011 + `disposition_reason`.
2. Hard 5-minute timer: `asyncio.wait_for` on the whole session; on timeout → graceful close + state transition `TIMED_OUT`.

**Test cases.**
- **D3-T1.** Smoke client `scripts/test_gemini_live.py` connects, sends 1s of silence, gets audio reply within 3s.
- **D3-T2.** Connection without a valid cookie → 4401 close.
- **D3-T3.** 5-minute timer fires; state becomes `TIMED_OUT`; client gets close code 1000 with payload `{reason:"5min_elapsed"}`.
- **D3-T4.** No `AIzaSy...` string ever leaves the server (browser network log inspection).

---

### D4. System prompt assembly (per drill)

**Files.** New [backend/trainer/drill/prompt.py](backend/trainer/drill/prompt.py).

**Steps.**
1. Builds the runtime persona prompt (PRD §8.2): persona JSON + opening line + difficulty + surprise pivot rules + product catalog (TD-7) + grounding constraints (no fabricated SKUs).
2. Inserts realtime constraints: speak English, accept Hindi/Hinglish from staff, never reveal the persona's underlying scoring rubric.

**Test cases.**
- **D4-T1.** Output is valid UTF-8, ≤100k chars (Gemini Live system-prompt budget).
- **D4-T2.** Random property test: never includes any markdown headings (Live API treats the whole prompt as a single instruction stream).
- **D4-T3.** Catalog is faithfully embedded: a known SKU appears verbatim.

---

### D5. Browser mic capture hook

**Files.** New [frontend/src/utils/useMic.js](frontend/src/utils/useMic.js).

**Steps.**
1. Custom hook `useMic({ onChunk })`: requests `getUserMedia({ audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true } })`, builds an `AudioWorkletNode` that emits 320-ms PCM 16-bit chunks.
2. Returns `{ start, stop, error, level }` (level 0–1 for VU meter).
3. Cleans up the AudioContext on unmount.

**Test cases.**
- **D5-T1.** Hook starts/stops cleanly across React strict-mode double-invocation.
- **D5-T2.** Permission revoked mid-stream → `error` set; no console exception.
- **D5-T3.** Level updates at ≥30 Hz when speaking.

---

### D6. Browser audio playback hook

**Files.** New [frontend/src/utils/useGeminiPlayback.js](frontend/src/utils/useGeminiPlayback.js).

**Steps.**
1. Hook `usePlayback({ socket })`: subscribes to incoming binary frames from the WS, schedules them with `AudioContext` via a small jitter buffer (300ms target).
2. Reports `playing: bool` and `lag_ms` for UI.

**Test cases.**
- **D6-T1.** With a synthetic source pumping 1s tones, playback is glitch-free for 60s in a Chrome 120 manual test.
- **D6-T2.** Buffer underrun → no exception; `lag_ms` rises gracefully.

---

### D7. WebSocket client wrapper hook

**Files.** New [frontend/src/utils/useGeminiLiveSocket.js](frontend/src/utils/useGeminiLiveSocket.js).

**Steps.**
1. Wraps `WebSocket` with auto-reconnect (1 retry only — drills are short), backoff 500ms.
2. Exposes `{ send, onText, onAudio, status, close }`.

**Test cases.**
- **D7-T1.** Server closes mid-call → `status` transitions `connected → reconnecting → failed`; UI reflects.
- **D7-T2.** Manual `close()` from React unmount aborts cleanly (no leaked sockets in the Network tab after 5 unmounts).

---

### D8. Drill page UI (live drill)

**Files.** New [frontend/src/pages/trainer/DrillPage.jsx](frontend/src/pages/trainer/DrillPage.jsx), new [frontend/src/components/trainer/MicMeter.jsx](frontend/src/components/trainer/MicMeter.jsx), new [frontend/src/components/trainer/CallTimer.jsx](frontend/src/components/trainer/CallTimer.jsx).

**Steps.**
1. Route `/trainer/drill/:drillUuid`.
2. Layout: persona card (top), big mic meter (centre), 5-minute countdown (top-right), End-Call button.
3. Auto-starts mic + WS on mount.
4. Surprise-pivot indicator: when persona triggers a pivot (D11), a subtle pill appears.

**Test cases.**
- **D8-T1.** Manual: full happy-path drill on Chrome 120 + iPad Safari 17 — call holds for 5 minutes, audio bidirectional throughout.
- **D8-T2.** Mid-drill mic permission revoke → graceful UI message + state `FAILED`.
- **D8-T3.** End-Call button → state `COMPLETED`, redirect to score-card page (built in E5).

---

### D9. Recording-to-disk

**Files.** New [backend/trainer/drill/recorder.py](backend/trainer/drill/recorder.py).

**Steps.**
1. While the WS pump runs, also write incoming + outgoing PCM into two files under `backend/data/trainer/audio/{YYYY}/{MM}/{drill_uuid}_in.pcm` and `_out.pcm`. Then post-process to a single 16-kHz mono WAV via `wave` stdlib (no ffmpeg dependency for v1; mix later in E if needed).
2. On state `COMPLETED|FAILED|TIMED_OUT`, finalize the WAV and write `audio_path` into the latest `calls.csv` row for that uuid.

**Test cases.**
- **D9-T1.** A 30s drill produces a WAV ≈ 30s long ±0.5s.
- **D9-T2.** Crash mid-drill → partial PCM files exist; janitor (G6) cleans them up.

---

### D10. Transcript JSONL writer

**Files.** New [backend/trainer/drill/transcript.py](backend/trainer/drill/transcript.py).

**Steps.**
1. Each Gemini Live text/transcript event is appended to `audio/{...}/{drill_uuid}.jsonl` with `{t_ms, speaker:"customer"|"staff", text, partial:bool}`.
2. On finalize, dedupe partials → final lines; write `transcript_path` to `calls.csv`.

**Test cases.**
- **D10-T1.** Synthetic stream of 10 partials + 5 finals → 5 final lines in the post-processed file.
- **D10-T2.** Concurrent appenders never interleave (single-writer guarantee).

---

### D11. Surprise-pivot logic

**Files.** New [backend/trainer/drill/pivot.py](backend/trainer/drill/pivot.py).

**Steps.**
1. At a random time between `T+90s` and `T+210s`, inject a "pivot directive" into the Gemini system stream (a `tool_call`-style nudge: "Pivot now to objection: <X>").
2. Pivot type drawn from `persona.surprise_pivot` distribution.

**Test cases.**
- **D11-T1.** Over 50 simulated drills, pivot occurs in window 90s–210s in every drill.
- **D11-T2.** Pivot type matches persona spec (no out-of-distribution pivots).

---

### D12. Network preflight check

**Files.** New [frontend/src/components/trainer/PreflightCheck.jsx](frontend/src/components/trainer/PreflightCheck.jsx), extend [backend/trainer/router.py](backend/trainer/router.py) with `GET /api/trainer/preflight`.

**Steps.**
1. Backend `/preflight` checks: `GEMINI_API_KEY` set, audio dir writable, recent average drill cost trending acceptable.
2. Frontend pings `/preflight`, runs a 2-second mic check (visual VU meter). Block "Start Drill" until both pass.

**Test cases.**
- **D12-T1.** Without mic permission, button stays disabled.
- **D12-T2.** With backend `/preflight` returning `{ok:false, reason:"GEMINI_API_KEY"}`, UI shows a clear red banner.

---

### D13. Failure handlers (mic revoked / network drop / Gemini error)

**Files.** New [backend/trainer/drill/failure.py](backend/trainer/drill/failure.py), [frontend/src/pages/trainer/DrillPage.jsx](frontend/src/pages/trainer/DrillPage.jsx) (handlers).

**Steps.**
1. Each known failure path transitions state with a specific `disposition_reason`.
2. Frontend shows a tailored message + "Try again" CTA. No silent failures.

**Test cases.**
- **D13-T1.** Forced WS close (server) → state `FAILED` with `network_drop`.
- **D13-T2.** Forced 401 from Gemini (mock) → `FAILED` with `gemini_error`.

---

### D14. Drill cancellation

**Files.** Extend [backend/trainer/router.py](backend/trainer/router.py) with `POST /api/trainer/drills/{uuid}/cancel`.

**Steps.**
1. Sets state to `CANCELLED`. WS server closes if open.
2. Audit `drills.cancelled`.

**Test cases.**
- **D14-T1.** Cancel mid-drill → WS closes within 1s; state is `CANCELLED`; quota count rolled back per G2.
- **D14-T2.** Cancel after `COMPLETED` → 409.

---

### D15. End-of-drill side-effects (chain into E)

**Files.** [backend/trainer/drill/state.py](backend/trainer/drill/state.py).

**Steps.**
1. On `COMPLETED`, enqueue a `BackgroundTask` to run E1 (score-card extraction). Returns from the WS handler immediately.
2. Failure to score does **not** revert the drill state (a separate retry path in F).

**Test cases.**
- **D15-T1.** A completed drill produces a `score_cards.csv` row within 30s under nominal conditions.
- **D15-T2.** Score-card task crash → drill stays `COMPLETED`; audit `scoring.failed` row written.

---

## 10. Group E — Score Card (depends on D)

### E1. Score-Card extractor (single Pro call)

**Files.** New [backend/trainer/scoring/extractor.py](backend/trainer/scoring/extractor.py), new [backend/trainer/scoring/prompts.py](backend/trainer/scoring/prompts.py).

**Steps.**
1. Prompt: ingest the transcript JSONL + persona spec, output a Pydantic-validated `ScoreCard` with the same taxonomy as the existing real-call analysis (Agent NPS, RELAX, Hooks, Probing, Skills, Barriers, Product Intelligence, Conversion Readiness).
2. Compute `score_overall` as a weighted sum (weights from PRD §11.3).
3. Persist row in `score_cards.csv`.

**Test cases.**
- **E1-T1.** Mock transcript → valid `ScoreCard`; overall in `[0, 100]`.
- **E1-T2.** Transcript-only-staff (no customer turns) → graceful `LOW_SIGNAL` flag.

---

### E2. Per-skill drill-down generator

**Files.** New [backend/trainer/scoring/breakdown.py](backend/trainer/scoring/breakdown.py).

**Steps.**
1. For each skill axis, generate `{score, examples_good[], examples_missed[], next_drill_hint}`.
2. Examples are quoted directly from the transcript with timestamps.

**Test cases.**
- **E2-T1.** Hand-crafted transcript with 3 obvious good moments → all 3 captured in `examples_good`.

---

### E3. Score-card endpoints

**Files.** Extend [backend/trainer/router.py](backend/trainer/router.py).

**Steps.**
1. Endpoints:
   ```
   GET  /api/trainer/score-cards/{drill_uuid}
   GET  /api/trainer/score-cards?staff_id=&limit=
   POST /api/trainer/score-cards/{drill_uuid}/rescore   # admin-only
   ```
2. Visibility:
   - Staff sees only their own.
   - Manager sees all in their store.
   - Cluster head sees all in their cluster.
   - Admin sees all.

**Test cases.**
- **E3-T1.** Staff GET on someone else's uuid → 403.
- **E3-T2.** Manager filter list → only own-store rows.

---

### E4. Score-card React UI

**Files.** New [frontend/src/pages/trainer/ScoreCardPage.jsx](frontend/src/pages/trainer/ScoreCardPage.jsx), new [frontend/src/components/trainer/SkillBar.jsx](frontend/src/components/trainer/SkillBar.jsx).

**Steps.**
1. Route `/trainer/score-cards/:drillUuid`.
2. Top: overall score circular gauge. Below: 8 skill bars (RELAX, Hooks, Probing, etc.). Click a bar → opens drill-down with quoted transcript moments.
3. CTA: "Try a similar drill" → calls C7 picker biased to the same skill weakness.

**Test cases.**
- **E4-T1.** Renders cleanly for a seeded score card.
- **E4-T2.** "Try similar" navigates to `/trainer/drill/<new uuid>` with persona biased correctly.

---

### E5. Drill → score-card redirect

**Files.** [frontend/src/pages/trainer/DrillPage.jsx](frontend/src/pages/trainer/DrillPage.jsx) (post-drill nav).

**Test cases.**
- **E5-T1.** On state `COMPLETED`, page navigates to `/trainer/score-cards/<drill_uuid>` and polls until the card is ready (≤30s under nominal conditions; show a loading spinner with "Scoring your drill…").

---

### E6. Coach annotations (manager comments on a drill)

**Files.** Extend [backend/trainer/router.py](backend/trainer/router.py) with `POST/GET /api/trainer/score-cards/{uuid}/notes`, new [backend/trainer/scoring/notes.py](backend/trainer/scoring/notes.py), new `notes.csv`.

**Steps.**
1. Manager+ writes a free-text note keyed to a drill. Notes are append-only; deletions are tombstones.

**Test cases.**
- **E6-T1.** Staff cannot post; manager can.
- **E6-T2.** Notes appear under their drill in E4 UI.

---

### E7. Score-card CSV export (admin)

**Files.** Extend [backend/trainer/router.py](backend/trainer/router.py) with `GET /api/trainer/admin/score-cards.csv`.

**Steps.**
1. Streams all score_cards.csv rows joined with staff display names. Admin only.

**Test cases.**
- **E7-T1.** Returns text/csv with the right header row; row count matches DB.

---

## 11. Group F — Adoption Panel (depends on E)

### F1. Manager dashboard backend aggregator

**Files.** New [backend/trainer/adoption/aggregator.py](backend/trainer/adoption/aggregator.py), extend [backend/trainer/router.py](backend/trainer/router.py) with `GET /api/trainer/adoption/store/{store_name}`.

**Steps.**
1. Returns: `{ drills_per_day_last_14d[], avg_score_trend[], staff_table[{staff_id, name, drills_30d, avg_score, weakest_skill}], coverage_pct }`.

**Test cases.**
- **F1-T1.** Aggregates correctly across seeded `score_cards.csv`.

---

### F2. Cluster head dashboard

**Files.** Extend `aggregator.py`, `router.py` with `GET /api/trainer/adoption/cluster/{cluster_id}`.

**Test cases.**
- **F2-T1.** Cluster head sees rolled-up store cards.

---

### F3. Adoption page UI (manager view)

**Files.** New [frontend/src/pages/trainer/AdoptionPage.jsx](frontend/src/pages/trainer/AdoptionPage.jsx), new [frontend/src/components/trainer/AdoptionTrendChart.jsx](frontend/src/components/trainer/AdoptionTrendChart.jsx).

**Steps.**
1. Route `/trainer/adoption`. Header: store selector (limited to manager's scope).
2. Layout: 2 trendline charts (drills/day, avg score), 1 staff table sorted by `avg_score asc`. Clicking a staff row opens their profile (F4).

**Test cases.**
- **F3-T1.** Staff row count matches roster.
- **F3-T2.** Time-zone correctness: charts use IST day boundaries.

---

### F4. Staff profile page

**Files.** New [frontend/src/pages/trainer/StaffProfilePage.jsx](frontend/src/pages/trainer/StaffProfilePage.jsx).

**Steps.**
1. Shows `{drills_30d, avg_score_trend, last_5_drills (with score-card links), top_2_strengths, top_2_gaps}`.

**Test cases.**
- **F4-T1.** Staff can see their own profile; others can't (manager+).

---

### F5. Coverage report (roster vs. drills)

**Files.** Extend `aggregator.py` with `coverage_report_for_store`.

**Steps.**
1. % of active staff with ≥1 drill in last 30d. Surfaced in F3 header.

**Test cases.**
- **F5-T1.** With 3 of 9 active staff drilled, returns 33%.

---

### F6. Weekly digest email stub (admin)

**Files.** New [backend/trainer/adoption/digest.py](backend/trainer/adoption/digest.py).

**Steps.**
1. For v1, build the digest *content* (HTML string) but **don't** send. Expose a manual `GET /api/trainer/admin/digest/preview/{store}` to preview. Hook up SMTP later (out of v1).

**Test cases.**
- **F6-T1.** Preview endpoint returns valid HTML referencing the store name.

---

## 12. Group G — Guardrails & quotas (parallelisable from A)

### G1. Daily quota gate

**Files.** New [backend/trainer/guardrails/quotas.py](backend/trainer/guardrails/quotas.py).

**Steps.**
1. `check_can_start(staff_id, store_name) -> CheckResult`: scans `calls.csv` for today's IST-day rows; counts per staff, per store, per tenant; consults `is_new_joiner` for the staff cap.
2. Returns `{ok, soft_warning?, hard_block_reason?, counts}`.

**Test cases.**
- **G1-T1.** With 5 drills already today, normal staff → `soft_warning="staff_soft"`.
- **G1-T2.** With 7 drills (= hard) → `hard_block_reason="staff_hard"`.
- **G1-T3.** New joiner allowed up to 12.

---

### G2. Cancellation refund

**Files.** [backend/trainer/guardrails/quotas.py](backend/trainer/guardrails/quotas.py) (`refund_on_cancel`).

**Steps.**
1. A `CANCELLED` drill ≤30s in does NOT count toward the daily cap. Implemented at read-time: filter `(status='CANCELLED' AND duration<30s)` out of the count.

**Test cases.**
- **G2-T1.** A 5s cancellation does not consume a slot.
- **G2-T2.** A 4-minute cancellation does (it cost API time).

---

### G3. Per-tenant daily INR cap

**Files.** [backend/trainer/guardrails/quotas.py](backend/trainer/guardrails/quotas.py).

**Steps.**
1. Sum `cost_inr` over today's IST-day rows; block when ≥ `TRAINER_DAILY_TENANT_CAP_INR`.

**Test cases.**
- **G3-T1.** With sum at cap-1 → next start succeeds; at cap → 429.

---

### G4. Per-drill cost target alert

**Files.** [backend/trainer/guardrails/quotas.py](backend/trainer/guardrails/quotas.py), [backend/trainer/audit.py](backend/trainer/audit.py).

**Steps.**
1. After a drill completes, if `cost_inr > TRAINER_PER_DRILL_COST_TARGET_INR * 1.5`, audit `cost.over_target`.

**Test cases.**
- **G4-T1.** A ₹25 drill (target ₹15) → audit row.

---

### G5. Frontend quota indicator

**Files.** New [frontend/src/components/trainer/QuotaBadge.jsx](frontend/src/components/trainer/QuotaBadge.jsx), [frontend/src/pages/trainer/TrainerHome.jsx](frontend/src/pages/trainer/TrainerHome.jsx).

**Steps.**
1. Shows "X/Y drills today" pill in the home header. Reads `GET /api/trainer/quota/me` (new endpoint).

**Test cases.**
- **G5-T1.** Pill turns amber on soft, red on hard.

---

### G6. Retention janitor (audio + transcripts)

**Files.** New [backend/trainer/guardrails/janitor.py](backend/trainer/guardrails/janitor.py), wire into [backend/trainer/bootstrap.py](backend/trainer/bootstrap.py) (run once at boot + daily after).

**Steps.**
1. Walks `backend/data/trainer/audio/` and deletes WAV files older than `TRAINER_AUDIO_RETENTION_DAYS`. JSONL transcripts older than `TRAINER_TRANSCRIPT_RETENTION_DAYS` likewise.
2. Audits `retention.purged` with counts.
3. Idempotent + crash-safe: missing files are fine.

**Test cases.**
- **G6-T1.** A pre-aged file (mtime −95d) is removed; a fresh one is kept.
- **G6-T2.** Empty audio dir → no-op, no exception.

---

## 13. Group H — Pilot rollout (depends on everything)

### H1. Pilot store allowlist

**Files.** [backend/trainer/config.py](backend/trainer/config.py) (`TRAINER_PILOT_STORES`), [backend/trainer/router.py](backend/trainer/router.py) (gate `drills/start`, `swot/refresh`).

**Steps.**
1. When `TRAINER_PILOT_STORES` is non-empty, only allow drill-start and swot-refresh for those stores. Other stores see a "coming soon" banner in F3 and a 403 on the API.

**Test cases.**
- **H1-T1.** With pilot=`["COCO INDIRANAGAR"]`, a HSR staff start → 403.
- **H1-T2.** Empty allowlist (default) → all stores allowed.

---

### H2. Trainer feature flag toggle (admin)

**Files.** Extend [backend/trainer/router.py](backend/trainer/router.py) — `GET /api/trainer/admin/flags`, `POST /api/trainer/admin/flags`.

**Steps.**
1. Persist runtime flags in `flags.csv` (read-through cache). For v1, just `pilot_stores` and `audio_backend` are tunable without restart.

**Test cases.**
- **H2-T1.** Setting pilot stores via API takes effect on the next request without restart.

---

### H3. Onboarding flow + first-drill walkthrough

**Files.** New [frontend/src/pages/trainer/OnboardingPage.jsx](frontend/src/pages/trainer/OnboardingPage.jsx), [frontend/src/pages/trainer/TrainerHome.jsx](frontend/src/pages/trainer/TrainerHome.jsx).

**Steps.**
1. First-time staff users (no completed drills) see a 4-step walkthrough: identify → preflight → first drill → first score card.
2. Walkthrough state persisted in `audit_log.csv` (`onboarding.step.completed`).

**Test cases.**
- **H3-T1.** New staff completing onboarding never sees it again on subsequent logins.

---

### H4. Pre-pilot smoke checklist (manual)

**Files.** New `docs/trainer_pilot_smoke.md`.

**Steps.**
1. A markdown checklist covering: 5 happy-path drills end to end, 2 forced failures (mic revoke, network drop), 1 admin roster upload, 1 SWOT refresh, 1 score-card review by manager, 1 quota-cap hit. Used by QA before flipping pilot on.

**Test cases.**
- **H4-T1.** All boxes checkable; results captured in a dated copy under `docs/trainer_pilot_smoke_<YYYYMMDD>.md`.

---

### H5. Kill-switch verification

**Files.** [backend/trainer/config.py](backend/trainer/config.py).

**Steps.**
1. `TRAINER_ENABLED=false` mid-pilot must:
   - Strip the trainer router (AC-3).
   - Hide the menu link (A3).
   - Cancel any in-flight drills with `disposition_reason="kill_switch"` (graceful WS close on shutdown).

**Test cases.**
- **H5-T1.** Toggle the env var + restart → `/api/trainer/*` 404 within 30s; existing routes 200.

---

## 14. Phasing

| Phase | Scope | Gate |
|---|---|---|
| **v0.1 — internal alpha** | A1–A8 + B1–B4 + C1–C7 + D1–D9 + E1–E3 | Engineering team can complete a drill end-to-end on Chrome; one store has cached SWOT |
| **v0.2 — pilot ready** | + D10–D15 + E4–E7 + F1–F5 + G1–G6 + H1–H4 | Pilot store passes H4 smoke checklist |
| **v0.3 — broad rollout** | + F6 + H2 + H5 | Manager stakeholder sign-off on adoption signals |
| **v1.0 — GA** | All tasks above + the 8 outstanding PRD items closed (see PRD §16) | Cost telemetry stable, week-over-week adoption ≥30% on pilot stores |

---

## 15. Open questions / risks parked from PRD §16

These are listed here so engineers can flag in PR descriptions when a decision is reached:

1. **Multilingual TTS quality.** Gemini Live English voice quality on cellular connections in stores. (Risk → may need Path B offload to ElevenLabs in D3.)
2. **Mobile/iPad audio worklet support.** Older iPads (15+) may need a fallback to `ScriptProcessorNode`. (Risk → D5 fallback path.)
3. **Audio retention costs.** 90-day WAV retention for 50 stores × 5 drills/day ≈ 22.5k WAVs/yr × ~5MB ≈ 110GB. Acceptable on local disk; in cloud, push to cold storage after 30d.
4. **Score-card prompt drift.** As the corpus grows, the per-call analyzer's taxonomy may drift. Add a prompt-version pin in `score_cards.csv` (column already exists).
5. **Persona library staleness.** Re-run C2 quarterly; flag in F6 digest when the library version is >90 days old.
6. **Cookie secret rotation.** Rotation invalidates all sessions. Document a rotation script in H4 smoke checklist.
7. **CORS in production.** The current backend allows all origins; trainer cookies need `SameSite=Lax` (set) but we should narrow CORS during pilot (separate ticket).
8. **Webhook for SMTP.** F6 stub leaves SMTP unconfigured. Pick provider before v0.3.

---

## 16. Reviewer checklist (use during PR review of any task)

- [ ] AC-1 baseline matches (no existing endpoint regressed).
- [ ] No new file outside `backend/trainer/`, `backend/tests/trainer/`, `backend/scripts/`, `frontend/src/pages/trainer/`, `frontend/src/components/trainer/`, `frontend/src/utils/trainerApi.js`, `frontend/src/utils/use*.js`, plus the documented edits to `backend/main.py` (1 block), `backend/requirements.txt`, `frontend/src/App.jsx` (1 routes block), `frontend/src/components/Header.jsx` (1 link), `frontend/vite.config.js` (`/ws` proxy entry).
- [ ] All test cases for the task pass locally (`pytest backend/tests/trainer/` for backend; `npm test` if added; manual list for UI).
- [ ] Audit row written for every state-changing action (grep test in CI).
- [ ] No `localStorage` reads/writes outside the existing app's keys.
- [ ] No Gemini API key shipped to the browser bundle.

---

**End of plan.**
