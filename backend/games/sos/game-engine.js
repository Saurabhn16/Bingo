const DIRECTIONS = [[0,1],[1,0],[1,1],[1,-1]];

function createGame(settings) {
  const { rows, cols } = settings;
  return {
    board: Array(rows * cols).fill(""),
    scores: {},
    currentPlayerId: null,
    lastMove: -1,
    scoredLines: [],
    sosCells: [],
    status: "waiting"
  };
}

function findNewSOS(board, rows, cols, index) {
  const r = Math.floor(index / cols), c = index % cols;
  const found = [];
  for (const [dr,dc] of DIRECTIONS) {
    for (let offset = -2; offset <= 0; offset++) {
      const cells = [];
      for (let k = 0; k < 3; k++) {
        const rr = r + (offset + k) * dr;
        const cc = c + (offset + k) * dc;
        if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) { cells.length = 0; break; }
        cells.push(rr * cols + cc);
      }
      if (cells.length === 3 && board[cells[0]] === "S" && board[cells[1]] === "O" && board[cells[2]] === "S") found.push(cells);
    }
  }
  return found;
}

function applyMove(game, settings, playerId, index, letter) {
  if (game.status !== "playing") throw new Error("The game is not in progress.");
  if (game.currentPlayerId !== playerId) throw new Error("It is not your turn.");
  if (!Number.isInteger(index) || index < 0 || index >= game.board.length) throw new Error("Invalid cell.");
  if (game.board[index]) throw new Error("That cell is already occupied.");
  if (letter !== "S" && letter !== "O") throw new Error("Choose S or O.");

  game.board[index] = letter;
  game.lastMove = index;
  const newLines = findNewSOS(game.board, settings.rows, settings.cols, index);
  const alreadyScored = new Set(game.scoredLines.map(line => line.slice().sort((a,b)=>a-b).join("-")));
  const uniqueLines = newLines.filter(line => !alreadyScored.has(line.slice().sort((a,b)=>a-b).join("-")));
  uniqueLines.forEach(line => {
    game.scoredLines.push(line);
    game.sosCells.push(...line);
  });
  game.sosCells = [...new Set(game.sosCells)];
  game.scores[playerId] = (game.scores[playerId] || 0) + uniqueLines.length;

  const targetReached = settings.winCondition === "target" && game.scores[playerId] >= settings.targetScore;
  const boardFull = game.board.every(Boolean);
  if (targetReached || boardFull) game.status = "finished";
  else if (!(settings.extraTurn && uniqueLines.length > 0)) {
    return { created: uniqueLines.length, nextPlayer: true };
  }
  return { created: uniqueLines.length, nextPlayer: false };
}

module.exports = { createGame, applyMove };