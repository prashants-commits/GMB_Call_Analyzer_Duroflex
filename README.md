# GMB Calls Analyzer — Local Setup & Run Guide

A two-part web app that ingests Google My Business call CSVs, scores them, and renders an analytics dashboard, calls listing, call detail, trends, and AI-generated insights (Gemini).

- **Backend:** FastAPI (Python) — serves the call data API on port `8000`
- **Frontend:** React + Vite (Node.js) — serves the UI on port `5173`

---

## 1. Prerequisites — install once, on a fresh machine

You need three things installed system-wide before anything else:

### 1.1 Python 3.10+ (3.11 / 3.12 / 3.13 all work)

- **Windows:** Download from [python.org/downloads](https://www.python.org/downloads/) — during the installer, **tick "Add Python to PATH"**.
- **macOS:** `brew install python` (or download from python.org).
- **Linux:** `sudo apt install python3 python3-pip python3-venv` (Debian/Ubuntu).

Verify:
```bash
python --version    # should print Python 3.10 or higher
pip --version
```

### 1.2 Node.js 18+ and npm (npm comes bundled)

- Download the **LTS** version from [nodejs.org](https://nodejs.org/) (currently 20.x or 22.x).
- **Windows:** Run the `.msi` installer; npm is included.
- **macOS:** `brew install node`.
- **Linux:** Use [nvm](https://github.com/nvm-sh/nvm) or your distro's package.

Verify:
```bash
node --version      # v18.x or higher
npm --version       # 9.x or higher
```

### 1.3 Git (only if cloning from a remote repo)

- Download from [git-scm.com](https://git-scm.com/downloads).
- Verify: `git --version`.

### 1.4 (Optional) Gemini API key for Insights feature

The Insights Dashboard uses Google Gemini. The rest of the app (Analytics, Listing, Trends) works without it.

- Get a key from [Google AI Studio](https://aistudio.google.com/apikey).
- You'll set it in `backend/.env` in step 3 below.

---

## 2. Get the code

```bash
git clone <repo-url> GMB_Call_Analyzer_Duroflex
cd GMB_Call_Analyzer_Duroflex
```

Or download/extract the zip and `cd` into the project folder.

The folder structure should look like:
```
GMB_Call_Analyzer_Duroflex/
├── backend/                # FastAPI server
│   ├── main.py
│   ├── csv_parser.py
│   ├── gemini_service.py
│   ├── requirements.txt
│   └── GMB Calls Analyzer - Call details (sample).csv
├── frontend/               # React + Vite app
│   ├── package.json
│   ├── src/
│   └── index.html
└── README.md
```

---

## 3. Backend setup (one time)

All commands are run from the project root.

### 3.1 Create a Python virtual environment

```bash
cd backend
python -m venv venv
```

### 3.2 Activate the virtual environment

- **Windows (Git Bash):** `source venv/Scripts/activate`
- **Windows (PowerShell):** `venv\Scripts\Activate.ps1`
- **Windows (cmd.exe):** `venv\Scripts\activate.bat`
- **macOS / Linux:** `source venv/bin/activate`

You should see `(venv)` in your prompt.

### 3.3 Install all Python packages from requirements.txt

```bash
pip install -r requirements.txt
```

This installs FastAPI, Uvicorn, google-genai, and python-dotenv in one go.

### 3.4 Configure the Gemini API key (only needed for Insights)

Create a file `backend/.env` with this content:
```
GEMINI_API_KEY=your-actual-key-from-aistudio
```

If you skip this, the Analytics / Listing / Trends pages all work — only the Insights dashboard will error.

### 3.5 (Optional) Replace the sample CSV

The repo ships with a sample CSV at `backend/GMB Calls Analyzer - Call details (sample).csv` (~2,620 calls). Replace it with your own CSV using the same column headers. The backend reads it at startup.

---

## 4. Frontend setup (one time)

In a **separate terminal** (so the backend can keep running later), from the project root:

```bash
cd frontend
npm install
```

This reads `package.json` and downloads ~300 packages into `frontend/node_modules/` (React, Vite, Tailwind, lucide-react, xlsx, etc.). Takes 30–90 seconds.

---

## 5. Running the app

You need **two terminals** open simultaneously — one for backend, one for frontend.

### 5.1 Terminal 1 — start the backend

```bash
cd backend
source venv/Scripts/activate          # Windows Git Bash; adjust per OS (see 3.2)
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

You should see:
```
Loaded 2620 calls from CSV
INFO:     Uvicorn running on http://127.0.0.1:8000
```

Sanity check (in a browser or `curl`): http://127.0.0.1:8000/api/health → `{"status":"ok","calls_loaded":2620}`.

### 5.2 Terminal 2 — start the frontend

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

Visit http://localhost:5173 in any modern browser (Chrome / Edge / Firefox / Safari).

**Default login (sample/static):**
- Email: `admin`
- Password: `admin`

(Other test accounts are listed in `frontend/src/pages/LoginPage.jsx`.)

---

## 6. Stopping the app

- In each terminal, press **Ctrl+C** to stop the server.
- To deactivate the Python venv: `deactivate`.

---

## 7. Common troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `python: command not found` | Python not on PATH | Reinstall Python with "Add to PATH" checked, or use `python3` instead |
| `ModuleNotFoundError: fastapi` | venv not activated, or `pip install` not run | Re-run step 3.2 then 3.3 |
| `Address already in use :8000` | An old uvicorn instance is still running | Kill it: `taskkill /PID <pid> /F` (Windows) or `lsof -ti:8000 \| xargs kill` (mac/linux). Then restart. |
| Frontend shows "Failed to load calls from server" | Backend not running, or running on wrong port | Check Terminal 1; the frontend proxy in `vite.config.js` expects `127.0.0.1:8000` |
| `npm install` fails with EACCES / permission errors | npm cache permissions | `npm install --cache /tmp/npm-cache` (or set a writable cache via `npm config set cache <path>`) |
| Insights page shows "GEMINI_API_KEY is not configured" | Missing or placeholder key in `backend/.env` | See step 3.4 |
| Login page rejects credentials | Wrong email/password | Use `admin` / `admin` (case-sensitive) |

---

## 8. Quick reference — install everything from scratch in one go

After cloning the repo and installing Python + Node (sections 1.1, 1.2):

```bash
# Backend
cd backend
python -m venv venv
source venv/Scripts/activate            # adjust per OS
pip install -r requirements.txt
cd ..

# Frontend
cd frontend
npm install
cd ..

# Run (in two terminals)
# Terminal 1:
cd backend && source venv/Scripts/activate && python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload

# Terminal 2:
cd frontend && npm run dev
```

Then open http://localhost:5173.

---

## 9. Project notes

- **Backend port:** `8000` (configured at startup)
- **Frontend port:** `5173` (Vite default)
- **API proxy:** Vite proxies `/api/*` → `http://127.0.0.1:8000` (see `frontend/vite.config.js`), so the frontend never needs to know the backend's full URL during development.
- **Data source:** CSV file at `backend/GMB Calls Analyzer - Call details (sample).csv` — reloaded at backend startup; if you replace it, restart Terminal 1.
- **Python dependencies:** Listed in `backend/requirements.txt`. Standard-library modules (`csv`, `json`, `os`, `re`, `pathlib`, `typing`) need no install.
- **Frontend dependencies:** Listed in `frontend/package.json` and locked in `frontend/package-lock.json`. `npm install` reads both.
