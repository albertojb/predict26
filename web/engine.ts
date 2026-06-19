// WC26 engine — TypeScript port of src/elo.py, src/rules.py, src/simulator.py.
// Embedded into the /api/predict26/simulate route. Keep this file as the canonical
// TS source; copy/paste into the route when redeploying.

export const DRAW_FACTOR = 0.30;
export const BASE_GOALS = 1.2;
export const GOAL_ELO_SCALE = 1000.0;
export const HOME_ELO_BONUS = 100;

export type Team = {
  slot: string;
  name: string;
  group: string;
  elo: number;
  is_host: boolean;
};

export type Match = {
  match_no: number;
  stage: string;
  team1_slot: string;
  team2_slot: string;
  date: string;
  venue: string;
  score_home: number | null;
  score_away: number | null;
  played: boolean;
};

export type Standing = {
  slot: string;
  name: string;
  group: string;
  elo: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
};

export type AssignThird = Record<string, Record<string, string>>;

export const isGroupStage = (m: Match) => m.stage.startsWith("Group");
export const matchGroup = (m: Match): string | null =>
  isGroupStage(m) ? m.stage.split(" ").pop()! : null;

export const points = (s: Standing) => 3 * s.wins + s.draws;
export const gd = (s: Standing) => s.gf - s.ga;
export const thirdCoeff = (s: Standing) =>
  points(s) * 1_000_000 + gd(s) * 1_000 + s.gf;

// ─── RNG ──────────────────────────────────────────────────────────────────────
// Deterministic mulberry32 — fast, seedable, good enough for Monte Carlo.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Knuth's Poisson sampler. λ stays small (<10) in this domain — fine.
export function poisson(lambda: number, rng: () => number): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

// ─── ELO probability ──────────────────────────────────────────────────────────
export const winProb = (e1: number, e2: number) =>
  1.0 / (1.0 + Math.pow(10, -(e1 - e2) / 400.0));

export function matchProbs(e1: number, e2: number): {
  pWin: number; pDraw: number; pLoss: number;
} {
  const we = winProb(e1, e2);
  const maxDraw = 2.0 * Math.min(we, 1.0 - we);
  const pDraw = DRAW_FACTOR * maxDraw;
  return { pWin: we - 0.5 * pDraw, pDraw, pLoss: (1.0 - we) - 0.5 * pDraw };
}

export function expectedGoals(e1: number, e2: number): [number, number] {
  const d = (e1 - e2) / GOAL_ELO_SCALE;
  return [BASE_GOALS * Math.exp(d), BASE_GOALS * Math.exp(-d)];
}

export function simulateMatch(e1: number, e2: number, rng: () => number): [number, number] {
  const [l1, l2] = expectedGoals(e1, e2);
  return [poisson(l1, rng), poisson(l2, rng)];
}

export function simulateKoMatch(
  e1: number, e2: number, rng: () => number,
): [number, number, boolean] {
  const [g1, g2] = simulateMatch(e1, e2, rng);
  if (g1 !== g2) return [g1, g2, g1 > g2];
  return [g1, g2, rng() < 0.5];
}

export const koAdvancementProb = (e1: number, e2: number) => {
  const { pWin, pDraw } = matchProbs(e1, e2);
  return pWin + pDraw * 0.5;
};

export const applyHostBonus = (elo: number, isHost: boolean, groupStage: boolean) =>
  isHost && groupStage ? elo + HOME_ELO_BONUS : elo;

// ─── Standings ────────────────────────────────────────────────────────────────
function newStanding(t: Team): Standing {
  return {
    slot: t.slot, name: t.name, group: t.group, elo: t.elo,
    played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0,
  };
}

export function computeGroupStandings(
  group: string,
  groupMatches: Match[],
  teamsInGroup: Team[],
): Standing[] {
  const by: Record<string, Standing> = {};
  for (const t of teamsInGroup) by[t.slot] = newStanding(t);

  for (const m of groupMatches) {
    if (!m.played || m.score_home == null || m.score_away == null) continue;
    const g1 = m.score_home, g2 = m.score_away;
    const t1 = by[m.team1_slot], t2 = by[m.team2_slot];
    if (!t1 || !t2) continue;
    t1.played++; t2.played++;
    t1.gf += g1; t1.ga += g2;
    t2.gf += g2; t2.ga += g1;
    if (g1 > g2) { t1.wins++; t2.losses++; }
    else if (g2 > g1) { t2.wins++; t1.losses++; }
    else { t1.draws++; t2.draws++; }
  }

  return sortStandings(Object.values(by), groupMatches);
}

function sortStandings(teams: Standing[], groupMatches: Match[]): Standing[] {
  const buckets = new Map<number, Standing[]>();
  for (const t of teams) {
    const p = points(t);
    if (!buckets.has(p)) buckets.set(p, []);
    buckets.get(p)!.push(t);
  }
  const sortedPts = [...buckets.keys()].sort((a, b) => b - a);
  const out: Standing[] = [];
  for (const p of sortedPts) {
    const tied = buckets.get(p)!;
    if (tied.length === 1) out.push(tied[0]);
    else out.push(...breakTies(tied, groupMatches));
  }
  return out;
}

function breakTies(tied: Standing[], groupMatches: Match[]): Standing[] {
  const h2h = computeH2H(tied, groupMatches);
  return [...tied].sort((a, b) => {
    const ha = h2h[a.slot], hb = h2h[b.slot];
    return (
      gd(b) - gd(a) ||
      b.gf - a.gf ||
      hb.pts - ha.pts ||
      hb.gd - ha.gd ||
      hb.gf - ha.gf ||
      b.wins - a.wins ||
      b.elo - a.elo ||
      a.name.localeCompare(b.name)
    );
  });
}

function computeH2H(
  subset: Standing[],
  groupMatches: Match[],
): Record<string, { pts: number; gd: number; gf: number }> {
  const slots = new Set(subset.map((t) => t.slot));
  const out: Record<string, { pts: number; gd: number; gf: number }> = {};
  for (const t of subset) out[t.slot] = { pts: 0, gd: 0, gf: 0 };
  for (const m of groupMatches) {
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

// ─── Third place ranking + bracket ────────────────────────────────────────────
export function rankThirdPlaced(
  all: Record<string, Standing[]>,
): Array<[string, Standing]> {
  const thirds: Array<[string, Standing]> = [];
  for (const [grp, st] of Object.entries(all)) {
    if (st.length >= 3) thirds.push([grp, st[2]]);
  }
  thirds.sort((a, b) => thirdCoeff(b[1]) - thirdCoeff(a[1]) || a[1].name.localeCompare(b[1].name));
  return thirds.slice(0, 8);
}

export function assignThirdBracket(
  qualifiedGroups: string[],
  table: AssignThird,
): Record<string, string> {
  const key = [...new Set(qualifiedGroups)].sort().join("");
  const entry = table[key];
  if (!entry) throw new Error(`No AssignThird entry for '${key}'`);
  return entry;
}

// ─── Slot resolution ──────────────────────────────────────────────────────────
export function resolveSlot(
  slot: string,
  teamsBySlot: Record<string, Team>,
  groupStandings: Record<string, Standing[]>,
  thirdBracket: Record<string, string>,
  koWinners: Record<number, string>,
  koRunnersUp: Record<number, string>,
): string | null {
  if (teamsBySlot[slot]) return teamsBySlot[slot].name;

  if (slot.length === 2 && /^\d$/.test(slot[0]) && /^[A-Za-z]$/.test(slot[1])) {
    const pos = parseInt(slot[0], 10) - 1;
    const grp = slot[1].toUpperCase();
    const st = groupStandings[grp] || [];
    return pos < st.length ? st[pos].name : null;
  }

  if (slot.startsWith("3-")) {
    const grp = thirdBracket[slot];
    if (!grp) return null;
    const st = groupStandings[grp] || [];
    return st.length >= 3 ? st[2].name : null;
  }

  if (slot.startsWith("W") && /^\d+$/.test(slot.slice(1))) {
    return koWinners[parseInt(slot.slice(1), 10)] ?? null;
  }
  if (slot.startsWith("RU") && /^\d+$/.test(slot.slice(2))) {
    return koRunnersUp[parseInt(slot.slice(2), 10)] ?? null;
  }
  return null;
}

// ─── Tournament simulation ────────────────────────────────────────────────────
export type Stage = "group" | "r32" | "r16" | "qf" | "sf" | "final" | "champion";
export const STAGES: Stage[] = ["group", "r32", "r16", "qf", "sf", "final", "champion"];

const KO_NEXT: Record<string, Stage> = {
  "Round of 32": "r16",
  "Round of 16": "qf",
  "Quarter-final": "sf",
  "Semi-final": "final",
  "Final": "champion",
};

export function simulateTournament(
  teamsBySlot: Record<string, Team>,
  matches: Match[],
  assignThird: AssignThird,
  rng: () => number,
  eloOverrides: Record<string, number> = {},
  koOverrides: Record<number, string> = {},
): Record<string, Stage> {
  const elo: Record<string, number> = {};
  for (const t of Object.values(teamsBySlot)) {
    elo[t.name] = eloOverrides[t.name] ?? t.elo;
  }

  // 1) Group stage
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

  // 2) Group standings
  const groupMatchMap: Record<string, Match[]> = {};
  for (const m of sim) {
    if (!isGroupStage(m)) continue;
    const g = matchGroup(m)!;
    (groupMatchMap[g] ||= []).push(m);
  }
  const groupTeamMap: Record<string, Team[]> = {};
  for (const t of Object.values(teamsBySlot)) {
    (groupTeamMap[t.group] ||= []).push(t);
  }
  const standings: Record<string, Standing[]> = {};
  for (const g of "ABCDEFGHIJKL") {
    standings[g] = computeGroupStandings(g, groupMatchMap[g] || [], groupTeamMap[g] || []);
  }

  const top8 = rankThirdPlaced(standings);
  const thirdBracket = assignThirdBracket(top8.map(([g]) => g), assignThird);

  // 3) Stage tracking
  const stage: Record<string, Stage> = {};
  for (const t of Object.values(teamsBySlot)) stage[t.name] = "group";
  for (const st of Object.values(standings)) {
    for (const ts of st.slice(0, 2)) stage[ts.name] = "r32";
  }
  for (const [, ts] of top8) stage[ts.name] = "r32";

  // 4) KO bracket
  const koWinners: Record<number, string> = {};
  const koRunnersUp: Record<number, string> = {};
  const koMatches = sim
    .filter((m) => !isGroupStage(m))
    .sort((a, b) => a.match_no - b.match_no);

  for (const m of koMatches) {
    if (!(m.stage in KO_NEXT)) continue;
    const t1 = resolveSlot(m.team1_slot, teamsBySlot, standings, thirdBracket, koWinners, koRunnersUp);
    const t2 = resolveSlot(m.team2_slot, teamsBySlot, standings, thirdBracket, koWinners, koRunnersUp);
    if (!t1 || !t2) continue;

    let winner: string, loser: string;
    if (m.match_no in koOverrides) {
      winner = koOverrides[m.match_no];
      loser = winner === t1 ? t2 : t1;
    } else {
      const [, , t1Wins] = simulateKoMatch(elo[t1], elo[t2], rng);
      [winner, loser] = t1Wins ? [t1, t2] : [t2, t1];
    }
    koWinners[m.match_no] = winner;
    koRunnersUp[m.match_no] = loser;
    stage[winner] = KO_NEXT[m.stage];
  }

  return stage;
}

export type MonteCarloCounts = Record<string, Record<Stage, number>>;

export function runMonteCarlo(
  teamsBySlot: Record<string, Team>,
  matches: Match[],
  assignThird: AssignThird,
  opts: {
    n: number;
    seed?: number;
    eloOverrides?: Record<string, number>;
    koOverrides?: Record<number, string>;
  },
): MonteCarloCounts {
  const seed = opts.seed ?? Math.floor(Math.random() * 1e9);
  const rng = mulberry32(seed);
  const counts: MonteCarloCounts = {};
  for (const t of Object.values(teamsBySlot)) {
    counts[t.name] = { group: 0, r32: 0, r16: 0, qf: 0, sf: 0, final: 0, champion: 0 };
  }
  for (let i = 0; i < opts.n; i++) {
    const r = simulateTournament(
      teamsBySlot, matches, assignThird, rng,
      opts.eloOverrides, opts.koOverrides,
    );
    for (const [name, st] of Object.entries(r)) counts[name][st]++;
  }
  return counts;
}
