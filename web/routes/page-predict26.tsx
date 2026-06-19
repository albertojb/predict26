// Route: /predict26 (page)
// React UI for the WC 2026 simulator. Talks to:
//   GET  /api/predict26/data
//   POST /api/predict26/match-probs
//   POST /api/predict26/simulate

import { useEffect, useMemo, useState } from "react";

type Team = { slot: string; name: string; group: string; elo: number; is_host: boolean };
type Match = {
  match_no: number; stage: string; team1_slot: string; team2_slot: string;
  date: string; venue: string;
  score_home: number | null; score_away: number | null; played: boolean;
};
type Stage = "group" | "r32" | "r16" | "qf" | "sf" | "final" | "champion";
type Counts = Record<string, Record<Stage, number>>;
type DataResp = { teams: Record<string, Team>; matches: Match[]; assignThird: Record<string, Record<string, string>> };

const STAGE_LABEL: Record<Stage, string> = {
  group: "Group", r32: "R32", r16: "R16", qf: "QF", sf: "SF", final: "Final", champion: "Champion",
};

const theme = {
  bg: "#0b1220",
  panel: "#111a2e",
  panel2: "#16223b",
  border: "#243254",
  fg: "#e8edf5",
  muted: "#8aa0c2",
  accent: "#22d3a3",
  accent2: "#f5b942",
  win: "#22d3a3",
  draw: "#8aa0c2",
  loss: "#ef6b6b",
};

const fmtPct = (x: number) => `${(x * 100).toFixed(1)}%`;

export default function Predict26() {
  const [data, setData] = useState<DataResp | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"sim" | "groups" | "match" | "bracket">("sim");

  const [n, setN] = useState(5000);
  const [seed, setSeed] = useState(42);
  const [eloOverrides, setEloOverrides] = useState<Record<string, number>>({});
  const [results, setResults] = useState<{ counts: Counts; n: number; elapsedMs: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [simErr, setSimErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/predict26/data", { headers: { Accept: "application/json" } })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        setData(j);
      })
      .catch((e) => setLoadErr(String(e)));
  }, []);

  const teamNames = useMemo(() => {
    if (!data) return [] as string[];
    return Object.values(data.teams).map((t) => t.name).sort();
  }, [data]);

  const nameToElo = useMemo(() => {
    const m: Record<string, number> = {};
    if (data) for (const t of Object.values(data.teams)) m[t.name] = t.elo;
    return m;
  }, [data]);

  const runSim = async () => {
    if (running) return;
    setRunning(true); setSimErr(null);
    try {
      const r = await fetch("/api/predict26/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ n, seed: seed || undefined, eloOverrides }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setResults({ counts: j.counts, n: j.n, elapsedMs: j.elapsedMs });
    } catch (e) {
      setSimErr(String(e));
    } finally {
      setRunning(false);
    }
  };

  if (loadErr) {
    return (
      <div style={{ minHeight: "100vh", background: theme.bg, color: theme.fg, padding: 24, fontFamily: "system-ui,sans-serif" }}>
        <h1>Predict26</h1>
        <p style={{ color: theme.loss }}>Failed to load data: {loadErr}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ minHeight: "100vh", background: theme.bg, color: theme.fg, display: "grid", placeItems: "center", fontFamily: "system-ui,sans-serif" }}>
        <p style={{ color: theme.muted }}>Loading World Cup data…</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: theme.bg, color: theme.fg, fontFamily: "system-ui,sans-serif" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 20px 48px" }}>
        <Header data={data} />
        <Settings
          n={n} setN={setN}
          seed={seed} setSeed={setSeed}
          eloOverrides={eloOverrides}
          setEloOverrides={setEloOverrides}
          nameToElo={nameToElo}
          teamNames={teamNames}
          runSim={runSim}
          running={running}
          simErr={simErr}
          results={results}
        />
        <Tabs tab={tab} setTab={setTab} />
        {tab === "sim" && <SimTab results={results} nameToElo={nameToElo} eloOverrides={eloOverrides} />}
        {tab === "groups" && <GroupsTab data={data} />}
        {tab === "match" && <MatchTab teamNames={teamNames} nameToElo={nameToElo} eloOverrides={eloOverrides} />}
        {tab === "bracket" && <BracketTab data={data} results={results} nameToElo={nameToElo} eloOverrides={eloOverrides} />}
        <Footer />
      </div>
    </div>
  );
}

function Header({ data }: { data: DataResp }) {
  const played = data.matches.filter((m) => m.played).length;
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 28, letterSpacing: -0.5 }}>
          <span style={{ color: theme.accent }}>Predict</span>26
        </h1>
        <span style={{ color: theme.muted, fontSize: 14 }}>World Cup 2026 — ELO + Monte Carlo simulator</span>
      </div>
      <div style={{ color: theme.muted, fontSize: 13, marginTop: 6 }}>
        48 teams · {data.matches.length} matches · {played} real results locked
      </div>
    </div>
  );
}

function Tabs({ tab, setTab }: { tab: string; setTab: (t: any) => void }) {
  const tabs: [string, string][] = [
    ["sim", "Tournament Odds"],
    ["bracket", "Bracket"],
    ["groups", "Group Standings"],
    ["match", "Match Estimator"],
  ];
  return (
    <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${theme.border}`, margin: "20px 0 18px" }}>
      {tabs.map(([key, label]) => (
        <button
          key={key}
          onClick={() => setTab(key)}
          style={{
            background: tab === key ? theme.panel2 : "transparent",
            border: "none",
            borderBottom: `2px solid ${tab === key ? theme.accent : "transparent"}`,
            color: tab === key ? theme.fg : theme.muted,
            padding: "10px 16px",
            fontSize: 14,
            fontWeight: 500,
            cursor: "pointer",
            borderRadius: "6px 6px 0 0",
          }}
        >{label}</button>
      ))}
    </div>
  );
}

function Settings({
  n, setN, seed, setSeed, eloOverrides, setEloOverrides, nameToElo, teamNames,
  runSim, running, simErr, results,
}: any) {
  const [eloOpen, setEloOpen] = useState(false);
  const overrideCount = Object.keys(eloOverrides).length;

  return (
    <div style={{ background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 10, padding: 14, marginBottom: 8 }}>
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: theme.muted }}>
          Simulations
          <input
            type="number" min={500} max={50000} step={500} value={n}
            onChange={(e) => setN(Math.max(500, Math.min(50000, Number(e.target.value) || 5000)))}
            style={inputStyle}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: theme.muted }}>
          Seed (0 = random)
          <input
            type="number" min={0} value={seed}
            onChange={(e) => setSeed(Math.max(0, Number(e.target.value) || 0))}
            style={inputStyle}
          />
        </label>
        <button
          onClick={runSim}
          disabled={running}
          style={{
            background: running ? theme.panel2 : theme.accent,
            color: running ? theme.muted : "#08130c",
            border: "none", padding: "10px 18px", fontSize: 14, fontWeight: 700,
            borderRadius: 8, cursor: running ? "default" : "pointer",
            marginTop: 16,
          }}
        >{running ? "Running…" : results ? "Re-run simulation" : "Run simulation"}</button>
        <button
          onClick={() => setEloOpen((v) => !v)}
          style={{
            background: "transparent", color: theme.fg,
            border: `1px solid ${theme.border}`,
            padding: "10px 14px", fontSize: 13, borderRadius: 8, cursor: "pointer",
            marginTop: 16,
          }}
        >ELO overrides{overrideCount ? ` (${overrideCount})` : ""} {eloOpen ? "▾" : "▸"}</button>
        {results && (
          <span style={{ color: theme.muted, fontSize: 12, marginLeft: "auto", marginTop: 16 }}>
            {results.n.toLocaleString()} sims · {(results.elapsedMs / 1000).toFixed(2)}s
          </span>
        )}
      </div>

      {simErr && <p style={{ color: theme.loss, marginTop: 8, fontSize: 13 }}>Sim error: {simErr}</p>}

      {eloOpen && (
        <div style={{
          marginTop: 12, paddingTop: 12, borderTop: `1px solid ${theme.border}`,
          maxHeight: 280, overflowY: "auto",
          display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 8,
        }}>
          {teamNames.map((name: string) => {
            const base = nameToElo[name];
            const cur = eloOverrides[name] ?? base;
            const changed = cur !== base;
            return (
              <div key={name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <span style={{ flex: 1, color: changed ? theme.accent2 : theme.fg }}>{name}</span>
                <input
                  type="number" min={800} max={2500} step={10} value={cur}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    setEloOverrides((prev: any) => {
                      const next = { ...prev };
                      if (Number.isFinite(v) && v !== base) next[name] = v;
                      else delete next[name];
                      return next;
                    });
                  }}
                  style={{ ...inputStyle, width: 72, padding: "4px 6px" }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SimTab({ results, nameToElo, eloOverrides }: {
  results: { counts: Counts; n: number; elapsedMs: number } | null;
  nameToElo: Record<string, number>;
  eloOverrides: Record<string, number>;
}) {
  if (!results) {
    return (
      <div style={{ ...panelStyle, color: theme.muted, padding: 32, textAlign: "center" }}>
        Click <b>Run simulation</b> above to compute championship odds.
      </div>
    );
  }
  const rows = Object.entries(results.counts).map(([name, c]) => {
    const total = results.n;
    return {
      name,
      elo: eloOverrides[name] ?? nameToElo[name] ?? 0,
      champion: c.champion / total,
      finalist: (c.champion + c.final) / total,
      top4: (c.champion + c.final + c.sf) / total,
      top8: (c.champion + c.final + c.sf + c.qf) / total,
      qualify: 1 - c.group / total,
    };
  }).sort((a, b) => b.champion - a.champion);

  const maxChamp = rows[0]?.champion ?? 1;

  return (
    <div>
      <div style={{ ...panelStyle, marginBottom: 16 }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Championship odds — top 16</h3>
        {rows.slice(0, 16).map((r) => (
          <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, fontSize: 13 }}>
            <span style={{ width: 160, color: theme.fg }}>{r.name}</span>
            <div style={{ flex: 1, background: theme.panel2, height: 18, borderRadius: 3, overflow: "hidden" }}>
              <div style={{
                width: `${(r.champion / maxChamp) * 100}%`,
                background: theme.accent, height: "100%",
              }} />
            </div>
            <span style={{ width: 60, textAlign: "right", color: theme.fg, fontVariantNumeric: "tabular-nums" }}>
              {fmtPct(r.champion)}
            </span>
          </div>
        ))}
      </div>

      <div style={{ ...panelStyle, overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>#</th>
              <th style={{ ...thStyle, textAlign: "left" }}>Team</th>
              <th style={thStyle}>ELO</th>
              <th style={thStyle}>🏆 Champion</th>
              <th style={thStyle}>🥈 Finalist</th>
              <th style={thStyle}>Top 4</th>
              <th style={thStyle}>Top 8</th>
              <th style={thStyle}>Qualify</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.name}>
                <td style={{ ...tdStyle, color: theme.muted }}>{i + 1}</td>
                <td style={{ ...tdStyle, textAlign: "left" }}>{r.name}</td>
                <td style={tdStyle}>{r.elo}</td>
                <td style={{ ...tdStyle, color: theme.accent, fontWeight: 600 }}>{fmtPct(r.champion)}</td>
                <td style={tdStyle}>{fmtPct(r.finalist)}</td>
                <td style={tdStyle}>{fmtPct(r.top4)}</td>
                <td style={tdStyle}>{fmtPct(r.top8)}</td>
                <td style={tdStyle}>{fmtPct(r.qualify)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GroupsTab({ data }: { data: DataResp }) {
  const [group, setGroup] = useState("A");
  const groupLetters = "ABCDEFGHIJKL".split("");

  // Reuse the same standings logic client-side (simple recomputation)
  const standings = useMemo(() => {
    const teamsByGroup: Record<string, Team[]> = {};
    for (const t of Object.values(data.teams)) (teamsByGroup[t.group] ||= []).push(t);
    const out: Record<string, any[]> = {};
    for (const g of groupLetters) {
      const ts = teamsByGroup[g] || [];
      const st: Record<string, any> = {};
      for (const t of ts) st[t.slot] = { ...t, played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0 };
      for (const m of data.matches) {
        if (!m.stage.startsWith(`Group ${g}`)) continue;
        if (!m.played || m.score_home == null || m.score_away == null) continue;
        const t1 = st[m.team1_slot], t2 = st[m.team2_slot];
        t1.played++; t2.played++; t1.gf += m.score_home; t1.ga += m.score_away;
        t2.gf += m.score_away; t2.ga += m.score_home;
        if (m.score_home > m.score_away) { t1.wins++; t2.losses++; }
        else if (m.score_away > m.score_home) { t2.wins++; t1.losses++; }
        else { t1.draws++; t2.draws++; }
      }
      const arr = Object.values(st).map((s: any) => ({
        ...s, points: s.wins * 3 + s.draws, gd: s.gf - s.ga,
      }));
      arr.sort((a, b) =>
        b.points - a.points || b.gd - a.gd || b.gf - a.gf
        || b.wins - a.wins || b.elo - a.elo || a.name.localeCompare(b.name),
      );
      out[g] = arr;
    }
    return out;
  }, [data]);

  const st = standings[group] || [];

  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {groupLetters.map((g) => (
          <button
            key={g}
            onClick={() => setGroup(g)}
            style={{
              background: g === group ? theme.accent : theme.panel2,
              color: g === group ? "#08130c" : theme.fg,
              border: "none", padding: "6px 12px", borderRadius: 6, fontWeight: 600,
              cursor: "pointer", fontSize: 13,
            }}
          >Group {g}</button>
        ))}
      </div>
      <div style={{ ...panelStyle, overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>#</th>
              <th style={{ ...thStyle, textAlign: "left" }}>Team</th>
              <th style={thStyle}>ELO</th>
              <th style={thStyle}>Pld</th>
              <th style={thStyle}>W</th>
              <th style={thStyle}>D</th>
              <th style={thStyle}>L</th>
              <th style={thStyle}>GF</th>
              <th style={thStyle}>GA</th>
              <th style={thStyle}>GD</th>
              <th style={thStyle}>Pts</th>
            </tr>
          </thead>
          <tbody>
            {st.map((t: any, i: number) => {
              const advance = i < 2;
              return (
                <tr key={t.slot} style={{ background: advance ? "rgba(34,211,163,0.06)" : undefined }}>
                  <td style={{ ...tdStyle, color: advance ? theme.accent : theme.muted, fontWeight: 600 }}>{i + 1}</td>
                  <td style={{ ...tdStyle, textAlign: "left" }}>{t.name}</td>
                  <td style={tdStyle}>{t.elo}</td>
                  <td style={tdStyle}>{t.played}</td>
                  <td style={tdStyle}>{t.wins}</td>
                  <td style={tdStyle}>{t.draws}</td>
                  <td style={tdStyle}>{t.losses}</td>
                  <td style={tdStyle}>{t.gf}</td>
                  <td style={tdStyle}>{t.ga}</td>
                  <td style={tdStyle}>{t.gd > 0 ? `+${t.gd}` : t.gd}</td>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{t.points}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ color: theme.muted, fontSize: 12, marginTop: 8 }}>
        Top 2 advance directly · best 8 of the 12 third-placed teams also advance to R32
      </p>
    </div>
  );
}

function MatchTab({ teamNames, nameToElo, eloOverrides }: {
  teamNames: string[];
  nameToElo: Record<string, number>;
  eloOverrides: Record<string, number>;
}) {
  const [a, setA] = useState(teamNames[0] || "");
  const [b, setB] = useState(teamNames[1] || "");
  const [r, setR] = useState<any>(null);

  useEffect(() => {
    if (!a || !b || a === b) return;
    const e1 = eloOverrides[a] ?? nameToElo[a];
    const e2 = eloOverrides[b] ?? nameToElo[b];
    fetch("/api/predict26/match-probs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ elo1: e1, elo2: e2 }),
    }).then((r) => r.json()).then(setR).catch(() => setR(null));
  }, [a, b, nameToElo, eloOverrides]);

  if (!teamNames.length) return null;

  const e1 = eloOverrides[a] ?? nameToElo[a];
  const e2 = eloOverrides[b] ?? nameToElo[b];

  return (
    <div style={panelStyle}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: theme.muted }}>
          Team A
          <select value={a} onChange={(e) => setA(e.target.value)} style={inputStyle}>
            {teamNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: theme.muted }}>
          Team B
          <select value={b} onChange={(e) => setB(e.target.value)} style={inputStyle}>
            {teamNames.filter((n) => n !== a).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <p style={{ fontSize: 13, color: theme.muted, marginBottom: 12 }}>
        ELO: <b style={{ color: theme.fg }}>{a}</b> {e1} vs <b style={{ color: theme.fg }}>{b}</b> {e2} (Δ = {e1 - e2 >= 0 ? "+" : ""}{e1 - e2})
      </p>
      {r && !r.error && (
        <>
          <div style={{ display: "flex", height: 36, borderRadius: 6, overflow: "hidden", marginBottom: 16 }}>
            <div style={{ width: `${r.pWin * 100}%`, background: theme.win, display: "grid", placeItems: "center", fontSize: 12, color: "#08130c", fontWeight: 700 }}>
              {fmtPct(r.pWin)}
            </div>
            <div style={{ width: `${r.pDraw * 100}%`, background: theme.draw, display: "grid", placeItems: "center", fontSize: 12, color: "#08130c", fontWeight: 700 }}>
              {fmtPct(r.pDraw)}
            </div>
            <div style={{ width: `${r.pLoss * 100}%`, background: theme.loss, display: "grid", placeItems: "center", fontSize: 12, color: "#fff", fontWeight: 700 }}>
              {fmtPct(r.pLoss)}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10 }}>
            <Metric label={`${a} Win`} value={fmtPct(r.pWin)} color={theme.win} />
            <Metric label="Draw" value={fmtPct(r.pDraw)} color={theme.draw} />
            <Metric label={`${b} Win`} value={fmtPct(r.pLoss)} color={theme.loss} />
            <Metric label={`xG ${a}`} value={r.xg1.toFixed(2)} />
            <Metric label={`xG ${b}`} value={r.xg2.toFixed(2)} />
            <Metric label={`KO advance ${a}`} value={fmtPct(r.pAdv)} color={theme.accent2} />
          </div>
        </>
      )}
    </div>
  );
}

function BracketTab({ data, results, nameToElo, eloOverrides }: {
  data: DataResp;
  results: { counts: Counts; n: number; elapsedMs: number } | null;
  nameToElo: Record<string, number>;
  eloOverrides: Record<string, number>;
}) {
  const stages = ["Round of 32", "Round of 16", "Quarter-final", "Semi-final", "Final", "Third place"];
  const matchesByStage = useMemo(() => {
    const o: Record<string, Match[]> = {};
    for (const m of data.matches) if (!m.stage.startsWith("Group")) (o[m.stage] ||= []).push(m);
    for (const s of Object.keys(o)) o[s].sort((a, b) => a.match_no - b.match_no);
    return o;
  }, [data]);

  const champPct = (name?: string) => {
    if (!results || !name) return null;
    const c = results.counts[name];
    if (!c) return null;
    return c.champion / results.n;
  };

  return (
    <div>
      <p style={{ color: theme.muted, fontSize: 12, marginBottom: 12 }}>
        Knockout bracket with FIFA's slot labels. Run a simulation to see each team's championship odds (🏆).
      </p>
      {stages.map((stage) => {
        const ms = matchesByStage[stage] || [];
        if (!ms.length) return null;
        return (
          <div key={stage} style={{ marginBottom: 18 }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 14, color: theme.muted, textTransform: "uppercase", letterSpacing: 1 }}>{stage}</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 8 }}>
              {ms.map((m) => (
                <div key={m.match_no} style={{
                  background: theme.panel, border: `1px solid ${theme.border}`,
                  borderRadius: 8, padding: 10, fontSize: 12,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", color: theme.muted, fontSize: 11, marginBottom: 6 }}>
                    <span>M{m.match_no}</span>
                    <span>{m.date.slice(5, 10)} · {m.venue.split(",")[0].slice(0, 16)}</span>
                  </div>
                  <SlotRow slot={m.team1_slot} teams={data.teams} champPct={champPct} />
                  <div style={{ height: 1, background: theme.border, margin: "4px 0" }} />
                  <SlotRow slot={m.team2_slot} teams={data.teams} champPct={champPct} />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SlotRow({ slot, teams, champPct }: {
  slot: string; teams: Record<string, Team>; champPct: (n?: string) => number | null;
}) {
  // For seeded slots from teams, show the real team name; otherwise show the slot label
  const team = teams[slot];
  const label = team ? team.name : slotLabel(slot);
  const c = team ? champPct(team.name) : null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", color: team ? theme.fg : theme.muted }}>
      <span>{label}</span>
      {c !== null && c >= 0.005 && (
        <span style={{ color: theme.accent2, fontSize: 11 }}>🏆 {fmtPct(c)}</span>
      )}
    </div>
  );
}

function slotLabel(slot: string): string {
  if (slot.startsWith("3-")) return `Best 3rd · ${slot.slice(2)}`;
  if (/^\d[A-Z]$/.test(slot)) return `#${slot[0]} Group ${slot[1]}`;
  if (slot.startsWith("W")) return `Winner M${slot.slice(1)}`;
  if (slot.startsWith("RU")) return `Loser M${slot.slice(2)}`;
  return slot;
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: theme.panel2, padding: 10, borderRadius: 6 }}>
      <div style={{ fontSize: 11, color: theme.muted, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: color ?? theme.fg }}>{value}</div>
    </div>
  );
}

function Footer() {
  return (
    <div style={{ color: theme.muted, fontSize: 12, marginTop: 32, paddingTop: 16, borderTop: `1px solid ${theme.border}`, textAlign: "center" }}>
      ELO model · Poisson goals · Mulberry32 RNG · 12 groups + best 3rd bracket per FIFA 2026 reference
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: theme.panel2,
  border: `1px solid ${theme.border}`,
  color: theme.fg,
  padding: "6px 8px",
  borderRadius: 6,
  fontSize: 13,
  width: 110,
};

const panelStyle: React.CSSProperties = {
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 10,
  padding: 14,
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  padding: "8px 10px",
  textAlign: "center",
  color: theme.muted,
  fontWeight: 600,
  fontSize: 12,
  borderBottom: `1px solid ${theme.border}`,
};

const tdStyle: React.CSSProperties = {
  padding: "7px 10px",
  textAlign: "center",
  fontVariantNumeric: "tabular-nums",
  borderBottom: `1px solid ${theme.border}`,
};
