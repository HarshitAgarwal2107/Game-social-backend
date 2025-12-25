// utils/createActivity.js
import Activity from "../models/Activity.js";

export async function createActivity({
  userId,      // actor
  type,        // "review", "comment", "like", "play"
  entityId,    // reviewId / commentId / gameId
  text,        // human readable
  url
}) {
  return Activity.create({
    userId,
    type,
    entityId,
    text,
    url
  });
}
