#!/usr/bin/env python3
"""
ROLE: CUSTOMIZE — implement fetch_metric_summary() below before running.

Input collector — query your data source and produce input.json for analyze-bayesian.py.

Usage:
    python .featbit-release-decision/scripts/collect-input.py <experiment-slug>

Reads:
    .featbit-release-decision/experiments/<slug>/definition.md

Writes:
    .featbit-release-decision/experiments/<slug>/input.json

---
CUSTOMIZATION

Implement the one function below:

    fetch_metric_summary(flag_key, variant, metric, start, end) -> (n, k)

See references/data-source-guide.md for copy-paste patterns:
  §FeatBit  — call the experiment results API
  §Database — run a SQL aggregation query
  §Custom   — call your own metrics service
---
"""

import json
import re
import sys
from pathlib import Path


# ── THE ONE FUNCTION YOU IMPLEMENT ────────────────────────────────────────────

def fetch_metric_summary(
    flag_key: str,
    variant: str,
    metric: str,
    start: str,
    end: str,
) -> tuple[int, int]:
    """
    Return (n_exposed, n_converted) for one variant × metric combination.

    Arguments:
        flag_key  — the FeatBit feature flag key (from definition.md)
        variant   — variant value, e.g. "false" / "true" / "control" / "v2"
        metric    — event name, e.g. "click_start_chat"
        start     — observation window start, ISO 8601 date string
        end       — observation window end, ISO 8601 date string (or "open")

    Returns:
        (n, k) where n = number of unique users exposed to this variant
                      k = number of those users who fired the metric event

    See references/data-source-guide.md for ready-to-use implementations.
    """
    raise NotImplementedError(
        "Implement fetch_metric_summary() for your data source.\n"
        "See .featbit-release-decision/references/data-source-guide.md:\n"
        "  §FeatBit  — FeatBit experiment results API\n"
        "  §Database — SQL aggregation query\n"
        "  §Custom   — your own metrics service\n"
    )


# ── Definition parser (mirrors analyze-bayesian.py) ────────────────────────────────────

def parse_definition(path: Path) -> dict:
    text = path.read_text()
    kv = {}
    for line in text.splitlines():
        if line and not line.startswith(" ") and not line.startswith("#") and ":" in line:
            key, _, value = line.partition(":")
            kv[key.strip()] = value.strip()

    ctrl_m  = re.search(r"control:\s*(\S+)", text)
    trt_m   = re.search(r"treatment:\s*(\S+)", text)
    start_m = re.search(r"start:\s*(\S+)", text)
    end_m   = re.search(r"end:\s*(\S+)", text)

    guardrail_events: list[str] = []
    in_guardrail = False
    for line in text.splitlines():
        if "guardrail_events:" in line:
            in_guardrail = True
            continue
        if in_guardrail:
            s = line.strip()
            if s.startswith("- "):
                guardrail_events.append(s[2:].strip())
            elif s and not s.startswith("#"):
                in_guardrail = False

    return {
        "flag_key":          kv.get("flag_key", ""),
        "primary_metric":    kv.get("primary_metric_event", ""),
        "guardrail_events":  guardrail_events,
        "control_variant":   ctrl_m.group(1)  if ctrl_m  else "control",
        "treatment_variant": trt_m.group(1)   if trt_m   else "treatment",
        "start":             start_m.group(1) if start_m else "",
        "end":               end_m.group(1)   if end_m   else "open",
    }


# ── Main ──────────────────────────────────────────────────────────────────────

def main(slug: str) -> None:
    base      = Path(".featbit-release-decision") / "experiments" / slug
    defn_path = base / "definition.md"

    if not defn_path.exists():
        print(f"ERROR: {defn_path} not found.")
        sys.exit(1)

    d           = parse_definition(defn_path)
    flag_key    = d["flag_key"]
    control     = d["control_variant"]
    treatment   = d["treatment_variant"]
    start       = d["start"]
    end         = d["end"]
    all_metrics = [m for m in [d["primary_metric"]] + d["guardrail_events"] if m]

    if not flag_key:
        print("ERROR: flag_key not found in definition.md")
        sys.exit(1)
    if not all_metrics:
        print("ERROR: no metrics found in definition.md")
        sys.exit(1)

    print(f"Collecting input for: {slug}")
    print(f"  flag_key:  {flag_key}")
    print(f"  control:   {control}   treatment: {treatment}")
    print(f"  window:    {start} → {end}")
    print(f"  metrics:   {', '.join(all_metrics)}")
    print()

    result: dict = {}
    for metric in all_metrics:
        result[metric] = {}
        for variant in (control, treatment):
            print(f"  fetching {metric!r} / {variant!r} ...", end=" ", flush=True)
            n, k = fetch_metric_summary(flag_key, variant, metric, start, end)
            result[metric][variant] = {"n": n, "k": k}
            print(f"n={n}  k={k}")

    out_path = base / "input.json"
    out_path.write_text(json.dumps({"metrics": result}, indent=2) + "\n")
    print(f"\nWritten: {out_path}")
    print("Run analysis: python .featbit-release-decision/scripts/analyze-bayesian.py", slug)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python collect-input.py <experiment-slug>")
        sys.exit(1)
    main(sys.argv[1])
