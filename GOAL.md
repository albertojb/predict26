# WC26 Engine — Goal

## What this is

A live World Cup 2026 simulator and bracket predictor that updates in real-time as matches are played.

## The decision this drives

**"Who is most likely to win from here?"** — given real results logged so far, what are the championship odds for every remaining team, and who is the projected opponent in each knockout match?

Secondary decisions:
- **Bracket scouting** — who are we most likely to face in R16, QF, SF based on current standings?
- **Scenario testing** — what happens to odds if Team X wins/loses a key group match? (ELO overrides)
- **Match estimation** — given two teams, what is the expected scoreline and win probability?

## Scope

| In | Out |
|---|---|
| 48-team, 12-group, 104-match WC 2026 format | Historical tournament data |
| ELO-based probability model | Expected goals / shot models |
| Monte Carlo simulation (10K runs) | Machine learning / neural models |
| Live result logging (session) | Persistent database / user accounts |
| Streamlit web UI | Mobile app, API |

## Data sources

- **ELO ratings**: [eloratings.net](https://www.eloratings.net/) as of June 18, 2026
- **Schedule / groups / draw positions**: FIFA WCup_2026_4.2.9 Excel reference model
- **Third-place bracket**: 495-entry `assign_third.json` from the same reference

## Success criterion

A user can open the app, log yesterday's results, and immediately see updated championship odds and a projected bracket path — in under 10 seconds including simulation.
