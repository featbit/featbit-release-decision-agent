# Analysis Script

A single Python script that reads `input.json` from an experiment folder and writes `analysis.md`.

No dashboard required. No online account. Runs locally.

---

## Requirements

```
python >= 3.9
numpy
```

Install once:

```bash
pip install numpy
```

---

## Script

The full script lives at [scripts/analyze-bayesian.py](../scripts/analyze-bayesian.py).

On first project setup, the agent copies it to `.featbit-release-decision/scripts/analyze-bayesian.py`. Run once per experiment:

```bash
python .featbit-release-decision/scripts/analyze-bayesian.py chat-cta-v2
```

```python
#!/usr/bin/env python3
"""
Bayesian A/B experiment analysis script.
Usage: python analyze-bayesian.py <experiment-slug>

Reads:
  .featbit-release-decision/experiments/<slug>/definition.md
  .featbit-release-decision/experiments/<slug>/input.json

Writes:
  .featbit-release-decision/experiments/<slug>/analysis.md
"""

import json
import sys
import re
from datetime import datetime, timezone
from pathlib import Path
import numpy as np


# ── helpers ──────────────────────────────────────────────────────────────────

def load_definition(path: Path) -> tuple[dict, str]:
    """Return (key→value dict, raw text) for definition.md."""
    text = path.read_text()
    result = {}
    for line in text.splitlines():
        if line and not line.startswith(" ") and not line.startswith("#") and ":" in line:
            key, _, value = line.partition(":")
            result[key.strip()] = value.strip()
    return result, text


def p_treatment_better(ctrl_k, ctrl_n, trt_k, trt_n,
                        n_samples: int = 100_000) -> float:
    """P(treatment CR > control CR) via Beta-Binomial Monte Carlo."""
    rng  = np.random.default_rng(seed=42)
    ctrl = rng.beta(ctrl_k + 1, ctrl_n - ctrl_k + 1, n_samples)
    trt  = rng.beta(trt_k  + 1, trt_n  - trt_k  + 1, n_samples)
    return float(np.mean(trt > ctrl))


def format_metric_table(label, metric_data, control, treatment):
    ctrl      = metric_data[control]
    trt       = metric_data[treatment]
    ctrl_rate = ctrl["k"] / ctrl["n"] if ctrl["n"] > 0 else 0.0
    trt_rate  = trt["k"]  / trt["n"]  if trt["n"]  > 0 else 0.0
    rel        = (trt_rate - ctrl_rate) / ctrl_rate * 100 if ctrl_rate > 0 else float("nan")
    confidence = p_treatment_better(ctrl["k"], ctrl["n"], trt["k"], trt["n"])
    header = (
        "| variant | exposed | converted | rate | relative_change | p(treatment > control) |\n"
        "|---------|---------|-----------|------|-----------------|------------------------|"
    )
    ctrl_row = f"| {control} | {ctrl['n']} | {ctrl['k']} | {ctrl_rate:.2%} | — | — |"
    trt_row  = (
        f"| {treatment} | {trt['n']} | {trt['k']} "
        f"| {trt_rate:.2%} | {rel:+.1f}% | {confidence:.1%} |"
    )
    return f"## {label}\n\n{header}\n{ctrl_row}\n{trt_row}\n"


# ── main ─────────────────────────────────────────────────────────────────────

def main(slug: str) -> None:
    base = Path(".featbit-release-decision") / "experiments" / slug
    defn, text = load_definition(base / "definition.md")

    input_path = base / "input.json"
    if not input_path.exists():
        print(f"ERROR: {input_path} not found.")
        print("Collect input data first:")
        print(f"  python .featbit-release-decision/scripts/collect-input.py {slug}")
        sys.exit(1)

    data = json.loads(input_path.read_text())

    ctrl_m    = re.search(r"control:\s*(\S+)", text)
    trt_m     = re.search(r"treatment:\s*(\S+)", text)
    control   = ctrl_m.group(1) if ctrl_m else "control"
    treatment = trt_m.group(1)  if trt_m  else "treatment"

    primary_event    = defn.get("primary_metric_event", "")
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

    min_sample   = int(defn.get("minimum_sample_per_variant", 0) or 0)
    primary_data = data["metrics"].get(primary_event, {})
    ctrl_n       = primary_data.get(control,   {}).get("n", 0)
    trt_n        = primary_data.get(treatment, {}).get("n", 0)
    sample_ok    = min(ctrl_n, trt_n) >= min_sample

    now       = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    end_raw   = re.search(r"end:\s*(\S+)", text)
    start_raw = re.search(r"start:\s*(\S+)", text)
    end_label   = end_raw.group(1)   if end_raw   else "open"
    start_label = start_raw.group(1) if start_raw else "?"

    lines = [
        f"experiment:   {slug}",
        f"computed_at:  {now}",
        f"window:       {start_label} → {end_label}",
        "",
    ]

    if primary_event in data["metrics"]:
        lines.append(format_metric_table(
            f"Primary Metric: {primary_event}",
            data["metrics"][primary_event], control, treatment,
        ))

    for g in guardrail_events:
        if g in data["metrics"]:
            lines.append(format_metric_table(
                f"Guardrail: {g}",
                data["metrics"][g], control, treatment,
            ))

    sample_mark = (
        "✓" if sample_ok
        else f"✗ (got {min(ctrl_n, trt_n)}, need {min_sample})"
    )
    lines += [
        "## Sample check",
        f"minimum required per variant: {min_sample} {sample_mark}",
        f"control exposed:   {ctrl_n}",
        f"treatment exposed: {trt_n}",
    ]

    out_path = base / "analysis.md"
    out_path.write_text("\n".join(lines) + "\n")
    print(f"Written: {out_path}")
    if not sample_ok:
        print("WARNING: sample size below minimum — treat results as indicative only.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python analyze-bayesian.py <experiment-slug>")
        sys.exit(1)
    main(sys.argv[1])
```

---

## What the Script Does

1. Reads `definition.md` to know which flag variants and events to look for
2. Loads `input.json` — aggregated `(n, k)` counts per variant per metric
3. For each metric: reads `n` and `k` per variant, computes rates
4. Runs Bayesian probability (Beta-Binomial conjugate, uniform prior) to get `p(treatment > control)`
5. Checks sample size against `minimum_sample_per_variant`
6. Writes `analysis.md`

---

## Interpreting the Confidence Column

`p(treatment > control)` is a Bayesian probability, not a classical p-value.

| Value | Meaning |
|-------|---------|
| > 95% | Strong signal — treatment is likely better |
| 80–95% | Moderate signal — consider extending the window |
| 40–80% | Weak or no signal |
| < 40% | Treatment is likely worse than control |

These thresholds are starting points. Business context and guardrail health matter. Pass `analysis.md` to `evidence-analysis` for the final decision framing.

---

## Re-running After New Data

Both scripts are idempotent — re-run whenever you want fresh numbers.

```bash
# After pulling fresh counts:
python .featbit-release-decision/scripts/collect-input.py chat-cta-v2
python .featbit-release-decision/scripts/analyze-bayesian.py chat-cta-v2
```

`input.json` and `analysis.md` will both be overwritten with fresh numbers.
