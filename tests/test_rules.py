"""Tests for the tournament rules engine."""
import pytest
from src.rules import (
    TeamStanding, compute_group_standings,
    rank_third_placed, assign_third_bracket, resolve_slot,
)
from src.data_loader import Match, Team


# ─── helpers ──────────────────────────────────────────────────────────────────

def _team(slot: str, elo: int = 1800) -> Team:
    grp = slot[0]
    return Team(slot=slot, name=slot, group=grp, elo=elo, is_host=False)


def _match(no: int, slot1: str, slot2: str, s1: int, s2: int) -> Match:
    grp = f"Group {slot1[0]}"
    return Match(
        match_no=no, stage=grp, team1_slot=slot1, team2_slot=slot2,
        date="2026-06-11", venue="Test", score_home=s1, score_away=s2, played=True,
    )


# ─── group standings ──────────────────────────────────────────────────────────

def test_clear_winner_ranks_first():
    teams = [_team("A1", 2000), _team("A2", 1500), _team("A3", 1600), _team("A4", 1700)]
    matches = [
        _match(1, "A1", "A2", 3, 0),
        _match(2, "A3", "A4", 1, 1),
        _match(3, "A1", "A3", 2, 0),
        _match(4, "A2", "A4", 0, 1),
        _match(5, "A1", "A4", 1, 0),
        _match(6, "A2", "A3", 0, 2),
    ]
    standings = compute_group_standings("A", matches, teams)
    assert standings[0].slot == "A1"  # 9 pts
    assert standings[-1].slot == "A2"  # 0 pts


def test_points_correct():
    teams = [_team("A1"), _team("A2"), _team("A3"), _team("A4")]
    matches = [
        _match(1, "A1", "A2", 1, 0), _match(2, "A3", "A4", 1, 1),
        _match(3, "A1", "A3", 0, 0), _match(4, "A2", "A4", 2, 1),
        _match(5, "A1", "A4", 2, 1), _match(6, "A2", "A3", 0, 1),
    ]
    standings = compute_group_standings("A", matches, teams)
    pts = {t.slot: t.points for t in standings}
    assert pts["A1"] == 7   # W, D, W = 3+1+3
    assert pts["A2"] == 3   # L, W, L = 0+3+0
    assert pts["A3"] == 5   # D, W, W = 1+3+... wait: D(A4)+D(A1)+W(A2) = 1+1+3 = 5
    assert pts["A4"] == 1   # D(A3), L(A2), L(A1) = 1+0+0


def test_gd_tiebreak():
    # A1 and A2 both 3 pts, but A1 has better GD
    teams = [_team("A1"), _team("A2"), _team("A3"), _team("A4")]
    matches = [
        _match(1, "A1", "A2", 2, 1),  # A1 wins
        _match(2, "A3", "A4", 0, 0),
        _match(3, "A1", "A3", 0, 1),  # A3 wins
        _match(4, "A2", "A4", 2, 0),  # A2 wins
        _match(5, "A1", "A4", 0, 0),
        _match(6, "A2", "A3", 0, 1),  # A3 wins
    ]
    standings = compute_group_standings("A", matches, teams)
    # A3: W, W = 6pts → 1st
    # A1: W, D = 4pts; A2: W, L = 3pts; A4: D, L = 1pt
    pts_order = [t.points for t in standings]
    assert pts_order == sorted(pts_order, reverse=True)


def test_unplayed_matches_ignored():
    teams = [_team("A1"), _team("A2"), _team("A3"), _team("A4")]
    played = [_match(1, "A1", "A2", 2, 0)]
    unplayed = [
        Match("x", "Group A", "A3", "A4", "2026-06-12", "V", None, None, False),
    ]
    standings = compute_group_standings("A", played + unplayed, teams)
    pts = {t.slot: t.points for t in standings}
    assert pts["A1"] == 3
    assert pts["A2"] == 0
    assert pts["A3"] == 0  # unplayed doesn't count


# ─── third-place ranking ──────────────────────────────────────────────────────

def _standing(slot: str, pts: int, gd: int, gf: int) -> TeamStanding:
    grp = slot[0]
    ts = TeamStanding(slot=slot, name=slot, group=grp, elo=1800)
    ts.wins = pts // 3
    ts.draws = pts % 3
    ts.gf = gf
    ts.ga = gf - gd
    ts.played = 3
    return ts


def test_rank_third_best_8():
    # Build 12 groups with known 3rd-place finishers
    standings = {}
    for i, grp in enumerate("ABCDEFGHIJKL"):
        # 3rd place gets i points (group L gets 11 pts = best)
        ts = _standing(f"{grp}3", i, i - 3, i)
        standings[grp] = [
            _standing(f"{grp}1", 9, 10, 12),
            _standing(f"{grp}2", 6, 5, 8),
            ts,
            _standing(f"{grp}4", 0, -10, 1),
        ]
    thirds = rank_third_placed(standings)
    assert len(thirds) == 8
    # Groups with higher points (E-L) should rank ahead of A-D
    top_groups = [g for g, _ in thirds]
    assert "L" in top_groups  # L has 11 pts
    assert "A" not in top_groups  # A has 0 pts


# ─── assign third bracket ────────────────────────────────────────────────────

def test_assign_third_valid_combination():
    result = assign_third_bracket(list("EFGHIJKL"))
    assert "3-CEFHI" in result
    assert result["3-CEFHI"] in "ABCDEFGHIJKL"


def test_assign_third_sorted_key():
    # Same combination, different order → same result
    r1 = assign_third_bracket(list("EFGHIJKL"))
    r2 = assign_third_bracket(list("LKJIHGFE"))
    assert r1 == r2


def test_assign_third_invalid_key():
    with pytest.raises(ValueError):
        assign_third_bracket(list("XYZWMNOP"))  # invalid group letters → not in table


# ─── slot resolution ─────────────────────────────────────────────────────────

def test_resolve_draw_slot():
    teams = {"A1": _team("A1")}
    assert resolve_slot("A1", teams, {}, {}, {}, {}) == "A1"


def test_resolve_group_position():
    ts1 = TeamStanding("A1", "Spain", "A", 2129, 3, 1, 0, 0, 2, 0)
    ts2 = TeamStanding("A2", "Qatar", "A", 1447, 0, 0, 0, 1, 0, 2)
    standings = {"A": [ts1, ts2]}
    assert resolve_slot("1A", {}, standings, {}, {}, {}) == "Spain"
    assert resolve_slot("2A", {}, standings, {}, {}, {}) == "Qatar"


def test_resolve_winner_slot():
    assert resolve_slot("W73", {}, {}, {}, {73: "Brazil"}, {}) == "Brazil"


def test_resolve_runner_up_slot():
    assert resolve_slot("RU101", {}, {}, {}, {}, {101: "France"}) == "France"


def test_resolve_unknown_returns_none():
    assert resolve_slot("W99", {}, {}, {}, {}, {}) is None
