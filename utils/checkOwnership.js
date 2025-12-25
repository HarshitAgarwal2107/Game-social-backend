// backend/utils/checkOwnership.js
import SteamLibrary from "../models/SteamLibraries.js";
import { getPG } from "../config/db.js";

export async function checkOwnership(userId, rawgId) {
  if (!userId || !rawgId) return false;

  const pg = getPG();
  if (!pg) throw new Error("Postgres pool not available");

  // RAWG → Steam appid
  const { rows } = await pg.query(
    `SELECT steam_id FROM steam_rawg_map WHERE rawg_id = $1 LIMIT 1`,
    [String(rawgId)]
  );

  if (!rows.length) return false;

  const steamAppId = Number(rows[0].steam_id);

  // Check Mongo Steam library
  const owned = await SteamLibrary.exists({
    userId,
    "games.appid": steamAppId
  });

  return Boolean(owned);
}
