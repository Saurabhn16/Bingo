// ================= TICTACTOE MULTIPLAYER ADDON =================
// Separate room map and event namespace; existing Bingo routes/events remain untouched.
const ticTacToeRooms = new Map();
const TTT_TURN_SECONDS = 30;
const TTT_WIN_LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6]
];

function tttCleanName(value, fallback) {
  const name = String(value || "").replace(/[\x00-\x1F\x7F]/g, "").trim().replace(/\s+/g, " ").slice(0, 20);
  return name || fallback;
}
function tttActive(room) {
  return room.players.filter(p => p.connected);
}
function tttWinner(board) {
  for (const line of TTT_WIN_LINES) {
    const [a,b,c] = line;
    if (board[a] && board[a] === board[b] && board[b] === board[c]) {
      return { symbol: board[a], cells: line };
    }
  }
  return null;
}
function tttPublic(room) {
  return {
    code: room.code,
    status: room.status,
    board: [...room.board],
    currentTurn: room.currentTurn,
    winner: room.winner,
    winningCells: [...room.winningCells],
    drawCount: room.drawCount,
    round: room.round,
    turnDeadline: room.turnDeadline,
    rematchVotes: [...room.rematchVotes],
    chat: room.chat.slice(-60),
    players: room.players.map(p => ({
      id: p.id, name: p.name, symbol: p.symbol,
      connected: p.connected, host: p.id === room.hostId,
      score: {...p.score}
    }))
  };
}
function tttBroadcast(room) {
  io.to("ttt:" + room.code).emit("ttt:state", tttPublic(room));
}
function tttClearTimer(room) {
  if (room.timerHandle) clearTimeout(room.timerHandle);
  room.timerHandle = null;
}
function tttStartTurnTimer(room) {
  tttClearTimer(room);
  room.turnDeadline = Date.now() + TTT_TURN_SECONDS * 1000;
  room.timerHandle = setTimeout(() => {
    if (room.status !== "playing" || !room.currentTurn) return;
    const expired = room.players.find(p => p.id === room.currentTurn);
    const opponent = room.players.find(p => p.id !== room.currentTurn);
    if (!expired || !opponent) return;
    room.winner = opponent.id;
    room.winningCells = [];
    room.status = "finished";
    room.turnDeadline = null;
    opponent.score.wins += 1;
    expired.score.losses += 1;
    room.finishReason = "timeout";
    tttBroadcast(room);
    io.to("ttt:" + room.code).emit("ttt:notice", `${expired.name} ran out of time.`);
  }, TTT_TURN_SECONDS * 1000);
}
function tttFinish(room, winnerId, winningCells = []) {
  tttClearTimer(room);
  room.status = "finished";
  room.winner = winnerId;
  room.winningCells = winningCells;
  room.currentTurn = null;
  room.turnDeadline = null;
  room.finishReason = winnerId ? "line" : "draw";
  if (winnerId) {
    const winner = room.players.find(p => p.id === winnerId);
    const loser = room.players.find(p => p.id !== winnerId);
    if (winner) winner.score.wins += 1;
    if (loser) loser.score.losses += 1;
  } else {
    room.drawCount += 1;
    room.players.forEach(p => p.score.draws += 1);
  }
}
function tttAttach(room, player, socket) {
  if (player.socketId && player.socketId !== socket.id) {
    const old = io.sockets.sockets.get(player.socketId);
    if (old) old.disconnect(true);
  }
  player.connected = true;
  player.socketId = socket.id;
  socket.join("ttt:" + room.code);
  socket.data.tttCode = room.code;
  socket.data.tttPlayerId = player.id;
  socket.data.tttToken = player.token;
  tttBroadcast(room);
}
function tttMakePlayer(name, symbol, host = false) {
  return {
    id: crypto.randomUUID(),
    token: crypto.randomBytes(32).toString("hex"),
    name: tttCleanName(name, symbol === "X" ? "Player X" : "Player O"),
    symbol, host, connected: false, socketId: null,
    score: {wins:0, losses:0, draws:0}
  };
}

app.post("/api/tictactoe/rooms", (req, res) => {
  let code;
  do { code = crypto.randomBytes(3).toString("hex").toUpperCase(); }
  while (ticTacToeRooms.has(code));
  const host = tttMakePlayer(req.body.name, "X", true);
  const room = {
    code, hostId: host.id, players: [host],
    status: "waiting", board: Array(9).fill(null),
    currentTurn: null, winner: null, winningCells: [],
    drawCount: 0, round: 1, turnDeadline: null,
    rematchVotes: [], chat: [], timerHandle: null
  };
  ticTacToeRooms.set(code, room);
  res.json({room:tttPublic(room), playerId:host.id, playerToken:host.token});
});

app.post("/api/tictactoe/rooms/:code/join", (req, res) => {
  const room = ticTacToeRooms.get(String(req.params.code).toUpperCase());
  if (!room) return res.status(404).json({error:"Tic-Tac-Toe room not found."});
  const token = String(req.body.playerToken || "");
  if (token) {
    const existing = room.players.find(p => p.token === token);
    if (existing) {
      existing.name = tttCleanName(req.body.name, existing.name);
      return res.json({room:tttPublic(room), playerId:existing.id, playerToken:existing.token});
    }
  }
  if (room.players.length >= 2)
    return res.status(400).json({error:"This room already has two players."});
  if (room.status !== "waiting")
    return res.status(400).json({error:"This match has already started."});
  const player = tttMakePlayer(req.body.name, "O");
  room.players.push(player);
  tttBroadcast(room);
  res.json({room:tttPublic(room), playerId:player.id, playerToken:player.token});
});

io.on("connection", socket => {
  socket.on("ttt:subscribe", ({code, playerId, playerToken} = {}) => {
    const room = ticTacToeRooms.get(String(code || "").toUpperCase());
    if (!room) return socket.emit("ttt:error", "Room not found.");
    const player = room.players.find(p => p.id === playerId && p.token === playerToken);
    if (!player) return socket.emit("ttt:error", "Player identity could not be verified.");
    tttAttach(room, player, socket);
    if (room.status === "paused" && tttActive(room).length === 2) {
      room.status = "playing";
      if (!room.currentTurn) room.currentTurn = room.players.find(p => p.symbol === "X").id;
      tttStartTurnTimer(room);
      tttBroadcast(room);
      io.to("ttt:" + room.code).emit("ttt:notice", "Both players are back. Match resumed!");
    }
  });

  socket.on("ttt:start", () => {
    const room = ticTacToeRooms.get(socket.data.tttCode);
    if (!room || room.status !== "waiting") return;
    if (socket.data.tttPlayerId !== room.hostId)
      return socket.emit("ttt:error", "Only the room host can start.");
    if (room.players.length !== 2 || tttActive(room).length !== 2)
      return socket.emit("ttt:error", "Both players must be connected.");
    room.status = "playing";
    room.board = Array(9).fill(null);
    room.currentTurn = room.players.find(p => p.symbol === "X").id;
    room.winner = null;
    room.winningCells = [];
    room.rematchVotes = [];
    tttStartTurnTimer(room);
    tttBroadcast(room);
  });

  socket.on("ttt:move", payload => {
    const room = ticTacToeRooms.get(socket.data.tttCode);
    if (!room || room.status !== "playing") return;
    const player = room.players.find(p => p.id === socket.data.tttPlayerId);
    const index = Number(payload && payload.index);
    if (!player || !player.connected) return;
    if (room.currentTurn !== player.id)
      return socket.emit("ttt:error", "It is not your turn.");
    if (!Number.isInteger(index) || index < 0 || index > 8 || room.board[index])
      return socket.emit("ttt:error", "That square is not available.");
    room.board[index] = player.symbol;
    const result = tttWinner(room.board);
    if (result) {
      tttFinish(room, player.id, result.cells);
    } else if (room.board.every(Boolean)) {
      tttFinish(room, null, []);
    } else {
      const opponent = room.players.find(p => p.id !== player.id && p.connected);
      if (!opponent) {
        tttClearTimer(room);
        room.status = "waiting";
        room.currentTurn = null;
        room.turnDeadline = null;
      } else {
        room.currentTurn = opponent.id;
        tttStartTurnTimer(room);
      }
    }
    tttBroadcast(room);
  });

  socket.on("ttt:rematchVote", () => {
    const room = ticTacToeRooms.get(socket.data.tttCode);
    if (!room || room.status !== "finished") return;
    const id = socket.data.tttPlayerId;
    if (!room.players.some(p => p.id === id) || room.rematchVotes.includes(id)) return;
    room.rematchVotes.push(id);
    if (room.rematchVotes.length === 2 && tttActive(room).length === 2) {
      room.round += 1;
      room.board = Array(9).fill(null);
      room.winner = null;
      room.winningCells = [];
      room.currentTurn = room.players.find(p => p.symbol === "X").id;
      room.status = "playing";
      room.rematchVotes = [];
      room.finishReason = null;
      tttStartTurnTimer(room);
      io.to("ttt:" + room.code).emit("ttt:notice", "Rematch accepted. New round!");
    }
    tttBroadcast(room);
  });

  socket.on("ttt:chat", raw => {
    const room = ticTacToeRooms.get(socket.data.tttCode);
    const player = room?.players.find(p => p.id === socket.data.tttPlayerId);
    if (!room || !player || !player.connected) return;
    const text = String(raw || "").replace(/[\x00-\x1F\x7F]/g, "").trim().slice(0, 180);
    if (!text) return;
    room.chat.push({id:crypto.randomUUID(), playerId:player.id, name:player.name, text, at:Date.now()});
    if (room.chat.length > 60) room.chat.shift();
    tttBroadcast(room);
  });

  socket.on("ttt:leave", () => {
    const room = ticTacToeRooms.get(socket.data.tttCode);
    const player = room?.players.find(p => p.id === socket.data.tttPlayerId);
    if (!room || !player || player.socketId !== socket.id) return;
    player.connected = false;
    player.socketId = null;
    if (room.status === "playing" || room.status === "paused") {
      const other = room.players.find(p => p.id !== player.id);
      if (other && other.connected) tttFinish(room, other.id, []);
      else {
        tttClearTimer(room);
        room.status = "waiting";
        room.currentTurn = null;
        room.turnDeadline = null;
      }
    }
    tttBroadcast(room);
  });

  socket.on("disconnect", () => {
    const room = ticTacToeRooms.get(socket.data.tttCode);
    const player = room?.players.find(p => p.id === socket.data.tttPlayerId);
    if (!room || !player || player.socketId !== socket.id) return;
    player.connected = false;
    player.socketId = null;
    if (room.status === "playing") {
      tttClearTimer(room);
      room.status = "paused";
      room.turnDeadline = null;
      io.to("ttt:" + room.code).emit("ttt:notice", `${player.name} disconnected. The board is paused until they reconnect.`);
    }
    tttBroadcast(room);
  });
});
// ================= END TICTACTOE MULTIPLAYER ADDON =================
