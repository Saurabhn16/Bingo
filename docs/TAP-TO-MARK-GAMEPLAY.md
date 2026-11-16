# Tap-to-Mark Bingo Update

This build changes Bingo Arena to a two-player, alternating-turn game.

## Gameplay
- Each player receives a shuffled 5x5 board containing 1–25.
- The host creates a private room and shares its six-character code.
- The host starts after the second player joins.
- The player whose turn it is selects any unmarked number on their own board.
- The selected cell turns green and the server passes the turn to the opponent.
- The same number may be selected on both players' separate boards.
- The first player to complete five rows, columns, or diagonals wins.

## Main implementation files
- `bingo.html`, `bingo.css`, `bingo.js`: responsive lobby and tap-to-mark UI.
- `shared/match.js`, `shared/rules.js`: authoritative move validation, turn switching, and win checks.
- `backend/src/realtime/socket.ts`: realtime room updates and mark events; the old call-number event is no longer exposed.
- `backend/src/config.ts`: defaults to two players and five lines to win.
- `backend/src/rooms/match-service.ts`: server-side mark errors.
- `shared/match.test.js`: tests for alternating turns, own-board marking, duplicate marks, and winning.

## Run locally
From the project root:

```powershell
npm install
npm run dev
```

Open `http://localhost:5000/bingo.html` (or the port configured in `backend/.env`).

## Verify
From the project root:

```powershell
npm test
npm run typecheck
```

Rooms are currently held in memory and are cleared when the server restarts.
