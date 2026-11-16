const WINNING_COMBINATIONS = [
  [0,1,2], [3,4,5], [6,7,8],
  [0,3,6], [1,4,7], [2,5,8],
  [0,4,8], [2,4,6]
];

function createGame() {
  return {
    board: Array(9).fill(null),
    currentTurn: "X",
    winner: null,
    winningLine: [],
    status: "playing"
  };
}

function makeMove(game, index, symbol) {
  if (game.status !== "playing") throw new Error("Game finished");
  if (!Number.isInteger(index) || index < 0 || index > 8)
    throw new Error("Invalid position");
  if (game.currentTurn !== symbol) throw new Error("Not your turn");
  if (game.board[index] !== null) throw new Error("Cell occupied");

  game.board[index] = symbol;

  const line = WINNING_COMBINATIONS.find(
    combo => combo.every(i => game.board[i] === symbol)
  );

  if (line) {
    game.winner = symbol;
    game.winningLine = line;
    game.status = "finished";
  } else if (game.board.every(cell => cell !== null)) {
    game.status = "draw";
  } else {
    game.currentTurn = symbol === "X" ? "O" : "X";
  }

  return game;
}

module.exports = { createGame, makeMove };
