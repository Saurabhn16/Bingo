const {
  rooms, createRoom, joinRoom, getRoom,
  getPlayer, getPublicRoom
} = require("./room-manager");

const { createGame, makeMove } = require("./game-engine");

const TURN_SECONDS = 30;
const timers = new Map();

function registerTicTacToe(io) {
  function emitState(room) {
    io.to(room.code).emit("ttt:state", getPublicRoom(room));
  }

  function clearTimer(code) {
    if (timers.has(code)) clearTimeout(timers.get(code));
    timers.delete(code);
  }

  function startTimer(room) {
    clearTimer(room.code);

    if (room.game.status !== "playing" || room.players.length !== 2) {
      room.timerEndsAt = null;
      return;
    }

    room.timerEndsAt = Date.now() + TURN_SECONDS * 1000;
    emitState(room);

    const timer = setTimeout(() => {
      const current = getRoom(room.code);
      if (!current || current.game.status !== "playing") return;

      const loser = current.game.currentTurn;
      const winner = loser === "X" ? "O" : "X";

      current.game.status = "finished";
      current.game.winner = winner;
      current.game.winningLine = [];
      current.scores[winner]++;
      current.timerEndsAt = null;
      timers.delete(room.code);

      io.to(room.code).emit("ttt:timeout", { loser, winner });
      emitState(current);
    }, TURN_SECONDS * 1000);

    timers.set(room.code, timer);
  }

  io.on("connection", socket => {
    socket.on("ttt:createRoom", (data = {}, callback) => {
      try {
        const nickname = String(data.nickname || "").trim().slice(0, 20);
        if (!nickname) throw new Error("Enter nickname");

        const room = createRoom(socket.id, nickname);
        socket.join(room.code);

        callback?.({ success: true, room: getPublicRoom(room) });
        emitState(room);
      } catch (error) {
        callback?.({ success: false, error: error.message });
      }
    });

    socket.on("ttt:joinRoom", (data = {}, callback) => {
      try {
        const code = String(data.code || "").trim().toUpperCase();
        const nickname = String(data.nickname || "").trim().slice(0, 20);

        if (!nickname) throw new Error("Enter nickname");
        if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code))
          throw new Error("Invalid room code");

        const room = joinRoom(code, socket.id, nickname);
        socket.join(code);

        callback?.({ success: true, room: getPublicRoom(room) });
        emitState(room);
        startTimer(room);
      } catch (error) {
        callback?.({ success: false, error: error.message });
      }
    });

    socket.on("ttt:move", (data = {}, callback) => {
      try {
        const code = String(data.code || "").toUpperCase();
        const room = getRoom(code);
        if (!room) throw new Error("Room not found");

        const player = getPlayer(room, socket.id);
        if (!player || !player.connected)
          throw new Error("Not a room player");

        makeMove(room.game, data.index, player.symbol);
        clearTimer(code);

        if (room.game.status === "finished") {
          room.scores[room.game.winner]++;
          room.timerEndsAt = null;
        } else if (room.game.status === "draw") {
          room.scores.draws++;
          room.timerEndsAt = null;
        } else {
          startTimer(room);
        }

        callback?.({ success: true });
        emitState(room);
      } catch (error) {
        callback?.({ success: false, error: error.message });
      }
    });

    socket.on("ttt:chat", (data = {}, callback) => {
      try {
        const room = getRoom(String(data.code || "").toUpperCase());
        if (!room) throw new Error("Room not found");

        const player = getPlayer(room, socket.id);
        if (!player || !player.connected)
          throw new Error("Not a room player");

        const message = String(data.message || "").trim().slice(0, 300);
        if (!message) throw new Error("Empty message");

        io.to(room.code).emit("ttt:chat", {
          nickname: player.nickname,
          symbol: player.symbol,
          message,
          timestamp: Date.now()
        });

        callback?.({ success: true });
      } catch (error) {
        callback?.({ success: false, error: error.message });
      }
    });

    socket.on("ttt:rematch", (data = {}, callback) => {
      try {
        const room = getRoom(String(data.code || "").toUpperCase());
        if (!room) throw new Error("Room not found");

        const player = getPlayer(room, socket.id);
        if (!player || !player.connected)
          throw new Error("Not a room player");
        if (room.game.status === "playing")
          throw new Error("Game is still running");

        room.rematchRequests.add(socket.id);

        io.to(room.code).emit("ttt:rematchStatus", {
          requested: room.rematchRequests.size,
          total: 2
        });

        if (room.rematchRequests.size === 2) {
          room.game = createGame();
          room.rematchRequests.clear();

          room.players.forEach(p => {
            p.symbol = p.symbol === "X" ? "O" : "X";
          });

          io.to(room.code).emit("ttt:rematchStarted");
          startTimer(room);
          emitState(room);
        }

        callback?.({ success: true });
      } catch (error) {
        callback?.({ success: false, error: error.message });
      }
    });

    socket.on("disconnect", () => {
      for (const room of rooms.values()) {
        const player = getPlayer(room, socket.id);
        if (!player) continue;

        player.connected = false;
        clearTimer(room.code);

        io.to(room.code).emit("ttt:playerDisconnected", {
          nickname: player.nickname
        });
        emitState(room);
        break;
      }
    });
  });
}

module.exports = registerTicTacToe;
