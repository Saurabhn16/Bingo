const socket = io("https://bingo-512e.onrender.com");

// Update BINGO letters only. Player names stay normal.
// Update BINGO letters only. Player names stay normal.
function updateBingoLetters(lineCount) {
  const count = Math.max(0, Math.min(5, Number(lineCount) || 0));

  document.querySelectorAll("#bingoLetters span").forEach((letter, index) => {
    letter.classList.toggle("completed", index < count);
  });
}
const $ = id => document.getElementById(id);
let board = Array.from({ length: 25 }, (_, i) => i + 1);
let room = null;
let roomCode = null;
let playerId = null;
let playerToken = null;
let selectedCell = null;
let audioContext = null;

function shuffleBoard() {
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

  board.forEach((number, index) => {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cell";
    cell.textContent = number;

    if (selectedCell === index) cell.classList.add("selected");

    cell.onclick = () => {
      if (selectedValue("method") !== "manual") return;

      if (selectedCell === null) {
        selectedCell = index;
      } else {
        [board[selectedCell], board[index]] =
          [board[index], board[selectedCell]];
        selectedCell = null;
      }

      renderPreview();
    };

    preview.appendChild(cell);
  });
}

function selectedValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`).value;
}

function message(text) {
  $("message").textContent = text;
}

async function request(url, body = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await response.json();

  if (!response.ok)
    throw new Error(data.error || "Request failed.");

  return data;
}

function saveMembership(data) {
  room = data.room;
  playerId = data.playerId;
  playerToken = data.playerToken;
  roomCode = data.room.code;

  localStorage.setItem("bingo-" + roomCode, JSON.stringify({
    playerId,
    playerToken
  }));
}

function subscribe() {
  if (!roomCode || !playerId || !playerToken) return;

  socket.emit("room:subscribe", {
    code: roomCode,
    playerId,
    playerToken
  });
}

function connectRoom() {
  if (socket.connected) subscribe();
  else socket.connect();
}

async function createRoom() {
  try {
    const data = await request("/api/rooms", {
      name: $("nickname").value.trim(),
      board,
      boardStyle: selectedValue("style")
    });

    saveMembership(data);
    connectRoom();
    message("Room created! Share the code with your friends.");
  } catch (error) {
    message(error.message);
  }
}

async function joinRoom() {
  try {
    const code = $("roomCode").value.trim().toUpperCase();

    if (!code) {
      message("Please enter a room code.");
      return;
    }

    const saved = localStorage.getItem("bingo-" + code);
    const membership = saved ? JSON.parse(saved) : {};

    const data = await request(
      "/api/rooms/" + encodeURIComponent(code) + "/join",
      {
        name: $("nickname").value.trim(),
        board,
        playerToken: membership.playerToken || ""
      }
    );

    saveMembership(data);
    connectRoom();
    message("Successfully joined room " + code);
  } catch (error) {
    message(error.message);
  }
}

// Browser-generated game audio. No external audio files required.
function playSound(frequencies) {
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;

    if (!audioContext) audioContext = new Audio();

    if (audioContext.state === "suspended") audioContext.resume();

    frequencies.forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const start = audioContext.currentTime + index * 0.13;

      oscillator.type = "sine";
      oscillator.frequency.value = frequency;

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);

      oscillator.connect(gain);
      gain.connect(audioContext.destination);

      oscillator.start(start);
      oscillator.stop(start + 0.24);
    });
  } catch (error) {
    console.warn("Audio unavailable:", error);
  }
}

function renderPlayers() {
  const container = document.querySelector(".players");
  container.innerHTML = "";

  room.players.forEach(player => {
    const card = document.createElement("div");
    card.className = "player-card" + (player.id === playerId ? " you" : "");;

    const name = document.createElement("strong");
    name.textContent =
      `${player.host ? "ðŸ‘‘ " : "ðŸŽ® "}${player.name}` +
      (player.id === playerId ? " (YOU)" : "");

    const status = document.createElement("p");
    status.textContent = player.forfeited
      ? "Forfeited"
      : player.connected ? "Connected" : "Disconnected";

    const lines = document.createElement("small");
    lines.textContent = `${player.lineCount}/5 lines`;

    card.append(name, status, lines);
    container.appendChild(card);
  });
}

function renderBoard(me, winner) {
  const container = $("board");
  container.innerHTML = "";

  room.called = room.called || [];

  me.board.forEach(number => {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cell";
    cell.textContent = number;

    if (room.called.includes(number))
      cell.classList.add("marked");

    cell.disabled =
      !room.started ||
      !!winner ||
      me.forfeited ||
      room.currentTurn !== playerId ||
      room.called.includes(number);

    cell.onclick = () => {
      if (cell.disabled) return;
      socket.emit("match:mark", number);
    };

    container.appendChild(cell);
  });
}

// Final preview: every player's board and completed winning lines.
function renderFinalResults(winner) {
  let result = $("finalResults");

  if (!result) {
    result = document.createElement("section");
    result.id = "finalResults";
    result.className = "final-results";
    $("game").appendChild(result);
  }

  result.innerHTML = "";

  const heading = document.createElement("h2");
  heading.textContent = `\u{1F3C6} ${winner.name} WINS!`;
  result.appendChild(heading);

  const subtitle = document.createElement("p");
  subtitle.textContent = "FINAL MATCH RESULTS";
  result.appendChild(subtitle);

  room.players.forEach(player => {
    const card = document.createElement("div");
    card.className = "final-player-card";

    const title = document.createElement("h3");
    title.textContent = `${player.name} â€” ${player.lineCount}/5 lines`;
    card.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "final-board";

    const winningCells = new Set(player.winningCells || []);

    player.board.forEach((number, index) => {
      const cell = document.createElement("div");
      cell.className = "final-cell";
      cell.textContent = number;

      if (room.called.includes(number))
        cell.classList.add("marked");

      if (winningCells.has(index))
        cell.classList.add("winning-cell");

      grid.appendChild(cell);
    });

    card.appendChild(grid);
    result.appendChild(card);
  });

  const me = room.players.find(p => p.id === playerId);
  if (me) updateBingoLetters(me.lineCount);
  const active = room.players.filter(p => p.connected && !p.forfeited);

  // Play Again is displayed inside the final results preview.
  if (me?.host && active.length >= 2) {
    const replay = document.createElement("button");
    replay.id = "playAgainButton";
    replay.className = "play-again";
    replay.textContent = "ðŸ”„ PLAY AGAIN";

    replay.onclick = () => {
      replay.disabled = true;
      replay.textContent = "STARTING NEW GAME...";
      socket.emit("match:playAgain");
    };

    result.appendChild(replay);
  }
}

function renderRoom() {
  if (!room) return;

  $("code").textContent = room.code;
  renderPlayers();

  const me = room.players.find(p => p.id === playerId);
  if (me) updateBingoLetters(me.lineCount);
  if (!me) return;

  const active = room.players.filter(p => p.connected && !p.forfeited);
  const start = $("start");

  start.hidden = room.started || !me.host || active.length < 2;
  start.disabled = start.hidden;

  if (!room.started) {
    $("turn").textContent = "Waiting for players";
    $("score").textContent =
      `${active.length}/5 connected players. Host can start with 2 or more.`;
    return;
  }

  const winner = room.players.find(p => p.id === room.winner);
  const current = room.players.find(p => p.id === room.currentTurn);

  if (winner) {
    $("turn").textContent =
      winner.id === playerId ? "YOU WIN! ðŸ†" : `${winner.name} WINS! ðŸ†`;

    $("score").textContent = "Game completed! Check the final boards below.";

    renderBoard(me, winner);
    renderFinalResults(winner);
    return;
  }

  $("finalResults")?.remove();

  if (me.forfeited) {
    $("turn").textContent = "YOU FORFEITED THIS MATCH";
  } else if (room.currentTurn === playerId) {
    $("turn").textContent = "YOUR TURN â€” PICK A NUMBER";
  } else {
    $("turn").textContent = current
      ? `${current.name}'S TURN`
      : "WAITING...";
  }

  $("score").textContent = room.players
    .map(p => `${p.name}: ${p.lineCount}/5 lines`)
    .join("  |  ");

  renderBoard(me, null);
}

// ==========================================
// BUTTONS AND EVENTS
// ==========================================

$("shuffle").onclick = shuffleBoard;

$("reset").onclick = () => {
  board = Array.from({ length: 25 }, (_, i) => i + 1);
  selectedCell = null;
  renderPreview();
};

document.querySelectorAll('input[name="method"]').forEach(input => {
  input.addEventListener("change", () => {
    const manual = selectedValue("method") === "manual";

    $("setupHint").textContent = manual
      ? "Select one cell and then another to swap their numbers."
      : "Random mode automatically shuffles numbers 1â€“25.";

    if (!manual) shuffleBoard();
  });
});

$("create").onclick = createRoom;
$("join").onclick = joinRoom;

$("start").onclick = () => {
  socket.emit("match:start");
};

$("copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText(roomCode);
    $("copy").textContent = "Copied!";
  } catch {
    message("Copy the room code manually: " + roomCode);
  }
};

$("leave").onclick = () => {
  socket.disconnect();

  if (roomCode)
    localStorage.removeItem("bingo-" + roomCode);

  location.reload();
};

$("roomCode").addEventListener("input", event => {
  event.target.value = event.target.value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
});

socket.on("connect", () => {
  subscribe();
});

socket.on("room:state", state => {
  const previous = room;
  const previousWinner = previous?.winner;
  const previousCalled = previous?.called?.length || 0;

  room = state;

  $("setup").hidden = true;
  $("game").hidden = false;

  renderRoom();

  if (state.winner && !previousWinner) {
    playSound([523, 659, 784, 1047]);
  } else if (state.called.length > previousCalled) {
    playSound([520]);
  }
});

socket.on("game:error", error => {
  message(typeof error === "string" ? error : "Game error.");
});

socket.on("connect_error", () => {
  message("Could not connect to the game server.");
});

socket.on("disconnect", () => {
  if (room)
    $("turn").textContent = "Connection lost. Reconnecting...";
});

shuffleBoard();
$("setup").hidden = false;
$("game").hidden = true;






