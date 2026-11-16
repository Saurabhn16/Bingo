const PALETTE = [
  "#A855F7", // Electric Purple
  "#22D3EE", // Neon Cyan
  "#FB5B67", // Coral Red
  "#FBBF24", // Golden Yellow
  "#10B981", // Emerald Green
  "#EC4899", // Hot Pink
  "#3B82F6", // Royal Blue
  "#F97316", // Orange
  "#A3E635", // Lime Green
  "#C4B5FD"  // Lavender
];

function createBoard(size) {
  return {
    size,
    // H[r][c]: horizontal edge between dot (r,c) and (r,c+1)
    h: Array.from({ length: size + 1 }, () => Array(size).fill(null)),
    // V[r][c]: vertical edge between dot (r,c) and (r+1,c)
    v: Array.from({ length: size }, () => Array(size + 1).fill(null)),
    boxes: Array.from({ length: size }, () => Array(size).fill(null)),
    moves: 0
  };
}

function isValidMove(board, move) {
  if (!move || !["h", "v"].includes(move.orientation)) return false;
  const { orientation, row, col } = move;
  if (!Number.isInteger(row) || !Number.isInteger(col)) return false;
  if (orientation === "h") {
    return row >= 0 && row <= board.size && col >= 0 &&
      col < board.size && board.h[row][col] === null;
  }
  return row >= 0 && row < board.size && col >= 0 &&
    col <= board.size && board.v[row][col] === null;
}

function adjacentBoxes(board, move) {
  const { orientation, row, col } = move;
  if (orientation === "h") {
    return [[row - 1, col], [row, col]];
  }
  return [[row, col - 1], [row, col]];
}

function isBoxComplete(board, r, c) {
  return board.h[r][c] !== null &&
    board.h[r + 1][c] !== null &&
    board.v[r][c] !== null &&
    board.v[r][c + 1] !== null;
}

function applyMove(board, move, playerId) {
  if (!isValidMove(board, move)) {
    return { ok: false, error: "That line is unavailable. Choose another line." };
  }

  const { orientation, row, col } = move;
  board[orientation][row][col] = playerId;
  board.moves += 1;

  const claimed = [];
  for (const [r, c] of adjacentBoxes(board, move)) {
    if (
      r >= 0 && r < board.size &&
      c >= 0 && c < board.size &&
      board.boxes[r][c] === null &&
      isBoxComplete(board, r, c)
    ) {
      board.boxes[r][c] = playerId;
      claimed.push({ row: r, col: c });
    }
  }

  return {
    ok: true,
    claimed,
    extraTurn: claimed.length > 0,
    finished: board.moves === 2 * board.size * (board.size + 1)
  };
}

function createPublicBoard(board) {
  return {
    size: board.size,
    h: board.h,
    v: board.v,
    boxes: board.boxes,
    moves: board.moves,
    totalMoves: 2 * board.size * (board.size + 1),
    totalBoxes: board.size * board.size
  };
}

module.exports = {
  PALETTE,
  createBoard,
  isValidMove,
  applyMove,
  createPublicBoard
};
