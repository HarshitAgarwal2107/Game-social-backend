import express from "express";
import { getPG } from "../config/db.js";

const router = express.Router();

router.get("/games", async (req, res) => {
  try {
    const {
      q,
      genres = "",
      platforms = ""
    } = req.query;

    if (!q || q.length < 3) return res.json([]);

    const pg = getPG();

    const where = [];
    const values = [];
    let idx = 1;

    where.push(`name ILIKE $${idx}`);
    values.push(`%${q}%`);
    idx++;

    where.push(`suggestions_count IS NOT NULL`);

    if (genres) {
      where.push(`genres ?| $${idx}`);
      values.push(genres.split(","));
      idx++;
    }

    if (platforms) {
      where.push(`platforms ?| $${idx}`);
      values.push(platforms.split(","));
      idx++;
    }

    const orderBy = `
      similarity(name, $${idx}) DESC,
      suggestions_count DESC
    `;
    values.push(q);

    const sql = `
      SELECT rawg_id, name, suggestions_count
      FROM games
      WHERE ${where.join(" AND ")}
      ORDER BY ${orderBy}
      LIMIT 15
    `;

    const { rows } = await pg.query(sql, values);
    res.json(rows);
  } catch (e) {
    console.error("[SEARCH ERROR]", e);
    res.status(500).json([]);
  }
});

export default router;
