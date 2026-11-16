# GameZone Tic-Tac-Toe Add-on

This is an additive patch for the existing Express + Socket.IO Bingo GameZone.

## Included
- `public/tictactoe.html`, `public/tictactoe.css`, `public/tictactoe.js`
- `tictactoe-server-addon.js` — isolated REST and Socket.IO backend
- `install-tictactoe.ps1` — safe installer with backup

## Install (Windows PowerShell)
1. Extract this ZIP.
2. Copy the extracted `GameZone-TicTacToe` folder somewhere accessible.
3. Open PowerShell in your existing GameZone project root (the folder containing `server.js`).
4. Run the installer using its full path, for example:
   `& "C:\path\to\GameZone-TicTacToe\install-tictactoe.ps1"`
5. Check syntax: `node --check .\server.js`
6. Start: `npm run dev`
7. Open `http://localhost:3000/tictactoe.html`

The installer backs up `server.js` and any files with matching names before copying. It refuses to install twice. Existing Bingo HTML, CSS, JS, routes and socket events are not replaced.

## Game behavior
- Private six-character room code; exactly two players.
- X is host and starts first; O joins second.
- Server validates turn, square, and win/draw.
- 30-second server-side turn timer; a timeout awards the round to the opponent.
- Scores and chat are kept in memory for the life of the room.
- Rematch requires both players to vote yes.
- A disconnect pauses the match in waiting state; reconnect with the same browser/localStorage identity to continue.

## Notes
Rooms and scores are in-memory and reset if the server restarts. This add-on uses the existing Socket.IO dependency and does not add packages. For production, configure HTTPS and consider persistent storage and rate limiting.
