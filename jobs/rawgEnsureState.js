import { getPG } from "../config/db.js";

export async function ensureRawgSyncState() {
  const db = getPG();

  await db.query(`
    CREATE TABLE IF NOT EXISTS rawg_sync_state (
      id INT PRIMARY KEY DEFAULT 1,
      last_synced_at TIMESTAMPTZ NOT NULL
    )
  `);

  await db.query(`
    INSERT INTO rawg_sync_state (id, last_synced_at)
    VALUES (1, '2000-01-01')
    ON CONFLICT (id) DO NOTHING
  `);
}
