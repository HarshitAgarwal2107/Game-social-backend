import express from "express";
import GameReview from "../models/GameReview.js";
import { rawgToSteamAppId } from "../utils/rawgTosteam.js";
import { getPlaytime } from "../utils/getPlaytime.js";
import ReviewComment from "../models/ReviewComment.js";
import { PRO_TAGS, CON_TAGS } from "../shared/reviewTags.js";
import User from "../models/User.js";
import { createNotification } from "../utils/createNotification.js";
import { extractMentions } from "../utils/parseMentions.js";
import { deleteNotification } from "../utils/deleteNotification.js";
import { createActivity } from "../utils/createActivity.js";
import { deleteActivity } from "../utils/deleteActivity.js";

const normalizeTags = (arr, allowed) =>
  Array.isArray(arr)
    ? arr.filter(t => allowed.includes(t))
    : [];

const router = express.Router();
router.get("/user/:username", async (req, res) => {
  try {
    const user = await User.findOne(
      { username: req.params.username },
      { _id: 1, displayName: 1 }
    );

    if (!user) {
      return res.status(404).json([]);
    }

    const reviews = await GameReview.find({
      userId: user._id,
      visibility: "public"
    })
      .sort({ createdAt: -1 })
      .lean();

    res.json(reviews);
  } catch (e) {
    console.error("[GET USER REVIEWS]", e);
    res.status(500).json([]);
  }
});

/* ===========================
   ROUTE ENTRY DEBUG
=========================== */
router.use((req, res, next) => {
  next();
});

/* ===========================
   CREATE / UPDATE REVIEW
=========================== */

/* ===========================
   GET REVIEWS FOR GAME
=========================== */
router.get("/game/:rawgId", async (req, res) => {

  try {
    const reviews = await GameReview.find({
      rawgId: req.params.rawgId,
      visibility: "public"
    })
      .populate("userId", "displayName linkedAccounts")
      .sort({ createdAt: -1 })
      .lean();


    res.json(reviews);
  } catch (e) {
    console.error("[GET REVIEWS] ERROR", e);
    res.status(500).json([]);
  }
});
// UPDATE REVIEW
router.put("/:id", async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({});

    const review = await GameReview.findById(req.params.id);
    if (!review) return res.status(404).json({});

    if (String(review.userId) !== String(req.user._id)) {
      return res.status(403).json({});
    }

    const {
      verdict,
      title,
      body,
      pros,
      cons,
      completed
    } = req.body;

    review.verdict = verdict;
    review.title = title;
    review.body = body;
    review.pros = normalizeTags(pros, PRO_TAGS);
    review.cons = normalizeTags(cons, CON_TAGS);
    review.completed = completed;
    review.edited = true;

    await review.save();

    res.json(review);
  } catch (e) {
    console.error("[UPDATE REVIEW]", e);
    res.status(500).json({});
  }
});

/* ===========================
   LIKE REVIEW
=========================== */


router.post("/:id/unlike", async (req, res) => {

  try {
    if (!req.user) return res.status(401).json({});

    // Remove like
    await GameReview.findByIdAndUpdate(req.params.id, {
      $pull: { likes: req.user._id }
    });

    const review = await GameReview.findById(req.params.id);

    if (review && String(review.userId) !== String(req.user._id)) {

      // 🔔 DELETE notification
      await deleteNotification({
        userId: review.userId,
        type: "review_like",
        actorId: req.user._id,
        entityId: review._id
      });

      // 📣 DELETE activity
      await deleteActivity({
        userId: review.userId,
        actorId: req.user._id,
        type: "activity_review_like",
        entityId: review._id
      });
    }

    res.json({ ok: true });

  } catch (e) {
    console.error("[UNLIKE REVIEW] ERROR", e);
    res.status(500).json({ ok: false });
  }
});



router.get("/:reviewId/comments", async (req, res) => {
  try {
    const comments = await ReviewComment.find({
      reviewId: req.params.reviewId
    })
      .populate("userId", "displayName linkedAccounts")
      .sort({ createdAt: 1 })
      .lean();

    // 🔍 DEBUG CONFIRMATION (ADD THIS)
    

    res.json(comments);
  } catch (e) {
    console.error("[GET COMMENTS]", e);
    res.status(500).json([]);
  }
});

router.post("/:reviewId/comments", async (req, res) => {


  try {
    if (!req.user) {
      console.warn("[POST COMMENT] ❌ NO USER");
      return res.status(401).json({ error: "no_user" });
    }

    const { body, parentId } = req.body;

    if (!body?.trim()) {
      console.warn("[POST COMMENT] ❌ EMPTY BODY");
      return res.status(400).json({ error: "empty_body" });
    }


    const comment = await ReviewComment.create({
      reviewId: req.params.reviewId,
      userId: req.user._id,
      parentId: parentId || null,
      body
    });


    await comment.populate("userId", "displayName linkedAccounts");
// 🔔 Mentions in comment
const mentions = extractMentions(body);

if (mentions.length) {
  const users = await User.find({
    username: { $in: mentions }
  }).select("_id");

  for (const u of users) {
    if (String(u._id) === String(req.user._id)) continue;

    await createNotification({
      userId: u._id,
      type: "mention",
      actorId: req.user._id,
      entityId: comment._id,
      text: `${req.user.displayName} mentioned you in a comment`,
      url: `/reviews/${req.params.reviewId}`
    });
    await createActivity({
  userId: req.user._id,
  type: "comment",
  entityId: comment._id,
  text: `${req.user.displayName} commented on a review`,
  url: `/reviews/${req.params.reviewId}`
});

  }
}

  
    res.json(comment);
  } catch (e) {
    console.error("[POST COMMENT] 💥 ERROR", e);
    res.status(500).json({ error: "comment_create_failed" });
  } 
});

router.post("/comments/:id/like", async (req, res) => {
  if (!req.user) return res.status(401).json({});

  const comment = await ReviewComment.findById(req.params.id);
  if (!comment) return res.status(404).json({});

  const userId = String(req.user._id);
  const liked = comment.likes.some(id => String(id) === userId);

  if (liked) {
    // UNLIKE
    comment.likes = comment.likes.filter(id => String(id) !== userId);
  } else {
    // LIKE
    comment.likes.push(req.user._id);
  }

  await comment.save();

  // 🔔 DELETE notification on UNLIKE (ADD HERE)
  if (
    liked && // this request is UNLIKE
    String(comment.userId) !== String(req.user._id)
  ) {
    await deleteNotification({
      userId: comment.userId,
      type: "comment_like",
      actorId: req.user._id,
      entityId: comment._id
    });
  }

  // 🔔 CREATE notification on LIKE (if you added it earlier)
  if (
    !liked && // this request is LIKE
    String(comment.userId) !== String(req.user._id)
  ) {
    await createNotification({
      userId: comment.userId,
      type: "comment_like",
      actorId: req.user._id,
      entityId: comment._id,
      text: `${req.user.displayName} liked your comment`,
      url: `/reviews/${comment.reviewId}`
    });
  }

  res.json({
    liked: !liked,
    count: comment.likes.length
  });
});

// UPDATE COMMENT
router.put("/comments/:id", async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({});

    const comment = await ReviewComment.findById(req.params.id);
    if (!comment) return res.status(404).json({});

    if (String(comment.userId) !== String(req.user._id)) {
      return res.status(403).json({});
    }

    const { body } = req.body;
    if (!body?.trim()) return res.status(400).json({});

    comment.body = body;
    comment.edited = true;

    await comment.save();
    await comment.populate("userId", "displayName linkedAccounts");

    res.json(comment);
  } catch (e) {
    console.error("[UPDATE COMMENT]", e);
    res.status(500).json({});
  }
});

// DELETE COMMENT (with replies)
router.delete("/comments/:id", async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({});

    const comment = await ReviewComment.findById(req.params.id);
    if (!comment) return res.status(404).json({});

    if (String(comment.userId) !== String(req.user._id)) {
      return res.status(403).json({});
    }

    await ReviewComment.deleteMany({
      $or: [
        { _id: comment._id },
        { parentId: comment._id }
      ]
    });

    await deleteNotification({ entityId: comment._id });
    await deleteActivity({ entityId: comment._id });

    res.json({ ok: true });
  } catch (e) {
    console.error("[DELETE COMMENT]", e);
    res.status(500).json({});
  }
});


router.post("/:rawgId", async (req, res) => {
  try {
    if (!req.user) {
      console.warn("[POST REVIEW] no user");
      return res.status(401).json({});
    }

    const {
      verdict,
      title,
      body,
      pros,
      cons,
      completed
    } = req.body;

    if (!verdict) {
      console.warn("[POST REVIEW] missing verdict");
      return res.status(400).json({ error: "verdict required" });
    }


    const steamAppId = await rawgToSteamAppId(req.params.rawgId);

    const playtime = steamAppId
      ? await getPlaytime(req.user._id, steamAppId)
      : null;


    const review = await GameReview.findOneAndUpdate(
  { userId: req.user._id, rawgId: req.params.rawgId },
  {
    verdict,
    title,
    body,
    pros: normalizeTags(pros, PRO_TAGS),
    cons: normalizeTags(cons, CON_TAGS),
    completed,
    steamAppId,
    playtimeHours: playtime,
    edited: true,
    visibility: "public"
  },
  { upsert: true, new: true }
);


// 🔔 Mentions in review title/body
const mentions = extractMentions(`${title || ""} ${body || ""}`);

if (mentions.length) {
  const users = await User.find({
    username: { $in: mentions }
  }).select("_id");

  for (const u of users) {
    if (String(u._id) === String(req.user._id)) continue;

    await createNotification({
      userId: u._id,
      type: "mention",
      actorId: req.user._id,
      entityId: review._id,
      text: `${req.user.displayName} mentioned you in a review`,
      url: `/game/${req.params.rawgId}`
    });
    // AFTER review is saved
await createActivity({
  userId: req.user._id,
  type: "review",
  entityId: review._id,
  text: `${req.user.displayName} reviewed a game`,
  url: `/game/${req.params.rawgId}`
});

  }
}

    res.json(review);
  } catch (e) {
    console.error("[POST REVIEW] ERROR", e);
    res.status(500).json({ error: "review_save_failed" });
  }
});
router.post("/:id/like", async (req, res) => {

  try {
    if (!req.user) {
      console.warn("[LIKE REVIEW] no user");
      return res.status(401).json({});
    }

    await GameReview.findByIdAndUpdate(req.params.id, {
      $addToSet: { likes: req.user._id }
    });
    const review = await GameReview.findById(req.params.id);

if (
  review &&
  String(review.userId) !== String(req.user._id)
) {
  await createNotification({
    userId: review.userId,
    type: "review_like",
    actorId: req.user._id,
    entityId: review._id,
    text: `${req.user.displayName} liked your review`,
    url: `/game/${review.rawgId}`
  });
  await createActivity({
  userId: req.user._id,
  type: "like",
  entityId: review._id,
  text: `${req.user.displayName} liked a review`,
  url: `/game/${review.rawgId}`
});

}


    res.json({ ok: true });
  } catch (e) {
    console.error("[LIKE REVIEW] ERROR", e);
    res.status(500).json({ ok: false });
  }
});

// DELETE REVIEW
router.delete("/:id", async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({});

    const review = await GameReview.findById(req.params.id);
    if (!review) return res.status(404).json({});

    if (String(review.userId) !== String(req.user._id)) {
      return res.status(403).json({});
    }

    // 🧹 Delete related comments
    await ReviewComment.deleteMany({ reviewId: review._id });

    // 🧹 Delete notifications related to this review
    await deleteNotification({ entityId: review._id });

    // 🧹 Delete activities related to this review
    await deleteActivity({ entityId: review._id });

    await review.deleteOne();

    res.json({ ok: true });
  } catch (e) {
    console.error("[DELETE REVIEW]", e);
    res.status(500).json({});
  }
});

export default router;
