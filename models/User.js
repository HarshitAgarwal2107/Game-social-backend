import mongoose from "mongoose";

const linkedAccountSchema = new mongoose.Schema({
  provider: { type: String, required: true },
  providerId: { type: String, required: true },
  displayName: String,
  email: String,
  avatar: String,
  accessToken: String,
  refreshToken: String,
});

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, sparse: true, index: true },
  displayName: String,
  email: { type: String, unique: true, sparse: true },
  profilePicture: String,
  createdAt: { type: Date, default: Date.now },
  linkedAccounts: [linkedAccountSchema],
  friends: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  ],

});

export default mongoose.model("User", userSchema);
