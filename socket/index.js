import { Server } from "socket.io";
import { Order } from "../models/Order.js";

let _io;

export function initSocket(server) {
  _io = new Server(server);

  _io.on("connection", (socket) => {
    socket.on("editor:join", async (shopId) => {
      socket.join(`shop:${shopId}`);
      try {
        const pendingCount = await Order.countDocuments({
          shop: shopId,
          status: "assigned",
        });
        socket.emit("pending-count", pendingCount);
      } catch (err) {
        console.error("editor:join count error:", err);
      }
    });

    socket.on("user:join", (userId) => {
      if (userId) {
        socket.join(`user:${userId}`);
      }
    });

    socket.on("role:join", (role) => {
      if (role) {
        socket.join(`role:${role}`);
      }
    });
  });
}

export function getIO() {
  return _io;
}

export async function emitPendingCount(shopId) {
  if (!_io) return;
  try {
    const pendingCount = await Order.countDocuments({
      shop: shopId,
      status: { $in: ["assigned", "in_progress"] },
    });
    _io.to(`shop:${shopId}`).emit("pending-count", pendingCount);
  } catch (err) {
    console.error("emitPendingCount error:", err);
  }
}
