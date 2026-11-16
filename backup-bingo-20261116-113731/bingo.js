const $ = (id) => document.getElementById(id);

const state = {
  socket: null,
  room: null,
  playerId: null,
  playerToken: null,
  nickname: "",
  board: [],
  marked: [],
  match: null,
  you: null,
  busy: false
};

const API_BASE = "/api";

function showMessage(targetId, message, success = false) {
  const element = $(targetId);
  if (!element) return;
  element.textContent = message || "";
  element.classList.toggle("success", success);
}

function showSection(section) {
  ["setupSection", "lobbySection", "gameSection"].forEach((id) => {
    $(id).classList.toggle("hidden", id !== section);
  });
}

function randomBoard() {
  const board = Array.from({ length:  25 }, (_, index) => index + 1);
  for (let index = board.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [board[index], board[swapIndex]] = [board[swapIndex], board[index]];
  }
  return board;
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (state.playerId) headers["x-player-id"] = state.playerId;
  if (state.playerToken) headers["x-player-token"] = state.playerToken;

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error?.message || payload.message || `Request failed (${response.status})`);
  }
  return payload;
}

function saveMembership(payload) {
  state.room = payload.room;
  state.playerId = payload.playerId;
  state.playerToken = payload.playerToken;
  state.nickname = payload.you?.nickname || state.nickname;
  state.you = payload.you || null;
  state.board = payload.you?.board || [];
  state.match = payload.match?.match || null;
  state.marked = payload.match?.you?.markedNumbers || [];

  sessionStorage.setItem("bingoMembership", JSON.stringify({
    roomCode: payload.room.code,
    playerId: payload.playerId,
    playerToken: payload.playerToken,
    nickname: state.nickname
  }));
}

function applyRealtimePayload(payload) {
  if (payload.roomView) state.room = payload.roomView;
  else if (payload.room) state.room = payload.room;

  // Subscribe acknowledgements and room:state events send the public match
  // and this player's private board as separate properties.
  if (Object.prototype.hasOwnProperty.call(payload, "match")) {
    state.match = payload.match?.match ?? payload.match ?? null;
  }
  if (payload.you) {
    state.you = payload.you;
    if (Array.isArray(payload.you.board)) state.board = payload.you.board;
    if (Array.isArray(payload.you.markedNumbers)) state.marked = payload.you.markedNumbers;
  }

  renderLobby();
  if (state.match?.status === "in_progress" || state.match?.status === "finished") {
    renderGame();
    showSection("gameSection");
    if (state.match.status === "finished") renderResult();
  } else {
    showSection("lobbySection");
  }
}

function connectSocket() {
  if (state.socket) state.socket.disconnect();
  state.socket = io();

  state.socket.on("connect", () => {
    state.socket.emit("room:subscribe", {
      roomCode: state.room.code,
      playerId: state.playerId,
      playerToken: state.playerToken
    }, (response) => {
      if (!response?.ok) {
        showMessage("setupMessage", response?.error?.message || "Could not connect to the room.");
        return;
      }
      applyRealtimePayload(response);
    });
  });

  state.socket.on("room:state", applyRealtimePayload);

  state.socket.on("match:finished", (event) => {
    if (event?.winnerId && state.match) {
      state.match.winnerId = event.winnerId;
      state.match.status = "finished";
      renderResult();
    }
  });

  state.socket.on("connect_error", () => {
    const target = state.match ? "lobbyMessage" : "setupMessage";
    showMessage(target, "Realtime connection failed. Check that the server is running.");
  });

  state.socket.on("disconnect", (reason) => {
    if (reason !== "io client disconnect" && state.room) {
      showMessage(state.match ? "lobbyMessage" : "lobbyMessage", "Connection lost. Reconnecting...");
    }
  });
}

function renderLobby() {
  if (!state.room) return;
  $("roomCodeDisplay").textContent = state.room.code;
  $("gameRoomCode").textContent = state.room.code;

  const players = state.room.players || [];
  $("playerCount").textContent = `${players.length}/${state.room.capacity || 2}`;
  $("playersList").innerHTML = players.map((player) => `
    <article class="player-card">
      <strong>${escapeHtml(player.nickname)} ${player.isHost ? "👑" : ""}</strong>
      <small><span class="player-dot ${player.connected ? "online" : "offline"}"></span>${player.connected ? "Connected" : "Disconnected"}</small>
      ${player.id === state.playerId ? '<small class="you-label">YOU</small>' : ""}
    </article>
  `).join("");

  const ready = players.length >= 2;
  $("lobbyMessage").textContent = ready
    ? (state.room.hostId === state.playerId ? "Both players are ready. Start the match!" : "Both players are here. Waiting for the host to start.")
    : "Waiting for another player to join...";
  $("startMatchBtn").disabled = !state.room.canStart || state.room.hostId !== state.playerId || state.busy;
  $("startMatchBtn").textContent = state.room.hostId === state.playerId ? "Start Game" : "Waiting for Host";
}

function renderGame() {
  const match = state.match || {};
  const ownBoard = state.you?.board || state.board || [];
  const ownMarked = state.you?.markedNumbers || state.marked || [];
  const players = match.players || [];
  const me = players.find((player) => player.id === state.playerId);
  const opponent = players.find((player) => player.id !== state.playerId);
  const myTurn = match.currentCallerId === state.playerId;
  const canPlay = myTurn && !match.paused && match.status === "in_progress" && !state.busy;

  $("myPlayerName").textContent = me?.nickname || state.nickname || "You";
  $("opponentName").textContent = opponent?.nickname || "Waiting...";
  $("myMarkedCount").textContent = String(me?.markedCount ?? ownMarked.length);
  $("myMarkedCountBadge").textContent = String(me?.markedCount ?? ownMarked.length);
  $("opponentMarkedCount").textContent = String(opponent?.markedCount ?? 0);

  $("turnStatus").classList.toggle("your-turn", canPlay);
  $("turnStatus").classList.toggle("opponent-turn", !canPlay && match.status === "in_progress");
  $("turnTitle").textContent = match.status === "finished"
    ? "MATCH FINISHED"
    : match.paused ? "GAME PAUSED" : canPlay ? "IT'S YOUR TURN!" : "OPPONENT'S TURN";
  $("turnSubtitle").textContent = match.status === "finished"
    ? "Check the result below."
    : match.paused ? "The player whose turn it is has disconnected."
      : canPlay ? "Choose any unmarked number on your board."
        : `${opponent?.nickname || "Your opponent"} is choosing a number.`;

  $("boardInstruction").textContent = canPlay
    ? "Tap any number to mark it green."
    : "Your board is locked until your next turn.";

  $("bingoBoard").innerHTML = ownBoard.map((number) => {
    const marked = ownMarked.includes(number);
    return `<button type="button" class="bingo-cell ${marked ? "marked" : ""}"
      data-number="${number}" aria-label="Number ${number}${marked ? ", marked" : ""}"
      aria-pressed="${marked}" ${!canPlay || marked ? "disabled" : ""}>${number}</button>`;
  }).join("");

  const moves = match.calls || [];
  const recent = moves.slice(-8).reverse();
  $("matchActivity").innerHTML = recent.length
    ? recent.map((move) => {
        const player = players.find((item) => item.id === move.byId);
        const isMe = move.byId === state.playerId;
        return `<li><strong>${escapeHtml(player?.nickname || "Player")}</strong> marked ${move.number}${isMe ? " (you)" : ""}</li>`;
      }).join("")
    : "<li>The game has started. Make the first move!</li>";
}

function renderResult() {
  const winner = state.match?.players?.find((player) => player.id === state.match.winnerId);
  const won = state.match?.winnerId === state.playerId;
  $("resultTitle").textContent = won ? "BINGO! YOU WIN!" : winner ? `${winner.nickname} WINS!` : "MATCH FINISHED";
  $("resultMessage").textContent = winner
    ? (won ? "Amazing! You completed the winning line first." : "Good game! Better luck next time.")
    : "The match has ended.";
  $("resultSection").classList.remove("hidden");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

async function withBusy(button, action) {
  if (state.busy) return;
  state.busy = true;
  if (button) button.disabled = true;
  try {
    await action();
  } catch (error) {
    showMessage(state.room ? "lobbyMessage" : "setupMessage", error.message);
  } finally {
    state.busy = false;
    if (state.room) renderLobby();
    if (state.match) renderGame();
  }
}

async function createRoom() {
  const nickname = $("nicknameInput").value.trim();
  if (nickname.length < 2 || nickname.length > 16) {
    showMessage("setupMessage", "Nickname must be 2–16 characters.");
    return;
  }

  state.nickname = nickname;
  await withBusy($("createRoomBtn"), async () => {
    const payload = await api("/rooms", {
      method: "POST",
      body: JSON.stringify({
        nickname,
        board: randomBoard(),
        visibility: "private",
        rules: { mode: "lines", linesToWin: 5 }
      })
    });
    saveMembership(payload);
    showSection("lobbySection");
    connectSocket();
    showMessage("lobbyMessage", "Room created. Share the code with your friend.", true);
    renderLobby();
  });
}

async function joinRoom() {
  const nickname = $("nicknameInput").value.trim();
  const code = $("roomCodeInput").value.trim().toUpperCase();
  if (nickname.length < 2 || nickname.length > 16) {
    showMessage("setupMessage", "Nickname must be 2–16 characters.");
    return;
  }
  if (!code) {
    showMessage("setupMessage", "Enter your friend's room code.");
    return;
  }

  state.nickname = nickname;
  await withBusy($("joinRoomBtn"), async () => {
    const payload = await api(`/rooms/${encodeURIComponent(code)}/join`, {
      method: "POST",
      body: JSON.stringify({ nickname, board: randomBoard() })
    });
    saveMembership(payload);
    showSection("lobbySection");
    connectSocket();
    renderLobby();
    showMessage("lobbyMessage", "You joined the room. Get ready!", true);
  });
}

function emitAction(event, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!state.socket?.connected) {
      reject(new Error("Not connected to the game server. Reconnecting..."));
      return;
    }
    state.socket.emit(event, payload, (response) => {
      if (!response?.ok) {
        reject(new Error(response?.error?.message || "Action failed."));
        return;
      }
      resolve(response);
    });
  });
}

async function startMatch() {
  await withBusy($("startMatchBtn"), async () => {
    await emitAction("match:start");
  });
}

async function markNumber(number, button) {
  if (state.busy) return;
  await withBusy(button, async () => {
    await emitAction("match:mark", { number });
  });
}

async function leaveRoom() {
  try {
    if (state.socket?.connected) await emitAction("room:leave");
  } catch (error) {
    console.warn("Leave room:", error.message);
  }
  state.socket?.disconnect();
  sessionStorage.removeItem("bingoMembership");
  state.room = null;
  state.match = null;
  state.playerId = null;
  state.playerToken = null;
  state.board = [];
  state.marked = [];
  $("nicknameInput").value = state.nickname;
  $("roomCodeInput").value = "";
  $("resultSection").classList.add("hidden");
  showSection("setupSection");
}

async function copyRoomCode() {
  if (!state.room?.code) return;
  try {
    await navigator.clipboard.writeText(state.room.code);
    $("copyRoomCodeBtn").textContent = "Copied!";
    setTimeout(() => { $("copyRoomCodeBtn").textContent = "Copy"; }, 1200);
  } catch {
    showMessage("lobbyMessage", `Copy this room code: ${state.room.code}`);
  }
}

async function restoreSession() {
  const saved = sessionStorage.getItem("bingoMembership");
  if (!saved) return;
  try {
    const membership = JSON.parse(saved);
    state.playerId = membership.playerId;
    state.playerToken = membership.playerToken;
    state.nickname = membership.nickname || "";
    $("nicknameInput").value = state.nickname;
    const payload = await api(`/rooms/${encodeURIComponent(membership.roomCode)}/rejoin`, {
      method: "POST",
      body: JSON.stringify({})
    });
    saveMembership(payload);
    showSection("lobbySection");
    connectSocket();
  } catch (error) {
    sessionStorage.removeItem("bingoMembership");
    state.playerId = null;
    state.playerToken = null;
    showSection("setupSection");
    showMessage("setupMessage", `Previous room could not be restored: ${error.message}`);
  }
}

$("createRoomBtn").addEventListener("click", createRoom);
$("joinRoomBtn").addEventListener("click", joinRoom);
$("startMatchBtn").addEventListener("click", startMatch);
$("copyRoomCodeBtn").addEventListener("click", copyRoomCode);
$("leaveRoomBtn").addEventListener("click", leaveRoom);
$("leaveGameBtn").addEventListener("click", leaveRoom);
$("backToSetupBtn").addEventListener("click", leaveRoom);

$("bingoBoard").addEventListener("click", (event) => {
  const button = event.target.closest("[data-number]");
  if (button && !button.disabled) markNumber(Number(button.dataset.number), button);
});

$("roomCodeInput").addEventListener("input", (event) => {
  event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
});

restoreSession();
