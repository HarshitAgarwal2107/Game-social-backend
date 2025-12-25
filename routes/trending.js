// routes/trending-composite.js
import express from "express";
import fetch from "node-fetch";
import { getPG } from "../config/db.js";
import {
  getMappingBySteamId,
  upsertMapping,
  autoMatchRawg
} from "../utils/steamRawgmap.js";

const router = express.Router();

const RAWG_KEY = process.env.RAWG_API_KEY;
const RAWG_BASE = "https://api.rawg.io/api/games";

// safe integer parse
const toInt = (v, d = 50) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.trunc(n), 200) : d;
};

// small batch runner to limit concurrency
async function batchMap(items, batchSize, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(fn));
    out.push(...results);
    await new Promise(r => setTimeout(r, 80));
  }
  return out;
}

// ensure RAWG game exists in games table
async function ensureRawgGame(client, rawgId) {
  const exists = await client.query(
    `SELECT 1 FROM games WHERE rawg_id = $1 LIMIT 1`,
    [rawgId]
  );
  if (exists.rowCount > 0) return;
  if (!RAWG_KEY) return;

  const r = await fetch(`${RAWG_BASE}/${rawgId}?key=${RAWG_KEY}`);
  if (!r.ok) return;

  const g = await r.json();

  await client.query(
    `INSERT INTO games (
      rawg_id, slug, name, name_original, description, description_raw, released,
      background_image, background_image_additional, suggestions_count,
      platforms, developers, publishers, genres, tags, esrb_rating, website,
      screenshots_count, achievements_count, game_series_count, additions_count,
      parents_count, alternative_names
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,
      $8,$9,$10,
      $11,$12,$13,$14,$15,$16,$17,
      $18,$19,$20,$21,$22,$23
    )
    ON CONFLICT (rawg_id) DO NOTHING`,
    [
      g.id,
      g.slug,
      g.name,
      g.name_original,
      g.description,
      g.description_raw,
      g.released,
      g.background_image,
      g.background_image_additional,
      g.suggestions_count,

      // jsonb columns
      JSON.stringify(g.platforms ?? []),
      JSON.stringify(g.developers ?? []),
      JSON.stringify(g.publishers ?? []),
      JSON.stringify(g.genres ?? []),
      JSON.stringify(g.tags ?? []),

      JSON.stringify(g.esrb_rating ?? null),
      g.website ?? null,

      g.screenshots_count ?? 0,
      g.achievements_count ?? 0,
      g.game_series_count ?? 0,
      g.additions_count ?? 0,
      g.parents_count ?? 0,

      // ✅ ARRAY (text[])
      Array.isArray(g.alternative_names)
        ? g.alternative_names
        : []
    ]
  );
}

router.get("/", async (req, res) => {
  try {
    const limit = toInt(req.query.limit || "100", 100);
    const pool = getPG();
    if (!pool) {
      return res.status(500).json({ error: "Postgres pool not available" });
    }

    const autoMatchEnabled = req.query.autoMatch !== "0";
    const autoThreshold = Number(req.query.autoThreshold ?? 0.6);
    const batchSize = Math.min(Math.max(Number(req.query.batchSize || 8), 1), 32);

    const client = await pool.connect();
    try {
      const trendingSql = `WITH ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY steam_id ORDER BY snapshot_time DESC) rn
        FROM steamspy_trending
      ),
      latest AS (
        SELECT * FROM ranked WHERE rn = 1
      )
      SELECT * FROM latest
      ORDER BY snapshot_time DESC
      LIMIT $1`;

      const { rows } = await client.query(trendingSql, [limit]);

      const processed = await batchMap(rows, batchSize, async (row) => {
        const steamId = Number(row.steam_id);
        const name = row.name ?? "";

        let mapping = await getMappingBySteamId(steamId).catch(() => null);

        if (!mapping && autoMatchEnabled) {
          const match = await autoMatchRawg(steamId, name, {
            threshold: autoThreshold
          }).catch(() => null);

          if (match?.rawgId) {
            mapping = await upsertMapping(steamId, String(match.rawgId), {
              source: "auto",
              confidence: match.score,
              metadata: match.candidate
            });
          }
        }

        if (mapping?.rawg_id) {
          await ensureRawgGame(client, mapping.rawg_id);
        }

        let game = null;
        if (mapping?.rawg_id) {
          const { rows } = await client.query(
            `SELECT rawg_id, slug, released, platforms, background_image
             FROM games WHERE rawg_id = $1`,
            [mapping.rawg_id]
          );
          game = rows[0] || null;
        }

        return {
          steam_id: String(row.steam_id),
          title: row.name,
          players: row.ccu,
          score: row.score_rank,
          snapshot_time: row.snapshot_time,
          rawg_id: mapping?.rawg_id ?? null,
          background_image: game?.background_image ?? null,
          mapping,
          games: game ? [game] : []
        };
      });

      return res.json(processed);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("trending-composite error:", err);
    return res.status(500).json({ error: "failed to fetch trending" });
  }
});

export default router;
