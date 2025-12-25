// backend/routes/gameLookup.js
import express from "express";
import { getPG } from "../config/db.js";

const router = express.Router();

function parseArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    const s = val.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed;
      if (typeof parsed === "object") return Object.values(parsed).map(String);
    } catch (e) {}
    return s.split(",").map(x => x.trim()).filter(Boolean);
  }
  return [String(val)];
}

// GET /api/game/rawg/:rawgId
router.get("/:rawgId", async (req, res) => {
  const rawgId = req.params.rawgId;
  if (!/^\d+$/.test(rawgId)) return res.status(400).json({ error: "rawgId must be numeric" });

  const pg = getPG();
  if (!pg) return res.status(500).json({ error: "Postgres pool not initialized" });

  try {
    const q = await pg.query(
      `SELECT rawg_id, slug, name, name_original,  released,
              background_image,  suggestions_count,
              platforms, developers, publishers, genres, tags, esrb_rating, 
              screenshots_count, achievements_count, game_series_count, additions_count,
              parents_count, alternative_names
       FROM games WHERE rawg_id = $1 LIMIT 1`,
      [Number(rawgId)]
    );

    if (!q.rows.length) return res.status(404).json({ error: "Game not found" });

    const row = q.rows[0];
    const description = row.description_raw || row.description || "";

    const result = {
      rawg_id: row.rawg_id ?? null,
      slug: row.slug ?? null,
      name: row.name ?? null,
      name_original: row.name_original ?? null,
      description,
      released: row.released ?? null,
      background_image: row.background_image ?? null,
      background_image_additional: row.background_image_additional ?? null,
      suggestions_count: row.suggestions_count ?? null,
      platforms: parseArray(row.platforms),
      developers: parseArray(row.developers),
      publishers: parseArray(row.publishers),
      genres: parseArray(row.genres),
      tags: parseArray(row.tags),
      esrb_rating: row.esrb_rating ?? null,
      website: row.website ?? null,
      screenshots_count: row.screenshots_count ?? 0,
      achievements_count: row.achievements_count ?? 0,
      game_series_count: row.game_series_count ?? 0,
      additions_count: row.additions_count ?? 0,
      parents_count: row.parents_count ?? 0,
      alternative_names: parseArray(row.alternative_names)
    };

    return res.json(result);
  } catch (err) {
    console.error("game lookup error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
