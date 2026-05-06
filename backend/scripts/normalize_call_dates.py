"""One-shot script to normalize CallDateTime column to DD-MM-YYYY.

Reads `GMB Calls Analyzer - Call details (sample).csv`, rewrites only the
CallDateTime column to DD-MM-YYYY (no timestamp), and writes back to the same
path. Every other column is passed through unchanged.

Source formats (auto-detected, all assumed month-first per data range
2026-03 to 2026-04):
    MM-DD-YYYY            e.g. "03-11-2026"      -> 11-03-2026
    M/D/YYYY              e.g. "3/21/2026"       -> 21-03-2026
    DD-MM-YYYY HH:MM      e.g. "22-04-2026 20:57"-> 22-04-2026
    YYYY-MM-DD HH:MM:SS   e.g. "2026-04-19 ..."  -> 19-04-2026

Run:
    python scripts/normalize_call_dates.py
"""

from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

CSV_PATH = Path(__file__).resolve().parent.parent / "GMB Calls Analyzer - Call details (sample).csv"
TMP_PATH = CSV_PATH.with_suffix(".csv.tmp")

# Allow CSV fields to be very large (transcripts can exceed default 128KB).
csv.field_size_limit(min(sys.maxsize, 2**31 - 1))

ISO_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2}) \d{2}:\d{2}:\d{2}$")
DAYFIRST_TIMED_RE = re.compile(r"^(\d{2})-(\d{2})-(\d{4}) \d{2}:\d{2}$")
MONTHFIRST_DASH_RE = re.compile(r"^(\d{2})-(\d{2})-(\d{4})$")
MONTHFIRST_SLASH_RE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})$")


def normalize(value: str) -> tuple[str, str]:
    """Return (normalized_value, format_tag) for a CallDateTime cell."""
    s = (value or "").strip()
    if not s:
        return s, "empty"

    m = ISO_RE.match(s)
    if m:
        y, mo, d = m.group(1), m.group(2), m.group(3)
        return f"{d}-{mo}-{y}", "iso"

    m = DAYFIRST_TIMED_RE.match(s)
    if m:
        d, mo, y = m.group(1), m.group(2), m.group(3)
        return f"{d}-{mo}-{y}", "dayfirst_timed"

    m = MONTHFIRST_DASH_RE.match(s)
    if m:
        mo, d, y = m.group(1), m.group(2), m.group(3)
        return f"{d}-{mo}-{y}", "monthfirst_dash"

    m = MONTHFIRST_SLASH_RE.match(s)
    if m:
        mo, d, y = m.group(1), m.group(2), m.group(3)
        return f"{int(d):02d}-{int(mo):02d}-{y}", "monthfirst_slash"

    return s, "unknown"


def main() -> int:
    if not CSV_PATH.exists():
        print(f"ERROR: source CSV not found at {CSV_PATH}", file=sys.stderr)
        return 1

    counts: dict[str, int] = {}
    rows_written = 0

    # Use latin-1 to preserve every byte, matching csv_parser.py.
    # newline='' lets csv handle row terminators; we pin lineterminator to
    # \r\n to match the existing file (CRLF row terminators).
    with open(CSV_PATH, mode="r", encoding="latin-1", newline="") as src, \
         open(TMP_PATH, mode="w", encoding="latin-1", newline="") as dst:
        reader = csv.reader(src)
        writer = csv.writer(dst, quoting=csv.QUOTE_MINIMAL, lineterminator="\r\n")

        try:
            header = next(reader)
        except StopIteration:
            print("ERROR: empty CSV", file=sys.stderr)
            return 1

        try:
            date_idx = header.index("CallDateTime")
        except ValueError:
            print("ERROR: 'CallDateTime' column not found in header", file=sys.stderr)
            return 1

        writer.writerow(header)
        rows_written += 1

        for row in reader:
            if date_idx < len(row):
                new_val, tag = normalize(row[date_idx])
                row[date_idx] = new_val
                counts[tag] = counts.get(tag, 0) + 1
            writer.writerow(row)
            rows_written += 1

    # Atomic-ish replace
    TMP_PATH.replace(CSV_PATH)

    print(f"Rows written (incl. header): {rows_written}")
    for tag, n in sorted(counts.items()):
        print(f"  {tag}: {n}")
    if "unknown" in counts:
        print("WARNING: some CallDateTime values did not match any known format", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
