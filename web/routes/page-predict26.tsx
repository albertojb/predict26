// Route: /predict26 (page)
// Editorial sports-annual redesign. Talks to:
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

const KOFI_HANDLE = "kekojb";
const GITHUB_URL = "https://github.com/albertojb/predict26";
const AUTHOR_NAME = "Alberto Jiménez Bákit";

const ink = {
  paper: "#F2EBDC",
  paperDeep: "#E8DFCB",
  paperEdge: "#D9CDB1",
  rule: "#1A1410",
  ink: "#1A1410",
  inkSoft: "#3A2E25",
  muted: "#6B5A48",
  faint: "#9C8B73",
  oxblood: "#7A1E1E",
  oxbloodDeep: "#5C1414",
  gold: "#A87A2A",
  pitch: "#2F5230",
  draw: "#8C7A5C",
};

const fmtPct = (x: number) => `${(x * 100).toFixed(1)}%`;
const fmtPctTight = (x: number) => `${(x * 100).toFixed(0)}%`;

function injectHead() {
  if (typeof document === "undefined") return;
  if (document.getElementById("predict26-fonts")) return;

  document.title = "Predict26 — World Cup 2026 ELO & Monte-Carlo Simulator";

  const meta = (attrs: Record<string, string>) => {
    const key = attrs.name ? `name="${attrs.name}"` : `property="${attrs.property}"`;
    const existing = document.head.querySelector(`meta[${key}]`);
    const m = existing || document.createElement("meta");
    for (const [k, v] of Object.entries(attrs)) m.setAttribute(k, v);
    if (!existing) document.head.appendChild(m);
  };
  const desc = "An ELO and Monte-Carlo reckoning of the 2026 FIFA World Cup. 48 teams, 104 fixtures, ten thousand simulated futures.";
  meta({ name: "description", content: desc });
  meta({ name: "theme-color", content: "#7A1E1E" });
  meta({ property: "og:title", content: "Predict26 — The World Cup Annual" });
  meta({ property: "og:description", content: desc });
  meta({ property: "og:type", content: "website" });
  meta({ property: "og:url", content: "https://sail.zo.space/predict26" });

  const pre1 = document.createElement("link");
  pre1.rel = "preconnect"; pre1.href = "https://fonts.googleapis.com"; pre1.id = "predict26-fonts";
  document.head.appendChild(pre1);
  const pre2 = document.createElement("link");
  pre2.rel = "preconnect"; pre2.href = "https://fonts.gstatic.com"; pre2.crossOrigin = "anonymous";
  document.head.appendChild(pre2);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,700;9..144,900&family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600;700&display=swap";
  document.head.appendChild(link);
}

const LOGGED_LS_KEY = "predict26-logged-v1";

function loadLogged(): Record<number, [number, number]> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = JSON.parse(localStorage.getItem(LOGGED_LS_KEY) || "{}");
    const out: Record<number, [number, number]> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (Array.isArray(v) && v.length === 2 && Number.isFinite(v[0]) && Number.isFinite(v[1])) {
        out[+k] = [v[0] as number, v[1] as number];
      }
    }
    return out;
  } catch { return {}; }
}

export default function Predict26() {
  const [data, setData] = useState<DataResp | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"sim" | "groups" | "match" | "bracket" | "log">("sim");

  const [n, setN] = useState(5000);
  const [seed, setSeed] = useState(42);
  const [eloOverrides, setEloOverrides] = useState<Record<string, number>>({});
  const [results, setResults] = useState<{ counts: Counts; n: number; elapsedMs: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [simErr, setSimErr] = useState<string | null>(null);

  // User-logged scorelines. matchNo → [home, away]. Persists to localStorage.
  const [logged, setLoggedState] = useState<Record<number, [number, number]>>({});
  useEffect(() => { setLoggedState(loadLogged()); }, []);

  const setLogged = (matchNo: number, home: number | null, away: number | null) => {
    setLoggedState((prev) => {
      const next = { ...prev };
      if (home === null || away === null || !Number.isFinite(home) || !Number.isFinite(away)) {
        delete next[matchNo];
      } else {
        next[matchNo] = [home, away];
      }
      try { localStorage.setItem(LOGGED_LS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const clearLogged = () => {
    setLoggedState({});
    try { localStorage.removeItem(LOGGED_LS_KEY); } catch {}
  };
  const mergeLogged = (incoming: Record<number, [number, number]>) => {
    setLoggedState((prev) => {
      const next = { ...prev, ...incoming };
      try { localStorage.setItem(LOGGED_LS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  useEffect(() => {
    injectHead();
    fetch("/api/predict26/data", { headers: { Accept: "application/json" } })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setData(await r.json());
      })
      .catch((e) => setLoadErr(String(e)));
  }, []);

  // Overlay logged scores onto the canonical schedule.
  const patchedData = useMemo<DataResp | null>(() => {
    if (!data) return null;
    if (Object.keys(logged).length === 0) return data;
    return {
      ...data,
      matches: data.matches.map((m) => {
        const ov = logged[m.match_no];
        if (!ov) return m;
        return { ...m, score_home: ov[0], score_away: ov[1], played: true };
      }),
    };
  }, [data, logged]);

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
      // Split logged into group-stage scoreOverrides + KO koOverrides (winner name).
      const scoreOverrides: Record<number, [number, number]> = {};
      const koOverrides: Record<number, string> = {};
      if (data) {
        for (const m of data.matches) {
          const ov = logged[m.match_no];
          if (!ov) continue;
          if (m.stage.startsWith("Group")) {
            scoreOverrides[m.match_no] = ov;
          } else if (ov[0] !== ov[1]) {
            // KO match: derive winner team name if both slots resolve to a real team
            const t1 = data.teams[m.team1_slot]?.name;
            const t2 = data.teams[m.team2_slot]?.name;
            if (t1 && t2) koOverrides[m.match_no] = ov[0] > ov[1] ? t1 : t2;
          }
        }
      }
      const r = await fetch("/api/predict26/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ n, seed: seed || undefined, eloOverrides, scoreOverrides, koOverrides }),
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
      <Shell>
        <p style={{ color: ink.oxblood, fontFamily: "Manrope,sans-serif" }}>
          Failed to load data: {loadErr}
        </p>
      </Shell>
    );
  }
  if (!data) {
    return (
      <Shell>
        <p style={{ color: ink.muted, fontFamily: "Manrope,sans-serif", fontStyle: "italic" }}>
          Loading the tournament…
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <Masthead data={data} />
      <Dateline />
      <Controls
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
      <Sections tab={tab} setTab={setTab} loggedCount={Object.keys(logged).length} />
      <div style={{ marginTop: 28 }}>
        {tab === "sim" && <SimTab results={results} nameToElo={nameToElo} eloOverrides={eloOverrides} />}
        {tab === "groups" && <GroupsTab data={patchedData ?? data} />}
        {tab === "match" && <MatchTab teamNames={teamNames} nameToElo={nameToElo} eloOverrides={eloOverrides} />}
        {tab === "bracket" && <BracketTab data={patchedData ?? data} results={results} eloOverrides={eloOverrides} />}
        {tab === "log" && <LogTab data={data} logged={logged} setLogged={setLogged} clearLogged={clearLogged} mergeLogged={mergeLogged} />}
      </div>
      <Colophon />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: "100vh",
      background: `radial-gradient(ellipse at top, ${ink.paper} 0%, ${ink.paperDeep} 100%)`,
      color: ink.ink,
      fontFamily: "Manrope, system-ui, sans-serif",
      position: "relative",
    }}>
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none", opacity: 0.35, mixBlendMode: "multiply",
        backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.1  0 0 0 0 0.08  0 0 0 0 0.06  0 0 0 0.18 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`,
      }} />
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none",
        boxShadow: `inset 0 0 120px rgba(60,40,20,0.25)`,
      }} />
      <div style={{
        maxWidth: 1180,
        margin: "0 auto",
        padding: "44px 32px 64px",
        position: "relative",
        animation: "fadeUp 700ms ease-out both",
      }}>
        {children}
      </div>
      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
        @keyframes stretch { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        input[data-p26]:focus, select[data-p26]:focus, button[data-p26]:focus {
          outline: 2px solid ${ink.oxblood}; outline-offset: 2px;
        }
        ::selection { background: ${ink.oxblood}; color: ${ink.paper}; }
        body { background: ${ink.paper}; }
      `}</style>
    </div>
  );
}

function Masthead({ data }: { data: DataResp }) {
  const played = data.matches.filter((m) => m.played).length;
  const total = data.matches.length;
  return (
    <header style={{ marginBottom: 8 }}>
      <div style={{
        display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24,
        flexWrap: "wrap",
      }}>
        <div>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11, letterSpacing: 4, textTransform: "uppercase",
            color: ink.oxblood, fontWeight: 700, marginBottom: 14,
          }}>
            № 26 · The World Cup Annual
          </div>
          <h1 style={{
            margin: 0,
            fontFamily: "'Fraunces', serif",
            fontVariationSettings: "'opsz' 144, 'SOFT' 50",
            fontWeight: 900,
            fontSize: "clamp(56px, 9vw, 124px)",
            lineHeight: 0.86,
            letterSpacing: -3,
            color: ink.ink,
          }}>
            Predict<span style={{ color: ink.oxblood, fontStyle: "italic", fontWeight: 700 }}>26</span>.
          </h1>
          <p style={{
            margin: "14px 0 0",
            fontFamily: "'Fraunces', serif",
            fontStyle: "italic",
            fontWeight: 400,
            fontSize: "clamp(15px, 1.7vw, 19px)",
            color: ink.inkSoft,
            maxWidth: 620,
            lineHeight: 1.4,
          }}>
            An ELO &amp; Monte-Carlo reckoning of the 2026 FIFA World Cup —
            <span style={{ color: ink.muted }}> Forty-eight teams. One-hundred-and-four matches. Ten thousand simulated futures.</span>
          </p>
        </div>
        <div style={{
          minWidth: 220,
          borderLeft: `2px solid ${ink.rule}`,
          paddingLeft: 18,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          color: ink.inkSoft,
          lineHeight: 1.9,
          textTransform: "uppercase",
          letterSpacing: 1.2,
        }}>
          <div><span style={{ color: ink.muted }}>Edition</span> · USA·CAN·MEX</div>
          <div><span style={{ color: ink.muted }}>Teams</span> · {Object.keys(data.teams).length}</div>
          <div><span style={{ color: ink.muted }}>Fixtures</span> · {total}</div>
          <div><span style={{ color: ink.muted }}>Locked</span> · {played} of {total}</div>
        </div>
      </div>
    </header>
  );
}

function Dateline() {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14, margin: "30px 0 22px",
    }}>
      <div style={{ flex: 1, height: 2, background: ink.rule }} />
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10, letterSpacing: 3, color: ink.muted, textTransform: "uppercase",
      }}>
        Issue · The Numbers Room
      </div>
      <div style={{ flex: 1, height: 2, background: ink.rule }} />
    </div>
  );
}

function Controls({
  n, setN, seed, setSeed, eloOverrides, setEloOverrides, nameToElo, teamNames,
  runSim, running, simErr, results,
}: any) {
  const [eloOpen, setEloOpen] = useState(false);
  const overrideCount = Object.keys(eloOverrides).length;

  return (
    <section style={{
      background: ink.paper,
      border: `1.5px solid ${ink.rule}`,
      padding: "18px 20px",
      marginTop: 8,
      boxShadow: `4px 4px 0 ${ink.rule}`,
    }}>
      <div style={{
        display: "flex", alignItems: "flex-end", gap: 22, flexWrap: "wrap",
      }}>
        <Field label="Simulations">
          <input data-p26 type="number" min={500} max={50000} step={500} value={n}
            onChange={(e) => setN(Math.max(500, Math.min(50000, Number(e.target.value) || 5000)))}
            style={fieldInput()}
          />
        </Field>
        <Field label="Seed · 0 = random">
          <input data-p26 type="number" min={0} value={seed}
            onChange={(e) => setSeed(Math.max(0, Number(e.target.value) || 0))}
            style={fieldInput()}
          />
        </Field>
        <button data-p26
          onClick={runSim}
          disabled={running}
          style={{
            background: running ? ink.paperDeep : ink.oxblood,
            color: running ? ink.muted : ink.paper,
            border: `1.5px solid ${ink.rule}`,
            padding: "12px 22px",
            fontFamily: "'Fraunces', serif",
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: 0.4,
            cursor: running ? "default" : "pointer",
            boxShadow: running ? "none" : `3px 3px 0 ${ink.rule}`,
            transform: running ? "translate(3px,3px)" : "none",
            transition: "transform 120ms ease, box-shadow 120ms ease",
          }}
        >
          {running ? "Casting lots…" : results ? "Re-cast" : "Cast the bones"}
        </button>
        <button data-p26
          onClick={() => setEloOpen((v: boolean) => !v)}
          style={{
            background: "transparent",
            color: ink.ink,
            border: `1.5px solid ${ink.rule}`,
            padding: "12px 18px",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: 1.5,
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          ELO overrides{overrideCount ? ` · ${overrideCount}` : ""} {eloOpen ? "−" : "+"}
        </button>
        {results && (
          <div style={{
            marginLeft: "auto",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            color: ink.muted,
            letterSpacing: 1,
            textTransform: "uppercase",
          }}>
            {results.n.toLocaleString()} sims · {(results.elapsedMs / 1000).toFixed(2)}s
          </div>
        )}
      </div>

      {simErr && (
        <p style={{
          color: ink.oxblood, marginTop: 10, fontSize: 13, fontStyle: "italic",
          fontFamily: "'Fraunces', serif",
        }}>
          The bones refused. ({simErr})
        </p>
      )}

      {eloOpen && (
        <div style={{
          marginTop: 14, paddingTop: 14, borderTop: `1px dashed ${ink.faint}`,
          maxHeight: 320, overflowY: "auto",
          display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 10,
        }}>
          {teamNames.map((name: string) => {
            const base = nameToElo[name];
            const cur = eloOverrides[name] ?? base;
            const changed = cur !== base;
            return (
              <div key={name} style={{
                display: "flex", alignItems: "center", gap: 10, fontSize: 13,
                padding: "4px 6px",
                background: changed ? "rgba(122,30,30,0.05)" : "transparent",
              }}>
                <span style={{
                  flex: 1,
                  fontFamily: "'Fraunces', serif",
                  color: changed ? ink.oxblood : ink.ink,
                  fontWeight: changed ? 600 : 400,
                  fontSize: 14,
                }}>{name}</span>
                <input data-p26
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
                  style={{ ...fieldInput(), width: 82, padding: "5px 8px" }}
                />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10, letterSpacing: 2, color: ink.muted, textTransform: "uppercase",
      }}>{label}</span>
      {children}
    </label>
  );
}

function fieldInput(): React.CSSProperties {
  return {
    background: ink.paperDeep,
    border: `1.5px solid ${ink.rule}`,
    color: ink.ink,
    padding: "8px 10px",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 14,
    fontWeight: 600,
    width: 120,
  };
}

function Sections({ tab, setTab, loggedCount }: {
  tab: string; setTab: (t: any) => void; loggedCount: number;
}) {
  const tabs: [string, string, string][] = [
    ["sim", "I.", "Tournament Odds"],
    ["bracket", "II.", "The Bracket"],
    ["groups", "III.", "Group Tables"],
    ["match", "IV.", "Match Room"],
    ["log", "V.", loggedCount > 0 ? `Log Results · ${loggedCount}` : "Log Results"],
  ];
  return (
    <nav style={{
      marginTop: 26,
      display: "flex", gap: 0, flexWrap: "wrap",
      borderTop: `2px solid ${ink.rule}`,
      borderBottom: `2px solid ${ink.rule}`,
    }}>
      {tabs.map(([key, numeral, label], i) => (
        <button
          key={key}
          onClick={() => setTab(key)}
          data-p26
          style={{
            flex: "1 1 auto",
            background: tab === key ? ink.ink : "transparent",
            color: tab === key ? ink.paper : ink.ink,
            border: "none",
            borderLeft: i === 0 ? "none" : `1.5px solid ${ink.rule}`,
            padding: "14px 18px",
            fontFamily: "'Fraunces', serif",
            fontSize: 16,
            fontWeight: 600,
            cursor: "pointer",
            display: "flex", alignItems: "baseline", gap: 10, justifyContent: "center",
            textAlign: "left",
            transition: "background 160ms ease, color 160ms ease",
          }}
        >
          <span style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
            color: tab === key ? ink.gold : ink.oxblood, letterSpacing: 1,
          }}>{numeral}</span>
          {label}
        </button>
      ))}
    </nav>
  );
}

function SectionTitle({ kicker, title, lede }: { kicker: string; title: string; lede?: string }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10, letterSpacing: 3, color: ink.oxblood, textTransform: "uppercase",
        fontWeight: 700, marginBottom: 6,
      }}>{kicker}</div>
      <h2 style={{
        margin: 0,
        fontFamily: "'Fraunces', serif",
        fontWeight: 700, fontSize: "clamp(28px, 4vw, 44px)",
        letterSpacing: -1, lineHeight: 1.05, color: ink.ink,
      }}>{title}</h2>
      {lede && (
        <p style={{
          margin: "8px 0 0",
          fontFamily: "'Fraunces', serif", fontStyle: "italic",
          color: ink.muted, fontSize: 16, maxWidth: 700, lineHeight: 1.45,
        }}>{lede}</p>
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
      <article>
        <SectionTitle
          kicker="§ I — The Odds"
          title="No simulation cast yet."
          lede="Press Cast the bones above to set ten thousand parallel tournaments in motion."
        />
      </article>
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

  const top = rows[0];
  const second = rows[1];
  const third = rows[2];
  const maxChamp = top?.champion ?? 1;

  return (
    <article>
      <SectionTitle
        kicker="§ I — The Odds"
        title="A leaderboard, distilled."
        lede="Championship probability ranks the table. Read the leaderboard like league standings; read the bars like a betting market."
      />

      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 16, marginBottom: 28,
      }}>
        <Podium rank={1} row={top} accent={ink.oxblood} note="Bookmaker's favourite" />
        <Podium rank={2} row={second} accent={ink.gold} note="The closest threat" />
        <Podium rank={3} row={third} accent={ink.pitch} note="Outside chance" />
      </div>

      <div style={paperBlock()}>
        <BlockHead title="Champion · top sixteen" right={`scale to ${fmtPct(maxChamp)}`} />
        {rows.slice(0, 16).map((r, i) => (
          <div key={r.name} style={{
            display: "grid",
            gridTemplateColumns: "28px 1.8fr 4fr 72px",
            alignItems: "center", gap: 12,
            padding: "9px 0",
            borderBottom: i < 15 ? `1px dashed ${ink.faint}` : "none",
          }}>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace", color: ink.muted,
              fontSize: 12, fontWeight: 600,
            }}>{String(i + 1).padStart(2, "0")}</span>
            <span style={{
              fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 17, color: ink.ink,
            }}>{r.name}</span>
            <div style={{ position: "relative", height: 14, background: ink.paperDeep, border: `1px solid ${ink.faint}` }}>
              <div style={{
                position: "absolute", inset: 0, right: "auto",
                width: `${(r.champion / maxChamp) * 100}%`,
                background: i === 0 ? ink.oxblood : i < 3 ? ink.oxbloodDeep : ink.inkSoft,
                animation: `stretch 700ms cubic-bezier(0.2,0.7,0.2,1) ${i * 35}ms both`,
                transformOrigin: "left",
              }} />
            </div>
            <span style={{
              textAlign: "right",
              fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 14,
              color: i === 0 ? ink.oxblood : ink.ink,
            }}>{fmtPct(r.champion)}</span>
          </div>
        ))}
      </div>

      <div style={{ ...paperBlock(), marginTop: 20, overflowX: "auto" }}>
        <BlockHead title="Full ledger · all forty-eight" right="probabilities" />
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>#</th>
              <th style={{ ...thStyle, textAlign: "left" }}>Team</th>
              <th style={thStyle}>ELO</th>
              <th style={thStyle}>Champion</th>
              <th style={thStyle}>Finalist</th>
              <th style={thStyle}>Top 4</th>
              <th style={thStyle}>Top 8</th>
              <th style={thStyle}>Qualify</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.name} style={{ borderBottom: `1px dashed ${ink.faint}` }}>
                <td style={{ ...tdStyle, color: ink.muted }}>{String(i + 1).padStart(2, "0")}</td>
                <td style={{ ...tdStyle, textAlign: "left", fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 500 }}>{r.name}</td>
                <td style={tdStyle}>{r.elo}</td>
                <td style={{ ...tdStyle, color: ink.oxblood, fontWeight: 700 }}>{fmtPct(r.champion)}</td>
                <td style={tdStyle}>{fmtPct(r.finalist)}</td>
                <td style={tdStyle}>{fmtPct(r.top4)}</td>
                <td style={tdStyle}>{fmtPct(r.top8)}</td>
                <td style={tdStyle}>{fmtPct(r.qualify)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function Podium({ rank, row, accent, note }: {
  rank: number; row?: any; accent: string; note: string;
}) {
  if (!row) return null;
  const ordinal = rank === 1 ? "First" : rank === 2 ? "Second" : "Third";
  return (
    <div style={{
      background: ink.paper,
      border: `1.5px solid ${ink.rule}`,
      padding: "18px 18px 16px",
      position: "relative",
      boxShadow: `4px 4px 0 ${ink.rule}`,
    }}>
      <div style={{
        position: "absolute", top: -10, left: 16,
        background: accent, color: ink.paper,
        padding: "2px 10px",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10, letterSpacing: 2, textTransform: "uppercase", fontWeight: 700,
      }}>{ordinal}</div>
      <div style={{
        fontFamily: "'Fraunces', serif", fontSize: 26, fontWeight: 700,
        color: ink.ink, marginTop: 6, letterSpacing: -0.5, lineHeight: 1.1,
      }}>{row.name}</div>
      <div style={{
        display: "flex", alignItems: "baseline", gap: 8, marginTop: 12,
      }}>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontWeight: 700,
          fontSize: 38, color: accent, letterSpacing: -1,
        }}>{fmtPct(row.champion)}</span>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
          color: ink.muted, letterSpacing: 1, textTransform: "uppercase",
        }}>to lift it</span>
      </div>
      <div style={{
        marginTop: 8,
        display: "flex", justifyContent: "space-between",
        fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
        color: ink.muted, letterSpacing: 1, textTransform: "uppercase",
      }}>
        <span>ELO {row.elo}</span>
        <span>{fmtPctTight(row.top4)} top-4</span>
      </div>
      <div style={{
        marginTop: 10, paddingTop: 8, borderTop: `1px dashed ${ink.faint}`,
        fontFamily: "'Fraunces', serif", fontStyle: "italic", fontSize: 13, color: ink.inkSoft,
      }}>{note}.</div>
    </div>
  );
}

function GroupsTab({ data }: { data: DataResp }) {
  const [group, setGroup] = useState("A");
  const groupLetters = "ABCDEFGHIJKL".split("");

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
      arr.sort((a: any, b: any) =>
        b.points - a.points || b.gd - a.gd || b.gf - a.gf
        || b.wins - a.wins || b.elo - a.elo || a.name.localeCompare(b.name),
      );
      out[g] = arr;
    }
    return out;
  }, [data]);

  const st = standings[group] || [];

  return (
    <article>
      <SectionTitle
        kicker="§ III — Group Tables"
        title="Twelve groups, three rounds."
        lede="Top two advance directly to the Round of 32; the eight best third-placed sides scramble for the remaining berths."
      />

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {groupLetters.map((g) => (
          <button
            key={g}
            data-p26
            onClick={() => setGroup(g)}
            style={{
              background: g === group ? ink.ink : "transparent",
              color: g === group ? ink.paper : ink.ink,
              border: `1.5px solid ${ink.rule}`,
              padding: "8px 14px",
              fontFamily: "'Fraunces', serif",
              fontWeight: 600, fontSize: 14, cursor: "pointer",
              letterSpacing: 0.4,
            }}
          >Group {g}</button>
        ))}
      </div>
      <div style={{ ...paperBlock(), overflowX: "auto" }}>
        <BlockHead title={`Group ${group}`} right="standings" />
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
                <tr key={t.slot} style={{
                  background: advance ? "rgba(47,82,48,0.06)" : undefined,
                  borderBottom: `1px dashed ${ink.faint}`,
                }}>
                  <td style={{
                    ...tdStyle,
                    color: advance ? ink.pitch : ink.muted,
                    fontWeight: 700,
                  }}>{i + 1}</td>
                  <td style={{
                    ...tdStyle, textAlign: "left",
                    fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 500,
                  }}>{t.name}</td>
                  <td style={tdStyle}>{t.elo}</td>
                  <td style={tdStyle}>{t.played}</td>
                  <td style={tdStyle}>{t.wins}</td>
                  <td style={tdStyle}>{t.draws}</td>
                  <td style={tdStyle}>{t.losses}</td>
                  <td style={tdStyle}>{t.gf}</td>
                  <td style={tdStyle}>{t.ga}</td>
                  <td style={tdStyle}>{t.gd > 0 ? `+${t.gd}` : t.gd}</td>
                  <td style={{ ...tdStyle, fontWeight: 700, color: ink.ink }}>{t.points}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </article>
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
    <article>
      <SectionTitle
        kicker="§ IV — Match Room"
        title="Any two sides, side by side."
        lede="Pick two teams. The model returns a Poisson-weighted scoreline expectation and a probability triptych."
      />
      <div style={{
        display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 18, marginBottom: 22,
        alignItems: "end",
      }}>
        <Field label="Home / Team A">
          <select data-p26 value={a} onChange={(e) => setA(e.target.value)} style={{ ...fieldInput(), width: "100%", fontFamily: "'Fraunces', serif", fontSize: 16 }}>
            {teamNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
        <div style={{
          fontFamily: "'Fraunces', serif", fontStyle: "italic", color: ink.oxblood,
          fontSize: 22, paddingBottom: 6,
        }}>vs.</div>
        <Field label="Away / Team B">
          <select data-p26 value={b} onChange={(e) => setB(e.target.value)} style={{ ...fieldInput(), width: "100%", fontFamily: "'Fraunces', serif", fontSize: 16 }}>
            {teamNames.filter((n) => n !== a).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
      </div>
      <p style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
        color: ink.muted, letterSpacing: 1, textTransform: "uppercase",
        marginBottom: 18,
      }}>
        ELO · {a} {e1} · {b} {e2} · Δ {e1 - e2 >= 0 ? "+" : ""}{e1 - e2}
      </p>

      {r && !r.error && (
        <div style={paperBlock()}>
          <BlockHead title="The triptych" right="WDL probabilities" />
          <div style={{
            display: "flex", height: 60, marginBottom: 22,
            border: `1.5px solid ${ink.rule}`,
            fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 15,
          }}>
            <div style={{
              width: `${r.pWin * 100}%`,
              background: ink.pitch, color: ink.paper,
              display: "grid", placeItems: "center",
              animation: "stretch 700ms ease-out both", transformOrigin: "left",
            }}>{fmtPct(r.pWin)}</div>
            <div style={{
              width: `${r.pDraw * 100}%`,
              background: ink.draw, color: ink.ink,
              display: "grid", placeItems: "center",
              animation: "stretch 700ms ease-out 100ms both", transformOrigin: "left",
            }}>{fmtPct(r.pDraw)}</div>
            <div style={{
              width: `${r.pLoss * 100}%`,
              background: ink.oxblood, color: ink.paper,
              display: "grid", placeItems: "center",
              animation: "stretch 700ms ease-out 200ms both", transformOrigin: "left",
            }}>{fmtPct(r.pLoss)}</div>
          </div>

          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 14,
          }}>
            <Metric label={`${a} Win`} value={fmtPct(r.pWin)} accent={ink.pitch} />
            <Metric label="Draw" value={fmtPct(r.pDraw)} accent={ink.draw} />
            <Metric label={`${b} Win`} value={fmtPct(r.pLoss)} accent={ink.oxblood} />
            <Metric label={`xG · ${a}`} value={r.xg1.toFixed(2)} accent={ink.ink} />
            <Metric label={`xG · ${b}`} value={r.xg2.toFixed(2)} accent={ink.ink} />
            <Metric label={`KO advance · ${a}`} value={fmtPct(r.pAdv)} accent={ink.gold} />
          </div>
        </div>
      )}
    </article>
  );
}

function LogTab({ data, logged, setLogged, clearLogged, mergeLogged }: {
  data: DataResp;
  logged: Record<number, [number, number]>;
  setLogged: (matchNo: number, home: number | null, away: number | null) => void;
  clearLogged: () => void;
  mergeLogged: (incoming: Record<number, [number, number]>) => void;
}) {
  const [fetchState, setFetchState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [fetchMsg, setFetchMsg] = useState<string>("");

  const groupedByStage = useMemo(() => {
    const groups: Record<string, Match[]> = {};
    for (const m of data.matches) (groups[m.stage] ||= []).push(m);
    for (const k of Object.keys(groups)) groups[k].sort((a, b) => a.match_no - b.match_no);
    return groups;
  }, [data]);

  // Order: A–L then KO stages in order.
  const stageOrder = useMemo(() => {
    const groupKeys = Object.keys(groupedByStage)
      .filter((s) => s.startsWith("Group "))
      .sort();
    const koKeys = ["Round of 32", "Round of 16", "Quarter-final", "Semi-final", "Third place", "Final"]
      .filter((s) => groupedByStage[s]);
    return [...groupKeys, ...koKeys];
  }, [groupedByStage]);

  const fetchFromWeb = async () => {
    setFetchState("loading"); setFetchMsg("");
    try {
      const r = await fetch("/api/predict26/fetch-results", { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const incoming: Record<number, [number, number]> = {};
      for (const [k, v] of Object.entries(j.results || {})) {
        if (Array.isArray(v) && v.length === 2) incoming[+k] = [v[0] as number, v[1] as number];
      }
      const count = Object.keys(incoming).length;
      mergeLogged(incoming);
      setFetchState("done");
      setFetchMsg(`Pulled ${count} result${count === 1 ? "" : "s"} from ${j.source || "the web"}.`);
    } catch (e) {
      setFetchState("error");
      setFetchMsg(String(e));
    }
  };

  const total = data.matches.length;
  const loggedCount = Object.keys(logged).length;
  const realPlayed = data.matches.filter((m) => m.played).length;

  return (
    <article>
      <SectionTitle
        kicker="§ V — Log Results"
        title="Replace the model with reality."
        lede="Enter scorelines as matches finish. Group tables and the bracket update at once; cast the bones again to refold the odds around what actually happened."
      />

      <div style={{
        ...paperBlock(), marginBottom: 18,
        display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap",
      }}>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
          color: ink.muted, letterSpacing: 1, textTransform: "uppercase",
        }}>
          {realPlayed} locked · <span style={{ color: ink.oxblood, fontWeight: 700 }}>{loggedCount} logged</span> · {total - realPlayed - loggedCount} pending
        </div>
        <button
          data-p26
          onClick={fetchFromWeb}
          disabled={fetchState === "loading"}
          style={{
            background: fetchState === "loading" ? ink.paperDeep : ink.pitch,
            color: ink.paper,
            border: `1.5px solid ${ink.rule}`,
            padding: "10px 16px",
            fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 14,
            cursor: fetchState === "loading" ? "default" : "pointer",
            boxShadow: `3px 3px 0 ${ink.rule}`,
          }}
        >
          {fetchState === "loading" ? "Pulling…" : "Auto-fetch from web"}
        </button>
        {loggedCount > 0 && (
          <button
            data-p26
            onClick={() => { if (confirm("Clear all logged results?")) clearLogged(); }}
            style={{
              background: "transparent", color: ink.ink,
              border: `1.5px solid ${ink.rule}`,
              padding: "10px 14px",
              fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
              letterSpacing: 1.5, textTransform: "uppercase", cursor: "pointer",
            }}
          >
            Clear logged
          </button>
        )}
        {fetchMsg && (
          <span style={{
            fontFamily: "'Fraunces', serif", fontStyle: "italic", fontSize: 14,
            color: fetchState === "error" ? ink.oxblood : ink.inkSoft,
          }}>{fetchMsg}</span>
        )}
      </div>

      {stageOrder.map((stage) => {
        const ms = groupedByStage[stage] || [];
        if (!ms.length) return null;
        return (
          <section key={stage} style={{ marginBottom: 20 }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 12, marginBottom: 10,
            }}>
              <h3 style={{
                margin: 0,
                fontFamily: "'Fraunces', serif", fontStyle: "italic",
                fontWeight: 600, fontSize: 18, color: ink.ink, letterSpacing: -0.3,
              }}>{stage}</h3>
              <div style={{ flex: 1, height: 1, background: ink.rule }} />
            </div>
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))",
              gap: 8,
            }}>
              {ms.map((m) => (
                <LogRow key={m.match_no} match={m} teams={data.teams}
                  logged={logged[m.match_no]} setLogged={setLogged} />
              ))}
            </div>
          </section>
        );
      })}
    </article>
  );
}

function LogRow({ match, teams, logged, setLogged }: {
  match: Match; teams: Record<string, Team>;
  logged: [number, number] | undefined;
  setLogged: (matchNo: number, home: number | null, away: number | null) => void;
}) {
  const t1 = teams[match.team1_slot];
  const t2 = teams[match.team2_slot];
  const hasTeams = !!t1 && !!t2;
  const isReal = match.played && match.score_home != null && !logged;
  const isLogged = !!logged;

  const [h, setH] = useState<string>(() => logged ? String(logged[0]) : "");
  const [a, setA] = useState<string>(() => logged ? String(logged[1]) : "");
  useEffect(() => {
    setH(logged ? String(logged[0]) : "");
    setA(logged ? String(logged[1]) : "");
  }, [logged]);

  const commit = (newH: string, newA: string) => {
    const ph = newH.trim() === "" ? null : parseInt(newH, 10);
    const pa = newA.trim() === "" ? null : parseInt(newA, 10);
    if (ph == null || pa == null || !Number.isFinite(ph) || !Number.isFinite(pa)) {
      setLogged(match.match_no, null, null);
    } else {
      setLogged(match.match_no, Math.max(0, ph), Math.max(0, pa));
    }
  };

  const label1 = t1?.name ?? slotLabel(match.team1_slot);
  const label2 = t2?.name ?? slotLabel(match.team2_slot);

  return (
    <div style={{
      background: isLogged ? "rgba(122,30,30,0.04)" : isReal ? "rgba(47,82,48,0.05)" : ink.paper,
      border: `1.5px solid ${ink.rule}`,
      padding: "10px 12px",
      display: "grid",
      gridTemplateColumns: "minmax(120px, 1fr) 60px auto 60px minmax(120px, 1fr)",
      gap: 8, alignItems: "center",
      opacity: hasTeams ? 1 : 0.55,
    }}>
      <div style={{
        textAlign: "right",
        fontFamily: "'Fraunces', serif",
        fontSize: hasTeams ? 15 : 12, fontStyle: hasTeams ? "normal" : "italic",
        fontWeight: hasTeams ? 600 : 400, color: hasTeams ? ink.ink : ink.muted,
        minWidth: 0,
        wordWrap: "break-word",
        wordBreak: "break-word",
      }}>{label1}</div>
      <input
        data-p26
        type="number" min={0} max={99} step={1}
        value={isReal ? String(match.score_home) : h}
        disabled={!hasTeams || isReal}
        onChange={(e) => { setH(e.target.value); commit(e.target.value, a); }}
        placeholder="–"
        style={{
          background: isReal ? ink.paperDeep : ink.paper,
          border: `1.5px solid ${ink.rule}`,
          color: ink.ink,
          padding: "6px 6px",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 18, fontWeight: 700, textAlign: "center",
          width: "100%",
        }}
      />
      <span style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
        color: ink.muted, letterSpacing: 1, textAlign: "center",
      }}>
        M{String(match.match_no).padStart(3, "0")}<br/>
        <span style={{ color: ink.faint, fontSize: 9 }}>{match.date.slice(5, 10)}</span>
      </span>
      <input
        data-p26
        type="number" min={0} max={99} step={1}
        value={isReal ? String(match.score_away) : a}
        disabled={!hasTeams || isReal}
        onChange={(e) => { setA(e.target.value); commit(h, e.target.value); }}
        placeholder="–"
        style={{
          background: isReal ? ink.paperDeep : ink.paper,
          border: `1.5px solid ${ink.rule}`,
          color: ink.ink,
          padding: "6px 6px",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 18, fontWeight: 700, textAlign: "center",
          width: "100%",
        }}
      />
      <div style={{
        textAlign: "left",
        fontFamily: "'Fraunces', serif",
        fontSize: hasTeams ? 15 : 12, fontStyle: hasTeams ? "normal" : "italic",
        fontWeight: hasTeams ? 600 : 400, color: hasTeams ? ink.ink : ink.muted,
        minWidth: 0,
        wordWrap: "break-word",
        wordBreak: "break-word",
      }}>{label2}</div>
    </div>
  );
}

// ─── Greedy bracket projection ─────────────────────────────────────────────────
// Projects which team fills every KO slot using real results + ELO for unplayed.
// confirmed=true  → result is locked by actual played matches
// confirmed=false → name is the ELO-based projection, not yet decided
const PROJ_DRAW_ELO_GAP = 50;

function projectBracket(
  data: DataResp,
  eloOverrides: Record<string, number>,
): Record<string, { name: string; confirmed: boolean }> {
  const elo: Record<string, number> = {};
  for (const t of Object.values(data.teams)) elo[t.name] = eloOverrides[t.name] ?? t.elo;

  type ProjRow = { slot: string; name: string; elo: number; pts: number; gd: number; gf: number; wins: number };
  const teamsByGroup: Record<string, Team[]> = {};
  for (const t of Object.values(data.teams)) (teamsByGroup[t.group] ||= []).push(t);

  const standings: Record<string, ProjRow[]> = {};
  const groupCounts: Record<string, { played: number; total: number }> = {};

  for (const g of "ABCDEFGHIJKL") {
    const gTeams = teamsByGroup[g] || [];
    const st: Record<string, ProjRow> = {};
    for (const t of gTeams) st[t.slot] = { slot: t.slot, name: t.name, elo: t.elo, pts: 0, gd: 0, gf: 0, wins: 0 };

    const gms = data.matches.filter((m) => m.stage === `Group ${g}`);
    groupCounts[g] = { played: 0, total: gms.length };

    for (const m of gms) {
      const r1 = st[m.team1_slot], r2 = st[m.team2_slot];
      if (!r1 || !r2) continue;
      let g1: number, g2: number;
      if (m.played && m.score_home != null && m.score_away != null) {
        g1 = m.score_home; g2 = m.score_away;
        groupCounts[g].played++;
      } else {
        const t1 = data.teams[m.team1_slot], t2 = data.teams[m.team2_slot];
        const e1 = (elo[t1?.name ?? ""] ?? 1500) + (t1?.is_host ? 100 : 0);
        const e2 = (elo[t2?.name ?? ""] ?? 1500) + (t2?.is_host ? 100 : 0);
        if (Math.abs(e1 - e2) <= PROJ_DRAW_ELO_GAP) { g1 = 0; g2 = 0; }
        else if (e1 > e2) { g1 = 1; g2 = 0; }
        else { g1 = 0; g2 = 1; }
      }
      r1.gf += g1; r1.gd += g1 - g2; r2.gf += g2; r2.gd += g2 - g1;
      if (g1 > g2) { r1.pts += 3; r1.wins++; }
      else if (g2 > g1) { r2.pts += 3; r2.wins++; }
      else { r1.pts++; r2.pts++; }
    }

    standings[g] = Object.values(st).sort((a, b) =>
      (b.pts - a.pts) || (b.gd - a.gd) || (b.gf - a.gf) || (b.wins - a.wins) ||
      (b.elo - a.elo) || a.name.localeCompare(b.name),
    );
  }

  // Best 8 third-placed teams
  const thirds = Object.entries(standings)
    .filter(([, st]) => st.length >= 3)
    .map(([g, st]) => ({ g, r: st[2] }));
  thirds.sort((a, b) =>
    (b.r.pts * 1_000_000 + b.r.gd * 1_000 + b.r.gf) -
    (a.r.pts * 1_000_000 + a.r.gd * 1_000 + a.r.gf) ||
    a.r.name.localeCompare(b.r.name),
  );
  const top8 = thirds.slice(0, 8);
  const atKey = [...new Set(top8.map((x) => x.g))].sort().join("");
  const thirdBracket: Record<string, string> = data.assignThird[atKey] ?? {};

  const result: Record<string, { name: string; confirmed: boolean }> = {};

  for (const [g, st] of Object.entries(standings)) {
    const done = groupCounts[g].played === groupCounts[g].total;
    if (st[0]) result[`1${g}`] = { name: st[0].name, confirmed: done };
    if (st[1]) result[`2${g}`] = { name: st[1].name, confirmed: done };
  }
  const allGroupsDone = Object.values(groupCounts).every((c) => c.played === c.total);
  for (const [slot, grp] of Object.entries(thirdBracket)) {
    const st = standings[grp];
    if (st?.[2]) result[slot] = { name: st[2].name, confirmed: allGroupsDone };
  }

  const KO_STAGES = new Set(["Round of 32", "Round of 16", "Quarter-final", "Semi-final", "Final", "Third place"]);
  for (const m of [...data.matches].sort((a, b) => a.match_no - b.match_no)) {
    if (!KO_STAGES.has(m.stage)) continue;
    const p1 = result[m.team1_slot] ?? null;
    const p2 = result[m.team2_slot] ?? null;
    if (!p1 || !p2) continue;

    let winner: { name: string; confirmed: boolean };
    let loser: { name: string; confirmed: boolean };

    if (m.played && m.score_home != null && m.score_away != null) {
      const t1w = m.score_home >= m.score_away; // >= covers draw (shouldn't happen in KO but defensive)
      winner = { name: t1w ? p1.name : p2.name, confirmed: true };
      loser = { name: t1w ? p2.name : p1.name, confirmed: true };
    } else {
      const e1 = elo[p1.name] ?? 1500, e2 = elo[p2.name] ?? 1500;
      const t1w = e1 >= e2;
      winner = { name: t1w ? p1.name : p2.name, confirmed: false };
      loser = { name: t1w ? p2.name : p1.name, confirmed: false };
    }
    result[`W${m.match_no}`] = winner;
    result[`RU${m.match_no}`] = loser;
  }

  return result;
}

function BracketTab({ data, results, eloOverrides }: {
  data: DataResp;
  results: { counts: Counts; n: number; elapsedMs: number } | null;
  eloOverrides: Record<string, number>;
}) {
  const stages = ["Round of 32", "Round of 16", "Quarter-final", "Semi-final", "Final", "Third place"];
  const matchesByStage = useMemo(() => {
    const o: Record<string, Match[]> = {};
    for (const m of data.matches) if (!m.stage.startsWith("Group")) (o[m.stage] ||= []).push(m);
    for (const s of Object.keys(o)) o[s].sort((a, b) => a.match_no - b.match_no);
    return o;
  }, [data]);

  const projection = useMemo(() => projectBracket(data, eloOverrides), [data, eloOverrides]);

  const champPct = (name?: string) => {
    if (!results || !name) return null;
    const c = results.counts[name];
    if (!c) return null;
    return c.champion / results.n;
  };

  // Build bracket tree showing match relationships
  const bracketTree = useMemo(() => {
    const tree: Record<string, { incoming: string[]; nextStage?: string; nextMatches: number[] }> = {};
    for (const m of data.matches) {
      if (m.stage.startsWith("Group")) continue;
      if (!tree[`M${m.match_no}`]) tree[`M${m.match_no}`] = { incoming: [], nextMatches: [] };
    }
    // Connect winners to next round
    for (const m of data.matches) {
      if (m.stage.startsWith("Group")) continue;
      const nextMatches = data.matches.filter(
        (nm) => (nm.team1_slot === `W${m.match_no}` || nm.team2_slot === `W${m.match_no}`),
      );
      const nextMatches3 = data.matches.filter(
        (nm) => (nm.team1_slot === `RU${m.match_no}` || nm.team2_slot === `RU${m.match_no}`),
      );
      tree[`M${m.match_no}`].nextMatches = [...nextMatches, ...nextMatches3].map((x) => x.match_no);
    }
    return tree;
  }, [data]);

  return (
    <article>
      <SectionTitle
        kicker="§ II — The Bracket"
        title="Forty-eight enter. One lifts."
        lede="Projected bracket based on ELO and live results. Italicised names are predicted, not yet confirmed. Run the simulation to overlay championship probability."
      />
      {stages.map((stage) => {
        const ms = matchesByStage[stage] || [];
        if (!ms.length) return null;
        return (
          <section key={stage} style={{ marginBottom: 26 }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 12, marginBottom: 12,
            }}>
              <h3 style={{
                margin: 0,
                fontFamily: "'Fraunces', serif",
                fontStyle: "italic", fontWeight: 600, fontSize: 22, color: ink.ink,
                letterSpacing: -0.5,
              }}>{stage}</h3>
              <div style={{ flex: 1, height: 1, background: ink.rule }} />
              <span style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                color: ink.muted, letterSpacing: 1.5, textTransform: "uppercase",
              }}>{ms.length} fixtures</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 10, position: "relative" }}>
              {ms.map((m) => {
                const nextMMs = bracketTree[`M${m.match_no}`]?.nextMatches || [];
                return (
                  <div key={m.match_no} style={{
                    background: ink.paper,
                    border: `1.5px solid ${ink.rule}`,
                    padding: 12,
                    fontSize: 13,
                    boxShadow: `2px 2px 0 ${ink.rule}`,
                    position: "relative",
                  }}>
                    <div style={{
                      display: "flex", justifyContent: "space-between",
                      fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                      color: ink.muted, letterSpacing: 1, marginBottom: 8,
                      textTransform: "uppercase",
                    }}>
                      <span>Match {String(m.match_no).padStart(3, "0")}</span>
                      <span>{m.date.slice(5, 10)} · {m.venue.split(",")[0].slice(0, 14)}</span>
                    </div>
                    <SlotRow slot={m.team1_slot} teams={data.teams} champPct={champPct} projection={projection} />
                    <div style={{
                      fontFamily: "'Fraunces', serif", fontStyle: "italic",
                      color: ink.oxblood, fontSize: 12, textAlign: "center",
                      margin: "2px 0",
                    }}>vs.</div>
                    <SlotRow slot={m.team2_slot} teams={data.teams} champPct={champPct} projection={projection} />
                    {nextMMs.length > 0 && (
                      <div style={{
                        marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${ink.faint}`,
                        fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
                        color: ink.faint, lineHeight: 1.3,
                      }}>
                        → M{nextMMs.map((nm) => String(nm).padStart(3, "0")).join(", M")}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </article>
  );
}

function SlotRow({ slot, teams, champPct, projection }: {
  slot: string;
  teams: Record<string, Team>;
  champPct: (n?: string) => number | null;
  projection?: Record<string, { name: string; confirmed: boolean }>;
}) {
  const directTeam = teams[slot]; // only set for raw draw positions (A1, B2…) — never for KO slots
  const proj = directTeam
    ? { name: directTeam.name, confirmed: true }
    : (projection?.[slot] ?? null);
  const label = proj ? proj.name : slotLabel(slot);
  const c = proj ? champPct(proj.name) : null;
  const isProjected = !!proj && !proj.confirmed;

  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "4px 0",
      color: proj ? (isProjected ? ink.muted : ink.ink) : ink.faint,
      fontFamily: "'Fraunces', serif",
      fontSize: proj ? 15 : 13,
      fontWeight: proj ? (isProjected ? 400 : 600) : 400,
      fontStyle: isProjected || !proj ? "italic" : "normal",
    }}>
      <span>{label}</span>
      {c !== null && c >= 0.005 && (
        <span style={{
          color: isProjected ? ink.faint : ink.oxblood,
          fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 700,
        }}>{fmtPct(c)}</span>
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

function Metric({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{
      background: ink.paperDeep,
      border: `1px solid ${ink.faint}`,
      padding: "14px 14px 12px",
    }}>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
        color: ink.muted, letterSpacing: 1.5, textTransform: "uppercase",
        marginBottom: 6,
      }}>{label}</div>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 24, fontWeight: 700,
        color: accent, letterSpacing: -0.5,
      }}>{value}</div>
    </div>
  );
}

function paperBlock(): React.CSSProperties {
  return {
    background: ink.paper,
    border: `1.5px solid ${ink.rule}`,
    padding: "18px 20px",
    boxShadow: `3px 3px 0 ${ink.rule}`,
  };
}

function BlockHead({ title, right }: { title: string; right?: string }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "baseline",
      marginBottom: 14, paddingBottom: 10,
      borderBottom: `1.5px solid ${ink.rule}`,
    }}>
      <h4 style={{
        margin: 0,
        fontFamily: "'Fraunces', serif", fontStyle: "italic",
        fontWeight: 600, fontSize: 18, color: ink.ink, letterSpacing: -0.3,
      }}>{title}</h4>
      {right && (
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
          color: ink.muted, letterSpacing: 1.5, textTransform: "uppercase",
        }}>{right}</span>
      )}
    </div>
  );
}

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
  fontFamily: "'JetBrains Mono', monospace",
};

const thStyle: React.CSSProperties = {
  padding: "10px 8px",
  textAlign: "center",
  color: ink.muted,
  fontWeight: 700,
  fontSize: 10,
  letterSpacing: 1.5,
  textTransform: "uppercase",
  borderBottom: `2px solid ${ink.rule}`,
};

const tdStyle: React.CSSProperties = {
  padding: "9px 8px",
  textAlign: "center",
  fontVariantNumeric: "tabular-nums",
  fontWeight: 500,
  color: ink.inkSoft,
};

function Colophon() {
  return (
    <footer style={{
      marginTop: 52, paddingTop: 24,
      borderTop: `4px double ${ink.rule}`,
    }}>
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 24,
        marginBottom: 18,
      }}>
        <div>
          <div style={kickerStyle()}>The Model</div>
          <p style={colophonPara()}>
            ELO ratings convert to win probabilities by the standard logistic; goals are Poisson with
            <span style={{ fontFamily: "'JetBrains Mono', monospace" }}> λ = 1.2 · exp(ΔR/1000)</span>;
            knockouts settle ties by a coin-flip. Mulberry32 supplies the entropy.
          </p>
        </div>
        <div>
          <div style={kickerStyle()}>The Format</div>
          <p style={colophonPara()}>
            Twelve groups of four, three rounds. The top two from each group plus the eight best
            third-placed sides advance into a Round of 32. Hosts get +100 ELO in the group stage.
          </p>
        </div>
        <div>
          <div style={kickerStyle()}>The Source</div>
          <p style={colophonPara()}>
            Open source under <a href={GITHUB_URL + "/blob/main/LICENSE"} style={linkStyle()}>GNU GPL v3</a>.
            Built by <a href={GITHUB_URL} style={linkStyle()}>{AUTHOR_NAME}</a> · {" "}
            <a href={GITHUB_URL} style={linkStyle()}>github.com/albertojb/predict26</a>.
          </p>
        </div>
        <div>
          <div style={kickerStyle()}>Buy the Author a Coffee</div>
          <a
            href={`https://ko-fi.com/${KOFI_HANDLE}`}
            target="_blank" rel="noopener noreferrer"
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              background: ink.oxblood, color: ink.paper,
              border: `1.5px solid ${ink.rule}`,
              padding: "10px 16px",
              fontFamily: "'Fraunces', serif", fontWeight: 700,
              fontSize: 14, letterSpacing: 0.3,
              textDecoration: "none",
              boxShadow: `3px 3px 0 ${ink.rule}`,
              marginTop: 4,
            }}
          >
            <span>☕</span> Ko-fi · ko-fi.com/{KOFI_HANDLE}
          </a>
        </div>
      </div>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        paddingTop: 16, borderTop: `1px solid ${ink.faint}`, flexWrap: "wrap", gap: 12,
      }}>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
          color: ink.muted, letterSpacing: 2, textTransform: "uppercase",
        }}>
          Predict26 · The World Cup Annual · MMXXVI
        </span>
        <span style={{
          fontFamily: "'Fraunces', serif", fontStyle: "italic", fontSize: 13, color: ink.muted,
        }}>
          Set in Fraunces, Manrope &amp; JetBrains Mono. Printed on the cloud.
        </span>
      </div>
    </footer>
  );
}

function kickerStyle(): React.CSSProperties {
  return {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10, letterSpacing: 2.5, color: ink.oxblood,
    textTransform: "uppercase", fontWeight: 700, marginBottom: 8,
  };
}
function colophonPara(): React.CSSProperties {
  return {
    margin: 0,
    fontFamily: "'Fraunces', serif", fontSize: 14, color: ink.inkSoft,
    lineHeight: 1.5,
  };
}
function linkStyle(): React.CSSProperties {
  return {
    color: ink.oxblood,
    textDecoration: "underline",
    textDecorationStyle: "dotted",
    textUnderlineOffset: 3,
  };
}
