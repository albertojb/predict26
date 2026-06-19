# Predict26

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-7A1E1E.svg)](LICENSE)
[![Live](https://img.shields.io/badge/Live-sail.zo.space%2Fpredict26-1A1410)](https://sail.zo.space/predict26)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/kekojb)

World Cup 2026 match estimator and tournament simulator using ELO ratings.

**Live:** https://sail.zo.space/predict26
**Repo layout + deploy workflow:** see [AGENTS.md](AGENTS.md).

## Features

- **Single-match estimation** — W/D/L probabilities + expected goals (Poisson) for any two teams
- **Manual ELO overrides** — scenario testing with custom ratings
- **Group-stage simulation** — full standings with FIFA 2026 tie-break rules (9 criteria)
- **Third-place ranking** — coefficient formula from the FIFA reference, best 8 of 12 advance
- **Knockout bracket** — projected bracket with real team names: confirmed results shown in bold, ELO-predicted slots in italics; exact slot mapping from the official AssignThird table (495 entries)
- **Full tournament Monte Carlo** — 10,000 simulations by default, adjustable
- **Streamlit UI** — browser-accessible, upload your own CSV/JSON, charts and tables
- **Locked real results** — matches 1–20 use real scores; remaining matches are simulated

## Tournament format

| Stage | Matches |
|---|---|
| Group stage (12 groups × 4 teams, 3 rounds) | 72 |
| Round of 32 (top 2 per group + best 8 thirds) | 16 |
| Round of 16 | 8 |
| Quarter-finals | 4 |
| Semi-finals | 2 |
| Third place + Final | 2 |
| **Total** | **104** |

## Model

- **ELO → win probability**: `P = 1 / (1 + 10^(-ΔR/400))`
- **Draw model**: peaks at ~30% for even match, derived from ELO difference
- **Goals**: Poisson with `λ = 1.2 × exp(ΔR/1000)` per team
- **Home advantage**: +100 ELO for USA, Canada, Mexico in group stage
- **Penalties**: 50/50 coin-flip

## Setup

```bash
pip install -r requirements.txt
```

## Run

```bash
streamlit run app.py
```

## Run tests

```bash
python -m pytest tests/ -v
```

## Project structure

```
WC26-engine/
  data/
    teams.csv           # 48 teams, ELO, group, host flag
    schedule.json       # 104 matches with dates, venues, scores (played=true for known results)
    assign_third.json   # 495-entry bracket mapping table from FIFA reference
  src/
    data_loader.py      # load/validate teams and schedule
    elo.py              # ELO probability + Poisson simulation engine
    rules.py            # standings, tie-breaks, third-place ranking, bracket resolution
    simulator.py        # Monte Carlo tournament simulator
  tests/
    test_elo.py
    test_rules.py
    test_simulator.py
  app.py                # Streamlit UI
  requirements.txt
  README.md
```

## Data source

ELO ratings from [World Football Elo Ratings](https://www.eloratings.net/) as of **June 18, 2026**.
Group assignments and bracket mapping from the WCup_2026_4.2.9 Excel reference model.

## Architecture note

The project is split into four pure modules:
1. **data_loader** — I/O only, no business logic
2. **elo** — probability math and match simulation, no tournament state
3. **rules** — FIFA rules and bracket logic, no simulation state
4. **simulator** — orchestrates the above to run a full tournament

`app.py` only calls these modules — it contains no logic of its own.

## License

[GNU General Public License v3.0](LICENSE) — see the `LICENSE` file for the full text. Copyright © 2026 Alberto Jiménez Bákit.

## Support

If you find this useful, you can buy me a coffee at [ko-fi.com/kekojb](https://ko-fi.com/kekojb).
