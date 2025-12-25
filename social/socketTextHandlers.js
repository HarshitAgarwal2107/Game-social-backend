// social/socketTextHandlers.js
import Redis from "ioredis";
import { getPG } from "../config/db.js";

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const redis = new Redis(REDIS_URL);

// Redis keys helpers
const membersKey = (roomId) => `room:${roomId}:members`;
const idleTimerKey = (roomId) => `room:${roomId}:idle`;

// DB helpers (message persistence)
async function saveMessage(pg, { roomId, userId, username, text }) {
  const q = `INSERT INTO game_messages(room_id, user_id, username, text) VALUES($1,$2,$3,$4) RETURNING id, created_at`;
  const res = await pg.query(q, [roomId, userId, username, text]);
  return res.rows[0];
}
async function loadHistory(pg, roomId, limit = 50) {
  const q = `SELECT id, user_id, username, text, created_at FROM game_messages WHERE room_id = $1 ORDER BY created_at DESC LIMIT $2`;
  const res = await pg.query(q, [roomId, limit]);
  return res.rows.reverse();
}

// presence helpers
function getUserFromSocket(socket) {
  const authUser = socket.handshake && socket.handshake.auth && socket.handshake.auth.user;
  if (authUser && typeof authUser === "object") {
    return {
      id: authUser.id ?? authUser._id ?? null,
      name: authUser.name ?? authUser.displayName ?? authUser.username ?? null,
      raw: authUser
    };
  }
  return { id: null, name: `Anon-${socket.id.slice(0,6)}` };
}
function memberIdForUser(user, socketId) {
  return user && user.id ? `uid:${user.id}` : `guest:${socketId}`;
}
async function cancelIdle(roomId) {
  await redis.del(idleTimerKey(roomId));
}
async function startIdleTimer(roomId, IDLE_SECONDS = 60 * 5) {
  await redis.set(idleTimerKey(roomId), "pending", "EX", IDLE_SECONDS);
  await redis.publish("room:idle", JSON.stringify({ roomId, when: Date.now() }));
}

/**
 * Attach text-chat handlers to a connected socket.
 * Usage: call inside io.on("connection", socket) with io and socket.
 */
export function attachTextHandlers(io, socket) {
  const pg = getPG();
  const user = getUserFromSocket(socket);

  // join-room
  socket.on("join-room", async (payload, cb) => {
    try {
      const roomId = payload && payload.roomId;
      if (!roomId) {
        if (typeof cb === "function") cb({ error: "missing_roomId" });
        return;
      }

      await socket.join(roomId);
      const memberId = memberIdForUser(user, socket.id);
      await redis.sadd(membersKey(roomId), memberId);
      await cancelIdle(roomId);


      io.to(roomId).emit("user-joined", { roomId, user: { id: user.id, name: user.name } });

      // send history to the joining socket (best-effort)
      try {
        const history = await loadHistory(pg, roomId, 50);
        socket.emit("chat-history", history);
      } catch (err) {
        console.error("failed to load chat history:", err);
      }

      if (typeof cb === "function") cb({ ok: true });
    } catch (err) {
      console.error("join-room error:", err);
      if (typeof cb === "function") cb({ error: "join_failed" });
    }
  });

  // leave-room
  socket.on("leave-room", async (payload, cb) => {
    try {
      const roomId = payload && payload.roomId;
      if (!roomId) {
        if (typeof cb === "function") cb({ error: "missing_roomId" });
        return;
      }

      await socket.leave(roomId);
      const memberId = memberIdForUser(user, socket.id);
      if (memberId) await redis.srem(membersKey(roomId), memberId);

      io.to(roomId).emit("user-left", { roomId, user: { id: user.id, name: user.name } });

      const remaining = await redis.scard(membersKey(roomId));
      if (remaining === 0) {
        await startIdleTimer(roomId);
      }

      if (typeof cb === "function") cb({ ok: true });
    } catch (err) {
      console.error("leave-room error:", err);
      if (typeof cb === "function") cb({ error: "leave_failed" });
    }
  });

  // send-msg
socket.on("send-msg", async (payload, cb) => {
  

  try {
    const { roomId, text, clientId } = payload || {};
        

    if (!roomId || !text) {
      if (typeof cb === "function") cb({ error: "missing_params" });
      return;
    }

    const username = (user && user.name) || `Anon-${socket.id.slice(0,6)}`;
    const userId = (user && user.id) || null;

 

    const save = await saveMessage(pg, { roomId, userId, username, text });


    const msg = {
      id: save.id,
      clientId: clientId || null,
      roomId,
      from: { id: userId, name: username },
      text,
      ts: save.created_at
        ? new Date(save.created_at).toISOString()
        : new Date().toISOString()
    };


    io.to(roomId).emit("message", msg);

    if (typeof cb === "function") {
      cb({ ok: true, id: save.id });
    }
  } catch (err) {
    console.error("[socketText] ❌ send-msg error:", err);
    if (typeof cb === "function") cb({ error: "send_failed" });
  }
});

  // get-history
  socket.on("get-history", async (payload, cb) => {
    try {
      const { roomId, limit = 50 } = payload || {};
      if (!roomId) {
        if (typeof cb === "function") cb({ error: "missing_roomId" });
        return;
      }
      const hist = await loadHistory(pg, roomId, limit);
      socket.emit("chat-history", hist);
      if (typeof cb === "function") cb({ ok: true, count: hist.length });
    } catch (err) {
      console.error("get-history error:", err);
      if (typeof cb === "function") cb({ error: "history_failed" });
    }
  });

  // cleanup on disconnect: remove this socket from all membership sets
  socket.on("disconnect", async () => {
    try {
      const roomsJoined = Array.from(socket.rooms).filter(r => r !== socket.id);
      for (const roomId of roomsJoined) {
        const memberId = memberIdForUser(user, socket.id);
        if (memberId) await redis.srem(membersKey(roomId), memberId);
        io.to(roomId).emit("user-left", { roomId, user: { id: user.id, name: user.name } });
        const remaining = await redis.scard(membersKey(roomId));
        if (remaining === 0) {
          await startIdleTimer(roomId);
        }
      }
    } catch (err) {
      console.error("text disconnect cleanup error:", err);
    }
  });
}
