// Route: /api/predict26/simulate
// POST { n?, seed?, eloOverrides?, scoreOverrides?, koOverrides? }
//   -> { counts: { team: { stage: count } }, n, elapsedMs }
//
// Engine logic is duplicated here from web/engine.ts because zo.space routes
// cannot import sibling files. Keep engine.ts as the editing source; sync this
// file by running scripts/build-routes.sh.

import type { Context } from "hono";
import fs from "node:fs";

const DATA_DIR = "/home/workspace/predict26/data";

// ─── Types ───────────────────────────────────────────────────────────────────
type Team = { slot: string; name: string; group: string; elo: number; is_host: boolean };
type Match = {
  match_no: number; stage: string; team1_slot: string; team2_slot: string;
  date: string; venue: string;
  score_home: number | null; score_away: number | null; played: boolean;
};
type Standing = {
  slot: string; name: string; group: string; elo: number;
  played: number; wins: number; draws: number; losses: number; gf: number; ga: number;
};
type AssignThird = Record<string, Record<string, string>>;
type Stage = "group" | "r32" | "r16" | "qf" | "sf" | "final" | "champion";

// ─── Constants ───────────────────────────────────────────────────────────────
const DRAW_FACTOR = 0.30;
const BASE_GOALS = 1.2;
const GOAL_ELO_SCALE = 1000.0;
const HOME_ELO_BONUS = 100;

// ─── RNG + probability ───────────────────────────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poisson(lambda: number, rng: () => number): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng(); } while (p > L);
  return k - 1;
}

const winProb = (e1: number, e2: number) => 1.0 / (1.0 + Math.pow(10, -(e1 - e2) / 400.0));

function expectedGoals(e1: number, e2: number): [number, number] {
  const d = (e1 - e2) / GOAL_ELO_SCALE;
  return [BASE_GOALS * Math.exp(d), BASE_GOALS * Math.exp(-d)];
}

function simulateMatch(e1: number, e2: number, rng: () => number): [number, number] {
  const [l1, l2] = expectedGoals(e1, e2);
  return [poisson(l1, rng), poisson(l2, rng)];
}

function simulateKoMatch(e1: number, e2: number, rng: () => number): [number, number, boolean] {
  const [g1, g2] = simulateMatch(e1, e2, rng);
  if (g1 !== g2) return [g1, g2, g1 > g2];
  return [g1, g2, rng() < 0.5];
}

const applyHostBonus = (elo: number, h: boolean, g: boolean) => (h && g ? elo + HOME_ELO_BONUS : elo);

// ─── Standings ───────────────────────────────────────────────────────────────
const points = (s: Standing) => 3 * s.wins + s.draws;
const gd = (s: Standing) => s.gf - s.ga;
const thirdCoeff = (s: Standing) => points(s) * 1_000_000 + gd(s) * 1_000 + s.gf;

function newStanding(t: Team): Standing {
  return {
    slot: t.slot, name: t.name, group: t.group, elo: t.elo,
    played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0,
  };
}

function computeH2H(subset: Standing[], gms: Match[]) {
  const slots = new Set(subset.map((t) => t.slot));
  const out: Record<string, { pts: number; gd: number; gf: number }> = {};
  for (const t of subset) out[t.slot] = { pts: 0, gd: 0, gf: 0 };
  for (const m of gms) {
    if (!m.played || m.score_home == null || m.score_away == null) continue;
    if (!slots.has(m.team1_slot) || !slots.has(m.team2_slot)) continue;
    const g1 = m.score_home, g2 = m.score_away;
    out[m.team1_slot].gf += g1; out[m.team1_slot].gd += g1 - g2;
    out[m.team2_slot].gf += g2; out[m.team2_slot].gd += g2 - g1;
    if (g1 > g2) out[m.team1_slot].pts += 3;
    else if (g2 > g1) out[m.team2_slot].pts += 3;
    else { out[m.team1_slot].pts++; out[m.team2_slot].pts++; }
  }
  return out;
}

function breakTies(tied: Standing[], gms: Match[]): Standing[] {
  const h2h = computeH2H(tied, gms);
  return [...tied].sort((a, b) => {
    const ha = h2h[a.slot], hb = h2h[b.slot];
    return gd(b) - gd(a) || b.gf - a.gf
      || hb.pts - ha.pts || hb.gd - ha.gd || hb.gf - ha.gf
      || b.wins - a.wins || b.elo - a.elo || a.name.localeCompare(b.name);
  });
}

function sortStandings(teams: Standing[], gms: Match[]): Standing[] {
  const buckets = new Map<number, Standing[]>();
  for (const t of teams) {
    const p = points(t);
    if (!buckets.has(p)) buckets.set(p, []);
    buckets.get(p)!.push(t);
  }
  const out: Standing[] = [];
  for (const p of [...buckets.keys()].sort((a, b) => b - a)) {
    const tied = buckets.get(p)!;
    out.push(...(tied.length === 1 ? tied : breakTies(tied, gms)));
  }
  return out;
}

function computeGroupStandings(_g: string, gms: Match[], teamsInGroup: Team[]): Standing[] {
  const by: Record<string, Standing> = {};
  for (const t of teamsInGroup) by[t.slot] = newStanding(t);
  for (const m of gms) {
    if (!m.played || m.score_home == null || m.score_away == null) continue;
    const g1 = m.score_home, g2 = m.score_away;
    const t1 = by[m.team1_slot], t2 = by[m.team2_slot];
    if (!t1 || !t2) continue;
    t1.played++; t2.played++; t1.gf += g1; t1.ga += g2; t2.gf += g2; t2.ga += g1;
    if (g1 > g2) { t1.wins++; t2.losses++; }
    else if (g2 > g1) { t2.wins++; t1.losses++; }
    else { t1.draws++; t2.draws++; }
  }
  return sortStandings(Object.values(by), gms);
}

function rankThirdPlaced(all: Record<string, Standing[]>): Array<[string, Standing]> {
  const thirds: Array<[string, Standing]> = [];
  for (const [grp, st] of Object.entries(all)) if (st.length >= 3) thirds.push([grp, st[2]]);
  thirds.sort((a, b) =>
    thirdCoeff(b[1]) - thirdCoeff(a[1]) || a[1].name.localeCompare(b[1].name),
  );
  return thirds.slice(0, 8);
}

function assignThirdBracket(qg: string[], table: AssignThird): Record<string, string> {
  const key = [...new Set(qg)].sort().join("");
  const e = table[key];
  if (!e) throw new Error(`No AssignThird entry for '${key}'`);
  return e;
}

function resolveSlot(
  slot: string, teams: Record<string, Team>,
  standings: Record<string, Standing[]>, tb: Record<string, string>,
  ko: Record<number, string>, ru: Record<number, string>,
): string | null {
  if (teams[slot]) return teams[slot].name;
  if (slot.length === 2 && /^\d$/.test(slot[0]) && /^[A-Za-z]$/.test(slot[1])) {
    const pos = parseInt(slot[0], 10) - 1, g = slot[1].toUpperCase();
    const st = standings[g] || [];
    return pos < st.length ? st[pos].name : null;
  }
  if (slot.startsWith("3-")) {
    const g = tb[slot]; if (!g) return null;
    const st = standings[g] || [];
    return st.length >= 3 ? st[2].name : null;
  }
  if (slot.startsWith("W") && /^\d+$/.test(slot.slice(1))) return ko[parseInt(slot.slice(1), 10)] ?? null;
  if (slot.startsWith("RU") && /^\d+$/.test(slot.slice(2))) return ru[parseInt(slot.slice(2), 10)] ?? null;
  return null;
}

const isGroupStage = (m: Match) => m.stage.startsWith("Group");
const matchGroup = (m: Match) => (isGroupStage(m) ? m.stage.split(" ").pop()! : null);

const KO_NEXT: Record<string, Stage> = {
  "Round of 32": "r16",
  "Round of 16": "qf",
  "Quarter-final": "sf",
  "Semi-final": "final",
  "Final": "champion",
};

function simulateTournament(
  teamsBySlot: Record<string, Team>, matches: Match[], at: AssignThird,
  rng: () => number,
  eloOverrides: Record<string, number>, koOverrides: Record<number, string>,
): Record<string, Stage> {
  const elo: Record<string, number> = {};
  for (const t of Object.values(teamsBySlot)) elo[t.name] = eloOverrides[t.name] ?? t.elo;

  const sim: Match[] = [];
  for (const m of matches) {
    if (!isGroupStage(m)) { sim.push(m); continue; }
    if (m.played) { sim.push(m); continue; }
    const t1 = teamsBySlot[m.team1_slot], t2 = teamsBySlot[m.team2_slot];
    const e1 = applyHostBonus(elo[t1.name], t1.is_host, true);
    const e2 = applyHostBonus(elo[t2.name], t2.is_host, true);
    const [g1, g2] = simulateMatch(e1, e2, rng);
    sim.push({ ...m, score_home: g1, score_away: g2, played: true });
  }

  const gms: Record<string, Match[]> = {};
  for (const m of sim) if (isGroupStage(m)) (gms[matchGroup(m)!] ||= []).push(m);
  const gts: Record<string, Team[]> = {};
  for (const t of Object.values(teamsBySlot)) (gts[t.group] ||= []).push(t);

  const standings: Record<string, Standing[]> = {};
  for (const g of "ABCDEFGHIJKL") {
    standings[g] = computeGroupStandings(g, gms[g] || [], gts[g] || []);
  }
  const top8 = rankThirdPlaced(standings);
  const tb = assignThirdBracket(top8.map(([g]) => g), at);

  const stage: Record<string, Stage> = {};
  for (const t of Object.values(teamsBySlot)) stage[t.name] = "group";
  for (const st of Object.values(standings)) for (const ts of st.slice(0, 2)) stage[ts.name] = "r32";
  for (const [, ts] of top8) stage[ts.name] = "r32";

  const kow: Record<number, string> = {}, kru: Record<number, string> = {};
  const ko = sim.filter((m) => !isGroupStage(m)).sort((a, b) => a.match_no - b.match_no);
  for (const m of ko) {
    if (!(m.stage in KO_NEXT)) continue;
    const t1 = resolveSlot(m.team1_slot, teamsBySlot, standings, tb, kow, kru);
    const t2 = resolveSlot(m.team2_slot, teamsBySlot, standings, tb, kow, kru);
    if (!t1 || !t2) continue;
    let w: string, l: string;
    if (m.match_no in koOverrides) {
      w = koOverrides[m.match_no]; l = w === t1 ? t2 : t1;
    } else {
      const [, , t1w] = simulateKoMatch(elo[t1], elo[t2], rng);
      [w, l] = t1w ? [t1, t2] : [t2, t1];
    }
    kow[m.match_no] = w; kru[m.match_no] = l;
    stage[w] = KO_NEXT[m.stage];
  }
  return stage;
}

// ─── Data loading (cached) ───────────────────────────────────────────────────
let cache: { teams: Record<string, Team>; matches: Match[]; assignThird: AssignThird } | null = null;
function loadData() {
  if (cache) return cache;
  const csv = fs.readFileSync(`${DATA_DIR}/teams.csv`, "utf8");
  const teams: Record<string, Team> = {};
  for (const r of csv.trim().split("\n").slice(1)) {
    const [slot, name, group, elo, is_host] = r.split(",").map((s) => s.trim());
    teams[slot] = { slot, name, group, elo: parseInt(elo, 10), is_host: is_host.toLowerCase() === "true" };
  }
  const matches: Match[] = JSON.parse(fs.readFileSync(`${DATA_DIR}/schedule.json`, "utf8"));
  const assignThird: AssignThird = JSON.parse(fs.readFileSync(`${DATA_DIR}/assign_third.json`, "utf8"));
  cache = { teams, matches, assignThird };
  return cache;
}

// ─── Handler ─────────────────────────────────────────────────────────────────
export default async (c: Context) => {
  let body: {
    n?: number; seed?: number;
    eloOverrides?: Record<string, number>;
    scoreOverrides?: Record<string, [number, number]>;
    koOverrides?: Record<string, string>;
  } = {};
  try { body = await c.req.json(); } catch { /* allow empty body */ }

  const n = Math.max(1, Math.min(50_000, Math.floor(body.n ?? 5_000)));
  const seed = body.seed && body.seed > 0 ? body.seed : Math.floor(Math.random() * 1e9);
  const eloOverrides = body.eloOverrides ?? {};
  const scoreOverrides = body.scoreOverrides ?? {};
  const koOverridesRaw = body.koOverrides ?? {};
  const koOverrides: Record<number, string> = {};
  for (const [k, v] of Object.entries(koOverridesRaw)) koOverrides[parseInt(k, 10)] = v;

  let data;
  try { data = loadData(); }
  catch (err) { return c.json({ error: `data load failed: ${err}` }, 500); }

  // Apply score overrides up front
  const patched: Match[] = data.matches.map((m) => {
    const ov = scoreOverrides[m.match_no];
    if (ov) return { ...m, score_home: ov[0], score_away: ov[1], played: true };
    return m;
  });

  const start = Date.now();
  const rng = mulberry32(seed);
  const counts: Record<string, Record<Stage, number>> = {};
  for (const t of Object.values(data.teams)) {
    counts[t.name] = { group: 0, r32: 0, r16: 0, qf: 0, sf: 0, final: 0, champion: 0 };
  }
  try {
    for (let i = 0; i < n; i++) {
      const r = simulateTournament(data.teams, patched, data.assignThird, rng, eloOverrides, koOverrides);
      for (const [name, st] of Object.entries(r)) counts[name][st]++;
    }
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }

  return c.json({ counts, n, seed, elapsedMs: Date.now() - start });
};
