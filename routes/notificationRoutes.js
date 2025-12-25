import express from "express";
import Notification from "../models/Notification.js";

const router = express.Router();

router.get("/", async (req, res) => {
  if (!req.user) return res.status(401).json([]);

  const notifications = await Notification.find({
    userId: req.user._id
  })
    .sort({ createdAt: -1 })
    .limit(30)
    .lean();

  res.json(notifications);
});

router.post("/:id/read", async (req, res) => {
  if (!req.user) return res.sendStatus(401);

  await Notification.updateOne(
    { _id: req.params.id, userId: req.user._id },
    { $set: { read: true } }
  );

  res.json({ ok: true });
});

export default router;
