import passport from "passport";
import { Strategy as SteamStrategy } from "passport-steam";
import dotenv from "dotenv";
import User from "../models/User.js";
import { createSteamLibraryIfMissing } from "../services/steamLibrary.js";

dotenv.config();

passport.use(
  new SteamStrategy(
    {
      returnURL: "http://localhost:5000/auth/steam/return",
      realm: "http://localhost:5000/",
      apiKey: process.env.STEAM_API_KEY,
      passReqToCallback: true
    },
    async (req, identifier, profile, done) => {
      try {
        const providerData = {
          provider: "steam",
          providerId: profile.id,
          displayName: profile.displayName,
          avatar: profile.photos?.[2]?.value || ""
        };

        // 🔗 Linking Steam to existing user
        if (req.user) {
          const linked = req.user.linkedAccounts.some(
            acc => acc.provider === "steam"
          );

          if (!linked) {
            req.user.linkedAccounts.push(providerData);
            await req.user.save();

            createSteamLibraryIfMissing(req.user._id, profile.id)
              .catch(err => console.error("Steam library init failed:", err));
          }

          return done(null, req.user);
        }

        // 🔐 Login with Steam
        let user = await User.findOne({
          "linkedAccounts.provider": "steam",
          "linkedAccounts.providerId": profile.id
        });

        if (!user) {
          user = await User.create({
            displayName: profile.displayName,
            avatar: providerData.avatar,
            linkedAccounts: [providerData]
          });

          createSteamLibraryIfMissing(user._id, profile.id)
            .catch(err => console.error("Steam library init failed:", err));
        }

        return done(null, user);
      } catch (err) {
        console.error("Steam strategy error:", err);
        return done(err, null);
      }
    }
  )
);
