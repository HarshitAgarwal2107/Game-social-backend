// models/Activity.js
import mongoose from "mongoose";

const ActivitySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, index: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    type: String,
    entityId: mongoose.Schema.Types.ObjectId,
    text: String,
    url: String
  },
  { timestamps: true }
);

export default mongoose.model("Activity", ActivitySchema);
