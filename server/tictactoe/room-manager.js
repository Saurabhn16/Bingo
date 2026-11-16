const crypto = require("crypto");
const { createGame } = require("./game-engine");

const rooms = new Map();

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 6 },
      () => chars[crypto.randomInt(chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function createRoom(socketId, nickname) {
  const code = generateCode();
  const room = {
    code,
    players: [{
      id: socketId,
      nickname,
      symbol: "X",
      connected: true
    }],
    game: createGame(),
    scores: { X: 0, O: 0, draws: 0 },
    rematchRequests: new Set(),
    timerEndsAt: null
  };
  rooms.set(code, room);
  return room;
}

function joinRoom(code, socketId, nickname) {
  const room = rooms.get(code);
  if (!room) throw new Error("Room not found");
  if (room.players.length >= 2) throw new Error("Room is full");

  room.players.push({
    id: socketId,
    nickname,
    symbol: "O",
    connected: true
  });
  return room;
}

function getRoom(code) {
  return rooms.get(code);
}

function getPlayer(room, socketId) {
  return room.players.find(p => p.id === socketId);
}

function getPublicRoom(room) {
  return {
    code: room.code,
    players: room.players.map(p => ({
      nickname: p.nickname,
      symbol: p.symbol,
      connected: p.connected
    })),
    game: room.game,
    scores: room.scores,
    rematchRequests: room.rematchRequests.size,
    timerEndsAt: room.timerEndsAt
  };
}

module.exports = {
  rooms,
  createRoom,
  joinRoom,
  getRoom,
  getPlayer,
  getPublicRoom
};
