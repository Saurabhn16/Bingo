const socket = io();

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
  `${"\u{1F451} "}${player.name}` +
  (player.id === playerId ? " (YOU)" : "");
const status = document.createElement("p");
    status.textContent = player.forfeited
      ? "Forfeited"
      : player.connected ? "Connected" : "Disconnected";

    const lines = document.createElement("small");
    lines.className = "player-record";
    const wins = player.score?.wins || 0;
    const totalRounds = room.round || 0;
    lines.textContent = `${wins}/${totalRounds} ROUNDS WON`;

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
  heading.textContent = `${winner.name} WINS!`;
  result.appendChild(heading);

  const subtitle = document.createElement("p");
  subtitle.textContent = `ROUND ${room.round || 1} COMPLETE`;
  result.appendChild(subtitle);

  // Match scoreboard
  const scoreboard = document.createElement("div");
  scoreboard.className = "match-scoreboard";

  const scoreTitle = document.createElement("h3");
  scoreTitle.className = "match-score-title";
  scoreTitle.textContent = "MATCH SCOREBOARD";
  scoreboard.appendChild(scoreTitle);

  const scoreGrid = document.createElement("div");
  scoreGrid.className = "match-score-grid";

  room.players.forEach(player => {
    const card = document.createElement("div");
    card.className = "match-score-card" +
      (player.id === winner.id ? " match-leader" : "");

    const playerName = document.createElement("strong");
    playerName.textContent =
      player.name + (player.id === playerId ? " (YOU)" : "");

    const wins = document.createElement("span");
    wins.className = "match-win-count";
    wins.textContent = String(player.score?.wins || 0);

    const label = document.createElement("small");
    label.textContent = "ROUND WINS";

    card.append(playerName, wins, label);
    scoreGrid.appendChild(card);
  });

  scoreboard.appendChild(scoreGrid);
  result.appendChild(scoreboard);

  // Final board previews
  room.players.forEach(player => {
    const card = document.createElement("div");
    card.className = "final-player-card";

    const title = document.createElement("h3");
    title.textContent =
      `${player.name} â€” ${player.lineCount}/5 lines`;
    card.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "final-board";

    const winningCells = new Set(player.winningCells || []);

    player.board.forEach((number, index) => {
      const cell = document.createElement("div");
      cell.className = "final-cell";
      cell.textContent = number;

      if (room.called.includes(number)) cell.classList.add("marked");
      if (winningCells.has(index)) cell.classList.add("winning-cell");

      grid.appendChild(cell);
    });

    card.appendChild(grid);
    result.appendChild(card);
  });

  const me = room.players.find(p => p.id === playerId);
  if (me) updateBingoLetters(me.lineCount);

  // Rematch voting
  const active = room.players.filter(p => p.connected && !p.forfeited);
  const votes = room.rematchVotes || [];
  const hasVoted = votes.includes(playerId);
  const allAccepted = active.length >= 2 &&
    active.every(p => votes.includes(p.id));

  const rematchPanel = document.createElement("div");
  rematchPanel.className = "rematch-panel";

  const rematchTitle = document.createElement("h3");
  rematchTitle.textContent = "\u{1F504} Another Round?";
  rematchPanel.appendChild(rematchTitle);

  const rematchInfo = document.createElement("p");
  rematchInfo.className = "rematch-info";

  if (allAccepted) {
    rematchInfo.textContent = "Everyone accepted! Starting the next round...";
  } else if (hasVoted) {
    rematchInfo.textContent =
      `You accepted. Waiting for ${active.length - votes.length} more player(s).`;
  } else {
    rematchInfo.textContent =
      `${votes.length} of ${active.length} players accepted the rematch.`;
  }

  rematchPanel.appendChild(rematchInfo);

  const voteButton = document.createElement("button");
  voteButton.className = "play-again";
  voteButton.textContent = hasVoted
    ? "\u{2713} REMATCH REQUESTED"
    : "\u{1F504} REQUEST REMATCH";
  voteButton.disabled = hasVoted || active.length < 2;

  voteButton.onclick = () => {
    voteButton.disabled = true;
    voteButton.textContent = "WAITING FOR PLAYERS...";
    socket.emit("match:rematchVote");
  };

  rematchPanel.appendChild(voteButton);

  if (active.length < 2) {
    rematchInfo.textContent = "At least 2 connected players are required.";
  }

  result.appendChild(rematchPanel);
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
    $("turn").textContent = winner.id === playerId ? "YOU WIN!" : `${winner.name} WINS!`;

    $("score").textContent = "Game completed! Check the final boards below.";

    renderBoard(me, winner);
    renderFinalResults(winner);
    return;
  }

  $("finalResults")?.remove();

  if (me.forfeited) {
    $("turn").textContent = "YOU FORFEITED THIS MATCH";
  } else if (room.currentTurn === playerId) {
    $("turn").textContent = "YOUR TURN - PICK A NUMBER";
  } else {
    $("turn").textContent = current
      ? `${current.name}'S TURN`
      : "WAITING...";
  }

  $("score").textContent = room.players
    .map(p => `${p.name}: ${p.score?.wins || 0}/${room.round || 0} wins`)
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
      : "Random mode automatically shuffles numbers 1Ã¢â‚¬â€œ25.";

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












