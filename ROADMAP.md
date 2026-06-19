# WC26 Engine — Roadmap

## Current status (as of June 19, 2026)

**Tournament**: Group stage in progress. Round 1 (matchdays 1–2) complete for 10 of 12 groups.

| Metric | Value |
|---|---|
| Group matches played | 20 / 72 |
| KO matches played | 0 / 32 |
| Groups with ≥1 result | A B C D E F G H I J |
| Groups fully unplayed | K, L |
| Tests | 36 / 36 passing |
| App | Running (`streamlit run app.py`) |

---

## Done ✅

### Bucket 1 — Data layer (`src/data_loader.py`)
- 48 teams loaded from `teams.csv` (slot, name, group, ELO, is_host)
- 104-match schedule from `schedule.json` (played + unplayed, scores where known)
- 495-entry third-place bracket table from `assign_third.json`
- Validation: asserts 48 teams, 104 matches, all group-stage slots resolve

### Bucket 2 — ELO engine (`src/elo.py`)
- Win probability: `P = 1/(1 + 10^(-ΔR/400))`
- Draw model: peaks ~30% for even teams, tapers with ELO gap
- Poisson goal model: `λ = 1.2 × exp(ΔR/1000)` per team
- Penalties: 50/50 coin-flip (no ET model)
- Host bonus: +100 ELO for USA / Canada / Mexico in group stage only
- KO advancement probability (analytical)

### Bucket 3 — Tournament rules (`src/rules.py`)
- Group standings with full FIFA 2026 9-criterion tiebreak (Pts → GD → GF → H2H Pts → H2H GD → H2H GF → Wins → ELO → Name)
- Third-place ranking by FIFA coefficient formula (Pts×1M + GD×1K + GF)
- Best-8-of-12 third-place advancement
- Third-place bracket assignment via lookup table (assigning specific slots to groups)
- Slot resolver: handles draw positions, group positions, third-place slots, W/RU references

### Bucket 4 — Monte Carlo simulator (`src/simulator.py`)
- `simulate_tournament()`: one full tournament, locks played/logged matches, simulates rest
- `run_monte_carlo()`: N simulations → `{team: {stage: count}}`
- Stage tracking: group / r32 / r16 / qf / sf / final / champion
- ELO overrides per team
- KO result overrides (lock known knockout results)

### Bucket 5 — Streamlit UI (`app.py`)
- **🏆 Tournament Results**: bar chart + stage-probability table for all 48 teams
- **🏟️ Bracket**: visual match cards in bracket order, greedy ELO estimator fills every slot with a real team name, advancement % and champion % per match
- **📋 Group Standings**: live standings for any group (real + logged results)
- **⚔️ Match Estimator**: W/D/L %, xG, KO advancement probability for any matchup
- **📝 Log Results**: group stage score editor (spreadsheet), KO winner selector; changes immediately update simulation

### Infrastructure
- `@st.cache_data` on data load and MC simulation (keyed on all override state)
- Bracket round order computed by DFS post-order traversal (adjacent cards share a bracket path)
- Session-state result logging (score overrides + KO winners)

### Bucket 6 — Bracket projection (web UI, `page-predict26.tsx`)
- `projectBracket()`: greedy deterministic pass over real results + ELO for unplayed matches
- Group stage: real scores used where available; unplayed matches projected as draw (≤50 ELO gap) or 1-0 to higher ELO
- Third-place: projects best 8 qualifiers and resolves slots via `assignThird` table
- KO bracket: higher ELO always advances (no draws in KO)
- Visual distinction: confirmed teams (bold, full colour) vs. projected teams (italic, muted)
- MC overlay: if simulation has been run, championship % shown next to each projected name

---

## In progress 🔄

| Task | Notes |
|---|---|
| Log real results daily | Manual: open Log Results tab, enter scores as matches finish |
| ELO rating updates | ELO frozen at June 18 — consider refreshing after group stage completes |
| schedule.json updates | Add real scores as `"played": true` entries so they survive page reloads |

---

## Up next 📋

### High priority
- [ ] **Persist logged results** — currently session-only; reloading the page loses all logged scores. Options: URL params, local JSON file, or small SQLite DB.
- [ ] **Schedule.json updates** — add real scores directly to `schedule.json` as `"played": true` so they survive page reloads. Simple file edit or a CLI helper.

### Medium priority
- [ ] **ELO update after group stage** — pull fresh ratings from eloratings.net once all 72 group matches are done
- [ ] **"What-if" group finish** — for any partially-played group, let user simulate "what if team X wins/draws/loses remaining matches" and see how standings change
- [ ] **Match-by-match probability timeline** — show how champion odds evolved as results were logged (requires storing historical snapshots)

### Low priority / nice-to-have
- [ ] Export logged results to JSON/CSV for sharing
- [ ] Share-a-bracket link (serialize session state to URL)
- [ ] Add actual match scores to KO result logging (currently just winner/loser)
- [ ] Third/fourth place distinguisher in stage tracking (currently both show "sf")

---

## Known ceilings (deliberate simplifications)

| Simplification | Ceiling | Upgrade when |
|---|---|---|
| Penalties = 50/50 coin flip | Real penalty odds vary (~56-60% for kicker) | Penalty shootout data available |
| ELO frozen at June 18 | Doesn't account for momentum, injuries, form | Refresh ELO from eloratings.net weekly |
| Greedy bracket projection (client-side) | Shows one deterministic path; not a probability distribution per slot | Add `slot_counts` to MC output to show "60% France, 30% Germany…" per slot |
| Session-only result logging | Lost on page reload | Add persistence (file or DB) |
| Home advantage = flat +100 ELO | Reality is venue/crowd-specific | Game-by-game home advantage data |
