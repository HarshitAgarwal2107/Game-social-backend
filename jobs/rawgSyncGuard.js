import { getPG } from "../config/db.js";
import { syncRawgGames } from "./rawgSync.js";
import { ensureRawgSyncState } from "./rawgEnsureState.js";
import { backfillRawgDetails } from "./rawgBackfill.js";
const MAX_AGE = 24 * 60 * 60 * 1000;

export async function syncIfStale() {
  await ensureRawgSyncState();

  const db = getPG();

  const { rows } = await db.query(
    `SELECT last_synced_at FROM rawg_sync_state WHERE id = 1`
  );

  const last = new Date(rows[0].last_synced_at).getTime();
  if (Date.now() - last > MAX_AGE) {
    await syncRawgGames();
    await backfillRawgDetails();
    console.log("[RAWG-Pipeline] Sync and Backfill successful")
  }else{
    console.log("[RAWG] Sync not needed.")
  }
}
