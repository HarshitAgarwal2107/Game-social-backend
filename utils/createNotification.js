import Notification from "../models/Notification.js";

export async function createNotification({
  userId,
  type,
  actorId,
  entityId,
  text,
  url
}) {
  if (!userId || !type) return;

  await Notification.create({
    userId,
    type,
    actorId,
    entityId,
    text,
    url
  });
}
