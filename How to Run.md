# How to Run — Local Development

End-to-end instructions to clone, configure, and run the **Stores Call Analyser + AI Trainer** suite on your machine. Goal: a freshly-cloned repo runs in **two terminals** with one command each.

> **Verified on:** Windows 11 (PowerShell + Git Bash), macOS 14, Ubuntu 22.04. Python 3.10–3.13, Node.js 18–22.

---

## 1. Prerequisites

You need three things installed system-wide:

### 1.1 Python 3.10+

- **Windows:** [python.org/downloads](https://www.python.org/downloads/) — during install, **tick "Add Python to PATH"**.
- **macOS:** `brew install python` (or python.org installer).
- **Linux:** `sudo apt install python3 python3-pip python3-venv` (Debian/Ubuntu).

Verify: `python --version` → should print `3.10` or higher.

### 1.2 Node.js 18+ (npm bundled)

- Get the LTS from [nodejs.org](https://nodejs.org/) (currently 20.x or 22.x).
- **Windows:** run the `.msi`. **macOS:** `brew install node`. **Linux:** [nvm](https://github.com/nvm-sh/nvm).

Verify: `node --version` and `npm --version`.

### 1.3 Git

[git-scm.com/downloads](https://git-scm.com/downloads). Verify: `git --version`.

### 1.4 Gemini API key

You need one for the AI features (Insights report, AI Trainer scoring, SWOT, voice drills). The Analytics / Listing / Trends pages of the analyzer work without it.

- Get a key from [Google AI Studio](https://aistudio.google.com/apikey).
- You'll add it to `backend/.env` in step 3.

---

## 2. Get the code

```bash
git clone https://github.com/prashants-commits/Stores-Call-Analyser-plus-Trainer.git
cd Stores-Call-Analyser-plus-Trainer
```

You should see this top-level layout:

```
Stores-Call-Analyser-plus-Trainer/
├── backend/                    # FastAPI server
│   ├── main.py                 # entry — boots both routers
│   ├── csv_parser.py           # loads the call CSV at startup
│   ├── gemini_service.py       # Insights endpoint
│   ├── trainer/                # AI Trainer subsystem (auth, drill, swot, scoring, personas)
│   ├── tests/                  # pytest suites
│   ├── requirements.txt
│   └── GMB Calls Analyzer - Call details (sample).csv
├── frontend/                   # React + Vite SPA
│   ├── package.json
│   └── src/                    # pages/, components/, utils/
├── README.md
├── How to Run.md               # ← you are here
└── What does this Application DO and How.md
```

---

## 3. Backend setup (one time)

### 3.1 Create + activate a Python venv

```bash
cd backend
python -m venv venv
```

Activate it:
- **Windows (Git Bash):** `source venv/Scripts/activate`
- **Windows (PowerShell):** `venv\Scripts\Activate.ps1`
- **Windows (cmd.exe):** `venv\Scripts\activate.bat`
- **macOS / Linux:** `source venv/bin/activate`

You should see `(venv)` in your prompt.

### 3.2 Install Python dependencies

```bash
pip install -r requirements.txt
```

Installs FastAPI, Uvicorn, google-genai SDK, pandas, portalocker, python-multipart, websockets, and pytest-family.

### 3.3 Configure `backend/.env`

Create the file `backend/.env` with this content (copy-paste, then replace the API key):

```env
# Required for Insights endpoint + AI Trainer (SWOT, scoring, personas, drills)
GEMINI_API_KEY=your-actual-key-from-aistudio

# AI Trainer subsystem — set false to disable trainer routes entirely
TRAINER_ENABLED=true

# 32-byte URL-safe secret for the trainer staff session cookie.
# Generate fresh with:  python -c "import secrets; print(secrets.token_urlsafe(32))"
TRAINER_COOKIE_SECRET=replace_me_with_a_token_urlsafe_32_value

# Comma-separated admin emails. These accounts get admin role on /api/trainer/*.
TRAINER_ADMIN_EMAILS=admin@duroflexworld.com

# Drill mode — "voice" uses the Gemini Live WebSocket; "text" uses HTTP+SSE+browser-TTS
DRILL_DEFAULT_MODE=voice

# Pilot stores eligible for AI Trainer (must match your call CSV's "Store Name" column)
TRAINER_PILOT_STORES=COCO INDIRANAGAR,COCO WHITEFIELD,COCO BANJARA HILLS,COCO AIRPORT ROAD BLR,COCO ANNA NAGAR,COCO KONDAPUR
```

**Tip:** if you don't need the AI Trainer at all, set `TRAINER_ENABLED=false` and you can skip `TRAINER_COOKIE_SECRET` and the rest.

### 3.4 (Optional) Replace the sample call CSV

The repo ships with `backend/GMB Calls Analyzer - Call details (sample).csv` (~2,620 calls across 30+ stores). To use your own data, replace this file with one that matches the same column headers. The backend reads it at startup — restart Terminal 1 (below) after replacing.

---

## 4. Frontend setup (one time)

In a **separate terminal**, from the project root:

```bash
cd frontend
npm install
```

This pulls ~300 packages into `frontend/node_modules/` — React 19, Vite 8, Tailwind 4, react-router-dom 7, lucide-react, xlsx, etc. Takes 30–90 seconds first time.

---

## 5. Run the app — two terminals

### 5.1 Terminal 1 — backend

```bash
cd backend
source venv/Scripts/activate            # or per-OS variant from 3.1
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

You should see:

```
Loaded 2620 calls from CSV
Trainer feature ENABLED (data_dir=...)
INFO:     Uvicorn running on http://127.0.0.1:8000
```

Sanity check: open http://127.0.0.1:8000/api/health → `{"status":"ok","calls_loaded":2620}`.

### 5.2 Terminal 2 — frontend

```bash
cd frontend
npm run dev
```

You should see:

```
  VITE v8.x  ready in ~500 ms
  ➜  Local:   http://localhost:5173/
```

### 5.3 Open the app

Visit **http://localhost:5173** in any modern browser.

---

## 6. Logging in

**Insights Analyzer (Analytics / Listing / Trends / Insights):**
- Email: `admin`
- Password: `admin`

(Other test accounts are listed in `frontend/src/pages/LoginPage.jsx`.)

**AI Trainer:**
1. After analyzer login, visit `/trainer` (or click the trainer link in the header).
2. Click **Identify** → pick a city + store + your staff name.
3. The roster ships with these test users (one per pilot store):

| staff_id | Name | Store |
|---|---|---|
| STF-0001 | Priya R | COCO INDIRANAGAR |
| STF-0002 | Rajesh S (manager) | COCO INDIRANAGAR |
| STF-0003 | Karthik V | COCO WHITEFIELD |
| STF-0004 | Sneha M | COCO BANJARA HILLS |
| STF-0005 | Arjun N | COCO AIRPORT ROAD BLR |
| STF-0006 | Kavitha S | COCO ANNA NAGAR |
| STF-0007 | Vivek P | COCO KONDAPUR |

Admin email (uses the `TRAINER_ADMIN_EMAILS` env var): `admin@duroflexworld.com` — log in as any staff but use this email at the prompt to get admin role + access to `/trainer/admin/*`.

---

## 7. Stop the app

- Press **Ctrl+C** in each terminal.
- Deactivate the Python venv: `deactivate`.

---

## 8. Common troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `python: command not found` | Python not on PATH | Reinstall Python with "Add to PATH", or use `python3` |
| `ModuleNotFoundError: fastapi` | venv not activated, or `pip install` skipped | Re-run **3.1** + **3.2** |
| `Address already in use :8000` | An old uvicorn is still running | Windows: `netstat -ano \| grep :8000` then `taskkill /PID <pid> /F`. Mac/Linux: `lsof -ti:8000 \| xargs kill` |
| Frontend shows "Failed to load calls" | Backend isn't running, or wrong port | Check Terminal 1; the Vite proxy in `vite.config.js` expects `127.0.0.1:8000` |
| Insights / AI Trainer features error 500 | Missing or placeholder `GEMINI_API_KEY` | See **3.3** |
| Trainer routes return 404 | `TRAINER_ENABLED` is false or unset | Set `TRAINER_ENABLED=true` in `backend/.env` and restart Terminal 1 |
| Voice drill — no AI customer audio | Browser blocked microphone, or wrong PTT key | Allow mic permission in the browser; press and hold **Spacebar** to speak |
| `npm install` fails with EACCES | npm cache permissions | `npm install --cache /tmp/npm-cache` |

---

## 9. Quick-reference — fresh clone to running app

```bash
# One-time setup
git clone https://github.com/prashants-commits/Stores-Call-Analyser-plus-Trainer.git
cd Stores-Call-Analyser-plus-Trainer

# Backend
cd backend
python -m venv venv
source venv/Scripts/activate            # adjust per OS
pip install -r requirements.txt
# Create backend/.env per section 3.3
cd ..

# Frontend
cd frontend
npm install
cd ..

# Run (two terminals)
# Terminal 1:
cd backend && source venv/Scripts/activate && python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload

# Terminal 2:
cd frontend && npm run dev
```

Then open http://localhost:5173 and follow section **6** to log in.

---

## 10. Project notes

- **Backend port:** `8000` · **Frontend port:** `5173`.
- **API proxy:** Vite proxies `/api/*` and `/ws/*` to `127.0.0.1:8000` (see `frontend/vite.config.js`); the frontend never needs to know the backend URL during dev.
- **Data:** call CSV is read once at backend startup. Trainer state (drills, score cards, SWOTs, personas) lives in `backend/data/trainer/` and is git-ignored.
- **Audio:** drill recordings land at `backend/data/trainer/audio/{YYYY}/{MM}/{drill_uuid}.wav`; transcripts at `…/{drill_uuid}.jsonl`.
- **Tests:** `cd backend && pytest tests/` — runs the trainer test suite.
- **Deeper dive:** see [What does this Application DO and How.md](./What%20does%20this%20Application%20DO%20and%20How.md) for architecture + AI-model choices.
