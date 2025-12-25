import fetch from "node-fetch";
import { getPG } from "../config/db.js";
import { ensureRawgSyncState } from "./rawgEnsureState.js";
const RAWG_KEY = process.env.RAWG_API_KEY;
const PAGE_SIZE = 40;
const LOCK_ID = 88442211;

/* ---------------- JSON NORMALIZATION ---------------- */
/* Always send valid JSON text to Postgres */
function toJson(value) {
  if (value == null) return null;

  if (typeof value === "string") {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return JSON.stringify(value);
    }
  }

  return JSON.stringify(value);
}

/* ---------------- CHECKPOINT HELPER ---------------- */
/* Save progress based on what is already stored */
async function checkpointLastSynced(db) {
  await db.query(`
    UPDATE rawg_sync_state
    SET last_synced_at = (
      SELECT MAX(rawg_updated)
      FROM games
      WHERE rawg_updated IS NOT NULL
    )
    WHERE id = 1
  `);
}

/* ---------------- MAIN SYNC ---------------- */

export async function syncRawgGames() {
  if (!RAWG_KEY) {
    throw new Error("RAWG_API_KEY missing from environment");
  }

  await ensureRawgSyncState();

  const db = getPG();

  const lock = await db.query(
    `SELECT pg_try_advisory_lock($1)`,
    [LOCK_ID]
  );

  if (!lock.rows[0].pg_try_advisory_lock) {
    console.log("[RAWG] Sync already running, skipping");
    return;
  }

  try {
    const { rows } = await db.query(
      `SELECT last_synced_at FROM rawg_sync_state WHERE id = 1`
    );

    const lastSynced =
      rows[0]?.last_synced_at?.toISOString().split("T")[0] || "2000-01-01";

    const today = new Date().toISOString().split("T")[0];

    let nextUrl =
      `https://api.rawg.io/api/games` +
      `?key=${RAWG_KEY}` +
      `&ordering=-updated` +
      `&dates=${lastSynced},${today}` +
      `&page_size=${PAGE_SIZE}`;

    while (nextUrl) {
      const res = await fetch(nextUrl);

      /* ---- END OF DATA ---- */
      if (res.status === 404) {
        console.warn("[RAWG] 404 — end of pagination, checkpointing");
        await checkpointLastSynced(db);
        break;
      }

      /* ---- TEMPORARY RAWG FAILURE ---- */
      if (res.status >= 500) {
        console.warn(
          `[RAWG] ${res.status} — RAWG temporary failure, checkpointing`
        );
        await checkpointLastSynced(db);
        return;
      }

      if (!res.ok) {
        throw new Error(`RAWG HTTP ${res.status}`);
      }

      const data = await res.json();

      for (const g of data.results || []) {
        await db.query(
          `
          INSERT INTO games (
            rawg_id,
            slug,
            name,
            name_original,
            released,
            background_image,
            suggestions_count,
            platforms,
            developers,
            publishers,
            genres,
            tags,
            esrb_rating,
            website,
            rawg_updated
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,$7,
            $8,$9,$10,$11,$12,$13,
            $14,$15
          )
          ON CONFLICT (rawg_id)
          DO UPDATE SET
            slug = EXCLUDED.slug,
            name = EXCLUDED.name,
            name_original = EXCLUDED.name_original,
            released = EXCLUDED.released,
            background_image = EXCLUDED.background_image,
            suggestions_count = EXCLUDED.suggestions_count,
            platforms = EXCLUDED.platforms,
            developers = EXCLUDED.developers,
            publishers = EXCLUDED.publishers,
            genres = EXCLUDED.genres,
            tags = EXCLUDED.tags,
            esrb_rating = EXCLUDED.esrb_rating,
            website = EXCLUDED.website,
            rawg_updated = EXCLUDED.rawg_updated
          `,
          [
            g.id,
            g.slug,
            g.name,
            g.name_original,
            g.released,
            g.background_image,
            g.suggestions_count,
            toJson(g.platforms ?? []),
            toJson(g.developers ?? []),
            toJson(g.publishers ?? []),
            toJson(g.genres ?? []),
            toJson(g.tags ?? []),
            toJson(g.esrb_rating),
            null,
            g.updated
          ]
        );
      }

      nextUrl = data.next;
    }

    await checkpointLastSynced(db);
    console.log("[RAWG] Sync completed");

  } catch (err) {
    console.error("[RAWG] Sync error — checkpointing progress", err);
    await checkpointLastSynced(db);
    throw err;
  } finally {
    await db.query(`SELECT pg_advisory_unlock($1)`, [LOCK_ID]);
  }
}
