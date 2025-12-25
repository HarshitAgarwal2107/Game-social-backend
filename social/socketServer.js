// social/socketServer.js

import { attachTextHandlers } from "./socketTextHandlers.js";
// Voice chat fully removed

/**
 * Register socket handlers when the io server is created
 */
export default function socketServer(io) {
  io.on("connection", (socket) => {
    // Attach text chat handlers only
    attachTextHandlers(io, socket);

    console.log("A user connected:", socket.id);

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
    });
  });
}
