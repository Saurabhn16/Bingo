const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const rooms = new Map();

app.use(express.json());
app.use(express.static("public"));

const makeCode = () => crypto.randomBytes(3).toString("hex").toUpperCase();
const makeToken = () => crypto.randomBytes(32).toString("hex");

const validBoard = b =>
  Array.isArray(b) &&
  b.length === 25 &&
  new Set(b).size === 25 &&
  b.every(n => Number.isInteger(n) && n >= 1 && n <= 25);

function winningLines(board, called) {
  const marked = new Set(
    board.map((n, i) => called.includes(n) ? i : -1).filter(i => i >= 0)
  );

  const lines = [];

  for (let r = 0; r < 5; r++)
    lines.push(Array.from({ length: 5 }, (_, c) => r * 5 + c));

  for (let c = 0; c < 5; c++)
    lines.push(Array.from({ length: 5 }, (_, r) => r * 5 + c));

  lines.push([0, 6, 12, 18, 24], [4, 8, 12, 16, 20]);

  return lines.filter(line => line.every(i => marked.has(i))).length;
}

function activePlayers(room) {
  return room.players.filter(p => p.connected && !p.forfeited);
}

function view(room) {
  return {
    code: room.code,
    started: room.started,
    currentTurn: room.currentTurn,
    winner: room.winner,
    called: room.called,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      board: p.board,
      lineCount: winningLines(p.board, room.called),
      connected: p.connected,
      forfeited: p.forfeited,
      host: p.id === room.hostId
    }))
  };
}

function broadcast(room) {
  io.to(room.code).emit("room:state", view(room));
}

function advanceAfterForfeit(room) {
  const active = activePlayers(room);

  if (active.length === 1) {
    room.winner = active[0].id;
    room.currentTurn = null;
    return;
  }

  if (active.length === 0) {
    room.currentTurn = null;
    return;
  }

  if (!active.some(p => p.id === room.currentTurn)) {
    const oldIndex = room.players.findIndex(p => p.id === room.currentTurn);
    const next = room.players
      .slice(oldIndex + 1)
      .concat(room.players.slice(0, oldIndex + 1))
      .find(p => p.connected && !p.forfeited);

    room.currentTurn = next ? next.id : active[0].id;
  }
}

function attachPlayer(room, player, socket) {
  if (player.socketId && player.socketId !== socket.id) {
    const oldSocket = io.sockets.sockets.get(player.socketId);
    if (oldSocket) oldSocket.disconnect(true);
  }

  player.connected = true;
  player.socketId = socket.id;

  socket.join(room.code);
  socket.data.code = room.code;
  socket.data.playerId = player.id;
  socket.data.playerToken = player.token;

  broadcast(room);
  socket.emit("room:state", view(room));
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/rooms", (req, res) => {
  const board = validBoard(req.body.board)
    ? req.body.board
    : Array.from({ length: 25 }, (_, i) => i + 1);

  const code = makeCode();
  const player = {
    id: crypto.randomUUID(),
    token: makeToken(),
    name: "Player 1",
    board,
    connected: false,
    forfeited: false,
    socketId: null
  };

  const room = {
    code,
    hostId: player.id,
    started: false,
    currentTurn: null,
    winner: null,
    called: [],
    boardStyle: req.body.boardStyle === "same" ? "same" : "different",
    players: [player]
  };

  rooms.set(code, room);

  res.json({
    room: view(room),
    playerId: player.id,
    playerToken: player.token
  });
});

app.post("/api/rooms/:code/join", (req, res) => {
  const room = rooms.get(req.params.code.toUpperCase());

  if (!room)
    return res.status(404).json({ error: "Room not found" });

  const suppliedToken = String(req.body.playerToken || "");

  // Rejoining an existing player slot
  if (suppliedToken) {
    const existing = room.players.find(p => p.token === suppliedToken);

    if (existing) {
      if (existing.forfeited && room.started) {
        return res.json({
          room: view(room),
          playerId: existing.id,
          playerToken: existing.token,
          forfeited: true
        });
      }

      return res.json({
        room: view(room),
        playerId: existing.id,
        playerToken: existing.token
      });
    }
  }

  if (room.started)
    return res.status(400).json({
      error: "Match already started. New players cannot join."
    });

  if (room.players.length >= 5)
    return res.status(400).json({
      error: "Room is full. Maximum 5 player slots allowed."
    });

  let board = validBoard(req.body.board)
    ? req.body.board
    : Array.from({ length: 25 }, (_, i) => i + 1);

  if (room.boardStyle === "same")
    board = [...room.players[0].board];

  const player = {
    id: crypto.randomUUID(),
    token: makeToken(),
    name: `Player ${room.players.length + 1}`,
    board,
    connected: false,
    forfeited: false,
    socketId: null
  };

  room.players.push(player);

  res.json({
    room: view(room),
    playerId: player.id,
    playerToken: player.token
  });
});

io.on("connection", socket => {
  socket.on("room:subscribe", ({ code, playerId, playerToken } = {}) => {
    const room = rooms.get(String(code || "").toUpperCase());

    if (!room)
      return socket.emit("game:error", "Room not found");

    const player = room.players.find(
      p => p.id === playerId && p.token === playerToken
    );

    if (!player)
      return socket.emit("game:error", "Player identity could not be verified");

    attachPlayer(room, player, socket);
  });

  socket.on("match:start", () => {
    const room = rooms.get(socket.data.code);
    if (!room || room.started) return;

    if (socket.data.playerId !== room.hostId)
      return socket.emit("game:error", "Only the host can start the match");

    const active = activePlayers(room);

    if (active.length < 2)
      return socket.emit("game:error", "At least 2 connected players are required");

    room.started = true;
    room.called = [];
    room.winner = null;
    room.currentTurn = active[0].id;

    broadcast(room);
  });

  socket.on("match:mark", number => {
    const room = rooms.get(socket.data.code);
    if (!room || !room.started || room.winner) return;

    const player = room.players.find(p => p.id === socket.data.playerId);

    if (!player || player.forfeited || !player.connected) return;

    if (room.currentTurn !== player.id)
      return socket.emit("game:error", "Wait for your turn");

    if (!Number.isInteger(number) || number < 1 || number > 25)
      return;

    if (room.called.includes(number)) return;

    room.called.push(number);

    if (winningLines(player.board, room.called) >= 5) {
      room.winner = player.id;
      room.currentTurn = null;
    } else {
      const index = room.players.findIndex(p => p.id === player.id);

      const next = room.players
        .slice(index + 1)
        .concat(room.players.slice(0, index + 1))
        .find(p => p.connected && !p.forfeited);

      room.currentTurn = next ? next.id : null;
    }

    broadcast(room);
  });

  socket.on("disconnect", () => {
    const room = rooms.get(socket.data.code);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.data.playerId);

    // Ignore disconnects from an older socket after a rejoin
    if (!player || player.socketId !== socket.id) return;

    player.connected = false;
    player.socketId = null;

    if (room.started && !room.winner) {
      player.forfeited = true;
      advanceAfterForfeit(room);
    }

    broadcast(room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log("GameZone running on port " + PORT);
});
