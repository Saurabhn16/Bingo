const manager = require("./room-manager");

function registerDotsAndBoxes(app, io) {
  app.post("/api/dotsandboxes/rooms", (req, res) => {
    try {
      res.status(201).json(manager.createRoom(req.body || {}));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/dotsandboxes/rooms/:code/join", (req, res) => {
    try {
      res.json(manager.joinRoom({ ...(req.body || {}), code: req.params.code }));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  io.on("connection", socket => {
    socket.on("db:subscribe", data => {
      try {
        manager.subscribe(io, socket, data);
      } catch (error) {
        socket.emit("db:error", error.message);
      }
    });

    socket.on("db:start", () => {
      try {
        const room = manager.getRoom(socket.data.dbCode);
        manager.startGame(io, room, socket.data.dbPlayerId);
      } catch (error) {
        socket.emit("db:error", error.message);
      }
    });

    socket.on("db:move", move => {
      try {
        const room = manager.getRoom(socket.data.dbCode);
        manager.makeMove(io, room, socket.data.dbPlayerId, move);
      } catch (error) {
        socket.emit("db:error", error.message);
      }
    });

    socket.on("db:rematchRequest", () => {
      try {
        const room = manager.getRoom(socket.data.dbCode);
        manager.requestRematch(io, room, socket.data.dbPlayerId);
      } catch (error) {
        socket.emit("db:error", error.message);
      }
    });

    socket.on("db:rematchVote", data => {
      try {
        const room = manager.getRoom(socket.data.dbCode);
        manager.voteRematch(io, room, socket.data.dbPlayerId, data?.accepted);
      } catch (error) {
        socket.emit("db:error", error.message);
      }
    });
    socket.on("db:chat", message => {
      const room = manager.getRoom(socket.data.dbCode);
      if (room) manager.addChat(io, room, socket.data.dbPlayerId, message);
    });

    socket.on("db:leave", () => manager.leaveRoom(io, socket));
    socket.on("disconnect", () => manager.disconnect(io, socket));
  });
}

module.exports = registerDotsAndBoxes;

