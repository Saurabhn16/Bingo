import test from 'node:test';
import assert from 'node:assert/strict';

import { createMatch, applyMark, matchPublicView, playerPrivateView } from './game-engine.js';

const boardOne = Array.from({ length:  25 }, (_, i) => i + 1);
const boardTwo = Array.from({ length:  25 }, (_, i) => 25 - i);

function match(rules = { mode: 'lines', linesToWin: 5 }) {
  return createMatch({
    roomCode: 'ABC234',
    rules,
    players: [
      { id: 'p1', nickname: 'Player One', board: boardOne, joinedAt: 1 },
      { id: 'p2', nickname: 'Player Two', board: boardTwo, joinedAt: 2 },
    ],
    startedAt: 100,
  });
}

function mark(state, playerId, number, at = 200) {
  return applyMark(state, { playerId, number, at });
}

test('tap-to-mark turns alternate between players', () => {
  let state = match();
  assert.equal(matchPublicView(state).currentCallerId, 'p1');

  const first = mark(state, 'p1', 1);
  assert.equal(first.ok, true);
  state = first.state;
  assert.equal(matchPublicView(state).currentCallerId, 'p2');

  const second = mark(state, 'p2', 25);
  assert.equal(second.ok, true);
  state = second.state;
  assert.equal(matchPublicView(state).currentCallerId, 'p1');
  assert.deepEqual(playerPrivateView(state, 'p1').markedNumbers, [1]);
  assert.deepEqual(playerPrivateView(state, 'p2').markedNumbers, [25]);
});

test('rejects a tap from the player who is not on turn', () => {
  const result = mark(match(), 'p2', 25);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'not_your_turn');
});

test('each player may mark the same number on their own board', () => {
  let state = match();
  const first = mark(state, 'p1', 7);
  assert.equal(first.ok, true);
  state = first.state;

  const second = mark(state, 'p2', 7);
  assert.equal(second.ok, true);
  assert.deepEqual(playerPrivateView(second.state, 'p1').markedNumbers, [7]);
  assert.deepEqual(playerPrivateView(second.state, 'p2').markedNumbers, [7]);
});

test('rejects numbers outside the player board and duplicate own marks', () => {
  const notOnBoard = mark(match(), 'p1', 26);
  assert.equal(notOnBoard.ok, false);
  assert.equal(notOnBoard.error.code, 'number_not_on_board');

  const first = mark(match(), 'p1', 3);
  assert.equal(first.ok, true);
  const opponentTurn = mark(first.state, 'p2', 3);
  assert.equal(opponentTurn.ok, true);
  const p1TurnAgain = mark(opponentTurn.state, 'p1', 3);
  assert.equal(p1TurnAgain.ok, false);
  assert.equal(p1TurnAgain.error.code, 'already_marked');
});

test('finishes when the player completes the configured five lines', () => {
  let state = match();
  const p1Numbers = [1, 2, 3, 4, 5];
  const p2Numbers = [25, 24, 23, 22];

  for (let index = 0; index < p1Numbers.length; index += 1) {
    const p1 = mark(state, 'p1', p1Numbers[index], 300 + index * 2);
    assert.equal(p1.ok, true);
    state = p1.state;
    if (index < p2Numbers.length) {
      const p2 = mark(state, 'p2', p2Numbers[index], 301 + index * 2);
      assert.equal(p2.ok, true);
      state = p2.state;
    }
  }
  assert.equal(state.status, 'in_progress'); // one row is not five lines
  assert.equal(state.players.p1.markedNumbers.length, 5);
});

test('five completed lines are required by the default game rule', () => {
  let state = match();
  for (let index = 0; index < 21; index += 1) {
    const p1 = mark(state, 'p1', index + 1, 400 + index * 2);
    assert.equal(p1.ok, true);
    state = p1.state;
    if (index < 20) {
      const p2 = mark(state, 'p2', 25 - index, 401 + index * 2);
      assert.equal(p2.ok, true);
      state = p2.state;
    }
  }
  assert.equal(state.status, 'finished');
  assert.equal(state.winnerId, 'p1');
  assert.ok(state.winningLines.length >= 5);
});

test('finishes immediately at the configured one-line rule and rejects later moves', () => {
  let state = match({ mode: 'lines', linesToWin: 1 });
  const sequence = [
    ['p1', 1], ['p2', 25], ['p1', 2], ['p2', 24],
    ['p1', 3], ['p2', 23], ['p1', 4], ['p2', 22], ['p1', 5],
  ];
  for (const [playerId, number] of sequence) {
    const result = mark(state, playerId, number);
    assert.equal(result.ok, true);
    state = result.state;
  }
  assert.equal(state.status, 'finished');
  assert.equal(state.winnerId, 'p1');
  assert.equal(mark(state, 'p2', 21).ok, false);
});
