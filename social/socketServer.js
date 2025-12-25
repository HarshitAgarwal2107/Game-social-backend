// social/socketServer.js
import Redis from "ioredis";
import { attachTextHandlers } from "./socketTextHandlers.js";
// import { attachVoiceHandlers } from "./socketVoiceHandlers.js";  // ← Fully removed

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const sub = new Redis(REDIS_URL);

// Subscribe to idle notifications (keeps behavior from earlier implementation)
sub.subscribe("room:idle");
sub.on("message", (channel, message) => {
  if (channel !== "room:idle") return;
  try {
    const { roomId } = JSON.parse(message);
    console.log("room:idle published for", roomId);
    // Note: In the original setup, this would emit to all sockets via `io`.
    // Since we no longer pass `io` here for voice-related broadcasts,
    // and idle cleanup is likely handled elsewhere now, we just log.
    // If you need to broadcast this globally, consider moving this subscription
    // into your main server file and using the top-level `io` there.
  } catch (err) {
    console.error("room idle handler error:", err);
  }
});

/**
 * Export a function to register socket handlers when you create your io server.
 *
 * Example usage in your server bootstrap:
 *
 * import socketServer from "./social/socketServer.js";
 * const io = new Server(httpServer, options);
 * socketServer(io);
 */
export default function socketServer(io /*, opts = {} */) {
  // No longer accepting opts (mediasoup-related createRoomRouter removed)

  io.on("connection", (socket) => {
    // Attach only text/chat related handlers
    attachTextHandlers(io, socket);

    // Voice handlers completely removed
    // attachVoiceHandlers(io, socket, { createRoomRouter: opts.createRoomRouter });

    // Additional per-socket setup can go here if needed
    console.log("A user connected:", socket.id);
  });

  // Optional: handle disconnects globally if needed
  io.on("disconnect", (socket) => {
    console.log("User disconnected:", socket.id);
  });
}