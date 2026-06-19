// Route: /api/predict26/match-probs
// POST { elo1: number, elo2: number } -> { pWin, pDraw, pLoss, xg1, xg2, pAdv }

import type { Context } from "hono";

const DRAW_FACTOR = 0.30;
const BASE_GOALS = 1.2;
const GOAL_ELO_SCALE = 1000.0;

const winProb = (e1: number, e2: number) =>
  1.0 / (1.0 + Math.pow(10, -(e1 - e2) / 400.0));

function matchProbs(e1: number, e2: number) {
  const we = winProb(e1, e2);
  const maxDraw = 2.0 * Math.min(we, 1.0 - we);
  const pDraw = DRAW_FACTOR * maxDraw;
  return { pWin: we - 0.5 * pDraw, pDraw, pLoss: (1.0 - we) - 0.5 * pDraw };
}

function expectedGoals(e1: number, e2: number): [number, number] {
  const d = (e1 - e2) / GOAL_ELO_SCALE;
  return [BASE_GOALS * Math.exp(d), BASE_GOALS * Math.exp(-d)];
}

export default async (c: Context) => {
  let body: { elo1?: number; elo2?: number };
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid json" }, 400); }
  const e1 = Number(body.elo1), e2 = Number(body.elo2);
  if (!Number.isFinite(e1) || !Number.isFinite(e2)) {
    return c.json({ error: "elo1 and elo2 required (numbers)" }, 400);
  }
  const { pWin, pDraw, pLoss } = matchProbs(e1, e2);
  const [xg1, xg2] = expectedGoals(e1, e2);
  return c.json({
    pWin, pDraw, pLoss, xg1, xg2,
    pAdv: pWin + pDraw * 0.5,
    delta: e1 - e2,
  });
};
