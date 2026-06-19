"""Data loading and validation for WC26 engine."""
from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

DATA_DIR = Path(__file__).parent.parent / "data"


@dataclass
class Team:
    slot: str       # draw-position label, e.g. "A1", "K4"
    name: str
    group: str      # single letter A-L
    elo: int
    is_host: bool


@dataclass
class Match:
    match_no: int
    stage: str
    team1_slot: str  # group stage: "A1"; knockout: "2A", "3-ABCDF", "W74", "RU101"
    team2_slot: str
    date: str
    venue: str
    score_home: Optional[int]
    score_away: Optional[int]
    played: bool

    @property
    def is_group_stage(self) -> bool:
        return self.stage.startswith("Group")

    @property
    def group(self) -> Optional[str]:
        """Return the group letter if this is a group-stage match."""
        if self.is_group_stage:
            return self.stage.split()[-1]  # "Group A" → "A"
        return None


def load_teams(path: Path = DATA_DIR / "teams.csv") -> dict[str, Team]:
    """Load teams keyed by their draw-position slot (e.g. 'A1')."""
    teams: dict[str, Team] = {}
    with open(path, encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            slot = row["slot"].strip()
            teams[slot] = Team(
                slot=slot,
                name=row["name"].strip(),
                group=row["group"].strip(),
                elo=int(row["elo"]),
                is_host=row["is_host"].strip().lower() == "true",
            )
    return teams


def load_schedule(path: Path = DATA_DIR / "schedule.json") -> list[Match]:
    """Load the full 80-match schedule."""
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    return [
        Match(
            match_no=m["match_no"],
            stage=m["stage"],
            team1_slot=m["team1_slot"],
            team2_slot=m["team2_slot"],
            date=m["date"],
            venue=m["venue"],
            score_home=m.get("score_home"),
            score_away=m.get("score_away"),
            played=m.get("played", False),
        )
        for m in raw
    ]


def load_all(data_dir: Path = DATA_DIR) -> tuple[dict[str, Team], list[Match]]:
    """Convenience loader. Returns (teams_by_slot, matches)."""
    teams = load_teams(data_dir / "teams.csv")
    matches = load_schedule(data_dir / "schedule.json")
    _validate(teams, matches)
    return teams, matches


def _validate(teams: dict[str, Team], matches: list[Match]) -> None:
    """Light sanity checks — fail fast on corrupt data."""
    assert len(teams) == 48, f"Expected 48 teams, got {len(teams)}"
    assert len(matches) == 104, f"Expected 104 matches, got {len(matches)}"
    # All group-stage slots must resolve to a known team
    for m in matches:
        if m.is_group_stage:
            assert m.team1_slot in teams, f"Unknown slot {m.team1_slot} in match {m.match_no}"
            assert m.team2_slot in teams, f"Unknown slot {m.team2_slot} in match {m.match_no}"


# ponytail: quick self-check — run with `python -m src.data_loader`
if __name__ == "__main__":
    teams, matches = load_all()
    played = sum(1 for m in matches if m.played)
    unplayed = len(matches) - played
    group_matches = sum(1 for m in matches if m.is_group_stage)
    print(f"Teams loaded: {len(teams)}")
    print(f"Matches: {len(matches)} total, {played} played, {unplayed} to simulate")
    print(f"Group stage: {group_matches}, Knockout: {len(matches) - group_matches}")
    print(f"Host teams: {[t.name for t in teams.values() if t.is_host]}")
    print(f"Top 5 by ELO: {[t.name for t in sorted(teams.values(), key=lambda t: t.elo, reverse=True)[:5]]}")
    print("OK")
