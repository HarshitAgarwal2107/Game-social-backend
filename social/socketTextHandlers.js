// social/socketTextHandlers.js
import { getPG } from "../config/db.js";

/* ---------------- DB helpers ---------------- */

async function saveMessage(pg, { roomId, userId, username, text }) {
  const q = `
    INSERT INTO game_messages (room_id, user_id, username, text)
    VALUES ($1, $2, $3, $4)
    RETURNING id, created_at
  `;
  const res = await pg.query(q, [roomId, userId, username, text]);
  return res.rows[0];
}

async function loadHistory(pg, roomId, limit = 50) {
  const q = `
    SELECT id, user_id, username, text, created_at
    FROM game_messages
    WHERE room_id = $1
    ORDER BY created_at DESC
    LIMIT $2
  `;
  const res = await pg.query(q, [roomId, limit]);
  return res.rows.reverse();
}

/* ---------------- User helpers ---------------- */

function getUserFromSocket(socket) {
  const authUser = socket.handshake?.auth?.user;

  if (authUser && typeof authUser === "object") {
    return {
      id: authUser.id ?? authUser._id ?? null,
      name:
        authUser.name ??
        authUser.displayName ??
        authUser.username ??
        `User-${socket.id.slice(0, 6)}`
    };
  }

  return {
    id: null,
    name: `Anon-${socket.id.slice(0, 6)}`
  };
}

/* ---------------- Socket handlers ---------------- */

export function attachTextHandlers(io, socket) {
  const pg = getPG();
  const user = getUserFromSocket(socket);

  /* join-room */
  socket.on("join-room", async (payload, cb) => {
    try {
      const { roomId } = payload || {};
      if (!roomId) {
        cb?.({ error: "missing_roomId" });
        return;
      }

      await socket.join(roomId);

      io.to(roomId).emit("user-joined", {
        roomId,
        user: { id: user.id, name: user.name }
      });

      const history = await loadHistory(pg, roomId, 50);
      socket.emit("chat-history", history);

      cb?.({ ok: true });
    } catch (err) {
      console.error("join-room error:", err);
      cb?.({ error: "join_failed" });
    }
  });

  /* leave-room */
  socket.on("leave-room", async (payload, cb) => {
    try {
      const { roomId } = payload || {};
      if (!roomId) {
        cb?.({ error: "missing_roomId" });
        return;
      }

      await socket.leave(roomId);

      io.to(roomId).emit("user-left", {
        roomId,
        user: { id: user.id, name: user.name }
      });

      cb?.({ ok: true });
    } catch (err) {
      console.error("leave-room error:", err);
      cb?.({ error: "leave_failed" });
    }
  });

  /* send-msg */
  socket.on("send-msg", async (payload, cb) => {
    try {
      const { roomId, text, clientId } = payload || {};
      if (!roomId || !text) {
        cb?.({ error: "missing_params" });
        return;
      }

      const save = await saveMessage(pg, {
        roomId,
        userId: user.id,
        username: user.name,
        text
      });

      const msg = {
        id: save.id,
        clientId: clientId ?? null,
        roomId,
        from: { id: user.id, name: user.name },
        text,
        ts: new Date(save.created_at).toISOString()
      };

      io.to(roomId).emit("message", msg);
      cb?.({ ok: true, id: save.id });
    } catch (err) {
      console.error("[socketText] send-msg error:", err);
      cb?.({ error: "send_failed" });
    }
  });

  /* get-history */
  socket.on("get-history", async (payload, cb) => {
    try {
      const { roomId, limit = 50 } = payload || {};
      if (!roomId) {
        cb?.({ error: "missing_roomId" });
        return;
      }

      const hist = await loadHistory(pg, roomId, limit);
      socket.emit("chat-history", hist);
      cb?.({ ok: true, count: hist.length });
    } catch (err) {
      console.error("get-history error:", err);
      cb?.({ error: "history_failed" });
    }
  });

  /* disconnect */
  socket.on("disconnect", () => {
    console.log("Text socket disconnected:", socket.id);
  });
}
