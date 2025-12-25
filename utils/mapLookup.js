// backend/utils/mapLookup.js
import { getPG } from "../config/db.js";

// find mapping by steam OR rawg id
// usage:
//   await findMapping({ steamId: 730 })
//   await findMapping({ rawgId: "3498" })
// returns: row or null
export async function findMapping({ steamId = null, rawgId = null } = {}) {
  if (!steamId && !rawgId) {
    throw new Error("findMapping requires either steamId or rawgId");
  }

  const pool = getPG();
  if (!pool) throw new Error("Postgres pool not available");

  // who wins if both provided?
  // priority: steamId -> rawgId
  if (steamId) {
    const { rows } = await pool.query(
      `SELECT * FROM steam_rawg_map WHERE steam_id = $1 LIMIT 1`,
      [steamId]
    );
    if (rows.length > 0) return rows[0];
  }

  if (rawgId) {
    const { rows } = await pool.query(
      `SELECT * FROM steam_rawg_map WHERE rawg_id = $1 LIMIT 1`,
      [String(rawgId)]
    );
    if (rows.length > 0) return rows[0];
  }

  return null;
}

// simple boolean check
//   await hasMapping({ steamId: 730 })
export async function hasMapping({ steamId = null, rawgId = null } = {}) {
  const m = await findMapping({ steamId, rawgId });
  return m !== null;
}
