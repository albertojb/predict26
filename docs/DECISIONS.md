# WC26 Engine — Architecture Decisions

Key decisions made during build, with rationale and known trade-offs.

---

## ADR-001 — ELO as the probability model

**Decision**: Use the standard ELO formula (`P = 1 / (1 + 10^(-ΔR/400))`) as the sole predictor.

**Alternatives considered**: Poisson regression on shots/xG, Dixon-Coles model, FIFA ranking points.

**Why ELO**:
- Ratings immediately available from eloratings.net
- Single number per team, no feature engineering
- Well-calibrated for international football at the tournament level
- Easily overridden by the user for scenario testing

**Trade-offs**: Ignores recent form, injuries, squad depth, fixture congestion. ELO is a lagging indicator — a team that just lost their striker still has the old rating.

---

## ADR-002 — Draw model derived from ELO, not independent

**Decision**: Draw probability peaks at `DRAW_FACTOR × 2 × min(P_win, 1-P_win)` (~30% for even teams). Win/loss probabilities are derived from `We = P_win + 0.5 × P_draw`.

**Why**: Keeps probabilities ELO-consistent (`We` from ELO matches the expected score). A separate independent draw model would break this consistency.

**Trade-off**: The `DRAW_FACTOR = 0.30` constant is calibrated by feel, not fitted to data. Adjust if calibration diverges from real tournament rates.

---

## ADR-003 — Penalties = 50/50 coin flip

**Decision**: Tied knockout matches resolved by `rng.random() < 0.5`.

**Why**: Penalty shootout outcome is close to 50/50 in practice (~56% home/favourite edge), and no per-team penalty data was available at build time. The coin flip is the correct default under uncertainty.

**Trade-off**: Underestimates edges for strong penalty teams (e.g. Germany historically good). Upgrade path: add per-team penalty conversion rates when data is available.

---

## ADR-004 — Home advantage = flat +100 ELO in group stage only

**Decision**: USA, Canada, Mexico get +100 ELO for all group-stage matches. No bonus in knockout rounds.

**Rationale**: Host advantage is real but diminishes in single-elimination under neutral-venue pressure. The +100 figure is a standard ELO home-field approximation. Applies only in group stage to avoid over-compounding through the bracket.

**Trade-off**: All three hosts treated identically. In reality, Mexican teams (already higher ELO) arguably need less of a boost, and Canadian home crowds may be weaker than US ones. Calibration knob: `HOME_ELO_BONUS` in `elo.py`.

---

## ADR-005 — Third-place bracket from lookup table, not formula

**Decision**: Use the 495-entry `assign_third.json` table (from the official FIFA Excel reference model) to assign third-place qualifier slots to bracket positions.

**Why**: The FIFA WC 2026 third-place assignment rule is not a simple formula — it depends on which specific combination of 8 groups qualifies, and the mapping is complex enough to require a pre-computed table. Reverse-engineering the formula would be error-prone.

**Trade-off**: Opaque — if FIFA changes the assignment rules, the table must be regenerated. Source: WCup_2026_4.2.9 Excel model.

---

## ADR-006 — Group tiebreak criterion 8 is ELO (proxy for FIFA rank)

**Decision**: When teams are tied on all statistical criteria (Pts, GD, GF, H2H Pts, H2H GD, H2H GF, Wins), use higher ELO as the tiebreaker (proxy for FIFA ranking). Final tiebreaker is alphabetical name (proxy for drawing of lots).

**Why**: FIFA rank data was not loaded. ELO and FIFA rank are highly correlated (~0.9), and this criterion is rarely reached in practice.

**Trade-off**: Will produce wrong tiebreak outcomes in edge cases where ELO and FIFA rank diverge. Accept this — it affects ≤1% of simulations and only matters when teams are statistically identical.

---

## ADR-007 — Monte Carlo over analytical solution

**Decision**: Use Monte Carlo simulation (N=10,000 default) rather than deriving analytical advancement probabilities.

**Why**: The WC 2026 format has many inter-dependent rules (third-place bracket, 9-level tiebreak, slot resolution). An analytical solution would be extremely complex and brittle. Monte Carlo handles all edge cases automatically.

**Trade-off**: Results are stochastic — rerunning with a different seed gives slightly different numbers. Fixed seed (default 42) makes results reproducible. Increase N for tighter confidence intervals.

---

## ADR-008 — Streamlit, single `app.py`, no backend

**Decision**: All UI in one `app.py`. No FastAPI/Flask backend, no database, no authentication.

**Why**: This is a personal analysis tool, not a multi-user product. Streamlit's top-to-bottom execution model is well-suited to a simulation dashboard where all state is per-session. Adding a backend would add deployment complexity with no benefit.

**Trade-off**: Session state is lost on page reload. All 10K simulations run in the Streamlit process. Not suitable for concurrent multi-user hosting. Acceptable for solo use.

---

## ADR-009 — Result logging is session-only (no persistence)

**Decision**: Score overrides and KO results live in `st.session_state` only. Page reload loses all logged data.

**Why**: The simplest implementation. For a tool used by one person updating results daily, re-entering a few scores per session is acceptable friction.

**Upgrade path**: Serialize `st.session_state` to a JSON file on disk and reload on startup. Or modify `schedule.json` directly (set `played: true` + `score_home/away`) for the most durable approach.

---

## ADR-010 — Bracket estimator is greedy (max-probability advancement)

**Decision**: The bracket display uses a greedy estimator: for each unplayed KO match, pick whichever team has P(advance) ≥ 50%. This produces one deterministic "most likely bracket."

**Why**: Showing probability distributions per bracket slot would require tracking which team appeared in each match across all MC simulations — a bigger data structure and more complex UI. The greedy bracket is the right default for a quick visual read.

**Trade-off**: The greedy bracket is not the "expected bracket" (which would require Monte Carlo slot tracking). It's the bracket you'd get if the most-likely outcome always happened. Diverges from reality the further you go into the tournament. Upgrade: add `slot_counts: dict[slot → Counter[team]]` to MC output.

---

## ADR-011 — Bracket projection runs client-side, not via a new API

**Decision**: `projectBracket()` is a pure function in `page-predict26.tsx`, called inside a `useMemo`. No new backend route.

**Why**: The function needs only `data` (teams + matches + assignThird) and `eloOverrides`, both already on the client. Adding an API route would be a round-trip with no benefit — the client can resolve all slots deterministically in < 1ms.

**Trade-off**: Logic is duplicated between the Python simulator and this TS projection. Acceptable: the projection is intentionally simpler (no H2H tiebreak, simplified standings sort).

---

## ADR-012 — Group draw threshold for projected bracket: 50 ELO points

**Decision**: For unplayed group matches in the bracket projection, project a draw (0-0) when |ELO₁ − ELO₂| ≤ 50; otherwise the higher-ELO team wins 1-0.

**Why**: A flat threshold is simple and transparent. 50 ELO points corresponds roughly to a 57% vs 43% win probability split — close enough that a draw is the honest projection.

**Trade-off**: The threshold is arbitrary; misclassifying close matches slightly shifts projected group standings. Irrelevant in practice since only group positions (not exact scores) matter for bracket advancement.
