"""Turn the raw Supabase rows into data/workout-logs.json.

Re-saving a workout adds a new row, so keep only the newest row for each date and day.
Usage: python3 scripts/export_logs.py <rows.json> <out.json>
"""
import json
import sys
from datetime import datetime, timezone

rows_path, out_path = sys.argv[1], sys.argv[2]
with open(rows_path, encoding="utf-8") as f:
    rows = json.load(f)

latest = {}
for row in sorted(rows, key=lambda r: r.get("created_at", "")):
    latest[(row["date"], row["day"])] = row  # later rows replace earlier ones

sessions = [
    {
        "date": r["date"],
        "day": r["day"],
        "saved_at": r.get("created_at"),
        "entries": r.get("entries") or [],
        "warmup": r.get("warmup") or [],
        "cooldown": r.get("cooldown") or [],
    }
    for r in sorted(latest.values(), key=lambda r: (r["date"], r["day"]))
]

out = {
    "exported_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "sessions": sessions,
}
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(out, f, indent=1)
    f.write("\n")
print(f"{len(rows)} rows -> {len(sessions)} sessions")
