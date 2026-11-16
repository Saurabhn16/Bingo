const socket = io("https://bingo-512e.onrender.com");
const $ = id => document.getElementById(id);

let room = null;
let playerId = null;
let playerToken = null;
let roomCode = null;
let countdownHandle = null;
let toastHandle = null;

function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastHandle);
  toastHandle = setTimeout(() => el.classList.remove("show"), 2400);
}

function showLobbyMessage(text) {
  $("lobbyMessage").textContent = text;
}

async function api(url, body = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function saveMembership(data) {
  room = data.room;
  playerId = data.playerId;
  playerToken = data.playerToken;
  roomCode = data.room.code;
  localStorage.setItem("ttt-" + roomCode, JSON.stringify({ playerId, playerToken }));
}

function subscribe() {
  if (!roomCode || !playerId || !playerToken) return;
  socket.emit("ttt:subscribe", { code: roomCode, playerId, playerToken });
}

function enterMatch() {
  $("lobby").hidden = true;
  $("match").hidden = false;
  $("roomCodeLabel").textContent = roomCode || "------";
  if (socket.connected) subscribe();
  else socket.connect();
}

async function createRoom() {
  const name = $("nickname").value.trim();
  if (!name) return showLobbyMessage("Enter your nickname first.");
  $("createRoom").disabled = true;
  try {
    const data = await api("/api/tictactoe/rooms", { name });
    saveMembership(data);
    enterMatch();
    showLobbyMessage("Room created.");
  } catch (error) {
    showLobbyMessage(error.message);
    $("createRoom").disabled = false;
  }
}

async function joinRoom() {
  const name = $("nickname").value.trim();
  const code = $("roomCode").value.trim().toUpperCase();
  if (!name) return showLobbyMessage("Enter your nickname first.");
  if (!code) return showLobbyMessage("Enter a room code.");
  $("joinRoom").disabled = true;
  try {
    const saved = localStorage.getItem("ttt-" + code);
    const membership = saved ? JSON.parse(saved) : {};
    const data = await api(`/api/tictactoe/rooms/${encodeURIComponent(code)}/join`, {
      name,
      playerToken: membership.playerToken || ""
    });
    saveMembership(data);
    enterMatch();
  } catch (error) {
    showLobbyMessage(error.message);
    $("joinRoom").disabled = false;
  }
}

function me() {
  return room?.players.find(player => player.id === playerId);
}

function renderPlayers() {
  const x = room.players.find(player => player.symbol === "X");
  const o = room.players.find(player => player.symbol === "O");
  const current = room.currentTurn;

  $("nameX").textContent = x?.name || "Waiting for player";
  $("nameO").textContent = o?.name || "Waiting...";
  $("statusX").textContent = x ? (x.connected ? (current === x.id ? "Your move" : "Connected") : "Reconnecting...") : "Waiting";
  $("statusO").textContent = o ? (o.connected ? (current === o.id ? "Your move" : "Connected") : "Reconnecting...") : "Not connected";
  $("playerX").classList.toggle("active", !!x && current === x.id && room.status === "playing");
  $("playerO").classList.toggle("active", !!o && current === o.id && room.status === "playing");
  $("scoreNameX").textContent = x?.name || "Player X";
  $("scoreNameO").textContent = o?.name || "Player O";
  $("winsX").textContent = x?.score?.wins ?? 0;
  $("winsO").textContent = o?.score?.wins ?? 0;
  $("draws").textContent = room.drawCount || 0;
  $("roundLabel").textContent = `Round ${room.round || 1}`;
}

function renderBoard() {
  const squares = document.querySelectorAll(".square");
  const current = room.currentTurn;
  const myTurn = current === playerId;
  squares.forEach((square, index) => {
    const value = room.board[index] || "";
    square.textContent = value;
    square.classList.toggle("x", value === "X");
    square.classList.toggle("o", value === "O");
    square.classList.toggle("winning", (room.winningCells || []).includes(index));
    square.disabled = room.status !== "playing" || !myTurn || !!value;
    square.setAttribute("aria-label", `Cell ${index + 1}${value ? ": " + value : ""}`);
  });
}

function renderChat() {
  const container = $("chatMessages");
  container.innerHTML = "";
  const messages = room.chat || [];
  if (!messages.length) {
    const empty = document.createElement("p");
    empty.className = "chat-empty";
    empty.textContent = "Messages from your opponent will appear here.";
    container.appendChild(empty);
    return;
  }
  messages.forEach(item => {
    const bubble = document.createElement("article");
    bubble.className = "chat-message" + (item.playerId === playerId ? " mine" : "");
    const name = document.createElement("strong");
    name.textContent = item.name;
    const body = document.createElement("p");
    body.textContent = item.text;
    bubble.append(name, body);
    container.appendChild(bubble);
  });
  container.scrollTop = container.scrollHeight;
}

function renderRoom() {
  if (!room) return;
  $("roomCodeLabel").textContent = room.code;
  renderPlayers();
  renderBoard();
  renderChat();

  const player = me();
  const bothConnected = room.players.length === 2 && room.players.every(p => p.connected);
  const start = $("startMatch");
  start.hidden = !(player?.host && room.status === "waiting" && bothConnected);
  start.disabled = !bothConnected;

  const rematch = $("rematchButton");
  rematch.hidden = room.status !== "finished";
  if (room.status === "finished") {
    const voted = room.rematchVotes?.includes(playerId);
    const opponentRequested = room.rematchVotes?.some(id => id !== playerId);

    rematch.textContent = voted
      ? "Waiting for acceptance..."
      : opponentRequested
        ? "Accept Rematch"
        : "Request Rematch";

    rematch.disabled = !!voted;
  }

  if (room.status === "waiting") {
    $("turnLabel").textContent = bothConnected ? "Ready to play?" : "Waiting for opponent";
    $("gameMessage").textContent = bothConnected
      ? (player?.host ? "Both players connected. Start when you're ready." : "Waiting for the host to start.")
      : "Share the room code with your friend.";
  } else if (room.status === "paused") {
    $("turnLabel").textContent = "Match paused";
    $("gameMessage").textContent = "Waiting for the disconnected player to reconnect.";
  } else if (room.status === "playing") {
    const current = room.players.find(p => p.id === room.currentTurn);
    $("turnLabel").textContent = current
      ? (current.id === playerId ? "Your turn" : `${current.name}'s turn`)
      : "Match in progress";
    $("gameMessage").textContent = room.currentTurn === playerId
      ? "Choose an empty square."
      : "Watch the board. Your turn is next.";
  } else if (room.status === "finished") {
    if (room.winner) {
      const winner = room.players.find(p => p.id === room.winner);
      $("turnLabel").textContent = winner?.id === playerId ? "You won! ðŸŽ‰" : `${winner?.name || "Opponent"} wins`;
      $("gameMessage").textContent = `${winner?.name || "A player"} completed three in a row. Request a rematch?`;
    } else {
      $("turnLabel").textContent = "It's a draw!";
      $("gameMessage").textContent = "Nobody completed a line. Request a rematch?";
    }
  }
  updateTimer();
}

function updateTimer() {
  clearInterval(countdownHandle);
  const tick = () => {
    if (!room?.turnDeadline || room.status !== "playing") {
      $("timerValue").textContent = "30";
      return;
    }
    const remaining = Math.max(0, Math.ceil((room.turnDeadline - Date.now()) / 1000));
    $("timerValue").textContent = String(remaining).padStart(2, "0");
    $("timerValue").style.color = remaining <= 7 ? "#ff718d" : "#f5f6ff";
  };
  tick();
  countdownHandle = setInterval(tick, 250);
}

document.querySelectorAll(".square").forEach(square => {
  square.addEventListener("click", () => {
    const index = Number(square.dataset.index);
    if (!Number.isInteger(index)) return;
    socket.emit("ttt:move", { index });
  });
});

$("createRoom").addEventListener("click", createRoom);
$("joinRoom").addEventListener("click", joinRoom);
$("roomCode").addEventListener("input", event => {
  event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
});
$("startMatch").addEventListener("click", () => socket.emit("ttt:start"));
$("rematchButton").addEventListener("click", () => socket.emit("ttt:rematchVote"));

$("copyInvite").addEventListener("click", async () => {
  if (!roomCode) {
    toast("Room code is not available.");
    return;
  }

  const inviteUrl = new URL(location.href);
  inviteUrl.searchParams.set("room", roomCode);
  const textToCopy = inviteUrl.toString();

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(textToCopy);
    } else {
      throw new Error("Clipboard API unavailable");
    }

    toast("Invite link copied!");
  } catch {
    const field = document.createElement("textarea");
    field.value = textToCopy;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.left = "-9999px";

    document.body.appendChild(field);
    field.select();
    field.setSelectionRange(0, field.value.length);

    let copied = false;

    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }

    field.remove();

    if (copied) {
      toast("Invite link copied!");
    } else {
      toast(`Copy failed. Room code: ${roomCode}`);
    }
  }
});

function sendChat(text) {
  const clean = String(text || "").trim();
  if (!clean) return;
  socket.emit("ttt:chat", clean);
}
$("chatForm").addEventListener("submit", event => {
  event.preventDefault();
  sendChat($("chatInput").value);
  $("chatInput").value = "";
});
document.querySelectorAll("[data-reaction]").forEach(button => {
  button.addEventListener("click", () => sendChat(button.dataset.reaction));
});

$("leaveRoom").addEventListener("click", () => {
  socket.emit("ttt:leave");
  socket.disconnect();
  if (roomCode) localStorage.removeItem("ttt-" + roomCode);
  location.href = "/";
});

socket.on("connect", subscribe);
socket.on("ttt:state", state => {
  room = state;
  renderRoom();
});
socket.on("ttt:error", text => toast(text));
socket.on("ttt:notice", text => toast(text));
socket.on("disconnect", () => {
  if (room) $("turnLabel").textContent = "Connection lost â€” reconnecting...";
});

const queryRoom = new URLSearchParams(location.search).get("room");
if (queryRoom) $("roomCode").value = queryRoom.toUpperCase();


