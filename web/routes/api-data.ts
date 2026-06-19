// Route: /api/predict26/data
// GET -> { teams, matches, assignThird }
// Reads source-of-truth JSON/CSV from the workspace so the GitHub repo + Streamlit
// app + zo.space all stay in sync.

import type { Context } from "hono";
import fs from "node:fs";

const DATA_DIR = "/home/workspace/predict26/data";

type Team = {
  slot: string; name: string; group: string; elo: number; is_host: boolean;
};

function loadTeams(): Record<string, Team> {
  const csv = fs.readFileSync(`${DATA_DIR}/teams.csv`, "utf8");
  const rows = csv.trim().split("\n").slice(1);
  const out: Record<string, Team> = {};
  for (const r of rows) {
    const [slot, name, group, elo, is_host] = r.split(",").map((s) => s.trim());
    out[slot] = {
      slot, name, group,
      elo: parseInt(elo, 10),
      is_host: is_host.toLowerCase() === "true",
    };
  }
  return out;
}

let cache: { teams: Record<string, Team>; matches: unknown[]; assignThird: unknown } | null = null;

function load() {
  if (cache) return cache;
  const teams = loadTeams();
  const matches = JSON.parse(fs.readFileSync(`${DATA_DIR}/schedule.json`, "utf8"));
  const assignThird = JSON.parse(fs.readFileSync(`${DATA_DIR}/assign_third.json`, "utf8"));
  cache = { teams, matches, assignThird };
  return cache;
}

export default async (c: Context) => {
  try {
    return c.json(load());
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
};
