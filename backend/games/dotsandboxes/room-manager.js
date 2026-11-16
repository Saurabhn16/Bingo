const crypto = require("crypto");
const {
  PALETTE,
  createBoard,
  applyMove,
  createPublicBoard
} = require("./game-engine");

const rooms = new Map();
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;

const id = () => crypto.randomUUID();
const token = () => crypto.randomBytes(32).toString("hex");

function roomCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function cleanColor(value, fallback = PALETTE[0]) {
  const color = String(value || fallback).toUpperCase();
  if (!PALETTE.includes(color)) throw new Error("Choose one of the 10 available player colors.");
  return color;
}

function firstAvailableColor(room) {
  const used = new Set(room.players.filter(p => !p.left).map(p => p.color));
  return PALETTE.find(color => !used.has(color)) || null;
}

function cleanName(value) {
  return String(value || "Player")
    .trim().replace(/\s+/g, " ").slice(0, 20) || "Player";
}

function getRoom(code) {
  return rooms.get(String(code || "").trim().toUpperCase());
}

function connectedPlayers(room) {
  return room.players.filter(p => p.connected && !p.left);
}

function playerFor(room, playerId) {
  return room.players.find(p => p.id === playerId);
}

function nextPlayer(room, fromId) {
  const eligible = room.players.filter(p => !p.left);
  if (!eligible.length) return null;
  const index = eligible.findIndex(p => p.id === fromId);
  for (let step = 1; step <= eligible.length; step++) {
    const candidate = eligible[(Math.max(index, -1) + step) % eligible.length];
    if (candidate.connected) return candidate.id;
  }
  return null;
}

function assignHost(room) {
  if (room.hostId && playerFor(room, room.hostId)?.connected) return;
  const next = connectedPlayers(room)[0] || room.players.find(p => !p.left);
  room.hostId = next ? next.id : null;
}

function publicRoom(room) {
  const board = room.board ? createPublicBoard(room.board) : null;
  return {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    settings: { size: room.size, maxPlayers: room.maxPlayers },
    players: room.players.filter(p => !p.left).map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      connected: p.connected,
      host: p.id === room.hostId,
      score: p.score
    })),
    board,
    currentTurn: room.currentTurn,
    lastMove: room.lastMove,
    winnerIds: room.winnerIds || [],
    rematch: room.rematch ? {
      requesterId: room.rematch.requesterId,
      votes: room.players.filter(p => !p.left).map(p => ({
        playerId: p.id,
        voted: Object.prototype.hasOwnProperty.call(room.rematch.votes, p.id),
        accepted: room.rematch.votes[p.id] === true
      })),
      total: room.players.filter(p => !p.left).length
    } : null,
    chat: room.chat.slice(-30),
    createdAt: room.createdAt
  };
}

function broadcast(io, room) {
  io.to(room.code).emit("db:state", publicRoom(room));
}

function cleanupRoom(room) {
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  room.cleanupTimer = setTimeout(() => {
    if (connectedPlayers(room).length === 0) rooms.delete(room.code);
  }, ROOM_TTL_MS);
  if (room.cleanupTimer.unref) room.cleanupTimer.unref();
}

function createRoom({ name, size, maxPlayers, color }) {
  const boardSize = Number(size);
  const playerLimit = Number(maxPlayers);
  if (!Number.isInteger(boardSize) || boardSize < 2 || boardSize > 10) {
    throw new Error("Choose a board size from 2x2 to 10x10.");
  }
  if (!Number.isInteger(playerLimit) || playerLimit < 2 || playerLimit > 10) {
    throw new Error("Player limit must be between 2 and 10.");
  }

  let code;
  do { code = roomCode(); } while (rooms.has(code));

  const player = {
    id: id(), token: token(), name: cleanName(name),
    color: cleanColor(color), score: 0, connected: false,
    socketId: null, left: false
  };
  const room = {
    code, hostId: player.id, players: [player],
    size: boardSize, maxPlayers: playerLimit,
    board: null, status: "waiting", currentTurn: null,
    lastMove: null, winnerIds: [], chat: [], rematch: null,
    createdAt: Date.now(), cleanupTimer: null
  };
  rooms.set(code, room);
  return { room: publicRoom(room), playerId: player.id, playerToken: player.token };
}

function joinRoom({ code, name, playerToken, color }) {
  const room = getRoom(code);
  if (!room) throw new Error("Room not found. Check the room code.");

  const existing = playerToken
    ? room.players.find(p => p.token === playerToken && !p.left)
    : null;

  if (existing) {
    existing.name = cleanName(name || existing.name);
    return { room: publicRoom(room), playerId: existing.id, playerToken: existing.token };
  }

  if (room.status !== "waiting") throw new Error("This game has already started.");
  if (room.players.filter(p => !p.left).length >= room.maxPlayers) {
    throw new Error("This room is full.");
  }

  const requestedColor = cleanColor(color, firstAvailableColor(room) || PALETTE[0]);
  const usedColors = new Set(room.players.filter(p => !p.left).map(p => p.color));
  if (usedColors.has(requestedColor)) {
    throw new Error("That color is already taken in this room. Please choose another color.");
  }

  const player = {
    id: id(), token: token(), name: cleanName(name),
    color: requestedColor,
    score: 0, connected: false, socketId: null, left: false
  };
  room.players.push(player);
  return { room: publicRoom(room), playerId: player.id, playerToken: player.token };
}

function subscribe(io, socket, data) {
  const room = getRoom(data?.code);
  if (!room) throw new Error("Room not found.");
  const player = playerFor(room, data?.playerId);
  if (!player || player.token !== data?.playerToken || player.left) {
    throw new Error("Your player identity could not be verified.");
  }

  if (player.socketId && player.socketId !== socket.id) {
    const oldSocket = io.sockets.sockets.get(player.socketId);
    // Invalidate old socket before disconnect so its disconnect handler is ignored.
    player.socketId = socket.id;
    if (oldSocket) oldSocket.disconnect(true);
  }

  player.connected = true;
  player.socketId = socket.id;
  player.name = cleanName(data.name || player.name);
  socket.join(room.code);
  socket.data.dbCode = room.code;
  socket.data.dbPlayerId = player.id;

  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  assignHost(room);

  if (room.status === "paused" && connectedPlayers(room).length >= 2) {
    room.status = "playing";
    if (!room.currentTurn || !playerFor(room, room.currentTurn)?.connected) {
      room.currentTurn = connectedPlayers(room)[0]?.id || null;
    }
  }
  broadcast(io, room);
}

function startGame(io, room, playerId) {
  if (room.status !== "waiting") throw new Error("This room has already started.");
  if (playerId !== room.hostId) throw new Error("Only the room leader can start the game.");
  const active = connectedPlayers(room);
  if (active.length < 2) throw new Error("At least 2 players must be connected.");
  room.players.forEach(p => { p.score = 0; });
  room.board = createBoard(room.size);
  room.status = "playing";
  room.currentTurn = active[0].id;
  room.lastMove = null;
  room.winnerIds = [];
  broadcast(io, room);
}

function makeMove(io, room, playerId, move) {
  if (!room || room.status !== "playing") throw new Error("The game is not active.");
  const player = playerFor(room, playerId);
  if (!player || !player.connected || player.left) throw new Error("You are not an active player.");
  if (room.currentTurn !== player.id) throw new Error("It's not your turn.");

  const result = applyMove(room.board, move, player.id);
  if (!result.ok) throw new Error(result.error);

  if (result.claimed.length) player.score += result.claimed.length;
  room.lastMove = {
    playerId: player.id,
    orientation: move.orientation,
    row: move.row,
    col: move.col,
    claimed: result.claimed
  };

  if (result.finished) {
    room.status = "finished";
    room.currentTurn = null;
    room.rematch = null;
    const highest = Math.max(...room.players.filter(p => !p.left).map(p => p.score));
    room.winnerIds = room.players.filter(p => !p.left && p.score === highest).map(p => p.id);
  } else if (!result.extraTurn) {
    const next = nextPlayer(room, player.id);
    if (next) {
      room.currentTurn = next;
    } else {
      room.status = "paused";
      room.currentTurn = null;
    }
  }
  broadcast(io, room);
}


function requestRematch(io, room, playerId) {
  if (!room || room.status !== "finished") {
    throw new Error("A rematch can only be requested after the game ends.");
  }

  const player = playerFor(room, playerId);
  if (!player || !player.connected || player.left) {
    throw new Error("You are not an active player.");
  }

  if (room.rematch) {
    throw new Error("A rematch vote is already in progress.");
  }

  const participants = room.players.filter(p => !p.left);
  if (participants.length < 2 || participants.some(p => !p.connected)) {
    throw new Error("All players must be connected to request a rematch.");
  }

  room.rematch = {
    requesterId: playerId,
    votes: { [playerId]: true }
  };

  broadcast(io, room);
}

function voteRematch(io, room, playerId, accepted) {
  if (!room || room.status !== "finished" || !room.rematch) {
    throw new Error("There is no rematch vote in progress.");
  }

  const player = playerFor(room, playerId);
  if (!player || !player.connected || player.left) {
    throw new Error("You are not an active player.");
  }

  if (typeof accepted !== "boolean") {
    throw new Error("Invalid rematch vote.");
  }

  if (Object.prototype.hasOwnProperty.call(room.rematch.votes, playerId)) {
    throw new Error("You have already voted.");
  }

  if (!accepted) {
    room.rematch = null;
    broadcast(io, room);
    return;
  }

  room.rematch.votes[playerId] = true;

  const participants = room.players.filter(p => !p.left);
  const everyoneAccepted = participants.every(
    p => p.connected && room.rematch.votes[p.id] === true
  );

  if (everyoneAccepted) {
    const requester = playerFor(room, room.rematch.requesterId);
    const firstPlayer = requester?.connected
      ? requester
      : connectedPlayers(room)[0];

    room.players.forEach(p => { p.score = 0; });
    room.board = createBoard(room.size);
    room.status = "playing";
    room.currentTurn = firstPlayer?.id || null;
    room.lastMove = null;
    room.winnerIds = [];
    room.rematch = null;
  }

  broadcast(io, room);
}
function addChat(io, room, playerId, rawText) {
  const player = playerFor(room, playerId);
  const text = String(rawText || "").trim().slice(0, 180);
  if (!player || !player.connected || player.left || !text) return;
  room.chat.push({ playerId, name: player.name, color: player.color, text, time: Date.now() });
  room.chat = room.chat.slice(-30);
  broadcast(io, room);
}

function leaveRoom(io, socket) {
  const room = getRoom(socket.data.dbCode);
  if (!room) return;
  const player = playerFor(room, socket.data.dbPlayerId);
  if (!player || player.socketId !== socket.id) return;
  player.connected = false;
  player.socketId = null;
  player.left = true;
  if (room.rematch) room.rematch = null;
  if (room.status === "playing" && room.currentTurn === player.id) {
    room.currentTurn = nextPlayer(room, player.id);
    if (!room.currentTurn) room.status = "paused";
  }
  assignHost(room);
  broadcast(io, room);
  cleanupRoom(room);
}

function disconnect(io, socket) {
  const room = getRoom(socket.data.dbCode);
  if (!room) return;
  const player = playerFor(room, socket.data.dbPlayerId);
  if (!player || player.socketId !== socket.id) return; // stale socket after reconnect
  player.connected = false;
  player.socketId = null;
  if (room.rematch) room.rematch = null;
  if (room.status === "playing" && room.currentTurn === player.id) {
    const next = nextPlayer(room, player.id);
    room.currentTurn = next;
    if (!next) room.status = "paused";
  }
  assignHost(room);
  broadcast(io, room);
  cleanupRoom(room);
}

module.exports = {
  createRoom, joinRoom, getRoom, publicRoom, subscribe,
  startGame, makeMove, addChat, leaveRoom, disconnect,
  requestRematch, voteRematch
};










