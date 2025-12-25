process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

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
// import mediasoup from "mediasoup";  // ← Removed
import Redis from "ioredis";

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

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL,
    credentials: true
  }
});

const PORT = process.env.PORT || 5000;

/* ---------------- REDIS ---------------- */

let redis = null;

async function startRedis() {
  if (process.env.DISABLE_REDIS === "true") {
    console.log("ℹ️ Redis disabled by environment");
    return;
  }

  try {
    redis = new Redis({
      host: process.env.REDIS_HOST || "127.0.0.1",
      port: process.env.REDIS_PORT || 6379,
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null
    });

    redis.on("connect", () => {
      console.log("✅ Redis connected");
    });

    redis.on("error", err => {
      console.warn("⚠️ Redis error:", err.message);
    });

    await redis.connect();
  } catch (err) {
    console.warn("⚠️ Redis not available, continuing without Redis");
    try {
      redis?.disconnect();
    } catch {}
    redis = null;
  }
}

/* ---------------- MEDIASOUP (fully disabled) ---------------- */

// let worker;  // ← Commented out

// async function runMediasoupWorker() { ... }  // ← Removed entirely

// const routers = new Map();  // ← Removed

// async function createRoomRouter(roomId) { ... }  // ← Removed entirely

/* ---------------- MIDDLEWARE ---------------- */

app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true
}));

app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "gamesocial-super-secret-2025",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      collectionName: "sessions"
    }),
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7,
      httpOnly: true,
      secure: false,
      sameSite: "lax"
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

app.get("/debug/session", (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).send("Not found");
  }
  res.json({
    sessionID: req.sessionID,
    session: req.session,
    user: req.user || null,
    authenticated: !!req.user
  });
});

app.get("/", (req, res) => {
  res.json({
    message: "GameSocial API Running",
    user: req.user || null
  });
});

app.get(
  "/api/frontend-hit",
  steamAutoSync,
  (req, res) => {
    res.json({ ok: true });
  }
);

/* ---------------- SOCKET.IO ---------------- */

io.use((socket, next) => {
  const { user } = socket.request.session?.passport || {};
  if (user) {
    socket.handshake.auth.user = user;
  }
  next();
});

// Pass only io to socketHandlers (no mediasoup dependencies)
socketHandlers(io);  // ← Removed { worker, createRoomRouter }

/* ---------------- STARTUP ---------------- */

async function main() {
  try {
    await connectDB();
    console.log("All DBs connected.");

    await startRedis();

    startCron({ runImmediately: true });
    console.log("Trending cron started.");
    startRawgCron({ runImmediately: true });
    console.log("RAWG cron started.");

    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log("Socket.IO ready");
    });
  } catch (err) {
    console.error("Startup failure:", err);
    process.exit(1);
  }
}

main();