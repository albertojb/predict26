# Predict26 — agent notes

World Cup 2026 ELO + Monte Carlo simulator. Two front-ends share one source of truth:

- **Streamlit** (`app.py`) — local dev UI, calls the Python engine in `src/`.
- **zo.space** (`/predict26`) — public web UI at https://sail.zo.space/predict26 ; the engine is mirrored in TypeScript under `web/routes/`.

The data files in `data/` are the canonical source. Both engines read them at runtime, so any edit to `data/teams.csv`, `data/schedule.json`, or `data/assign_third.json` propagates to both UIs without a redeploy.

## Layout

```
predict26/
  data/                       canonical CSV/JSON — used by Python AND zo.space
  src/                        Python engine: elo, rules, simulator, data_loader
  tests/                      Python pytest suite
  app.py                      Streamlit UI (legacy / local)
  web/
    engine.ts                 TypeScript port of the engine (source of truth)
    routes/
      api-data.ts             →  GET  /api/predict26/data
      api-match-probs.ts      →  POST /api/predict26/match-probs
      api-simulate.ts         →  POST /api/predict26/simulate
      page-predict26.tsx      →  GET  /predict26  (React page)
  docs/DECISIONS.md           design rationale
  GOAL.md, ROADMAP.md         product context
```

## Deployment model

zo.space routes are NOT files on disk — they live in the platform. `web/routes/*` is the source-of-truth that Claude pushes via `write_space_route` / `edit_space_route`. Whenever you edit a route file, re-deploy by calling the matching tool with the new content. Paths:

| File                            | Space path                       | Type |
| ------------------------------- | -------------------------------- | ---- |
| `web/routes/api-data.ts`        | `/api/predict26/data`            | api  |
| `web/routes/api-match-probs.ts` | `/api/predict26/match-probs`     | api  |
| `web/routes/api-simulate.ts`    | `/api/predict26/simulate`        | api  |
| `web/routes/page-predict26.tsx` | `/predict26`                     | page |

The simulate route inlines the engine (duplicated from `web/engine.ts`) because zo.space routes can't import sibling files. When the engine changes, update both `web/engine.ts` AND `web/routes/api-simulate.ts`. Run the parity check before pushing (see "Verify" below).

## GitHub sync workflow

The repo is `albertojb/predict26`. After any change here, commit + push:

```
cd /home/workspace/predict26
git add -A
git commit -m "..."
git push
```

Future Claude sessions should:
1. `git pull` first
2. Read this AGENTS.md + GOAL.md before making changes
3. Push back when done

## Verify

Quick parity check between TypeScript port and Python reference:

```bash
# Python reference values
cd /home/workspace/predict26
python -c "from src.elo import match_probs, expected_goals; print(match_probs(2129, 1447), expected_goals(2129, 1447))"

# Engine via the live API
curl -s -X POST http://localhost:3099/api/predict26/match-probs \
  -H "Content-Type: application/json" -d '{"elo1":2129,"elo2":1447}'
```

Sanity-check a deployed simulation:
```bash
curl -s -X POST http://localhost:3099/api/predict26/simulate \
  -H "Content-Type: application/json" -d '{"n":1000,"seed":42}' \
  | python -c "import json,sys; d=json.load(sys.stdin); print(d['n'], d['elapsedMs'])"
```

Run the Python test suite:
```bash
python -m pytest tests/ -v
```

## Engine notes

- ELO → win probability uses `P = 1 / (1 + 10^(-ΔR/400))`
- Goals modeled as Poisson with `λ = 1.2 × exp(ΔR/1000)`
- Host bonus: +100 ELO for USA / Canada / Mexico in group stage only
- Penalties: 50/50 coin flip
- Third-place ranking uses `Pts × 1,000,000 + GD × 1,000 + GF`
- Bracket mapping for the 8 best thirds comes from `data/assign_third.json` (495 entries, FIFA reference)

The TypeScript port uses **mulberry32** as a deterministic PRNG and Knuth's algorithm for Poisson sampling (λ stays small enough in this domain). Output matches Python's NumPy reference to 6 decimal places on `match_probs`, `expected_goals`, and `ko_advancement_prob`.

## Things NOT yet ported to /predict26 (vs. Streamlit)

- "Log Results" tab (session-local score + KO overrides). The API already accepts `scoreOverrides` and `koOverrides` — only the UI is missing.
- Bracket card "advancement probability" inline number (the Python version shows a per-card Adv% next to each team).
- ELO-overrides persistence across page reloads.

Add these by editing `web/routes/page-predict26.tsx` and redeploying.
