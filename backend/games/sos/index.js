const RoomManager = require("./room-manager");

function registerSOS(io) {
  const manager = new RoomManager(io);
  io.on("connection", socket => {
    const safe = (event, fn) => socket.on(event, payload => {
      try { fn(payload || {}); }
      catch (error) { socket.emit("sos:error",{message:error.message || "Request failed."}); }
    });
    safe("sos:createRoom", payload => socket.emit("sos:room",manager.create(socket,payload)));
    safe("sos:joinRoom", payload => socket.emit("sos:room",manager.join(socket,payload)));
    safe("sos:start", payload => manager.start(socket,payload.code));
    safe("sos:move", payload => manager.move(socket,payload));
    safe("sos:rematchRequest", payload => manager.requestRematch(socket,payload.code));
    safe("sos:rematchAccept", payload => manager.acceptRematch(socket,payload.code));
    safe("sos:rematchDecline", payload => manager.declineRematch(socket,payload.code));
    safe("sos:leave", () => manager.leave(socket));
    socket.on("disconnect",()=>manager.disconnect(socket));
  });
  return manager;
}
module.exports = registerSOS;