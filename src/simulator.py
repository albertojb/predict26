"""Monte Carlo tournament simulator for WC 2026."""
from __future__ import annotations

from collections import defaultdict

import numpy as np
from numpy.random import Generator

from src.data_loader import Match, Team
from src.elo import apply_host_bonus, simulate_match, simulate_ko_match
from src.rules import (
    assign_third_bracket, compute_group_standings,
    rank_third_placed, resolve_slot,
)

STAGES = ["group", "r32", "r16", "qf", "sf", "final", "champion"]

_KO_NEXT_STAGE = {
    "Round of 32": "r16",
    "Round of 16": "qf",
    "Quarter-final": "sf",
    "Semi-final": "final",
    "Final": "champion",
}


def simulate_tournament(
    teams: dict[str, Team],
    matches: list[Match],
    rng: Generator,
    elo_overrides: dict[str, int] | None = None,
    ko_overrides: dict[int, str] | None = None,
) -> dict[str, str]:
    """Run one full tournament. Returns {team_name: stage_reached}.

    Stage values: "group" | "r32" | "r16" | "qf" | "sf" | "final" | "champion"
    Played matches are locked; unplayed matches are simulated.
    ko_overrides: {match_no: advancing_team_name} locks KO results without simulation.
    """
    elos = {t.name: (elo_overrides or {}).get(t.name, t.elo) for t in teams.values()}

    # ── 1. Group stage ──────────────────────────────────────────────────────
    sim_matches: list[Match] = []
    for m in matches:
        if not m.is_group_stage:
            sim_matches.append(m)
            continue
        if m.played:
            sim_matches.append(m)
        else:
            t1, t2 = teams[m.team1_slot], teams[m.team2_slot]
            e1 = apply_host_bonus(elos[t1.name], t1.is_host, True)
            e2 = apply_host_bonus(elos[t2.name], t2.is_host, True)
            g1, g2 = simulate_match(e1, e2, rng)
            sim_matches.append(Match(
                m.match_no, m.stage, m.team1_slot, m.team2_slot,
                m.date, m.venue, g1, g2, True,
            ))

    # ── 2. Group standings ──────────────────────────────────────────────────
    group_matches_map: dict[str, list] = defaultdict(list)
    for m in sim_matches:
        if m.is_group_stage:
            group_matches_map[m.group].append(m)

    group_teams_map: dict[str, list] = defaultdict(list)
    for t in teams.values():
        group_teams_map[t.group].append(t)

    standings: dict = {}
    for grp in "ABCDEFGHIJKL":
        standings[grp] = compute_group_standings(grp, group_matches_map[grp], group_teams_map[grp])

    top8_thirds = rank_third_placed(standings)
    third_bracket = assign_third_bracket([g for g, _ in top8_thirds])

    # ── 3. Stage tracking ───────────────────────────────────────────────────
    stage: dict[str, str] = {t.name: "group" for t in teams.values()}

    for stds in standings.values():
        for ts in stds[:2]:
            stage[ts.name] = "r32"
    for _, ts in top8_thirds:
        stage[ts.name] = "r32"

    # ── 4. KO bracket ───────────────────────────────────────────────────────
    ko_winners: dict[int, str] = {}
    ko_runners_up: dict[int, str] = {}

    for m in sorted((m for m in sim_matches if not m.is_group_stage), key=lambda m: m.match_no):
        if m.stage not in _KO_NEXT_STAGE:
            continue  # ponytail: "Third place" skipped — 3rd/4th not tracked separately

        t1 = resolve_slot(m.team1_slot, teams, standings, third_bracket, ko_winners, ko_runners_up)
        t2 = resolve_slot(m.team2_slot, teams, standings, third_bracket, ko_winners, ko_runners_up)
        if t1 is None or t2 is None:
            continue

        # Lock logged KO result; otherwise simulate
        if ko_overrides and m.match_no in ko_overrides:
            winner = ko_overrides[m.match_no]
            loser = t2 if winner == t1 else t1
        else:
            _, _, t1_wins = simulate_ko_match(elos[t1], elos[t2], rng)
            winner, loser = (t1, t2) if t1_wins else (t2, t1)
        ko_winners[m.match_no] = winner
        ko_runners_up[m.match_no] = loser
        stage[winner] = _KO_NEXT_STAGE[m.stage]

    return stage


def run_monte_carlo(
    teams: dict[str, Team],
    matches: list[Match],
    n: int = 10_000,
    seed: int | None = None,
    elo_overrides: dict[str, int] | None = None,
    ko_overrides: dict[int, str] | None = None,
) -> dict[str, dict[str, int]]:
    """Run N simulations. Returns {team_name: {stage: count}}."""
    rng = np.random.default_rng(seed)
    counts: dict[str, dict[str, int]] = {
        t.name: {s: 0 for s in STAGES} for t in teams.values()
    }
    for _ in range(n):
        for name, s in simulate_tournament(teams, matches, rng, elo_overrides, ko_overrides).items():
            counts[name][s] += 1
    return counts


# ponytail: self-check — `python -m src.simulator`
if __name__ == "__main__":
    from src.data_loader import load_all

    teams, matches = load_all()
    print("Running 100 quick simulations...")
    results = run_monte_carlo(teams, matches, n=100, seed=0)

    by_champ = sorted(results.items(), key=lambda x: x[1]["champion"], reverse=True)
    print(f"\n{'Team':<22} {'Champion':>8} {'Finalist':>8} {'SF':>8}")
    print("-" * 50)
    for name, counts in by_champ[:10]:
        print(f"{name:<22} {counts['champion']:>8d} {counts['final']:>8d} {counts['sf']:>8d}")

    total_champs = sum(c["champion"] for c in results.values())
    assert total_champs == 100, f"Expected 100 champions, got {total_champs}"
    print(f"\nOK ({total_champs} champions across 100 sims)")
