(() => {
  const socket = io();
  const $ = id => document.getElementById(id);
  const screens = ["lobby","waiting","game","result"];
  let state = null, roomCode = null, playerId = null, selectedLetter = "S";
  let tapState = {index:-1,count:0,timer:null}, toastTimer;
  const show = name => screens.forEach(s => $(s).classList.toggle("hidden",s!==name));
  const toast = message => { const el=$("toast"); el.textContent=message; el.classList.add("show"); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove("show"),2400); };
  const error = message => $("lobbyError").textContent = message || "";
  const emit = (event,payload) => socket.emit(event,payload);
  const myPlayer = () => state?.players?.find(p=>p.id===socket.id);
  const currentPlayer = () => state?.players?.find(p=>p.id===state.currentPlayerId);
  const isHost = () => !!playerId && state?.hostId === playerId;
  const isMyTurn = () => state?.status === "playing" && state.currentPlayerId === socket.id;

  socket.on("connect",()=>{$("connection").textContent="Connected";$("connection").classList.add("online");});
  socket.on("disconnect",()=>{$("connection").textContent="Disconnected";$("connection").classList.remove("online");});
  socket.on("sos:error",data=>{const msg=data?.message||"Something went wrong";error(msg);toast(msg);});
  socket.on("sos:room", data => {
    state = data;
    roomCode = data.code;
    playerId = data.youId || socket.id || playerId;
    renderRoom();
  });

  socket.on("sos:state", data => {
    state = data;
    playerId = data.youId || socket.id || playerId;
    renderState();
  });

  socket.on("sos:started", data => {
    state = data;
    playerId = data.youId || socket.id || playerId;
    show("game");
    renderState();
    toast("Match started!");
  });

  socket.on("sos:moveResult", data => {
    state = data;
    playerId = data.youId || socket.id || playerId;
    renderState();
    if (data.created > 0) {
      toast(data.created + " SOS line(s) created!");
    }
  });

  socket.on("sos:finished", data => {
    state = data;
    playerId = data.youId || socket.id || playerId;
    renderResult(data.reason);
  });

  socket.on("sos:rematch", data => {
    state = data;
    playerId = data.youId || socket.id || playerId;
    toast(data.message || "Rematch update");
    renderResult();
  });

  socket.on("sos:playerLeft", data => {
    toast(data.message || "A player left the room");
  });
$("winCondition").addEventListener("change",()=>$("targetWrap").classList.toggle("hidden",$("winCondition").value!=="target"));
  $("createRoom").onclick=()=>{
    error("");
    const name=$("createName").value.trim();
    if(!name)return error("Enter your name.");
    emit("sos:createRoom",{name,settings:readSettings()});
  };
  $("joinRoom").onclick=()=>{
    error("");
    const name=$("joinName").value.trim(), code=$("roomCode").value.trim().toUpperCase();
    if(!name||!code)return error("Enter your name and room code.");
    emit("sos:joinRoom",{name,code});
  };
  $("roomCode").addEventListener("input",e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,""));
  $("copyCode").onclick=async()=>{try{await navigator.clipboard.writeText(roomCode);toast("Room code copied");}catch{toast(`Room code: ${roomCode}`);}};
  $("startGame").onclick = () => { if (!isHost()) return toast("Only the host can start."); if (state.players.length < state.settings.maxPlayers) return toast("Waiting for all players."); emit("sos:start", { code: roomCode }); };
  $("leaveWaiting").onclick=$("leaveGame").onclick=()=>{emit("sos:leave",{code:roomCode});state=null;roomCode=null;show("lobby");};
  $("pickS").onclick=()=>pick("S");$("pickO").onclick=()=>pick("O");
  $("rematch").onclick=()=>emit("sos:rematchRequest",{code:roomCode});
  $("acceptRematch").onclick=()=>emit("sos:rematchAccept",{code:roomCode});
  $("declineRematch").onclick=()=>emit("sos:rematchDecline",{code:roomCode});
  $("backLobby").onclick=()=>{emit("sos:leave",{code:roomCode});state=null;roomCode=null;show("lobby");};
  function readSettings(){return {rows:+$("rows").value,cols:+$("cols").value,maxPlayers:+$("maxPlayers").value,touchMode:$("touchMode").value,timer:+$("timer").value,extraTurn:$("extraTurn").checked,winCondition:$("winCondition").value,targetScore:+$("targetScore").value};}
  function pick(letter){selectedLetter=letter;$("pickS").classList.toggle("selected",letter==="S");$("pickO").classList.toggle("selected",letter==="O");}
  function renderRoom() {
    show("waiting");

    $("displayRoomCode").textContent = state.code;
    $("waitingPlayers").innerHTML = "";

    state.players.forEach(p => {
      const el = document.createElement("div");
      el.className = "player-chip";

      const heading = document.createElement("b");
      heading.textContent = p.name + (p.id === state.hostId ? " ★ HOST" : "");

      const detail = document.createElement("small");
      detail.textContent =
        (p.id === playerId ? "You" : "Player") +
        " · " + (p.connected ? "Connected" : "Reconnecting");

      el.append(heading, detail);
      $("waitingPlayers").append(el);
    });

    const host = isHost();
    const enoughPlayers = state.players.length >= state.settings.maxPlayers;

    $("waitingHint").textContent =
      `${state.players.length} / ${state.settings.maxPlayers} players joined`;

    $("startGame").disabled = !host || !enoughPlayers;
    $("startGame").textContent = host
      ? (enoughPlayers ? "Start Game" : "Waiting for players...")
      : "Waiting for host to start...";

    $("hostSettings").innerHTML = "";

    const s = state.settings;
    [
      ["Board", `${s.rows} × ${s.cols}`],
      ["Players", s.maxPlayers],
      ["Touch", s.touchMode],
      ["Timer", s.timer ? `${s.timer}s` : "Unlimited"],
      ["Extra turn", s.extraTurn ? "On" : "Off"]
    ].forEach(([key, value]) => {
      const item = document.createElement("span");
      item.textContent = `${key}: ${value}`;
      $("hostSettings").append(item);
    });
  }function renderState(){
    if(!state)return;
    if(state.status==="waiting"){renderRoom();return;}
    if(state.status==="playing"){show("game");$("gameRoomCode").textContent=state.code;$("boardLabel").textContent=`${state.settings.rows} \u00D7 ${state.settings.cols} BOARD`;$("timerLabel").textContent=state.settings.timer?`Turn timer: ${state.settings.timer}s`:"No timer";
      const current=currentPlayer();$("turnLabel").textContent=isMyTurn()?"Your turn":`${current?.name||"Opponent"}'s turn`;$("turnSub").textContent=isMyTurn()?"Choose S or O, then select an empty cell.":`Waiting for ${current?.name||"player"} to move.`;
      renderScores($("scoreboard"));renderBoard();renderSettings();renderActivity();
    }
  }
  function renderScores(target){target.innerHTML="";state.players.forEach(p=>{const el=document.createElement("div");el.className="score-card"+(p.id===state.currentPlayerId?" active":"");el.innerHTML=`<div class="name">${escapeHtml(p.name)} ${p.id===state.hostId?"\u2605":""}</div><strong>${p.score}</strong><span class="turn">${p.id===state.currentPlayerId?"CURRENT TURN":p.id===socket.id?"YOU":""}</span>`;target.append(el);});}
  function renderBoard(){
    const board=$("board");board.innerHTML="";board.style.setProperty("--n",state.settings.cols);
    state.board.forEach((letter,index)=>{const b=document.createElement("button");b.className="cell "+(letter?letter.toLowerCase():"empty");b.textContent=letter||"";b.disabled=!!letter||!isMyTurn();b.setAttribute("aria-label",letter?`Cell ${index+1}: ${letter}`:`Empty cell ${index+1}`);
      if(index===state.lastMove)b.classList.add("last");if(state.sosCells?.includes(index))b.classList.add("sos-cell");b.onclick=()=>handleCell(index);board.append(b);});
    $("moveHint").textContent=!isMyTurn()?"Wait for your turn.":`Selected letter: ${selectedLetter}. Input: ${state.settings.touchMode} tap.`;
    $("pickS").disabled=$("pickO").disabled=!isMyTurn();
  }
  function handleCell(index) {
    if (!isMyTurn()) {
      toast("Wait for your turn.");
      return;
    }

    if (state.board[index]) {
      toast("This cell is already occupied.");
      return;
    }

    const mode = state.settings.touchMode;
    const required = mode === "triple" ? 3 :
                     mode === "double" ? 2 : 1;

    if (required === 1) {
      sendMove(index);
      return;
    }

    if (tapState.index !== index) {
      clearTimeout(tapState.timer);
      tapState = { index, count: 0, timer: null };
    }

    tapState.count++;

    if (tapState.count >= required) {
      clearTimeout(tapState.timer);
      tapState = { index: -1, count: 0, timer: null };
      sendMove(index);
      return;
    }

    const remaining = required - tapState.count;
    clearTimeout(tapState.timer);

    tapState.timer = setTimeout(() => {
      tapState = { index: -1, count: 0, timer: null };
      toast("Tap the same cell " + remaining + " more time(s).");
    }, 900);
  }

  function sendMove(index) {
    if (!socket.connected) {
      toast("Server disconnected. Please reconnect.");
      return;
    }

    emit("sos:move", {
      code: roomCode,
      index: index,
      letter: selectedLetter
    });
  }

  function renderSettings(){const s=state.settings;const items=[["Board",`${s.rows} \u00D7 ${s.cols}`],["Players",`${s.maxPlayers} max`],["Touch",s.touchMode],["Timer",s.timer?`${s.timer}s`:"Unlimited"],["Extra turn",s.extraTurn?"Enabled":"Disabled"],["Scoring","1 point per SOS"]];$("matchSettings").innerHTML=items.map(([k,v])=>`<div class="setting-line"><span>${k}</span><b>${v}</b></div>`).join("");}
  function renderActivity(){$("activity").innerHTML="";(state.activity||[]).slice(-12).reverse().forEach(item=>{const p=document.createElement("p");p.textContent=item;$("activity").append(p);});}
  function renderResult(reason){
    show("result");

    const winner = state.players.slice().sort((a,b)=>b.score-a.score)[0];
    const tied = state.players.filter(p=>p.score===winner?.score).length>1;

    $("winnerTitle").textContent = tied ? "It's a tie!" : `${winner?.name||"Player"} wins!`;
    $("winnerSub").textContent = reason || "The match has ended.";
    renderScores($("finalScores"));

    const rematch = state.rematch;
    const accepted = rematch?.acceptedBy || [];
    const acceptedByMe = !!rematch && accepted.includes(playerId);

    $("rematch").classList.toggle("hidden", !!rematch);
    $("acceptRematch").classList.toggle("hidden", !rematch || acceptedByMe);
    $("declineRematch").classList.toggle("hidden", !rematch || acceptedByMe);

    if (!rematch) {
      $("rematchStatus").textContent = "Want to play again?";
    } else if (acceptedByMe) {
      $("rematchStatus").textContent = "You accepted. Waiting for everyone else...";
    } else {
      const requester = state.players.find(p=>p.id===rematch.requestedBy);
      $("rematchStatus").textContent = `${requester?.name || "A player"} wants a rematch!`;
    }
  }

  function escapeHtml(value){return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
})();

