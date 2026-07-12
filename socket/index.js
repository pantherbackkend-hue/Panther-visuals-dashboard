import { Server } from "socket.io";

let _io;

export function initSocket(server) {
  _io = new Server(server);

  _io.on("connection", (socket) => {
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
