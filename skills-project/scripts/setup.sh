#!/usr/bin/env bash
# Verifies dependencies required by skills-project scripts.
# Exit 0 = ready. Exit 1 = missing dependency (message printed to stderr).

set -euo pipefail

ok=true

check() {
  local name="$1" cmd="$2"
  if command -v "$cmd" >/dev/null 2>&1; then
    echo "  $name: $(command -v "$cmd")"
  else
    echo "  $name: NOT FOUND" >&2
    ok=false
  fi
}

echo "skills-project: checking dependencies..."
check "node" "node"
check "npx"  "npx"

# tsx may be global or via npx — either is fine
if command -v tsx >/dev/null 2>&1; then
  echo "  tsx: $(command -v tsx)"
elif npx tsx --version >/dev/null 2>&1; then
  echo "  tsx: npx tsx (on-demand)"
else
  echo "  tsx: NOT FOUND" >&2
  ok=false
fi

if [ "$ok" = false ]; then
  echo "" >&2
  echo "Install tsx: npm install -g tsx" >&2
  exit 1
fi

echo ""
echo "All dependencies ready."
