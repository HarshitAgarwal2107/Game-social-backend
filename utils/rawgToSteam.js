import { getPG } from "../config/db.js";

export async function rawgToSteamAppId(rawgId) {
  const pg = getPG();
  const { rows } = await pg.query(
    `SELECT steam_id FROM steam_rawg_map WHERE rawg_id = $1 LIMIT 1`,
    [String(rawgId)]
  );
  if (!rows.length) return null;
  return Number(rows[0].steam_id);
}
