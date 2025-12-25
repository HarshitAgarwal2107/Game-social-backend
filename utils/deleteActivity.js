import Activity from "../models/Activity.js";

export async function deleteActivity({
  userId,
  actorId,
  type,
  entityId
}) {
  try {
    await Activity.deleteMany({
      userId,
      actorId,
      type,
      entityId
    });
  } catch (e) {
    console.error("[DELETE ACTIVITY]", e);
  }
}
