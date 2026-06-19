"""ELO-based match probability and score simulation engine."""
from __future__ import annotations

import math
from numpy.random import Generator

# Calibration constants — all in one place for easy tuning
DRAW_FACTOR = 0.30       # peak draw probability for equally-matched teams (~30%)
BASE_GOALS = 1.2         # average goals per team at equal ELO, neutral venue
GOAL_ELO_SCALE = 1000.0  # ELO points per e-fold change in expected goals
HOME_ELO_BONUS = 100     # applied to host nation ELO in group stage only


# ─── core probability functions ───────────────────────────────────────────────

def win_prob(elo1: float, elo2: float) -> float:
    """ELO expected score (win=1, draw=0.5, loss=0) for team1.
    Formula: P = 1 / (1 + 10^(-ΔR/400))
    """
    return 1.0 / (1.0 + 10.0 ** (-(elo1 - elo2) / 400.0))


def match_probs(elo1: float, elo2: float) -> tuple[float, float, float]:
    """Return (P_win, P_draw, P_loss) for team1 in a group-stage match.

    ELO-consistent model:  We = P_win + 0.5 * P_draw
    Draw peaks at DRAW_FACTOR * 100% (~30%) for even teams, drops toward 0
    as the ELO gap widens.  P_win and P_loss are derived from We.
    """
    we = win_prob(elo1, elo2)
    # max possible draw without making P_win or P_loss negative
    max_draw = 2.0 * min(we, 1.0 - we)
    draw = DRAW_FACTOR * max_draw           # capped by max_draw implicitly
    p_win = we - 0.5 * draw
    p_loss = (1.0 - we) - 0.5 * draw
    return p_win, draw, p_loss


# ─── Poisson goal model ────────────────────────────────────────────────────────

def expected_goals(elo1: float, elo2: float) -> tuple[float, float]:
    """Expected goals (λ1, λ2) for each team using Poisson model.
    Equal ELOs → (1.2, 1.2).  400-pt advantage → ≈ (1.80, 0.80).
    """
    diff = (elo1 - elo2) / GOAL_ELO_SCALE
    return BASE_GOALS * math.exp(diff), BASE_GOALS * math.exp(-diff)


# ─── match simulation ─────────────────────────────────────────────────────────

def simulate_match(
    elo1: float,
    elo2: float,
    rng: Generator,
) -> tuple[int, int]:
    """Sample a Poisson scoreline (goals1, goals2) for 90 minutes.
    Draws are a valid outcome (used for group stage).
    """
    lam1, lam2 = expected_goals(elo1, elo2)
    return int(rng.poisson(lam1)), int(rng.poisson(lam2))


def simulate_ko_match(
    elo1: float,
    elo2: float,
    rng: Generator,
) -> tuple[int, int, bool]:
    """Simulate a knockout match (no draw allowed).
    Returns (goals1, goals2, team1_advances).
    Ties resolved by 50/50 penalty coin-flip.
    """
    g1, g2 = simulate_match(elo1, elo2, rng)
    if g1 != g2:
        return g1, g2, g1 > g2
    # ponytail: penalties = 50/50 coin flip, no extra-time model
    return g1, g2, bool(rng.random() < 0.5)


# ─── analytical advancement probability ──────────────────────────────────────

def ko_advancement_prob(elo1: float, elo2: float) -> float:
    """P(team1 advances) in a knockout match.
    Analytical: P_advance = P_win + P_draw * 0.5  (50/50 penalties)
    """
    p_win, p_draw, _ = match_probs(elo1, elo2)
    return p_win + p_draw * 0.5


def apply_host_bonus(elo: float, is_host: bool, is_group_stage: bool) -> float:
    """Add HOME_ELO_BONUS to host-nation ELO in group stage only."""
    if is_host and is_group_stage:
        return elo + HOME_ELO_BONUS
    return elo


# ponytail: self-check — `python -m src.elo`
if __name__ == "__main__":
    cases = [
        ("Even (1800v1800)",  1800, 1800),
        ("Spain v Qatar",     2129, 1447),
        ("Germany v Curaçao", 1939, 1427),
        ("Argentina v Algeria",2128, 1759),
    ]
    print(f"{'Match':<28} {'P_win':>6} {'P_draw':>6} {'P_loss':>6} {'xG1':>5} {'xG2':>5} {'P_adv':>6}")
    print("-" * 70)
    for label, e1, e2 in cases:
        pw, pd, pl = match_probs(e1, e2)
        l1, l2 = expected_goals(e1, e2)
        pa = ko_advancement_prob(e1, e2)
        print(f"{label:<28} {pw:>6.1%} {pd:>6.1%} {pl:>6.1%} {l1:>5.2f} {l2:>5.2f} {pa:>6.1%}")
