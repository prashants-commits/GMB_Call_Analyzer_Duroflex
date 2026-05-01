"""AI Trainer — segregated subsystem for store staff training.

This package is a **strict opt-in**: nothing in here runs unless `TRAINER_ENABLED=true`
in the environment AND `backend/main.py` has loaded `bootstrap.on_startup` + included
`router`. With the flag off, importing this package has zero side effects beyond
loading config from .env.

Segregation invariants (see AITrainer_TechPlan_v1.md §5 AC-1 through AC-10):
- No code in this package mutates the existing `CallDataStore`. It only reads.
- No code in this package writes to existing data files
  (`backend/GMB Calls Analyzer - Call details (sample).csv`, etc.).
- All trainer state lives under `backend/data/trainer/` (CSVs + audio).
- All HTTP routes are mounted under `/api/trainer/*`.
- All WebSocket routes are mounted under `/ws/trainer/*`.
"""
