import Notification from "../models/Notification.js";

export async function deleteNotification({
  userId,
  type,
  actorId,
  entityId
}) {
  await Notification.deleteOne({
    userId,
    type,
    actorId,
    entityId
  });
}
