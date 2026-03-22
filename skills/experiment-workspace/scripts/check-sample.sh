#!/usr/bin/env bash
# ROLE: READY-TO-RUN — copy to project and run as-is. Do not modify.
#
# check-sample.sh — show sample counts per variant from input.json.
#
# Usage:
#   bash .featbit-release-decision/scripts/check-sample.sh <experiment-slug>
#
# Reads:
#   .featbit-release-decision/experiments/<slug>/input.json
#   .featbit-release-decision/experiments/<slug>/definition.md  (for minimum_sample_per_variant)
#
# Example output:
#   === Sample check for: chat-cta-v2 ===
#
#     false   (control)    412 exposed
#     true    (treatment)  438 exposed
#
#   Minimum required per variant: 200 ✓

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <experiment-slug>"
  exit 1
fi

SLUG="$1"
BASE=".featbit-release-decision/experiments/$SLUG"
INPUT_JSON="$BASE/input.json"
DEFINITION="$BASE/definition.md"

if [ ! -f "$INPUT_JSON" ]; then
  echo "ERROR: $INPUT_JSON not found."
  echo "Collect input first — run: python .featbit-release-decision/scripts/collect-input.py $SLUG"
  exit 1
fi

MIN=""
if [ -f "$DEFINITION" ]; then
  MIN=$(grep "minimum_sample_per_variant" "$DEFINITION" | awk -F': ' '{print $2}' | tr -d ' ')
fi

python3 - "$INPUT_JSON" "$MIN" <<'PYEOF'
import json, sys

input_path = sys.argv[1]
min_req    = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2] else 0

data = json.loads(open(input_path).read())
metrics = data.get("metrics", {})
if not metrics:
    print("ERROR: no metrics in input.json")
    sys.exit(1)

# Use first metric for the sample check (primary metric)
first_metric = next(iter(metrics))
variants = metrics[first_metric]

slug = input_path.split("/")[-2]
print(f"=== Sample check for: {slug} ===")
print()

counts = {}
for variant, vals in variants.items():
    n = vals.get("n", 0)
    counts[variant] = n
    print(f"  {variant:<20} {n} exposed")

print()
smallest = min(counts.values()) if counts else 0
if min_req:
    mark = "✓" if smallest >= min_req else f"✗ (smallest variant has {smallest} — not ready yet)"
    print(f"Minimum required per variant: {min_req} {mark}")
PYEOF
