const { randomBytes } = require("crypto");
const { createGame, applyMove } = require("./game-engine");

const DEFAULTS = { rows:5, cols:5, maxPlayers:2, touchMode:"single", timer:0, extraTurn:true, winCondition:"board", targetScore:10 };
const ALLOWED_SIZES = new Set([3,5,6,8,10,12,15]);
const cleanName = value => String(value || "Player").trim().slice(0,18) || "Player";
const publicRoom = (room, youId) => ({
  code: room.code, youId, hostId: room.hostId, isHost: room.hostId === youId, status: room.game.status,
  settings: room.settings,
  players: room.players.map(p => ({ id:p.id, name:p.name, score:room.game.scores[p.id] || 0, connected:!!p.socketId })),
  board: room.game.board, currentPlayerId:room.game.currentPlayerId,
  lastMove:room.game.lastMove, sosCells:room.game.sosCells, rematch:room.rematch ? { requestedBy:room.rematch.requestedBy, acceptedBy:[...room.rematch.acceptedBy] } : null, activity:room.activity.slice(-30)
});

class RoomManager {
  constructor(io) { this.io=io; this.rooms=new Map(); this.socketToRoom=new Map(); }
  normalizeSettings(input={}) {
    const rows=Number(input.rows), cols=Number(input.cols), maxPlayers=Number(input.maxPlayers);
    if (!ALLOWED_SIZES.has(rows) || !ALLOWED_SIZES.has(cols)) throw new Error("Choose a supported board size.");
    if (![2,3,4].includes(maxPlayers)) throw new Error("Choose 2, 3 or 4 players.");
    const touchMode=["single","double","triple"].includes(input.touchMode)?input.touchMode:"single";
    const timer=[0,10,15,30,60].includes(Number(input.timer))?Number(input.timer):0;
    const winCondition=input.winCondition==="target"?"target":"board";
    const targetScore=Math.max(1,Math.min(100,Number(input.targetScore)||10));
    return { rows,cols,maxPlayers,touchMode,timer,extraTurn:input.extraTurn!==false,winCondition,targetScore };
  }
  create(socket, payload) {
    const settings=this.normalizeSettings(payload.settings);
    const code=randomBytes(4).toString("hex").slice(0,6).toUpperCase();
    const player={id:socket.id,name:cleanName(payload.name),socketId:socket.id};
    const game=createGame(settings);game.scores[player.id]=0;
    const room={code,hostId:player.id,players:[player],settings,game,activity:[`${player.name} created the room.`],rematchVotes:new Set()};
    this.rooms.set(code,room);this.attach(socket,room,player);return publicRoom(room,player.id);
  }
  join(socket,payload) {
    const code=String(payload.code||"").toUpperCase(), room=this.rooms.get(code);
    if(!room)throw new Error("Room not found. Check the code.");
    if(room.game.status!=="waiting")throw new Error("This match has already started.");
    if(room.players.length>=room.settings.maxPlayers)throw new Error("This room is full.");
    const player={id:socket.id,name:cleanName(payload.name),socketId:socket.id};
    room.players.push(player);room.game.scores[player.id]=0;room.activity.push(`${player.name} joined the room.`);
    this.attach(socket,room,player);this.broadcast(room);return publicRoom(room,player.id);
  }
  attach(socket,room,player) { socket.join(room.code);this.socketToRoom.set(socket.id,room.code);player.socketId=socket.id; }
  start(socket, code) {
    const room = this.getRoom(code);
    const player = this.getPlayer(room, socket.id);

    if (player.id !== room.hostId) {
      throw new Error("Only the host can start the game.");
    }

    if (room.players.length < 2) {
      throw new Error("At least two players are required.");
    }

    if (room.players.length < room.settings.maxPlayers) {
      throw new Error("Waiting for all required players to join.");
    }

    if (room.game.status !== "waiting") {
      throw new Error("Game already started.");
    }

    room.game.status = "playing";
    room.game.currentPlayerId = room.players[0].id;
    room.activity.push("The match started.");

    this.broadcast(room, "sos:started");
  }
  move(socket,payload) {
    const room=this.getRoom(payload.code), player=this.getPlayer(room,socket.id);
    const result=applyMove(room.game,room.settings,player.id,Number(payload.index),payload.letter);
    if(result.nextPlayer) {
      const i=room.players.findIndex(p=>p.id===player.id);
      room.game.currentPlayerId=room.players[(i+1)%room.players.length].id;
    }
    room.activity.push(`${player.name} placed ${payload.letter} and scored ${result.created} SOS.`);
    if(room.game.status==="finished") {
      this.broadcast(room,"sos:finished",{reason:room.settings.winCondition==="target"?"Target score reached.":"The board is full."});
    } else {
      this.broadcast(room,"sos:moveResult",{created:result.created});
    }
  }
  requestRematch(socket,code) {
    const room = this.getRoom(code);
    const player = this.getPlayer(room, socket.id);

    if (room.game.status !== "finished") {
      throw new Error("Rematch is available after the match ends.");
    }

    if (!room.rematch) {
      room.rematch = {
        requestedBy: player.id,
        acceptedBy: [player.id]
      };
      room.activity.push(`${player.name} requested a rematch.`);
    } else if (!room.rematch.acceptedBy.includes(player.id)) {
      room.rematch.acceptedBy.push(player.id);
    }

    if (room.rematch.acceptedBy.length >= room.players.length) {
      return this.completeRematch(room);
    }

    this.broadcast(room, "sos:rematch", {
      message: "Waiting for the other players to accept."
    });
  }

  acceptRematch(socket,code) {
    const room = this.getRoom(code);
    const player = this.getPlayer(room, socket.id);

    if (room.game.status !== "finished" || !room.rematch) {
      throw new Error("There is no pending rematch request.");
    }

    if (!room.rematch.acceptedBy.includes(player.id)) {
      room.rematch.acceptedBy.push(player.id);
    }

    if (room.rematch.acceptedBy.length >= room.players.length) {
      return this.completeRematch(room);
    }

    this.broadcast(room, "sos:rematch", {
      message: `${player.name} accepted the rematch.`
    });
  }

  declineRematch(socket,code) {
    const room = this.getRoom(code);
    const player = this.getPlayer(room, socket.id);

    if (!room.rematch || room.game.status !== "finished") {
      throw new Error("There is no pending rematch request.");
    }

    room.rematch = null;
    room.activity.push(`${player.name} declined the rematch.`);

    this.broadcast(room, "sos:rematch", {
      message: `${player.name} declined. Rematch cancelled.`
    });
  }

  completeRematch(room) {
    room.game = createGame(room.settings);

    room.players.forEach(player => {
      room.game.scores[player.id] = 0;
    });

    room.rematch = null;
    if (room.rematchVotes) room.rematchVotes.clear();

    room.activity.push("Everyone accepted. A new match is ready.");

    this.broadcast(room, "sos:state", {
      message: "Rematch accepted! The new board is ready."
    });
  }

  leave(socket) {
    const code=this.socketToRoom.get(socket.id);if(!code)return;
    const room=this.rooms.get(code);this.socketToRoom.delete(socket.id);if(!room)return;
    room.players=room.players.filter(p=>p.socketId!==socket.id);room.rematchVotes.delete(socket.id);room.rematch=null;
    if(!room.players.length){this.rooms.delete(code);return;}
    if(room.hostId===socket.id)room.hostId=room.players[0].id;
    room.activity.push("A player left the room.");
    if(room.game.status==="playing" && room.players.length<2)room.game.status="waiting";
    if(room.game.currentPlayerId===socket.id)room.game.currentPlayerId=room.players[0].id;
    this.io.to(code).emit("sos:playerLeft",{message:"A player left the room."});
    this.broadcast(room);
  }
  getRoom(code){const room=this.rooms.get(String(code||"").toUpperCase());if(!room)throw new Error("Room not found.");return room;}
  getPlayer(room,socketId){const player=room.players.find(p=>p.socketId===socketId);if(!player)throw new Error("You are not in this room.");return player;}
  broadcast(room, event = "sos:state", extra = {}) {
    room.players.forEach(player => {
      const client = this.io.sockets.sockets.get(player.socketId);
      if (!client) return;

      const personalizedState = publicRoom(room, player.id);
      client.emit(event, { ...personalizedState, ...extra });
    });
  }
  disconnect(socket){this.leave(socket);}
}
module.exports=RoomManager;