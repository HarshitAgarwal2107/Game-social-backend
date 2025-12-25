import steamAutoSync from "./middleware/SteamAutoSync.js";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import session from "express-session";
import MongoStore from "connect-mongo";
import passport from "passport";
import dotenv from "dotenv";

import connectDB from "./config/db.js";
import "./strategies/google.js";
import "./strategies/steam.js";

import authRoutes from "./routes/authRoutes.js";
import apiRoutes from "./routes/apiRoutes.js";
import gameLookup from "./routes/gameLookup.js";
import trending from "./routes/trending.js";
import socketHandlers from "./social/socketServer.js";
import friendRoutes from "./routes/friendRoutes.js";

import { startCron } from "./cron/steamspy_trending.js";
import { startRawgCron } from "./cron/rawg_games.js";

import reviewRoutes from "./routes/reviewRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import searchRoutes from "./routes/searchRoutes.js";

dotenv.config();

/* ---------------- APP ---------------- */

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

/* ---------------- CORS ---------------- */

const allowedOrigins = [
  process.env.FRONTEND_URL,      // https://game-social.vercel.app
  "http://localhost:5173"        // local dev
].filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);

      console.error("❌ Blocked by CORS:", origin);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true
  })
);

/* ---------------- SECURITY ---------------- */

app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ---------------- SESSION ---------------- */

app.use(
  session({
    name: "connect.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      collectionName: "sessions"
    }),
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7,
      httpOnly: true,
      secure: true,        // REQUIRED for HTTPS (Vercel/Railway)
      sameSite: "none"     // REQUIRED for cross-origin cookies
    }
  })
);

/* ---------------- PASSPORT ---------------- */

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
  done(null, user._id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const User = (await import("./models/User.js")).default;
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

/* ---------------- ROUTES ---------------- */

app.use("/auth", authRoutes);
app.use("/api", apiRoutes);
app.use("/api/gameLookup", gameLookup);
app.use("/api/trending", trending);
app.use("/api/reviews", reviewRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/friends", friendRoutes);

app.get("/", (req, res) => {
  res.json({
    message: "GameSocial API Running",
    user: req.user || null
  });
});

app.get("/api/frontend-hit", steamAutoSync, (req, res) => {
  res.json({ ok: true });
});

/* ---------------- SOCKET.IO ---------------- */

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true
  }
});

io.use((socket, next) => {
  const passportSession = socket.request.session?.passport;
  if (passportSession?.user) {
    socket.handshake.auth.user = passportSession.user;
  }
  next();
});

socketHandlers(io);

/* ---------------- STARTUP ---------------- */

async function main() {
  try {
    await connectDB();
    console.log("✅ All DBs connected");

    startCron({ runImmediately: true });
    console.log("✅ Trending cron started");

    startRawgCron({ runImmediately: true });
    console.log("✅ RAWG cron started");

    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log("🔌 Socket.IO ready");
    });
  } catch (err) {
    console.error("❌ Startup failure:", err);
    process.exit(1);
  }
}

main();
