"""One-off: regenerate every cached SWOT and back-fill new high-traffic stores.

Originally triggered after the prompts.py "captured-lead" fix on 2026-05-02.
Re-used for the SWOT version-filter rollout: pass ``--version mattress_only``
(or set ``SWOT_REGEN_VERSION=mattress_only``) to populate the new
mattress-only cache rows for every existing scope.

Scope:
  * Cities: only those that already have a cached SWOT in any version
    (via list_cached without a version filter). Falls back to PILOT_CITIES
    if the cache is empty.
  * Stores: existing cached scopes UNION every store with >= 70
    PRE_PURCHASE leads in the analytics CSV.

Runs N generations in parallel via a thread pool. Each generation makes
3 Gemini Pro calls (Stage-1 map x N batches + 2 Stage-2 reduce calls)
and persists to swot_cache.csv via the existing orchestrator.
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND = REPO_ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from dotenv import load_dotenv
load_dotenv(BACKEND / ".env")

from csv_parser import CallDataStore  # noqa: E402
from trainer.bootstrap import on_startup as trainer_on_startup  # noqa: E402
from trainer.swot.cache import list_cached  # noqa: E402
from trainer.swot.orchestrator import generate_swot, SWOTGenerationError  # noqa: E402

# Bootstrap the trainer subsystem so latest_calls_for_store/city can resolve
# the in-memory call corpus. Mirrors backend/main.py's startup wiring.
trainer_on_startup(call_data_store=CallDataStore())

PRE_PURCHASE_TYPES = {
    "PRE_PURCHASE (Pre Store Visit)",
    "PRE_PURCHASE (Post Store Visit)",
}
LEAD_THRESHOLD = 70  # >= 70 PRE_PURCHASE calls
PILOT_CITIES = ["Bengaluru", "Hyderabad", "Chennai", "Mumbai", "Delhi NCR"]
ANALYTICS_CSV = BACKEND / "GMB Calls Analyzer - Call details (sample).csv"
PARALLELISM = 3
ACTOR_EMAIL = "bulk-regen"


def qualifying_stores() -> list[tuple[str, int]]:
    counts: Counter[str] = Counter()
    with open(ANALYTICS_CSV, encoding="cp1252", errors="replace", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            ctype = row.get("Call Type") or row.get("call_type")
            if ctype in PRE_PURCHASE_TYPES:
                store = (row.get("Store Name") or row.get("store_name") or "").strip()
                if store:
                    counts[store] += 1
    return sorted(
        [(s, c) for s, c in counts.items() if c >= LEAD_THRESHOLD],
        key=lambda t: -t[1],
    )


def existing_cached_scopes() -> tuple[set[str], set[str]]:
    """Return (cities, stores) that already have at least one cached SWOT
    in any version. Used to scope the regen to "everything that currently
    has a report" without rediscovering."""
    cities: set[str] = set()
    stores: set[str] = set()
    for row in list_cached():  # all scopes, all versions
        if row["scope"] == "city":
            cities.add(row["name"])
        elif row["scope"] == "store":
            stores.add(row["name"])
    return cities, stores


def resolve_targets(only_existing: bool) -> list[tuple[str, str]]:
    cached_cities, cached_stores = existing_cached_scopes()
    if only_existing:
        cities = sorted(cached_cities) or list(PILOT_CITIES)
        stores = sorted(cached_stores)
        return [("city", c) for c in cities] + [("store", s) for s in stores]
    # Legacy: pilot cities + every high-traffic store + any extra cached scope.
    qstores = [s for s, _ in qualifying_stores()]
    stores = sorted(set(qstores) | cached_stores)
    cities = sorted(set(PILOT_CITIES) | cached_cities)
    return [("city", c) for c in cities] + [("store", s) for s in stores]


def run_one(scope: str, name: str, version: str) -> dict:
    t0 = time.time()
    try:
        report = generate_swot(name, scope=scope, version=version, actor_email=ACTOR_EMAIL)
        return {
            "scope": scope,
            "name": name,
            "version": version,
            "ok": True,
            "elapsed": time.time() - t0,
            "cost_inr": report.cost_inr,
            "calls": report.input_call_count,
            "n_str": len(report.strengths),
            "n_wk": len(report.weaknesses),
            "n_op": len(report.opportunities),
            "n_th": len(report.threats),
        }
    except SWOTGenerationError as exc:
        return {"scope": scope, "name": name, "version": version, "ok": False,
                "elapsed": time.time() - t0,
                "error": f"{exc.stage}: {exc.reason}"}
    except Exception as exc:  # noqa: BLE001
        return {"scope": scope, "name": name, "version": version, "ok": False,
                "elapsed": time.time() - t0,
                "error": f"{type(exc).__name__}: {exc}"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--version", "-v",
        choices=["all_calls", "mattress_only"],
        default=os.getenv("SWOT_REGEN_VERSION", "mattress_only"),
        help="SWOT version to (re)generate (default: mattress_only)",
    )
    parser.add_argument(
        "--only-existing",
        action="store_true",
        default=True,
        help="Restrict to scopes that already have a cached SWOT (default)",
    )
    parser.add_argument(
        "--include-new-stores",
        dest="only_existing",
        action="store_false",
        help="Also include any store with >= 70 PRE_PURCHASE leads (legacy behaviour)",
    )
    parser.add_argument("--parallelism", "-p", type=int, default=PARALLELISM)
    args = parser.parse_args()

    if not os.getenv("GEMINI_API_KEY"):
        print("ERROR: GEMINI_API_KEY not set in backend/.env", file=sys.stderr)
        return 2

    targets = resolve_targets(only_existing=args.only_existing)
    cities = [t for t in targets if t[0] == "city"]
    stores = [t for t in targets if t[0] == "store"]
    print(f"=== SWOT bulk regenerate (version={args.version}) ===")
    if args.only_existing:
        print(f"Mode: only-existing (every scope with a cached SWOT)")
    else:
        print(f"Mode: legacy (pilot cities + stores >={LEAD_THRESHOLD} leads)")
    print(f"Cities: {len(cities)}  Stores: {len(stores)}")
    print(f"Total reports: {len(targets)}  Parallelism: {args.parallelism}")
    print()

    results: list[dict] = []
    started_at = time.time()

    with ThreadPoolExecutor(max_workers=args.parallelism) as ex:
        futures = {
            ex.submit(run_one, scope, name, args.version): (scope, name)
            for scope, name in targets
        }
        completed = 0
        for fut in as_completed(futures):
            r = fut.result()
            completed += 1
            tag = "OK  " if r["ok"] else "FAIL"
            extra = (
                f"calls={r['calls']:3d} cost=Rs.{r['cost_inr']:.2f} "
                f"S/W/O/T={r['n_str']}/{r['n_wk']}/{r['n_op']}/{r['n_th']}"
                if r["ok"] else r.get("error", "")
            )
            print(f"[{completed:2d}/{len(targets)}] {tag} {r['scope']:5s} {r['name']:30s} ({r['elapsed']:5.1f}s)  {extra}")
            results.append(r)

    elapsed = time.time() - started_at
    ok = [r for r in results if r["ok"]]
    fail = [r for r in results if not r["ok"]]
    total_cost = sum(r["cost_inr"] for r in ok)
    print()
    print(f"=== DONE in {elapsed:.0f}s ({elapsed/60:.1f} min) ===")
    print(f"Succeeded: {len(ok)}  Failed: {len(fail)}  Total cost: Rs.{total_cost:.2f}")
    if fail:
        print("\nFailures:")
        for r in fail:
            print(f"  {r['scope']:5s} {r['name']:30s}  {r.get('error','')}")
    return 0 if not fail else 1


if __name__ == "__main__":
    sys.exit(main())
