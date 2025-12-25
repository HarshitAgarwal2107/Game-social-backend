// social/socketVoiceHandlers.js
import Redis from "ioredis";
import { getPG } from "../config/db.js";

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const ANNOUNCED_IP = process.env.ANNOUNCED_IP || null;
const redis = new Redis(REDIS_URL);

const membersKey = (roomId) => `room:${roomId}:members`;
const idleTimerKey = (roomId) => `room:${roomId}:idle`;

// ─────────────────────────────────────────
// Redis helpers
// ─────────────────────────────────────────
async function cancelIdle(roomId) {
  console.log("[backend][idle] cancel idle for", roomId);
  await redis.del(idleTimerKey(roomId));
}

async function startIdleTimer(roomId, IDLE_SECONDS = 60 * 5) {
  console.log("[backend][idle] start idle timer for", roomId);
  await redis.set(idleTimerKey(roomId), "pending", "EX", IDLE_SECONDS);
  await redis.publish(
    "room:idle",
    JSON.stringify({ roomId, when: Date.now() })
  );
}

// ─────────────────────────────────────────
// User helpers
// ─────────────────────────────────────────
function getUserFromSocket(socket) {
  const authUser = socket.handshake?.auth?.user;
  if (authUser && typeof authUser === "object") {
    return {
      id: authUser.id ?? authUser._id ?? null,
      name: authUser.name ?? authUser.displayName ?? authUser.username ?? null,
      raw: authUser
    };
  }
  return { id: null, name: `Anon-${socket.id.slice(0, 6)}` };
}

function memberIdForUser(user, socketId) {
  return user && user.id ? `uid:${user.id}` : `guest:${socketId}`;
}

// ─────────────────────────────────────────
// mediasoup in-memory state
// ─────────────────────────────────────────
const rooms = new Map();

/**
 * Get or create a room and GUARANTEE router readiness.
 */
async function getRoom(roomId, createIfMissing = true, createRoomRouter) {
  console.log("[backend][room] getRoom", roomId);

  if (rooms.has(roomId)) {
    const room = rooms.get(roomId);
    console.log(
      "[backend][room] exists. router?",
      !!room.router,
      "routerPromise?",
      !!room.routerPromise
    );

    if (room.router) return room;

    if (room.routerPromise) {
      console.log("[backend][room] awaiting routerPromise");
      room.router = await room.routerPromise;
      console.log("[backend][room] router ready after await");
      return room;
    }

    return room;
  }

  if (!createIfMissing) {
    console.warn("[backend][room] room not found and not creating");
    return null;
  }

  console.log("[backend][room] creating new room", roomId);

  const room = {
    router: null,
    routerPromise: null,
    peers: new Map()
  };

  rooms.set(roomId, room);

  if (typeof createRoomRouter === "function") {
    console.log("[backend][room] creating mediasoup router");
    try {
      room.routerPromise = createRoomRouter(roomId);
      room.router = await room.routerPromise;
      console.log("[backend][room] mediasoup router CREATED");
    } catch (err) {
      console.error("[backend][room] failed to create router", err);
      throw err;
    }
  } else {
    console.error("[backend][room] createRoomRouter NOT PROVIDED");
    throw new Error("createRoomRouter function not provided");
  }

  return room;
}

// ─────────────────────────────────────────
// Attach handlers
// ─────────────────────────────────────────
export function attachVoiceHandlers(io, socket, opts = {}) {
  const { createRoomRouter } = opts;
  const pg = getPG();
  const user = getUserFromSocket(socket);

  console.log("[backend] voice handlers attached for socket", socket.id);

  // ───────────────── voice-join ─────────────────
  socket.on("voice-join", async (payload, cb) => {
    console.log("[backend][voice-join] called", payload);

    try {
      const { roomId: incomingRoomId, gameId, rawgId } = payload || {};
      const lookupRawgId =
        rawgId ??
        gameId ??
        (typeof incomingRoomId === "string"
          ? incomingRoomId.split(":")[1]
          : null);

      if (!lookupRawgId) {
        console.error("[backend][voice-join] missing rawgId");
        return cb?.({ error: "missing_rawgId" });
      }

      const canonicalRoomId = `game:${lookupRawgId}:voice`;
      console.log("[backend][voice-join] canonicalRoomId =", canonicalRoomId);

      let roomRow = null;

      try {
        const res = await pg.query(
          `SELECT room_id FROM games_voice_rooms
           WHERE rawg_id = $1 AND active = true
           LIMIT 1`,
          [lookupRawgId.toString()]
        );
        if (res.rows.length) roomRow = res.rows[0];
        console.log("[backend][voice-join] DB lookup result =", roomRow);
      } catch (err) {
        console.warn("[backend][voice-join] DB lookup failed (table may not exist):", err.message);
        // Continue without DB - use in-memory only
      }

      if (!roomRow) {
        try {
          const ins = await pg.query(
            `INSERT INTO games_voice_rooms(rawg_id, room_id, active)
             VALUES ($1, $2, true)
             RETURNING room_id`,
            [lookupRawgId.toString(), canonicalRoomId]
          );
          roomRow = ins.rows[0];
          console.log("[backend][voice-join] DB insert OK");
        } catch (err) {
          console.warn("[backend][voice-join] DB insert failed (table may not exist), using fallback:", err.message);
          roomRow = { room_id: canonicalRoomId };
        }
      }

      const roomToJoin = roomRow.room_id;
      console.log("[backend][voice-join] joining socket.io room", roomToJoin);

      // 🔥 ENSURE ROUTER EXISTS HERE
      const room = await getRoom(roomToJoin, true, createRoomRouter);
      console.log(
        "[backend][voice-join] router ready?",
        !!room.router
      );

      await socket.join(roomToJoin);

      // Create peer entry and store user data
      if (!room.peers.has(socket.id)) {
        room.peers.set(socket.id, {
          transports: new Map(),
          producers: new Map(),
          consumers: new Map(),
          user: user  // ← IMPORTANT: store user info on peer
        });
      } else {
        // In case peer already exists (rare), ensure user is set
        room.peers.get(socket.id).user = user;
      }

      // 🔧 FIX 1: Send full participant list to the newly joined user
      const participants = [];
      for (const [peerSocketId, peer] of room.peers.entries()) {
        participants.push({
          socketId: peerSocketId,
          name: peer.user?.name || "User",
          muted: false,
          speaking: false
        });
      }
      socket.emit("voice-state", { participants });

      // 🔧 FIX 2: Replay all existing producers to the new joiner
      for (const [peerSocketId, peer] of room.peers.entries()) {
        if (peerSocketId === socket.id) continue;

        for (const producer of peer.producers.values()) {
          socket.emit("new-producer", {
            producerId: producer.id,
            socketId: peerSocketId,
            name: peer.user?.name || "User"
          });
        }
      }

      const memberId = memberIdForUser(user, socket.id);
      await redis.sadd(membersKey(roomToJoin), memberId);
      await cancelIdle(roomToJoin);

      // Notify others that someone joined
      io.to(roomToJoin).emit("voice-joined", {
        roomId: roomToJoin,
        user: { id: user.id, name: user.name, socketId: socket.id }
      });

      console.log("[backend][voice-join] SUCCESS");
      cb?.({ ok: true, roomId: roomToJoin });
    } catch (err) {
      console.error("[backend][voice-join] FAILED", err);
      cb?.({ error: "voice_join_failed" });
    }
  });

  // ───────────────── getRtpCapabilities ─────────────────
  socket.on("getRtpCapabilities", async (payload, cb) => {
    console.log("[backend][getRtpCapabilities] called", payload);

    try {
      const roomId = payload?.roomId;
      if (!roomId) return cb({ error: "missing_roomId" });

      const room = await getRoom(roomId, true, createRoomRouter);
      if (!room.router) {
        console.error("[backend][getRtpCapabilities] router NOT READY");
        return cb({ error: "router_not_ready" });
      }

      console.log("[backend][getRtpCapabilities] OK");
      cb({ rtpCapabilities: room.router.rtpCapabilities });
    } catch (err) {
      console.error("[backend][getRtpCapabilities] FAILED", err);
      cb({ error: err.message });
    }
  });

  // ───────────────── createWebRtcTransport ─────────────────
  socket.on("createWebRtcTransport", async (payload, cb) => {
    console.log("[backend][createWebRtcTransport] called", payload);

    try {
      const roomId = payload?.roomId;
      if (!roomId) return cb({ error: "missing_roomId" });

      const room = await getRoom(roomId, true, createRoomRouter);
      if (!room.router) {
        console.error("[backend][createWebRtcTransport] router NOT READY");
        return cb({ error: "router_not_ready" });
      }

      const transport = await room.router.createWebRtcTransport({
        listenIps: [{ ip: "0.0.0.0", announcedIp: ANNOUNCED_IP }],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true
      });

      console.log("[backend][createWebRtcTransport] transport created", transport.id);

      if (!room.peers.has(socket.id)) {
        room.peers.set(socket.id, {
          transports: new Map(),
          producers: new Map(),
          consumers: new Map(),
          user: user
        });
        console.log("[backend][createWebRtcTransport] peer created", socket.id);
      }

      room.peers
        .get(socket.id)
        .transports.set(transport.id, transport);

      cb({
        params: {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters
        }
      });
    } catch (err) {
      console.error("[backend][createWebRtcTransport] FAILED", err);
      cb({ error: err.message });
    }
  });

  // ───────────────── connect-transport ─────────────────
  socket.on("connect-transport", async (payload, cb) => {
    console.log("[backend][connect-transport] called", payload);

    try {
      const { roomId, transportId, dtlsParameters } = payload || {};

      if (!roomId || !transportId || !dtlsParameters) {
        console.error("[backend][connect-transport] missing params");
        return cb({ error: "missing_params" });
      }

      const room = await getRoom(roomId, false);
      if (!room) {
        console.error("[backend][connect-transport] room not found");
        return cb({ error: "room_not_found" });
      }

      const peer = room.peers.get(socket.id);
      if (!peer) {
        console.error("[backend][connect-transport] peer not found", socket.id);
        return cb({ error: "peer_not_found" });
      }

      const transport = peer.transports.get(transportId);
      if (!transport) {
        console.error("[backend][connect-transport] transport not found", transportId);
        return cb({ error: "transport_not_found" });
      }

      console.log("[backend][connect-transport] connecting DTLS…");
      await transport.connect({ dtlsParameters });
      console.log("[backend][connect-transport] DTLS CONNECTED");

      cb({ ok: true });
    } catch (err) {
      console.error("[backend][connect-transport] FAILED", err);
      cb({ error: err.message });
    }
  });

  // ───────────────── produce ─────────────────
  socket.on("produce", async (payload, cb) => {
    console.log("[backend][produce] called", payload);

    try {
      const { roomId, transportId, kind, rtpParameters } = payload || {};

      if (!roomId || !transportId || !kind || !rtpParameters) {
        console.error("[backend][produce] missing params");
        return cb({ error: "missing_params" });
      }

      const room = rooms.get(roomId);
      if (!room) {
        console.error("[backend][produce] room not found");
        return cb({ error: "room_not_found" });
      }

      const peer = room.peers.get(socket.id);
      if (!peer) {
        console.error("[backend][produce] peer not found", socket.id);
        return cb({ error: "peer_not_found" });
      }

      const transport = peer.transports.get(transportId);
      if (!transport) {
        console.error("[backend][produce] transport not found", transportId);
        return cb({ error: "transport_not_found" });
      }

      console.log("[backend][produce] creating producer");

      const producer = await transport.produce({
        kind,
        rtpParameters
      });

      // 🔧 FIX 3: Store producer and ensure user is available
      peer.producers ??= new Map();
      peer.producers.set(producer.id, producer);

      // Notify everyone else in the room about the new producer
      socket.to(roomId).emit("new-producer", {
        producerId: producer.id,
        socketId: socket.id, // Fixed: use socketId to match frontend expectation
        name: peer.user?.name || "User"
      });

      console.log("[backend][produce] producer created", producer.id);

      producer.on("transportclose", () => {
        console.log("[backend][produce] transport closed for producer", producer.id);
        producer.close();
      });

      producer.on("close", () => {
        socket.to(roomId).emit("producer-closed", { producerId: producer.id });
      });

      cb({ id: producer.id });
    } catch (err) {
      console.error("[backend][produce] FAILED", err);
      cb({ error: err.message });
    }
  });

  // ───────────────── consume ─────────────────
  socket.on("consume", async (payload, cb) => {
    console.log("[backend][consume] called", payload);

    try {
      const { roomId, consumerTransportId, producerId, rtpCapabilities } =
        payload || {};

      if (!roomId || !consumerTransportId || !producerId || !rtpCapabilities) {
        return cb({ error: "missing_params" });
      }

      const room = await getRoom(roomId, true, createRoomRouter);
      if (!room.router) return cb({ error: "router_not_ready" });

      if (!room.router.canConsume({ producerId, rtpCapabilities })) {
        console.error("[backend][consume] cannot consume");
        return cb({ error: "cannot_consume" });
      }

      const peer = room.peers.get(socket.id);
      const transport = peer?.transports.get(consumerTransportId);
      if (!transport) return cb({ error: "transport_not_found" });

      const consumer = await transport.consume({
        producerId,
        rtpCapabilities,
        paused: false
      });

      peer.consumers.set(consumer.id, consumer);
      await consumer.resume();

      console.log("[backend][consume] consumer created", consumer.id);

      cb({
        params: {
          id: consumer.id,
          producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters
        }
      });
    } catch (err) {
      console.error("[backend][consume] FAILED", err);
      cb({ error: err.message });
    }
  });

  // ───────────────── voice-speaking ─────────────────
  socket.on("voice-speaking", async (payload) => {
    console.log("[backend][voice-speaking] called", payload);

    try {
      const { roomId, speaking } = payload || {};

      if (!roomId) {
        console.warn("[backend][voice-speaking] missing roomId");
        return;
      }

      const room = await getRoom(roomId, false);
      if (!room || !room.peers.has(socket.id)) {
        console.warn("[backend][voice-speaking] peer not in room");
        return;
      }

      // Broadcast speaking status to all other users in the room
      socket.to(roomId).emit("voice-speaking", {
        socketId: socket.id,
        speaking: !!speaking
      });

      console.log("[backend][voice-speaking] broadcasted", socket.id, speaking);
    } catch (err) {
      console.error("[backend][voice-speaking] FAILED", err);
    }
  });

  // ───────────────── voice-leave ─────────────────
  socket.on("voice-leave", async (payload, cb) => {
    console.log("[backend][voice-leave] called", payload);

    try {
      const roomId = payload?.roomId;
      if (!roomId) {
        console.warn("[backend][voice-leave] missing roomId");
        return cb?.({ error: "missing_roomId" });
      }

      const room = await getRoom(roomId, false);
      if (!room || !room.peers.has(socket.id)) {
        console.warn("[backend][voice-leave] peer not in room");
        return cb?.({ ok: true });
      }

      const peer = room.peers.get(socket.id);

      // Close all producers and consumers
      for (const producer of peer.producers.values()) {
        try {
          producer.close();
        } catch (err) {
          console.warn("[backend][voice-leave] error closing producer", err);
        }
      }
      for (const consumer of peer.consumers.values()) {
        try {
          consumer.close();
        } catch (err) {
          console.warn("[backend][voice-leave] error closing consumer", err);
        }
      }
      for (const transport of peer.transports.values()) {
        try {
          transport.close();
        } catch (err) {
          console.warn("[backend][voice-leave] error closing transport", err);
        }
      }

      // Remove from socket.io room
      await socket.leave(roomId);

      // Remove peer
      room.peers.delete(socket.id);

      // Remove from Redis
      const memberId = memberIdForUser(user, socket.id);
      await redis.srem(membersKey(roomId), memberId);

      // Notify others
      socket.to(roomId).emit("voice-left", {
        socketId: socket.id
      });

      console.log("[backend][voice-leave] SUCCESS");
      cb?.({ ok: true });
    } catch (err) {
      console.error("[backend][voice-leave] FAILED", err);
      cb?.({ error: err.message });
    }
  });

  // 🔧 FIX 4: Proper cleanup on disconnect
  socket.on("disconnect", async () => {
    console.log("[backend] socket disconnect", socket.id);

    for (const [roomId, room] of rooms.entries()) {
      if (!room.peers.has(socket.id)) continue;

      const peer = room.peers.get(socket.id);

      // Close all producers and consumers
      for (const producer of peer.producers.values()) {
        try {
          producer.close();
        } catch (err) {
          console.warn("[backend] error closing producer on disconnect", err);
        }
      }
      for (const consumer of peer.consumers.values()) {
        try {
          consumer.close();
        } catch (err) {
          console.warn("[backend] error closing consumer on disconnect", err);
        }
      }
      for (const transport of peer.transports.values()) {
        try {
          transport.close();
        } catch (err) {
          console.warn("[backend] error closing transport on disconnect", err);
        }
      }

      // Remove from Redis
      const memberId = memberIdForUser(user, socket.id);
      try {
        await redis.srem(membersKey(roomId), memberId);
      } catch (err) {
        console.warn("[backend] error removing from Redis", err);
      }

      // Remove peer
      room.peers.delete(socket.id);

      // Notify others
      socket.to(roomId).emit("voice-left", {
        socketId: socket.id
      });

      console.log("[backend] peer removed from room", roomId);
    }
  });
}