"""WC 2026 Streamlit app — no logic here, all calls go to src/."""
from collections import defaultdict

import pandas as pd
import streamlit as st

from src.data_loader import Match, load_all
from src.elo import expected_goals, match_probs
from src.rules import assign_third_bracket, compute_group_standings
from src.simulator import run_monte_carlo

st.set_page_config(page_title="WC 2026 Engine", page_icon="⚽", layout="wide")
st.title("⚽ World Cup 2026 Simulator")

# ── Data ─────────────────────────────────────────────────────────────────────
@st.cache_data
def _load():
    return load_all()

teams, matches = _load()
team_names = sorted(t.name for t in teams.values())
name_to_elo = {t.name: t.elo for t in teams.values()}

# ── Session state ─────────────────────────────────────────────────────────────
for _k, _v in [("score_overrides", {}), ("ko_results", {})]:
    if _k not in st.session_state:
        st.session_state[_k] = _v

score_overrides: dict = st.session_state.score_overrides   # {match_no: (g1, g2)}
ko_results: dict = st.session_state.ko_results             # {match_no: {"winner": str, "loser": str}}

# ── Apply score overrides → patched match list ────────────────────────────────
patched: list[Match] = []
for _m in matches:
    if _m.match_no in score_overrides:
        _g1, _g2 = score_overrides[_m.match_no]
        patched.append(Match(_m.match_no, _m.stage, _m.team1_slot, _m.team2_slot,
                             _m.date, _m.venue, _g1, _g2, True))
    else:
        patched.append(_m)

# ── Current standings (real + logged results) ─────────────────────────────────
grp_matches: dict = defaultdict(list)
grp_teams: dict = defaultdict(list)
for m in patched:
    if m.is_group_stage:
        grp_matches[m.group].append(m)
for t in teams.values():
    grp_teams[t.group].append(t)

standings = {g: compute_group_standings(g, grp_matches[g], grp_teams[g]) for g in "ABCDEFGHIJKL"}
group_played = {g: sum(1 for m in grp_matches[g] if m.played) for g in "ABCDEFGHIJKL"}

# Bracket round order — DFS post-order from Final so adjacent cards share a bracket path
def _bracket_rounds() -> dict[str, list[int]]:
    ko = {m.match_no: m for m in matches
          if not m.is_group_stage and m.stage != "Third place"}
    feeders: dict[int, list[int]] = {}
    for no, m in ko.items():
        feeders[no] = [int(s[1:]) for s in [m.team1_slot, m.team2_slot]
                       if s.startswith("W") and s[1:].isdigit()]
    final_no = max(no for no, m in ko.items() if m.stage == "Final")
    def dfs(no: int) -> list[int]:
        result = []
        for f in feeders.get(no, []):
            result.extend(dfs(f))
        result.append(no)
        return result
    rounds: dict[str, list[int]] = {}
    for no in dfs(final_no):
        rounds.setdefault(ko[no].stage, []).append(no)
    return rounds

bracket_rounds = _bracket_rounds()


def _resolve(slot: str) -> tuple[str | None, bool]:
    """Resolve a match slot → (team_name | None, is_confirmed).
    Confirmed = result is locked (played or fully logged), not just estimated.
    """
    if slot in teams:
        return teams[slot].name, True
    if len(slot) == 2 and slot[0].isdigit() and slot[1].isalpha():
        pos, grp = int(slot[0]) - 1, slot[1].upper()
        stds = standings.get(grp, [])
        return (stds[pos].name if pos < len(stds) else None), group_played[grp] == 6
    if slot.startswith("3-"):
        return None, False   # ponytail: requires all 12 groups complete
    if slot.startswith("W") and slot[1:].isdigit():
        r = ko_results.get(int(slot[1:]))
        return (r["winner"] if r else None), bool(r)
    if slot.startswith("RU") and slot[2:].isdigit():
        r = ko_results.get(int(slot[2:]))
        return (r["loser"] if r else None), bool(r)
    return None, False


# ── Bracket estimation (greedy ELO) ──────────────────────────────────────────

def _build_est() -> dict[str, str]:
    """Fill every bracket slot with most likely team name (greedy ELO advancement)."""
    est: dict[str, str] = {}

    # Group positions from current standings (current leader = best estimate)
    for grp in "ABCDEFGHIJKL":
        for i, ts in enumerate(standings[grp], 1):
            est[f"{i}{grp}"] = ts.name

    # Third-place slots: rank current thirds by coefficient, apply bracket mapping
    thirds = [(g, standings[g][2]) for g in "ABCDEFGHIJKL"]  # always 4 teams per group
    thirds.sort(key=lambda x: (-x[1].third_coeff, x[1].name))
    try:
        tb = assign_third_bracket([g for g, _ in thirds[:8]])
        for slot, grp in tb.items():
            est[slot] = standings[grp][2].name
    except ValueError:
        pass  # ponytail: invalid group combo → skip third-place bracket estimation

    def _pick(slot: str) -> str | None:
        if slot in est:
            return est[slot]
        if len(slot) == 2 and slot[0].isdigit() and slot[1].isalpha():
            pos, g = int(slot[0]) - 1, slot[1].upper()
            s = standings.get(g, [])
            return s[pos].name if pos < len(s) else None
        if slot.startswith("W") and slot[1:].isdigit():
            no = int(slot[1:])
            r = ko_results.get(no)
            return (r["winner"] if r else est.get(f"W{no}"))
        if slot.startswith("RU") and slot[2:].isdigit():
            no = int(slot[2:])
            r = ko_results.get(no)
            return (r["loser"] if r else est.get(f"RU{no}"))
        return None

    for m in sorted([m for m in matches if not m.is_group_stage], key=lambda m: m.match_no):
        t1, t2 = _pick(m.team1_slot), _pick(m.team2_slot)
        if not t1 or not t2:
            continue
        if m.stage == "Third place":
            est[f"W{m.match_no}"], est[f"RU{m.match_no}"] = t1, t2
            continue
        logged = ko_results.get(m.match_no)
        if logged:
            w, l = logged["winner"], logged["loser"]
        else:
            e1 = elo_overrides.get(t1, name_to_elo.get(t1, 1800))
            e2 = elo_overrides.get(t2, name_to_elo.get(t2, 1800))
            pw, pd_p, _ = match_probs(e1, e2)
            w, l = (t1, t2) if pw + pd_p * 0.5 >= 0.5 else (t2, t1)
        est[f"W{m.match_no}"], est[f"RU{m.match_no}"] = w, l
    return est


def _get_est(slot: str) -> tuple[str, bool]:
    """(team_name, is_confirmed) — always returns a real team name, never a slot label."""
    name, confirmed = _resolve(slot)
    if name:
        return name, confirmed
    return est_slots.get(slot, "TBD"), False


def _card(m: Match) -> str:
    """HTML match card for the bracket view."""
    t1, t1_conf = _get_est(m.team1_slot)
    t2, t2_conf = _get_est(m.team2_slot)
    logged = ko_results.get(m.match_no)

    adv1: float | None = None
    if t1 in name_to_elo and t2 in name_to_elo:
        e1 = elo_overrides.get(t1, name_to_elo[t1])
        e2 = elo_overrides.get(t2, name_to_elo[t2])
        pw, pd_p, _ = match_probs(e1, e2)
        adv1 = pw + pd_p * 0.5

    def row(name: str, adv: float | None, conf: bool, won: bool, lost: bool) -> str:
        if won:
            bg, fw = "#d1fae5", "bold"
        elif lost:
            bg, fw = "#fee2e2", "normal"
        else:
            bg = "#f0f7ff" if adv is not None and adv >= 0.5 else "white"
            fw = "bold" if adv is not None and adv >= 0.5 else "normal"
        est_mark = "" if conf else "<span style='color:#bbb;font-size:0.8em'>~</span> "
        won_mark = "✅ " if won else ""
        adv_str = (f"<span style='color:#888;font-size:0.82em'> {adv:.0%}</span>"
                   if adv is not None else "")
        champ = results.get(name, {}).get("champion", 0) / n_sims if name in results else 0
        trophy = (f"<span style='color:#e5a000;font-size:0.78em'> 🏆{champ:.1%}</span>"
                  if champ >= 0.005 else "")
        return (f'<div style="padding:5px 10px;background:{bg};font-weight:{fw};'
                f'overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
                f'{won_mark}{est_mark}{name}{adv_str}{trophy}</div>')

    t1_won = bool(logged and logged["winner"] == t1)
    t2_won = bool(logged and logged["winner"] == t2)
    hdr_bg = "#e6f4ea" if logged else "#f8f9fa"
    venue = m.venue.split(",")[0][:20]
    date  = m.date[5:10]

    return (
        f'<div style="border:1px solid #dee2e6;border-radius:8px;overflow:hidden;'
        f'margin-bottom:6px;background:white;font-size:0.86em">'
        f'<div style="background:{hdr_bg};padding:2px 8px;font-size:0.72em;color:#6c757d;'
        f'display:flex;justify-content:space-between">'
        f'<b>M{m.match_no}</b><span>{date} · {venue}</span></div>'
        + row(t1, adv1, t1_conf, t1_won, t2_won and not t1_won)
        + '<div style="height:1px;background:#f0f0f0"></div>'
        + row(t2, (1 - adv1) if adv1 is not None else None, t2_conf, t2_won, t1_won and not t2_won)
        + '</div>'
    )


# ── Sidebar ───────────────────────────────────────────────────────────────────
with st.sidebar:
    st.header("⚙️ Settings")
    n_sims = st.slider("Simulations", 500, 50_000, 10_000, 500)
    seed_val = st.number_input("Seed (0 = random)", min_value=0, max_value=99_999, value=42)
    seed = int(seed_val) if seed_val > 0 else None

    st.subheader("ELO Overrides")
    elo_overrides: dict[str, int] = {}
    with st.expander("Adjust team ratings"):
        for team in team_names:
            val = st.number_input(team, 800, 2500, name_to_elo[team], 10, key=f"elo_{team}")
            if val != name_to_elo[team]:
                elo_overrides[team] = int(val)

    n_logged = len(score_overrides) + len(ko_results)
    if n_logged:
        st.info(f"📝 {n_logged} result(s) logged")

est_slots = _build_est()   # greedy bracket estimate, rebuilt each run

# ── MC simulation ─────────────────────────────────────────────────────────────
@st.cache_data(show_spinner="Running simulations…")
def _run_mc(n, seed, elo_key, score_key, ko_key):
    _teams, _all = _load()
    score_ovr = {no: (g1, g2) for no, g1, g2 in score_key}
    _pat = []
    for m in _all:
        if m.match_no in score_ovr:
            g1, g2 = score_ovr[m.match_no]
            _pat.append(Match(m.match_no, m.stage, m.team1_slot, m.team2_slot,
                              m.date, m.venue, g1, g2, True))
        else:
            _pat.append(m)
    return run_monte_carlo(
        _teams, _pat, n=n, seed=seed,
        elo_overrides=dict(elo_key) if elo_key else None,
        ko_overrides={no: w for no, w in ko_key} if ko_key else None,
    )

_elo_key   = tuple(sorted(elo_overrides.items()))
_score_key = tuple(sorted((no, g1, g2) for no, (g1, g2) in score_overrides.items()))
_ko_key    = tuple(sorted((no, r["winner"]) for no, r in ko_results.items()))
results    = _run_mc(n_sims, seed, _elo_key, _score_key, _ko_key)


# ── Tabs ──────────────────────────────────────────────────────────────────────
tab1, tab2, tab3, tab4, tab5 = st.tabs([
    "🏆 Tournament Results", "🏟️ Bracket", "📋 Group Standings",
    "⚔️ Match Estimator", "📝 Log Results",
])

# ── Tab 1: Tournament Results ─────────────────────────────────────────────────
with tab1:
    rows = []
    for _name, _counts in results.items():
        rows.append({
            "Team": _name,
            "ELO": elo_overrides.get(_name, name_to_elo[_name]),
            "🏆 Champion": _counts["champion"] / n_sims,
            "🥈 Finalist":  (_counts["champion"] + _counts["final"]) / n_sims,
            "Top 4":  sum(_counts[s] for s in ["champion", "final", "sf"]) / n_sims,
            "Top 8":  sum(_counts[s] for s in ["champion", "final", "sf", "qf"]) / n_sims,
            "Qualify": (n_sims - _counts["group"]) / n_sims,
        })
    df = pd.DataFrame(rows).sort_values("🏆 Champion", ascending=False).reset_index(drop=True)
    df.index += 1
    st.subheader(f"Championship Odds — {n_sims:,} simulations")
    st.bar_chart(df.set_index("Team")["🏆 Champion"].head(20) * 100)
    fmt = {col: "{:.1%}" for col in df.columns if col not in ("Team", "ELO")}
    st.dataframe(df.style.format(fmt), use_container_width=True)


# ── Tab 2: Bracket ────────────────────────────────────────────────────────────
with tab2:
    st.caption(
        "Bold = projected winner · ~ = estimated from current standings · "
        "✅ = logged · Adv% = KO advancement probability · 🏆 = champion % from Monte Carlo"
    )
    ko_lookup = {m.match_no: m for m in matches if not m.is_group_stage}

    # Stage layout: matches-per-row controls card width (fewer = wider)
    _per_row = {
        "Round of 32":  4,
        "Round of 16":  2,
        "Quarter-final": 2,
        "Semi-final":   2,
        "Final":        1,
    }
    _half_break = {          # insert a divider after this many rows per stage
        "Round of 32": 2,    # top half vs bottom half
        "Round of 16": 2,
        "Quarter-final": 1,
    }

    for _stage, _n in _per_row.items():
        _nos = bracket_rounds.get(_stage, [])
        if not _nos:
            continue
        st.markdown(f"### {_stage}")
        _break_after = _half_break.get(_stage, len(_nos))  # no break = one continuous section
        for _row_i, _chunk_start in enumerate(range(0, len(_nos), _n)):
            if _row_i > 0 and _row_i % _break_after == 0:
                st.markdown(
                    "<div style='border-top:2px dashed #adb5bd;margin:4px 0 8px'></div>",
                    unsafe_allow_html=True,
                )
            _chunk = _nos[_chunk_start:_chunk_start + _n]
            _cols  = st.columns(_n)
            for _col, _no in zip(_cols, _chunk):
                _col.markdown(_card(ko_lookup[_no]), unsafe_allow_html=True)
        st.markdown("<hr style='margin:6px 0 2px;border:none;border-top:1px solid #e9ecef'>",
                    unsafe_allow_html=True)

    # Third place match below the Final
    _third = next((m for m in matches if m.stage == "Third place"), None)
    if _third:
        st.markdown("### Third Place")
        _, _c, _ = st.columns([1, 2, 1])
        _c.markdown(_card(_third), unsafe_allow_html=True)


# ── Tab 3: Group Standings ────────────────────────────────────────────────────
with tab3:
    grp_sel = st.selectbox("Group", list("ABCDEFGHIJKL"), key="grp_sel")
    stds = standings[grp_sel]
    rows = []
    for i, ts in enumerate(stds, 1):
        rows.append({
            "": i, "Team": ts.name, "ELO": ts.elo,
            "Pld": ts.played, "W": ts.wins, "D": ts.draws, "L": ts.losses,
            "GF": ts.gf, "GA": ts.ga, "GD": f"{ts.gd:+d}", "Pts": ts.points,
        })
    st.dataframe(pd.DataFrame(rows).set_index(""), use_container_width=True)
    st.caption(f"{group_played[grp_sel]}/6 matches played in Group {grp_sel}")


# ── Tab 4: Match Estimator ────────────────────────────────────────────────────
with tab4:
    st.subheader("Single Match Probability")
    col_a, col_b = st.columns(2)
    with col_a:
        team_a = st.selectbox("Team A", team_names, key="ma")
    with col_b:
        team_b = st.selectbox("Team B", [t for t in team_names if t != team_a], key="mb")

    ea = elo_overrides.get(team_a, name_to_elo[team_a])
    eb = elo_overrides.get(team_b, name_to_elo[team_b])
    p_win, p_draw, p_loss = match_probs(ea, eb)
    xg1, xg2 = expected_goals(ea, eb)

    st.caption(f"ELO: **{team_a}** {ea} vs **{team_b}** {eb} (Δ = {ea - eb:+d})")
    col_w, col_d, col_l = st.columns(3)
    col_w.metric(f"{team_a} Win", f"{p_win:.1%}")
    col_d.metric("Draw", f"{p_draw:.1%}")
    col_l.metric(f"{team_b} Win", f"{p_loss:.1%}")
    col_xg1, col_xg2 = st.columns(2)
    col_xg1.metric(f"xG {team_a}", f"{xg1:.2f}")
    col_xg2.metric(f"xG {team_b}", f"{xg2:.2f}")
    st.info(f"Knockout: **{team_a}** advances {p_win + p_draw * 0.5:.1%} (penalties = 50/50 coin-flip)")


# ── Tab 5: Log Results ────────────────────────────────────────────────────────
with tab5:
    st.subheader("Log Match Results")
    log_type = st.radio("Stage type", ["Group Stage", "Knockout"], horizontal=True)

    if log_type == "Group Stage":
        log_grp = st.selectbox("Group", list("ABCDEFGHIJKL"), key="log_grp")
        unplayed = [m for m in matches if m.is_group_stage and m.group == log_grp and not m.played]

        if not unplayed:
            st.success(f"All real matches in Group {log_grp} are locked in from the schedule.")
        else:
            rows = []
            for m in unplayed:
                logged = score_overrides.get(m.match_no)
                rows.append({
                    "match_no": m.match_no,
                    "Date": m.date[:10],
                    "Venue": m.venue,
                    "Home": teams[m.team1_slot].name,
                    "GH": logged[0] if logged else None,
                    "GA": logged[1] if logged else None,
                    "Away": teams[m.team2_slot].name,
                })
            df = pd.DataFrame(rows)
            df["GH"] = df["GH"].astype(pd.Int64Dtype())
            df["GA"] = df["GA"].astype(pd.Int64Dtype())

            with st.form("group_form"):
                edited = st.data_editor(
                    df,
                    column_config={
                        "match_no": st.column_config.NumberColumn("M#", disabled=True),
                        "Date":  st.column_config.TextColumn(disabled=True),
                        "Venue": st.column_config.TextColumn(disabled=True),
                        "Home":  st.column_config.TextColumn(disabled=True),
                        "GH": st.column_config.NumberColumn("H Goals", min_value=0, max_value=20, step=1),
                        "GA": st.column_config.NumberColumn("A Goals", min_value=0, max_value=20, step=1),
                        "Away":  st.column_config.TextColumn(disabled=True),
                    },
                    hide_index=True, use_container_width=True,
                )
                if st.form_submit_button("💾 Save group results", type="primary"):
                    for _, row in edited.iterrows():
                        no = int(row["match_no"])
                        if pd.notna(row["GH"]) and pd.notna(row["GA"]):
                            score_overrides[no] = (int(row["GH"]), int(row["GA"]))
                        else:
                            score_overrides.pop(no, None)
                    st.rerun()

    else:  # Knockout
        ko_stage_opts = ["Round of 32", "Round of 16", "Quarter-final", "Semi-final", "Final"]
        ko_stage = st.selectbox("Round", ko_stage_opts, key="ko_stage_sel")
        ko_stage_matches = sorted([m for m in matches if m.stage == ko_stage], key=lambda m: m.match_no)

        for m in ko_stage_matches:
            t1, t1_conf = _get_est(m.team1_slot)
            t2, t2_conf = _get_est(m.team2_slot)
            logged = ko_results.get(m.match_no)
            t1_lbl = t1 + ("" if t1_conf else " ~")
            t2_lbl = t2 + ("" if t2_conf else " ~")

            with st.expander(f"M{m.match_no}: {t1_lbl} vs {t2_lbl} — {m.date[:10]}, {m.venue}",
                             expanded=not bool(logged)):
                if logged:
                    st.success(f"✅ **{logged['winner']}** advanced")
                    if st.button("Clear result", key=f"clr_{m.match_no}"):
                        del ko_results[m.match_no]
                        st.rerun()
                elif "TBD" not in (t1, t2):
                    winner_sel = st.radio("Who advanced?", [t1_lbl, t2_lbl],
                                         horizontal=True, key=f"wr_{m.match_no}")
                    if st.button("Log result", key=f"log_{m.match_no}", type="primary"):
                        w = t1 if winner_sel == t1_lbl else t2
                        ko_results[m.match_no] = {"winner": w, "loser": t2 if w == t1 else t1}
                        st.rerun()
                else:
                    st.info("Bracket not yet resolved for this match")

    # ── Logged summary ────────────────────────────────────────────────────────
    total_logged = len(score_overrides) + len(ko_results)
    if total_logged:
        st.divider()
        c1, c2 = st.columns([4, 1])
        c1.subheader(f"📊 {total_logged} result(s) logged this session")
        if c2.button("🗑️ Clear all", type="secondary"):
            st.session_state.score_overrides.clear()
            st.session_state.ko_results.clear()
            st.rerun()

        if score_overrides:
            st.write("**Group stage:**")
            rows = []
            for no, (g1, g2) in sorted(score_overrides.items()):
                _m = next(x for x in matches if x.match_no == no)
                rows.append({"M#": no, "Home": teams[_m.team1_slot].name,
                              "Score": f"{g1} – {g2}", "Away": teams[_m.team2_slot].name})
            st.dataframe(pd.DataFrame(rows), hide_index=True)

        if ko_results:
            st.write("**Knockout:**")
            rows = [{"M#": no, "Winner": r["winner"], "Eliminated": r["loser"]}
                     for no, r in sorted(ko_results.items())]
            st.dataframe(pd.DataFrame(rows), hide_index=True)

