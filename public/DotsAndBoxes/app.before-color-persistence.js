(() => {
  const $ = id => document.getElementById(id);
  const socket = io();
  const COLORS = [
    { name: "Electric Purple", hex: "#A855F7" },
    { name: "Neon Cyan", hex: "#22D3EE" },
    { name: "Coral Red", hex: "#FB5B67" },
    { name: "Golden Yellow", hex: "#FBBF24" },
    { name: "Emerald Green", hex: "#10B981" },
    { name: "Hot Pink", hex: "#EC4899" },
    { name: "Royal Blue", hex: "#3B82F6" },
    { name: "Orange", hex: "#F97316" },
    { name: "Lime Green", hex: "#A3E635" },
    { name: "Lavender", hex: "#C4B5FD" }
  ];
  function setupColorPicker(containerId, inputId) {
    const container = $(containerId);
    const input = $(inputId);
    container.innerHTML = COLORS.map((color, index) => `
      <button type="button" class="color-swatch ${""}"
        style="--swatch:${color.hex}" data-color="${color.hex}"
        aria-label="${color.name}" title="${color.name}" aria-pressed="${index === 0}"></button>
    `).join("");
    container.addEventListener("click", event => {
      const swatch = event.target.closest(".color-swatch");
      if (!swatch) return;
      input.value = swatch.dataset.color;
      container.querySelectorAll(".color-swatch").forEach(button => {
        const selected = button === swatch;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-pressed", String(selected));
      });
    });
  }
  setupColorPicker("createColorPicker", "createColor");
  setupColorPicker("joinColorPicker", "joinColor");
  let identity = null;
  let state = null;
  let toastTimer = null;
  let previousMoveKey = null;

  const show = id => $(id).classList.remove("hidden");
  const hide = id => $(id).classList.add("hidden");
  function toast(message) {
    $("toast").textContent = message;
    $("toast").classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2600);
  }
  function setScreen(screen) {
    ["homeScreen","lobbyScreen","gameScreen"].forEach(id => hide(id));
    show(screen);
  }
  function saveIdentity(data) {
    identity = {
      code: data.room.code,
      playerId: data.playerId,
      playerToken: data.playerToken,
      name: data.room.players.find(p => p.id === data.playerId)?.name || ""
    };
    sessionStorage.setItem("dotsAndBoxesIdentity", JSON.stringify(identity));
  }
  async function post(url, body) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }
  function enterRoom(data) {
    saveIdentity(data);
    setScreen("lobbyScreen");
    $("homeError").textContent = "";
    if (socket.connected) subscribe();
    else socket.connect();
  }
  function subscribe() {
    if (!identity) return;
    socket.emit("db:subscribe", {
      code: identity.code,
      playerId: identity.playerId,
      playerToken: identity.playerToken,
      name: identity.name
    });
  }
  $("createForm").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      const data = await post("/api/dotsandboxes/rooms", {
        name: $("createName").value,
        size: Number($("boardSize").value),
        maxPlayers: Number($("playerLimit").value),
        color: $("createColor").value
      });
      enterRoom(data);
    } catch (error) { $("homeError").textContent = error.message; }
  });
  $("joinForm").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      const code = $("roomCode").value.trim().toUpperCase();
      const data = await post(`/api/dotsandboxes/rooms/${encodeURIComponent(code)}/join`, {
        name: $("joinName").value,
        color: $("joinColor").value
      });
      enterRoom(data);
    } catch (error) { $("homeError").textContent = error.message; }
  });
  $("roomCode").addEventListener("input", e => e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,""));
  socket.on("connect", () => {
    $("connection").classList.add("connected");
    $("connection").innerHTML = "<i></i> Connected";
    subscribe();
  });
  socket.on("disconnect", () => {
    $("connection").classList.remove("connected");
    $("connection").innerHTML = "<i></i> Reconnectingâ€¦";
  });
  socket.on("connect_error", () => {
    $("connection").classList.remove("connected");
    $("connection").innerHTML = "<i></i> Connection issue";
  });
  socket.on("db:error", message => toast(message));
  socket.on("db:state", next => {
    state = next;
    render();
  });

  function render() {
    if (!state || !identity) return;
    $("lobbyCode").textContent = state.code;
    $("lobbySize").textContent = `${state.settings.size} Ã— ${state.settings.size}`;
    $("lobbyLimit").textContent = `${state.settings.maxPlayers} players`;
    $("playerCount").textContent = `${state.players.length} / ${state.settings.maxPlayers} joined`;
    $("lobbyPlayers").innerHTML = state.players.map((p, i) => `
      <div class="player-row">
        <span class="avatar" style="background:${p.color}">${escapeHtml(p.name.slice(0,1).toUpperCase())}</span>
        <div><div class="player-name">${escapeHtml(p.name)}${p.id === identity.playerId ? " (You)" : ""}</div>
        <div class="player-meta">${p.connected ? "Connected" : "Reconnectingâ€¦"}</div></div>
        ${p.host ? '<span class="player-tag">â˜… LEADER</span>' : ""}
      </div>`).join("");
    const isHost = state.hostId === identity.playerId;
    $("startGame").classList.toggle("hidden", !isHost || state.status !== "waiting");
    $("lobbyHint").textContent = isHost
      ? "You are the leader. Start when at least two players are connected."
      : "Waiting for the room leader to start the game.";
    if (state.status === "waiting") {
      setScreen("lobbyScreen");
      return;
    }
    setScreen("gameScreen");
    $("gameRoomCode").textContent = state.code;
    $("boardTitle").textContent = `${state.settings.size} Ã— ${state.settings.size} board`;
    renderScoreboard();
    renderTurn();
    renderBoard();
    renderActivity();
    renderChat();
    if (state.status === "finished") renderResult();
    else hide("resultPanel");
  }
  function renderScoreboard() {
    $("scorePlayerCount").textContent = `${state.players.length} players`;
    $("scoreboard").innerHTML = state.players.map(p => `
      <div class="score-item ${p.id === identity.playerId ? "me" : ""}">
        <div class="score-name"><i class="score-color" style="background:${p.color}"></i>${escapeHtml(p.name)}${p.id === identity.playerId ? " Â· YOU" : ""}</div>
        <div class="score-value" style="color:${p.color}">${p.score}<small>boxes</small></div>
      </div>`).join("");
  }
  function renderTurn() {
    const current = state.players.find(p => p.id === state.currentTurn);
    const banner = $("turnBanner");
    if (state.status === "finished") {
      banner.innerHTML = '<span class="turn-indicator"></span><strong>Game complete Â· Final scores are in</strong>';
      $("gameStatus").textContent = "Finished";
      return;
    }
    if (state.status === "paused" || !current) {
      banner.innerHTML = '<span class="turn-indicator"></span><strong>Game paused Â· Waiting for players to reconnect</strong>';
      $("gameStatus").textContent = "Paused";
      return;
    }
    const mine = current.id === identity.playerId;
    banner.innerHTML = `<span class="turn-indicator" style="background:${current.color};box-shadow:0 0 12px ${current.color}"></span><strong>${mine ? "It's your turn!" : `${escapeHtml(current.name)}'s turn`}</strong><span style="margin-left:auto;color:#aab0ca">${mine ? "Choose a line" : "Waiting for moveâ€¦"}</span>`;
    $("gameStatus").textContent = "In progress";
  }
  function renderBoard() {
    const board = state.board;
    if (!board) return;
    const n = board.size;
    const root = $("gameBoard");
    root.style.setProperty("--n", n);
    root.innerHTML = "";
    const canPlay = state.status === "playing" && state.currentTurn === identity.playerId;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const cell = document.createElement("div");
        cell.className = "board-cell";
        const owner = board.boxes[r][c];
        if (owner) {
          const player = state.players.find(p => p.id === owner);
          const fill = document.createElement("div");
          fill.className = "box-fill";
          fill.style.background = player?.color || "#777";
          cell.appendChild(fill);
        }
        const topOwner = board.h[r][c];
        const leftOwner = board.v[r][c];
        const top = makeEdge("h", r, c, topOwner, canPlay);
        const left = makeEdge("v", r, c, leftOwner, canPlay);
        cell.append(top, left);
        const dot = document.createElement("i"); dot.className = "dot"; cell.appendChild(dot);
        root.appendChild(cell);
      }
    }
    // Complete the bottom and right outer edges and their terminal dots.
    const lastRow = n - 1;
    const lastCol = n - 1;
    for (let c = 0; c < n; c++) {
      const cell = root.children[lastRow * n + c];
      cell.appendChild(makeEdge("h", n, c, board.h[n][c], canPlay, "bottom"));
    }
    for (let r = 0; r < n; r++) {
      const cell = root.children[r * n + lastCol];
      cell.appendChild(makeEdge("v", r, n, board.v[r][n], canPlay, "right"));
    }
    // Place dots at the bottom/right boundaries.
    root.querySelectorAll(".dot").forEach((dot, i) => {
      const r = Math.floor(i / n), c = i % n;
      if (c === n - 1) {
        const rightDot = document.createElement("i"); rightDot.className = "dot";
        rightDot.style.left = "auto"; rightDot.style.right = "-5px"; dot.parentElement.appendChild(rightDot);
      }
      if (r === n - 1) {
        const bottomDot = document.createElement("i"); bottomDot.className = "dot";
        bottomDot.style.top = "auto"; bottomDot.style.bottom = "-5px"; dot.parentElement.appendChild(bottomDot);
      }
      if (r === n - 1 && c === n - 1) {
        const corner = document.createElement("i"); corner.className = "dot";
        corner.style.left = "auto"; corner.style.top = "auto"; corner.style.right = "-5px"; corner.style.bottom = "-5px";
        dot.parentElement.appendChild(corner);
      }
    });
    const claimed = board.boxes.flat().filter(Boolean).length;
    $("boardProgress").textContent = `${claimed} / ${board.totalBoxes} boxes claimed`;
    $("moveCount").textContent = `${board.moves} / ${board.totalMoves} lines`;
  }
  function makeEdge(orientation, row, col, ownerId, canPlay, extraClass = "") {
    const edge = document.createElement("button");
    edge.type = "button";
    edge.className = `edge ${orientation} ${extraClass} ${ownerId ? "claimed" : ""} ${!canPlay && !ownerId ? "disabled" : ""}`;
    edge.setAttribute("aria-label", `${orientation === "h" ? "Horizontal" : "Vertical"} line ${row + 1}, ${col + 1}${ownerId ? " already claimed" : ""}`);
    const owner = state.players.find(p => p.id === ownerId);
    if (ownerId) edge.style.background = owner?.color || "#777";
    edge.disabled = Boolean(ownerId) || !canPlay;
    edge.addEventListener("click", () => {
      if (!canPlay || ownerId) return;
      socket.emit("db:move", { orientation, row, col });
    });
    return edge;
  }
  function renderActivity() {
    const move = state.lastMove;
    if (!move) {
      $("activity").innerHTML = '<p class="empty-state">The first move is waiting to happen.</p>';
      return;
    }
    const player = state.players.find(p => p.id === move.playerId);
    const key = `${move.playerId}:${move.orientation}:${move.row}:${move.col}`;
    if (key !== previousMoveKey) previousMoveKey = key;
    const claimedText = move.claimed.length
      ? `claimed ${move.claimed.length} box${move.claimed.length > 1 ? "es" : ""}`
      : "drew a line";
    $("activity").innerHTML = `<div class="activity-item"><b style="color:${player?.color || "#fff"}">${escapeHtml(player?.name || "Player")}</b> ${claimedText}.</div>`;
  }
  function renderChat() {
    $("chatMessages").innerHTML = state.chat.map(m => `<div class="chat-message"><b style="color:${m.color}">${escapeHtml(m.name)}</b>${escapeHtml(m.text)}</div>`).join("");
    $("chatMessages").scrollTop = $("chatMessages").scrollHeight;
  }
  function renderResult() {
    show("resultPanel");
    const winners = state.players.filter(p => state.winnerIds.includes(p.id));
    $("resultTitle").textContent = winners.length > 1 ? "It's a tie!" : `${winners[0]?.name || "A player"} wins!`;
    $("resultText").textContent = winners.length > 1
      ? `Well played! ${winners.map(p => p.name).join(" and ")} share the top score.`
      : "Congratulations on claiming the most boxes!";
    $("finalScores").innerHTML = [...state.players].sort((a,b) => b.score-a.score).map(p =>
      `<div class="final-score"><span><i class="score-color" style="display:inline-block;background:${p.color};margin-right:8px"></i>${escapeHtml(p.name)}</span><b>${p.score} boxes</b></div>`
    ).join("");
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, ch => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[ch]));
  }
  $("startGame").addEventListener("click", () => socket.emit("db:start"));
  $("copyCode").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(state.code); toast("Room code copied!"); }
    catch { toast(`Room code: ${state.code}`); }
  });
  function leave() {
    socket.emit("db:leave");
    sessionStorage.removeItem("dotsAndBoxesIdentity");
    identity = null; state = null;
    setScreen("homeScreen");
  }
  $("leaveLobby").addEventListener("click", leave);
  $("leaveGame").addEventListener("click", () => {
    if (confirm("Leave this game? Your place will be released.")) leave();
  });
  $("backHome").addEventListener("click", leave);
  $("chatForm").addEventListener("submit", event => {
    event.preventDefault();
    const value = $("chatInput").value.trim();
    if (!value) return;
    socket.emit("db:chat", value);
    $("chatInput").value = "";
  });

  // Restore the current tab's room after a page refresh.
  try {
    const saved = JSON.parse(sessionStorage.getItem("dotsAndBoxesIdentity") || "null");
    if (saved?.code && saved?.playerId && saved?.playerToken) {
      identity = saved;
      setScreen("lobbyScreen");
      if (socket.connected) subscribe();
    }
  } catch { sessionStorage.removeItem("dotsAndBoxesIdentity"); }
})();

