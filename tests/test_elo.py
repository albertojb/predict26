"""Unit tests for the ELO match engine."""
import math
import pytest
import numpy as np
from src.elo import (
    win_prob, match_probs, expected_goals,
    simulate_match, simulate_ko_match, ko_advancement_prob,
    apply_host_bonus, BASE_GOALS, HOME_ELO_BONUS,
)


def test_win_prob_even():
    assert win_prob(1800, 1800) == 0.5


def test_win_prob_higher_elo_wins():
    assert win_prob(1900, 1800) > 0.5
    assert win_prob(1700, 1800) < 0.5


def test_win_prob_symmetry():
    assert abs(win_prob(2000, 1600) + win_prob(1600, 2000) - 1.0) < 1e-12


def test_match_probs_sum_to_one():
    for e1, e2 in [(1800, 1800), (2129, 1447), (1939, 1427)]:
        pw, pd, pl = match_probs(e1, e2)
        assert abs(pw + pd + pl - 1.0) < 1e-12, f"Probs don't sum to 1 for ({e1},{e2})"


def test_match_probs_all_non_negative():
    for e1, e2 in [(1800, 1800), (2200, 1300), (1300, 2200)]:
        pw, pd, pl = match_probs(e1, e2)
        assert pw >= 0 and pd >= 0 and pl >= 0


def test_match_probs_draw_peaks_for_even_match():
    _, pd_even, _ = match_probs(1800, 1800)
    _, pd_lopsided, _ = match_probs(2129, 1447)
    assert pd_even > pd_lopsided


def test_expected_goals_equal_elos():
    l1, l2 = expected_goals(1800, 1800)
    assert l1 == l2 == pytest.approx(BASE_GOALS)


def test_expected_goals_stronger_scores_more():
    l1, l2 = expected_goals(1900, 1800)
    assert l1 > l2


def test_expected_goals_symmetry():
    l1a, l2a = expected_goals(2000, 1600)
    l1b, l2b = expected_goals(1600, 2000)
    assert l1a == pytest.approx(l2b)
    assert l2a == pytest.approx(l1b)


def test_ko_advancement_even():
    assert ko_advancement_prob(1800, 1800) == pytest.approx(0.5)


def test_ko_advancement_higher_elo_favored():
    assert ko_advancement_prob(2000, 1600) > 0.5


def test_simulate_match_returns_non_negative_ints():
    rng = np.random.default_rng(42)
    for _ in range(20):
        g1, g2 = simulate_match(1800, 1800, rng)
        assert isinstance(g1, int) and g1 >= 0
        assert isinstance(g2, int) and g2 >= 0


def test_simulate_ko_match_no_persistent_tie():
    """KO match must always produce a winner."""
    rng = np.random.default_rng(0)
    for _ in range(50):
        g1, g2, team1_wins = simulate_ko_match(1800, 1800, rng)
        assert isinstance(team1_wins, bool)
        if g1 != g2:
            assert team1_wins == (g1 > g2)


def test_apply_host_bonus_group_stage():
    boosted = apply_host_bonus(1780, is_host=True, is_group_stage=True)
    assert boosted == 1780 + HOME_ELO_BONUS


def test_apply_host_bonus_not_in_knockout():
    unboosted = apply_host_bonus(1780, is_host=True, is_group_stage=False)
    assert unboosted == 1780


def test_apply_host_bonus_non_host():
    unchanged = apply_host_bonus(1800, is_host=False, is_group_stage=True)
    assert unchanged == 1800
