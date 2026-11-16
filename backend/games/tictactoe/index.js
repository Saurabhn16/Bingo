const crypto = require("crypto");

const rooms = new Map();
const TURN_TIME = 30_000;
const WINNING_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

const makeId = () => crypto.randomUUID();
const makeToken = () => crypto.randomBytes(32).toString("hex");

function makeCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function cleanName(value, fallback) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 20) || fallback;
}

function getRoom(code) {
  return rooms.get(String(code || "").toUpperCase());
}

function clearTimer(room) {
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
}

function publicRoom(room) {
  return {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      symbol: p.symbol,
      connected: p.connected,
      host: p.id === room.hostId,
      score: { wins: p.score.wins }
    })),
    board: [...room.board],
    currentTurn: room.currentTurn,
    winner: room.winner,
    winningCells: [...room.winningCells],
    drawCount: room.drawCount,
    round: room.round,
    turnDeadline: room.turnDeadline,
    chat: room.chat.slice(-60),
    rematchVotes: [...room.rematchVotes]
  };
}

function broadcast(io, room) {
  io.to(room.code).emit("ttt:state", publicRoom(room));
}

function findWinner(board) {
  for (const line of WINNING_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[b] === board[c]) {
      return { symbol: board[a], cells: line };
    }
  }
  return null;
}

function playerFor(room, id) {
  return room.players.find(p => p.id === id);
}

function activePlayers(room) {
  return room.players.filter(p => p.connected);
}

function startTurnTimer(io, room) {
  clearTimer(room);

  if (room.status !== "playing" || !room.currentTurn) return;

  room.turnDeadline = Date.now() + TURN_TIME;

  room.timer = setTimeout(() => {
    if (room.status !== "playing") return;

    const currentIndex = room.players.findIndex(
      p => p.id === room.currentTurn
    );

    const next = room.players[(currentIndex + 1) % 2];

    if (!next || !next.connected) {
      room.status = "paused";
      room.turnDeadline = null;
      broadcast(io, room);
      return;
    }

    room.currentTurn = next.id;
    room.turnDeadline = null;

    io.to(room.code).emit("ttt:notice", "Time is up! Turn passed.");
    startTurnTimer(io, room);
    broadcast(io, room);
  }, TURN_TIME);
}

function startRound(io, room) {
  clearTimer(room);

  room.board = Array(9).fill("");
  room.winner = null;
  room.winningCells = [];
  room.status = "playing";
  room.round += 1;
  room.rematchVotes.clear();

  const first = room.players.find(p => p.symbol === "X");
  room.currentTurn = first ? first.id : null;

  startTurnTimer(io, room);
  broadcast(io, room);
}

function handlePlayerDeparture(io, room, player) {
  if (!player || !player.connected) return;

  player.connected = false;
  player.socketId = null;

  if (room.status === "playing") {
    clearTimer(room);
    room.turnDeadline = null;

    const remaining = activePlayers(room);

    if (remaining.length === 1) {
      const winner = remaining[0];

      room.status = "finished";
      room.winner = winner.id;
      room.currentTurn = null;
      room.winningCells = [];
      winner.score.wins += 1;
      room.rematchVotes.clear();

      io.to(room.code).emit(
        "ttt:notice",
        `${player.name} left the game. ${winner.name} wins!`
      );
    } else {
      room.status = "paused";
      room.currentTurn = null;

      io.to(room.code).emit(
        "ttt:notice",
        `${player.name} left the game.`
      );
    }
  } else {
    io.to(room.code).emit(
      "ttt:notice",
      `${player.name} left the room.`
    );
  }

  broadcast(io, room);
}
function registerTicTacToe(app, io) {
  // CREATE ROOM
  app.post("/api/tictactoe/rooms", (req, res) => {
    let code;
    do {
      code = makeCode();
    } while (rooms.has(code));

    const player = {
      id: makeId(),
      token: makeToken(),
      name: cleanName(req.body.name, "Player X"),
      symbol: "X",
      connected: false,
      socketId: null,
      score: { wins: 0 }
    };

    const room = {
      code,
      hostId: player.id,
      players: [player],
      board: Array(9).fill(""),
      currentTurn: null,
      winner: null,
      winningCells: [],
      status: "waiting",
      drawCount: 0,
      round: 0,
      turnDeadline: null,
      timer: null,
      chat: [],
      rematchVotes: new Set()
    };

    rooms.set(code, room);

    res.json({
      room: publicRoom(room),
      playerId: player.id,
      playerToken: player.token
    });
  });

  // JOIN ROOM
  app.post("/api/tictactoe/rooms/:code/join", (req, res) => {
    const room = getRoom(req.params.code);

    if (!room) {
      return res.status(404).json({ error: "Room not found." });
    }

    const token = String(req.body.playerToken || "");

    if (token) {
      const existing = room.players.find(p => p.token === token);

      if (existing) {
        existing.name = cleanName(req.body.name, existing.name);

        return res.json({
          room: publicRoom(room),
          playerId: existing.id,
          playerToken: existing.token
        });
      }
    }

    if (room.status !== "waiting" || room.players.length >= 2) {
      return res.status(400).json({
        error: "This room is full or the match has already started."
      });
    }

    const player = {
      id: makeId(),
      token: makeToken(),
      name: cleanName(req.body.name, "Player O"),
      symbol: "O",
      connected: false,
      socketId: null,
      score: { wins: 0 }
    };

    room.players.push(player);

    res.json({
      room: publicRoom(room),
      playerId: player.id,
      playerToken: player.token
    });
  });

  // SOCKET EVENTS
  io.on("connection", socket => {

    socket.on("ttt:subscribe", ({ code, playerId, playerToken } = {}) => {
      const room = getRoom(code);

      if (!room) {
        return socket.emit("ttt:error", "Room not found.");
      }

      const player = room.players.find(
        p => p.id === playerId && p.token === playerToken
      );

      if (!player) {
        return socket.emit("ttt:error", "Player identity could not be verified.");
      }

      if (player.socketId && player.socketId !== socket.id) {
        const oldSocket = io.sockets.sockets.get(player.socketId);
        if (oldSocket) oldSocket.disconnect(true);
      }

      player.connected = true;
      player.socketId = socket.id;

      socket.join(room.code);
      socket.data.tttCode = room.code;
      socket.data.tttPlayerId = player.id;

      if (room.status === "paused" && activePlayers(room).length === 2) {
        room.status = "playing";
        startTurnTimer(io, room);
      }

      broadcast(io, room);
    });

    socket.on("ttt:start", () => {
      const room = getRoom(socket.data.tttCode);
      if (!room || room.status !== "waiting") return;

      if (socket.data.tttPlayerId !== room.hostId) {
        return socket.emit("ttt:error", "Only the host can start the match.");
      }

      if (room.players.length !== 2 || activePlayers(room).length !== 2) {
        return socket.emit("ttt:error", "Wait for both players to connect.");
      }

      startRound(io, room);
    });

    socket.on("ttt:move", ({ index } = {}) => {
      const room = getRoom(socket.data.tttCode);
      if (!room || room.status !== "playing") return;

      const player = playerFor(room, socket.data.tttPlayerId);

      if (!player || !player.connected) return;

      if (room.currentTurn !== player.id) {
        return socket.emit("ttt:error", "Wait for your turn.");
      }

      if (!Number.isInteger(index) || index < 0 || index > 8) return;
      if (room.board[index]) return;

      if (room.turnDeadline && Date.now() > room.turnDeadline) {
        return socket.emit("ttt:error", "Your turn has expired.");
      }

      clearTimer(room);
      room.board[index] = player.symbol;

      const result = findWinner(room.board);

      if (result) {
        room.status = "finished";
        room.winner = player.id;
        room.winningCells = result.cells;
        player.score.wins += 1;
        room.currentTurn = null;
        room.turnDeadline = null;
      } else if (room.board.every(Boolean)) {
        room.status = "finished";
        room.winner = null;
        room.drawCount += 1;
        room.currentTurn = null;
        room.turnDeadline = null;
      } else {
        const next = room.players.find(p => p.id !== player.id);

        if (!next || !next.connected) {
          room.status = "paused";
          room.currentTurn = next?.id || null;
          room.turnDeadline = null;
        } else {
          room.currentTurn = next.id;
          startTurnTimer(io, room);
        }
      }

      broadcast(io, room);
    });

    socket.on("ttt:rematchVote", () => {
      const room = getRoom(socket.data.tttCode);
      if (!room || room.status !== "finished") return;

      const player = playerFor(room, socket.data.tttPlayerId);
      if (!player || !player.connected) return;

      room.rematchVotes.add(player.id);

      if (
        room.rematchVotes.size === 2 &&
        activePlayers(room).length === 2
      ) {
        startRound(io, room);
      } else {
        broadcast(io, room);
      }
    });

    socket.on("ttt:chat", text => {
      const room = getRoom(socket.data.tttCode);
      if (!room) return;

      const player = playerFor(room, socket.data.tttPlayerId);
      const message = String(text || "").trim().slice(0, 180);

      if (!player || !player.connected || !message) return;

      room.chat.push({
        playerId: player.id,
        name: player.name,
        text: message,
        time: Date.now()
      });

      room.chat = room.chat.slice(-60);
      broadcast(io, room);
    });

    socket.on("ttt:leave", () => {
      const room = getRoom(socket.data.tttCode);
      if (!room) return;

      const player = playerFor(room, socket.data.tttPlayerId);
      if (!player || player.socketId !== socket.id) return;

      handlePlayerDeparture(io, room, player);
    });

    socket.on("disconnect", () => {
      const room = getRoom(socket.data.tttCode);
      if (!room) return;

      const player = playerFor(room, socket.data.tttPlayerId);
      if (!player || player.socketId !== socket.id) return;

      handlePlayerDeparture(io, room, player);
    });
  });
}

module.exports = registerTicTacToe;
