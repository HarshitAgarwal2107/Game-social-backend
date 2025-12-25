import mongoose from "mongoose";

const NotificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },

    type: {
      type: String,
      enum: [
        "mention",
        "review_like",
        "comment_like",
        "friend"
      ],
      required: true
    },

    actorId: { type: mongoose.Schema.Types.ObjectId },
    entityId: { type: mongoose.Schema.Types.ObjectId },

    text: String,
    url: String,

    read: { type: Boolean, default: false }
  },
  { timestamps: true }
);

export default mongoose.model("Notification", NotificationSchema);
