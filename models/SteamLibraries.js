// models/SteamLibrary.js
import mongoose from "mongoose";

const SteamGameSchema = new mongoose.Schema(
  {
    appid: Number,
    name: String,
    playtimeForever: Number,
    playtime2Weeks: Number,
    imgIconUrl: String,
    imgLogoUrl: String,
    hasCommunityVisibleStats: Boolean
  },
  { _id: false }
);

const SteamLibrarySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      unique: true,
      index: true
    },
    steamId: {
      type: String,
      index: true
    },
    gameCount: Number,
    games: [SteamGameSchema],
    lastSyncedAt: Date
  },
  { timestamps: true }
);

export default mongoose.model("SteamLibrary", SteamLibrarySchema);
