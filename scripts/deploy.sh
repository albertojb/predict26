#!/usr/bin/env bash
# Manual smoke-test the deployed routes against the live zo.space server.
# Actual code deploys happen via Claude's zo `write_space_route` /
# `edit_space_route` tools — there's no public CLI for that yet.

set -euo pipefail

BASE="${1:-http://localhost:3099}"
echo "Pinging $BASE/api/predict26/data"
curl -sf "$BASE/api/predict26/data" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'  teams={len(d[\"teams\"])} matches={len(d[\"matches\"])} assignThird={len(d[\"assignThird\"])}')"

echo "Pinging $BASE/api/predict26/match-probs"
curl -sf -X POST "$BASE/api/predict26/match-probs" \
  -H "Content-Type: application/json" \
  -d '{"elo1":2129,"elo2":1447}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'  pWin={d[\"pWin\"]:.4f} pDraw={d[\"pDraw\"]:.4f} pLoss={d[\"pLoss\"]:.4f}')"

echo "Pinging $BASE/api/predict26/simulate (n=500)"
curl -sf -X POST "$BASE/api/predict26/simulate" \
  -H "Content-Type: application/json" \
  -d '{"n":500,"seed":42}' \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
top=sorted(d['counts'].items(), key=lambda x: x[1]['champion'], reverse=True)[:3]
print(f'  n={d[\"n\"]} elapsed={d[\"elapsedMs\"]}ms')
for n,c in top: print(f'    {n}: {c[\"champion\"]/d[\"n\"]:.1%}')
"

echo "OK"
