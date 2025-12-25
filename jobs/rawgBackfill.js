import fetch from "node-fetch";
import { getPG } from "../config/db.js";

const RAWG_KEY = process.env.RAWG_API_KEY;
const LOCK_ID = 88442222;

export async function backfillRawgDetails() {
  if (!RAWG_KEY) {
    throw new Error("RAWG_API_KEY missing from environment");
  }

  const db = getPG();

  const lock = await db.query(
    `SELECT pg_try_advisory_lock($1)`,
    [LOCK_ID]
  );

  if (!lock.rows[0].pg_try_advisory_lock) {
    console.log("[RAWG-BACKFILL] Already running, skipping");
    return;
  }

  try {
    const { rows } = await db.query(`
      SELECT rawg_id
      FROM games
      WHERE update_status=0
      ORDER BY rawg_updated DESC
    `);

    if (rows.length === 0) {
      console.log("[RAWG-BACKFILL] Nothing to backfill");
      return;
    }

    for (const row of rows) {
      const url = `https://api.rawg.io/api/games/${row.rawg_id}?key=${RAWG_KEY}`;
      const res = await fetch(url);

      if (res.status === 404) {
        console.warn(`[RAWG-BACKFILL] Game ${row.rawg_id} not found, skipping`);
        continue;
      }

      if (!res.ok) {
        console.warn(`[RAWG-BACKFILL] HTTP ${res.status}, stopping backfill`);
        return;
      }

      const g = await res.json();

      await db.query(`
        UPDATE games SET
          screenshots_count = $1,
          achievements_count = $2,
          game_series_count = $3,
          additions_count = $4,
          parents_count = $5,
          alternative_names = $6,
          rawg_updated = NOW()
        WHERE rawg_id = $7
      `, [
        g.screenshots_count,
        g.achievements_count,
        g.game_series_count,
        g.additions_count,
        g.parents_count,
        g.alternative_names ?? [],
        g.id
      ]);

      console.log(`[RAWG-BACKFILL] Filled ${g.name}`);
    }

  } finally {
    await db.query(`SELECT pg_advisory_unlock($1)`, [LOCK_ID]);
  }
}
