// Route: /api/predict26/fetch-results
// GET -> { results: { matchNo: [home, away] }, source, found, queried }
//
// Pulls completed match results from ESPN's public FIFA World Cup scoreboard
// (no API key, no cost). Matches them against our schedule by team name + date.

import type { Context } from "hono";
import fs from "node:fs";

const DATA_DIR = "/home/workspace/predict26/data";

type Team = { slot: string; name: string; group: string; elo: number; is_host: boolean };
type Match = {
  match_no: number; stage: string; team1_slot: string; team2_slot: string;
  date: string; venue: string;
  score_home: number | null; score_away: number | null; played: boolean;
};

function loadTeams(): Record<string, Team> {
  const csv = fs.readFileSync(`${DATA_DIR}/teams.csv`, "utf8");
  const rows = csv.trim().split("\n").slice(1);
  const out: Record<string, Team> = {};
  for (const r of rows) {
    const [slot, name, group, elo, is_host] = r.split(",").map((s) => s.trim());
    out[slot] = { slot, name, group, elo: parseInt(elo, 10), is_host: is_host.toLowerCase() === "true" };
  }
  return out;
}

// Normalize a team name for matching: lowercase, strip diacritics, strip non-letters,
// then map known variants to a canonical key.
const NAME_ALIASES: Record<string, string> = {
  // Our short forms → ESPN canonical
  "republicofkorea": "southkorea",
  "korearepublic": "southkorea",
  "repofkorea": "southkorea",
  "czechrep": "czechia",
  "czechrepublic": "czechia",
  "republicofireland": "ireland",
  "northmacedonia": "macedonia",
  "ivorycoast": "cotedivoire",
  "us": "usa",
  "unitedstates": "usa",
  "unitedstatesofamerica": "usa",
  "bosniaherzegovina": "bosnia",
  "bosniaandherzegovina": "bosnia",
  "capeverde": "capeverde",
  "saudiarabia": "saudiarabia",
  "newzealand": "newzealand",
  "newcaledonia": "newcaledonia",
  "southafrica": "southafrica",
  "domrepublic": "dominicanrepublic",
  "dr": "dominicanrepublic",
};
function nameKey(s: string): string {
  if (!s) return "";
  const norm = s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, "");
  return NAME_ALIASES[norm] ?? norm;
}

async function fetchEspnDate(yyyymmdd: string): Promise<any[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${yyyymmdd}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return [];
    const j: any = await r.json();
    return Array.isArray(j.events) ? j.events : [];
  } catch {
    return [];
  }
}

export default async (c: Context) => {
  let teams: Record<string, Team>; let matches: Match[];
  try {
    teams = loadTeams();
    matches = JSON.parse(fs.readFileSync(`${DATA_DIR}/schedule.json`, "utf8"));
  } catch (err) {
    return c.json({ error: `failed to load schedule: ${err}` }, 500);
  }

  // Pull every date in the WC range that has an unplayed match. Cap at 60 dates
  // (the full WC window is ~40 days) to bound outbound requests.
  const today = new Date().toISOString().slice(0, 10);
  const dates = new Set<string>();
  for (const m of matches) {
    if (m.played) continue;
    if (m.date > today) continue;
    dates.add(m.date);
  }
  const dateList = [...dates].sort().slice(0, 60);

  const results: Record<number, [number, number]> = {};

  for (const date of dateList) {
    const espnDate = date.replace(/-/g, "");
    const events = await fetchEspnDate(espnDate);
    if (!events.length) continue;

    for (const ev of events) {
      const comp = ev?.competitions?.[0];
      if (!comp) continue;
      const status = comp?.status?.type;
      const completed = status?.completed === true || status?.state === "post";
      if (!completed) continue;
      const cs = comp.competitors || [];
      const home = cs.find((c: any) => c.homeAway === "home");
      const away = cs.find((c: any) => c.homeAway === "away");
      if (!home?.team || !away?.team) continue;
      const hk = nameKey(home.team.displayName || home.team.name || "");
      const ak = nameKey(away.team.displayName || away.team.name || "");
      const hs = Number(home.score);
      const as = Number(away.score);
      if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;

      // Find matching fixture on same date by team name
      const candidates = matches.filter((m) => m.date === date && !m.played);
      for (const m of candidates) {
        const n1 = nameKey(teams[m.team1_slot]?.name || "");
        const n2 = nameKey(teams[m.team2_slot]?.name || "");
        if (!n1 || !n2) continue;
        if (n1 === hk && n2 === ak) { results[m.match_no] = [hs, as]; break; }
        if (n1 === ak && n2 === hk) { results[m.match_no] = [as, hs]; break; }
      }
    }
  }

  return c.json({
    results,
    source: "ESPN",
    found: Object.keys(results).length,
    queried: dateList.length,
  });
};
