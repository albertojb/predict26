"""FIFA WC 2026 tournament rules: standings, tie-breaks, third-place ranking, bracket."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

DATA_DIR = Path(__file__).parent.parent / "data"

# ─── data structures ──────────────────────────────────────────────────────────

@dataclass
class TeamStanding:
    slot: str           # draw-position (e.g. "A1")
    name: str
    group: str
    elo: int
    played: int = 0
    wins: int = 0
    draws: int = 0
    losses: int = 0
    gf: int = 0         # goals for
    ga: int = 0         # goals against

    @property
    def points(self) -> int:
        return 3 * self.wins + self.draws

    @property
    def gd(self) -> int:
        return self.gf - self.ga

    @property
    def third_coeff(self) -> float:
        """Coefficient used to rank third-placed teams (from Excel reference).
        Formula: Pts × 1,000,000 + GD × 1,000 + GF × 1
        """
        return self.points * 1_000_000 + self.gd * 1_000 + self.gf


# ─── group standings ──────────────────────────────────────────────────────────

def compute_group_standings(
    group: str,
    group_matches: list,        # list[Match] from data_loader
    teams_in_group: list,       # list[Team] from data_loader
) -> list[TeamStanding]:
    """Compute final standings for one group, ranked by FIFA WC 2026 tiebreak rules.

    Tiebreak order (no card data → fair play = 0):
      1. Points  2. Overall GD  3. Overall GF  4. H2H Pts  5. H2H GD
      6. H2H GF  7. Wins  8. ELO rank (proxy for FIFA rank)  9. Name (alpha)
    """
    standings: dict[str, TeamStanding] = {
        t.slot: TeamStanding(slot=t.slot, name=t.name, group=t.group, elo=t.elo)
        for t in teams_in_group
    }

    for m in group_matches:
        if not m.played or m.score_home is None:
            continue
        g1, g2 = m.score_home, m.score_away
        t1, t2 = standings[m.team1_slot], standings[m.team2_slot]
        t1.played += 1; t2.played += 1
        t1.gf += g1; t1.ga += g2
        t2.gf += g2; t2.ga += g1
        if g1 > g2:
            t1.wins += 1; t2.losses += 1
        elif g2 > g1:
            t2.wins += 1; t1.losses += 1
        else:
            t1.draws += 1; t2.draws += 1

    return _sort_standings(list(standings.values()), group_matches)


def _sort_standings(teams: list[TeamStanding], group_matches: list) -> list[TeamStanding]:
    """Sort teams by FIFA tiebreak rules."""
    # Sort descending by points first, then handle tied groups
    by_pts: dict[int, list[TeamStanding]] = {}
    for t in teams:
        by_pts.setdefault(t.points, []).append(t)

    result: list[TeamStanding] = []
    for pts in sorted(by_pts.keys(), reverse=True):
        tied = by_pts[pts]
        if len(tied) == 1:
            result.extend(tied)
        else:
            result.extend(_break_ties(tied, group_matches))
    return result


def _break_ties(tied: list[TeamStanding], group_matches: list) -> list[TeamStanding]:
    """Break equal-points tie using GD → GF → H2H stats → wins → ELO → name."""
    if len(tied) == 1:
        return tied

    h2h = _compute_h2h(tied, group_matches)

    def key(t: TeamStanding) -> tuple:
        h = h2h[t.slot]
        # All numeric: negate so sorting ascending gives descending rank
        # Name: ascending alphabetical (earlier = better per drawing of lots)
        return (-t.gd, -t.gf, -h['pts'], -h['gd'], -h['gf'], -t.wins, -t.elo, t.name)

    return sorted(tied, key=key)


def _compute_h2h(
    subset: list[TeamStanding],
    group_matches: list,
) -> dict[str, dict]:
    """H2H stats (pts, gd, gf) among a subset of teams."""
    slots = {t.slot for t in subset}
    h2h: dict[str, dict] = {t.slot: {'pts': 0, 'gd': 0, 'gf': 0} for t in subset}
    for m in group_matches:
        if (
            m.team1_slot in slots
            and m.team2_slot in slots
            and m.played
            and m.score_home is not None
        ):
            g1, g2 = m.score_home, m.score_away
            h2h[m.team1_slot]['gf'] += g1
            h2h[m.team1_slot]['gd'] += g1 - g2
            h2h[m.team2_slot]['gf'] += g2
            h2h[m.team2_slot]['gd'] += g2 - g1
            if g1 > g2:
                h2h[m.team1_slot]['pts'] += 3
            elif g2 > g1:
                h2h[m.team2_slot]['pts'] += 3
            else:
                h2h[m.team1_slot]['pts'] += 1
                h2h[m.team2_slot]['pts'] += 1
    return h2h


# ─── third-place ranking ──────────────────────────────────────────────────────

def rank_third_placed(
    all_group_standings: dict[str, list[TeamStanding]],
) -> list[tuple[str, TeamStanding]]:
    """Return the 8 best third-placed teams sorted by third_coeff.

    Returns list of (group_letter, TeamStanding) sorted best→worst.
    """
    thirds: list[tuple[str, TeamStanding]] = []
    for grp_letter, standings in all_group_standings.items():
        if len(standings) >= 3:
            thirds.append((grp_letter, standings[2]))  # 3rd = index 2

    # Sort descending by coefficient; name as final deterministic tiebreak
    thirds.sort(key=lambda x: (-x[1].third_coeff, x[1].name))
    return thirds[:8]


# ─── third-place bracket assignment ──────────────────────────────────────────

_ASSIGN_THIRD: Optional[dict[str, dict[str, str]]] = None


def _load_assign_third() -> dict[str, dict[str, str]]:
    global _ASSIGN_THIRD
    if _ASSIGN_THIRD is None:
        path = DATA_DIR / "assign_third.json"
        with open(path, encoding="utf-8") as f:
            _ASSIGN_THIRD = json.load(f)
    return _ASSIGN_THIRD


def assign_third_bracket(qualified_groups: list[str]) -> dict[str, str]:
    """Given the 8 group letters whose 3rd-placed teams qualified,
    return a mapping of slot_label → group_letter.

    Example return: {"3-CEFHI": "E", "3-EFGIJ": "J", ...}
    """
    key = "".join(sorted(set(qualified_groups)))
    table = _load_assign_third()
    if key not in table:
        raise ValueError(f"No AssignThird entry for group combination '{key}'")
    return table[key]


# ─── slot resolution ──────────────────────────────────────────────────────────

def resolve_slot(
    slot: str,
    teams: dict[str, object],                  # teams_by_slot from data_loader
    group_standings: dict[str, list[TeamStanding]],
    third_bracket: dict[str, str],             # from assign_third_bracket()
    ko_winners: dict[int, str],                # match_no → winning team name
    ko_runners_up: dict[int, str],             # match_no → losing team name
) -> Optional[str]:
    """Resolve any slot label to a team name (or None if not yet decided).

    Slot types:
      "A1"       → draw-position slot, directly from teams dict
      "1A","2B"  → 1st/2nd in group from standings
      "3-CEFHI"  → best 3rd-placed from those groups, via bracket
      "W73"      → winner of match 73
      "RU101"    → runner-up of match 101
    """
    if slot in teams:
        return teams[slot].name  # type: ignore[attr-defined]

    # "1A", "2B", "3A" etc.
    if len(slot) == 2 and slot[0].isdigit() and slot[1].isalpha():
        pos = int(slot[0]) - 1      # 0-indexed
        grp = slot[1].upper()
        standings = group_standings.get(grp, [])
        if pos < len(standings):
            return standings[pos].name
        return None

    # "3-CEFHI" etc.
    if slot.startswith("3-"):
        if slot not in third_bracket:
            return None
        grp = third_bracket[slot]
        standings = group_standings.get(grp, [])
        if len(standings) >= 3:
            return standings[2].name
        return None

    # "W73", "W74" etc.
    if slot.startswith("W") and slot[1:].isdigit():
        return ko_winners.get(int(slot[1:]))

    # "RU101", "RU102" etc.
    if slot.startswith("RU") and slot[2:].isdigit():
        return ko_runners_up.get(int(slot[2:]))

    return None


# ponytail: self-check — `python -m src.rules`
if __name__ == "__main__":
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from src.data_loader import load_all

    teams, matches = load_all()

    # Group by group letter
    from collections import defaultdict
    group_matches: dict[str, list] = defaultdict(list)
    for m in matches:
        if m.is_group_stage:
            group_matches[m.group].append(m)

    group_teams: dict[str, list] = defaultdict(list)
    for t in teams.values():
        group_teams[t.group].append(t)

    standings: dict[str, list[TeamStanding]] = {}
    for grp in "ABCDEFGHIJKL":
        standings[grp] = compute_group_standings(grp, group_matches[grp], group_teams[grp])

    print("Group A standings (after played matches only):")
    for i, ts in enumerate(standings["A"], 1):
        print(f"  {i}. {ts.name:<20} Pts={ts.points} GD={ts.gd:+} GF={ts.gf}")

    thirds = rank_third_placed(standings)
    print(f"\nTop 8 thirds (by coeff, from played matches):")
    for grp, ts in thirds:
        print(f"  3{grp}: {ts.name:<20} coeff={ts.third_coeff:.0f}")
    print("OK")
