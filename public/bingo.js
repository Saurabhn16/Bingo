const socket = io("https://bingo-512e.onrender.com");
const $ = id => document.getElementById(id);
let board = Array.from({ length: 25 }, (_, i) => i + 1);
let roomCode = null;
let playerId = null;
let playerToken = null;
let room = null;
let selectedCell = null;

function randomBoard() {
  board = Array.from({ length: 25 }, (_, i) => i + 1);

  for (let i = board.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [board[i], board[j]] = [board[j], board[i]];
  }

  selectedCell = null;
  renderPreview();
}

function renderPreview() {
  const preview = $("preview");
  preview.innerHTML = "";

  board.forEach((n, i) => {
    const cell = document.createElement("button");
    cell.className = "cell";
    cell.textContent = n;
    cell.type = "button";

    cell.onclick = () => {
      if (document.querySelector('input[name="method"]:checked').value !== "manual")
        return;

      if (selectedCell === null) {
        selectedCell = i;
        cell.classList.add("selected");
        return;
      }

      [board[selectedCell], board[i]] = [board[i], board[selectedCell]];
      selectedCell = null;
      renderPreview();
    };

    preview.appendChild(cell);
  });
}

$("shuffle").onclick = randomBoard;
$("reset").onclick = randomBoard;

document.querySelectorAll('input[name="method"]').forEach(r =>
  r.addEventListener("change", () => {
    const manual = document.querySelector('input[name="method"]:checked').value === "manual";

    $("setupHint").textContent = manual
      ? "Tap one cell, then another to swap their numbers."
      : "Random mode automatically shuffles numbers 1–25.";

    if (!manual) randomBoard();
  })
);

function message(t) {
  $("message").textContent = t;
}

async function request(url, data) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });

  const result = await res.json();

  if (!res.ok) throw new Error(result.error || "Request failed");

  return result;
}

function setupPayload(code = "") {
  return {
    name: $("nickname").value.trim(),
    board: [...board],
    boardStyle: document.querySelector('input[name="style"]:checked').value,
    playerToken: code
      ? localStorage.getItem("bingo-token-" + code.toUpperCase()) || ""
      : ""
  };
}

async function enter(data) {
  roomCode = data.room.code;
  playerId = data.playerId;
  playerToken = data.playerToken;

  localStorage.setItem("bingo-token-" + roomCode, playerToken);

  $("setup").hidden = true;
  $("game").hidden = false;
  $("code").textContent = roomCode;

  socket.emit("room:subscribe", {
    code: roomCode,
    playerId,
    playerToken
  });
}

$("create").onclick = async () => {
  try {
    const data = await request("/api/rooms", setupPayload());
    await enter(data);
  } catch (e) {
    message(e.message);
  }
};

$("join").onclick = async () => {
  try {
    const code = $("roomCode").value.trim().toUpperCase();
    const data = await request(
      "/api/rooms/" + code + "/join",
      setupPayload(code)
    );

    await enter(data);
  } catch (e) {
    message(e.message);
  }
};

$("start").onclick = () => socket.emit("match:start");

$("copy").onclick = async () => {
  await navigator.clipboard.writeText(roomCode);
  $("copy").textContent = "Copied!";
};

$("leave").onclick = () => location.reload();

socket.on("room:state", state => {
  room = state;
  renderGame();
});

socket.on("game:error", text => {
  $("turn").textContent = text;
});

function renderPlayers() {
  let list = $("playersList");

  if (!list) {
    list = document.createElement("div");
    list.id = "playersList";
    list.style.display = "grid";
    list.style.gridTemplateColumns = "repeat(auto-fit, minmax(125px, 1fr))";
    list.style.gap = "10px";
    list.style.margin = "15px 0";

    $("board").parentNode.insertBefore(list, $("board"));
  }

  list.innerHTML = "";

  room.players.forEach((p, index) => {
    const card = document.createElement("div");

    card.style.padding = "12px";
    card.style.borderRadius = "10px";
    card.style.background = room.currentTurn === p.id && room.started
      ? "#39245f" : "#202033";
    card.style.border = room.currentTurn === p.id && room.started
      ? "2px solid #a78bfa" : "1px solid #444";

    const name = document.createElement("div");
    name.textContent = (p.host ? "👑 " : "🎮 ") + p.name;
    name.style.fontWeight = "bold";

    const lines = document.createElement("div");
    lines.textContent = `${p.lineCount}/5 lines`;
    lines.style.marginTop = "5px";

    const status = document.createElement("div");
    status.style.fontSize = "12px";
    status.style.marginTop = "5px";

    if (room.winner === p.id) {
      status.textContent = "🏆 WINNER";
    } else if (p.forfeited) {
      status.textContent = "FORFEITED";
    } else if (!p.connected) {
      status.textContent = "DISCONNECTED";
    } else if (room.currentTurn === p.id && room.started) {
      status.textContent = "YOUR TURN";
    } else if (!room.started) {
      status.textContent = p.host ? "HOST" : "READY";
    } else {
      status.textContent = "WAITING";
    }

    card.append(name, lines, status);
    list.appendChild(card);
  });
}

function renderGame() {
  if (!room) return;

  const me = room.players.find(p => p.id === playerId);
  if (!me) return;

  // Remove the old two-player boxes and show the current player's identity.
  $("p1").hidden = true;
  $("p2").hidden = true;

  let identity = $("myPlayerIdentity");

  if (!identity) {
    identity = document.createElement("div");
    identity.id = "myPlayerIdentity";

    identity.style.width = "100%";
    identity.style.boxSizing = "border-box";
    identity.style.padding = "13px 18px";
    identity.style.margin = "12px 0 20px";
    identity.style.borderRadius = "12px";
    identity.style.background = "#30204d";
    identity.style.border = "1px solid #a78bfa";
    identity.style.color = "#d8b4fe";
    identity.style.fontSize = "20px";
    identity.style.fontWeight = "bold";
    identity.style.textAlign = "center";

    $("p1").parentElement.insertBefore(identity, $("p1"));
  }

  const myPosition = room.players.findIndex(p => p.id === playerId) + 1;
  identity.textContent = `YOU ARE PLAYER ${myPosition}`;

  const canStart =
    !room.started &&
    room.players.filter(p => p.connected && !p.forfeited).length >= 2 &&
    me.host;

  $("start").hidden = !canStart;
  $("start").style.display = canStart ? "block" : "none";
  $("start").disabled = !canStart;

  const winner = room.players.find(p => p.id === room.winner);

  if (winner) {
    $("turn").textContent = winner.id === playerId
      ? "YOU WIN! 🎉"
      : `${winner.name} WINS! 🏆`;
  } else if (!room.started) {
    $("turn").textContent = `${room.players.length} player slots used. Waiting for host to start.`;
  } else if (me.forfeited) {
    $("turn").textContent = "YOU HAVE FORFEITED THIS MATCH";
  } else if (!me.connected) {
    $("turn").textContent = "DISCONNECTED";
  } else if (room.currentTurn === playerId) {
    $("turn").textContent = "IT'S YOUR TURN!";
  } else {
    const current = room.players.find(p => p.id === room.currentTurn);
    $("turn").textContent = current
      ? `${current.name}'S TURN`
      : "MATCH FINISHED";
  }

  $("score").textContent = room.players
    .map(p => `${p.name}: ${p.lineCount}/5`)
    .join(" · ");

  const letters = $("bingoLetters")?.querySelectorAll("span") || [];
  letters.forEach((letter, i) =>
    letter.classList.toggle("cut", i < me.lineCount)
  );

  renderPlayers();

  const boardElement = $("board");
  boardElement.innerHTML = "";

  me.board.forEach(n => {
    const cell = document.createElement("button");

    cell.className = "cell" + (room.called.includes(n) ? " marked" : "");
    cell.textContent = n;

    cell.disabled =
      !room.started ||
      me.forfeited ||
      !me.connected ||
      room.currentTurn !== playerId ||
      !!room.winner ||
      room.called.includes(n);

    cell.onclick = () => socket.emit("match:mark", n);
    boardElement.appendChild(cell);
  });
}

randomBoard();

