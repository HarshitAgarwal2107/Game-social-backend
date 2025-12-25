import { triggerSteamSyncIfNeeded } from "../services/steamLibrary.js";

export default async function steamAutoSync(req, res, next) {
  try {
    console.log("[SteamAutoSync] / hit by", req.user?._id);
    if (!req.user) return next();

    const steamAccount = req.user.linkedAccounts?.find(
      acc => acc.provider === "steam"
    );

    if (!steamAccount) return next();
    
    triggerSteamSyncIfNeeded(req.user._id, steamAccount.providerId);
  } catch (err) {
    console.error("Steam auto-sync middleware error:", err);
  }

  next();
}
