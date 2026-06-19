"""Tests for the Monte Carlo simulator."""
import numpy as np
import pytest

from src.data_loader import load_all
from src.simulator import STAGES, run_monte_carlo, simulate_tournament


@pytest.fixture(scope="module")
def loaded():
    return load_all()


def test_simulate_tournament_returns_all_teams(loaded):
    teams, matches = loaded
    rng = np.random.default_rng(0)
    result = simulate_tournament(teams, matches, rng)
    assert set(result.keys()) == {t.name for t in teams.values()}


def test_simulate_tournament_valid_stages(loaded):
    teams, matches = loaded
    rng = np.random.default_rng(1)
    result = simulate_tournament(teams, matches, rng)
    for stage in result.values():
        assert stage in STAGES, f"Invalid stage: {stage}"


def test_exactly_one_champion_per_sim(loaded):
    teams, matches = loaded
    rng = np.random.default_rng(2)
    for _ in range(20):
        result = simulate_tournament(teams, matches, rng)
        champions = [name for name, s in result.items() if s == "champion"]
        assert len(champions) == 1, f"Expected 1 champion, got {champions}"


def test_exactly_32_qualify_per_sim(loaded):
    """Top 2 of 12 groups (24) + best 8 thirds = 32 qualify."""
    teams, matches = loaded
    rng = np.random.default_rng(3)
    result = simulate_tournament(teams, matches, rng)
    qualified = [name for name, s in result.items() if s != "group"]
    assert len(qualified) == 32


def test_monte_carlo_counts_sum_to_n(loaded):
    teams, matches = loaded
    n = 100
    results = run_monte_carlo(teams, matches, n=n, seed=42)
    for name, counts in results.items():
        assert sum(counts.values()) == n, f"Counts don't sum to {n} for {name}"


def test_monte_carlo_champion_sums_to_n(loaded):
    teams, matches = loaded
    n = 200
    results = run_monte_carlo(teams, matches, n=n, seed=7)
    total_champions = sum(c["champion"] for c in results.values())
    assert total_champions == n


def test_elo_override_affects_results(loaded):
    teams, matches = loaded
    weak = min(teams.values(), key=lambda t: t.elo).name
    base = run_monte_carlo(teams, matches, n=200, seed=0)
    boosted = run_monte_carlo(teams, matches, n=200, seed=0, elo_overrides={weak: 2500})
    assert boosted[weak]["champion"] > base[weak]["champion"]
