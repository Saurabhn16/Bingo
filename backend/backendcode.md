
import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';

import { loadConfig } from './config.js';

// Load environment configuration
const config = loadConfig();

// Initialize Express
const app = express();

// Middleware
app.use(
  cors({
    origin: config.corsOrigin,
    methods: ['GET', 'POST'],
  }),
);

app.use(express.json());

// Health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).json({
    success: true,
    message: 'Bingo Arena backend is running!',
    status: 'online',
    timestamp: new Date().toISOString(),
  });
});

// Basic API endpoint
app.get('/api', (_req, res) => {
  res.json({
    name: 'Bingo Arena API',
    version: '0.1.0',
    status: 'running',
  });
});

// Create HTTP server
const httpServer = createServer(app);

// Initialize Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: config.corsOrigin,
    methods: ['GET', 'POST'],
  },
});

// Socket.IO connections
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.emit('connected', {
    message: 'Connected to Bingo Arena!',
    socketId: socket.id,
  });

  socket.on('disconnect', (reason) => {
    console.log(
      `Player disconnected: ${socket.id}, reason: ${reason}`,
    );
  });
});

// Start backend server
httpServer.listen(config.port, config.host, () => {
  console.log('====================================');
  console.log('       BINGO ARENA BACKEND          ');
  console.log('====================================');
  console.log(`Server: http://localhost:${config.port}`);
  console.log(`Health: http://localhost:${config.port}/health`);
  console.log(`API: http://localhost:${config.port}/api`);
  console.log('Socket.IO: Ready');
  console.log('====================================');
});

// Handle server errors
httpServer.on('error', (error) => {
  console.error('Server error:', error);
  process.exitCode = 1;
});

// Graceful shutdown
function shutdown() {
  console.log('Shutting down Bingo Arena server...');
  io.close(() => {
    console.log('Server stopped.');
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
import { fileURLToPath } from 'node:url';

import { MAX_PLAYERS_PER_ROOM, normalizeWinRules } from '../../shared/game-engine.js';
import type { WinRules } from '../../shared/domain.js';

export interface AppConfig {
  readonly port: number;
  readonly host: string;
  readonly staticDir: string;
  readonly roomCapacity: number;
  readonly defaultRules: WinRules;
  readonly corsOrigin: string | false;
  readonly isProduction: boolean;
}

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function readInteger(
  raw: string | undefined,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be an integer between ${min} and ${max}, received "${raw}".`);
  }

  return value;
}

/**
 * Reads and validates configuration. Missing optional values fall back to
 * documented defaults; anything malformed stops the server at boot instead of
 * failing on the first request.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = readInteger(env.PORT, 'PORT', 3000, 1, 65_535);
  const roomCapacity = readInteger(env.ROOM_CAPACITY, 'ROOM_CAPACITY', MAX_PLAYERS_PER_ROOM, 2, 16);
  const linesToWin = readInteger(env.LINES_TO_WIN, 'LINES_TO_WIN', 1, 1, 5);

  const rulesResult = normalizeWinRules({
    mode: env.WIN_MODE ?? 'lines',
    linesToWin,
  });

  if (!rulesResult.ok) {
    throw new ConfigError('WIN_MODE must be "lines" or "fullHouse"; LINES_TO_WIN must be 1-5.');
  }

  const corsOrigin = env.CORS_ORIGIN?.trim();

  return {
    port,
    host: env.HOST?.trim() || '0.0.0.0',
    staticDir: env.STATIC_DIR?.trim() || REPO_ROOT,
    roomCapacity,
    defaultRules: rulesResult.rules,
    corsOrigin: corsOrigin === undefined || corsOrigin === '' ? false : corsOrigin,
    isProduction: env.NODE_ENV === 'production',
  };
}
import { ERROR_CODES } from '../../../shared/game-engine.js';

/**
 * Domain error carrying a machine-readable code plus the HTTP status the API
 * should answer with. Socket handlers forward `code` and `message` verbatim.
 */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details ?? null;
  }
}

const STATUS_BY_CODE: Record<string, number> = {
  [ERROR_CODES.ROOM_NOT_FOUND]: 404,
  [ERROR_CODES.ROOM_CODE_INVALID]: 400,
  [ERROR_CODES.ROOM_FULL]: 409,
  [ERROR_CODES.ROOM_CLOSED]: 409,
  [ERROR_CODES.ROOM_PRIVATE]: 403,
  [ERROR_CODES.PLAYER_NOT_IN_ROOM]: 403,
  [ERROR_CODES.NOT_ROOM_HOST]: 403,
  [ERROR_CODES.NOT_ENOUGH_PLAYERS]: 409,
  [ERROR_CODES.INVALID_NICKNAME]: 400,
  [ERROR_CODES.INVALID_BOARD]: 400,
  [ERROR_CODES.INVALID_RULES]: 400,
  [ERROR_CODES.NOT_YOUR_TURN]: 409,
  [ERROR_CODES.NUMBER_ALREADY_CALLED]: 409,
  [ERROR_CODES.NUMBER_OUT_OF_RANGE]: 400,
  [ERROR_CODES.MATCH_NOT_STARTED]: 409,
  [ERROR_CODES.MATCH_FINISHED]: 409,
};

export function statusForCode(code: string): number {
  return STATUS_BY_CODE[code] ?? 400;
}

/** Throws a domain error with the conventional status for its code. */
export function fail(code: string, message: string, details?: unknown): never {
  throw new AppError(code, message, statusForCode(code), details);
}

export function toErrorBody(error: AppError): {
  error: { code: string; message: string; details: unknown };
} {
  return { error: { code: error.code, message: error.message, details: error.details } };
}

/** Normalises anything thrown into an AppError so handlers stay branch-free. */
export function asAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  const message = error instanceof Error ? error.message : 'Unexpected server error.';
  return new AppError('internal_error', message, 500);
}
import {
  ERROR_CODES,
  applyCall,
  applyForfeit,
  applyMark,
  matchPublicView,
  playerPrivateView,
  playerProgress,
} from '../../../shared/game-engine.js';
import { AppError } from './errors.js';
import type { RoomService } from './room-service.js';
import type { Room } from './room-types.js';

const CALL_ERROR_MESSAGES: Record<string, string> = {
  [ERROR_CODES.NOT_YOUR_TURN]: 'It is not your turn to call a number.',
  [ERROR_CODES.NUMBER_ALREADY_CALLED]: 'That number has already been called.',
  [ERROR_CODES.NUMBER_OUT_OF_RANGE]: 'Called numbers must be whole numbers from 1 to 25.',
  [ERROR_CODES.MATCH_FINISHED]: 'This match has already finished.',
  [ERROR_CODES.MATCH_NOT_STARTED]: 'This match has not started yet.',
  [ERROR_CODES.NUMBER_NOT_CALLED]: 'Only numbers that have been called can be marked.',
  [ERROR_CODES.NUMBER_NOT_ON_BOARD]: 'That number is not on your board.',
  [ERROR_CODES.ALREADY_MARKED]: 'That number is already marked.',
  [ERROR_CODES.PLAYER_NOT_IN_ROOM]: 'You are not a player in this match.',
};

function requireMatch(room: Room) {
  if (!room.match) {
    throw new AppError(ERROR_CODES.MATCH_NOT_STARTED, 'This room has no match yet.', 409);
  }
  return room.match;
}

function toAppError(error: { code: string }): AppError {
  const message = CALL_ERROR_MESSAGES[error.code] ?? 'That move is not allowed.';
  return new AppError(error.code, message, 409);
}

/**
 * Applies turn actions to a live match.
 *
 * These are the only entry points the realtime layer uses, and each one validates
 * against server-held state — the client never decides turn ownership, whether a
 * number is callable, or who won.
 */
export function callNumber(
  service: RoomService,
  code: string,
  playerId: string,
  number: unknown,
): { room: Room; call: { number: number; byId: string; seq: number; at: number } } {
  const room = service.store.require(code.trim().toUpperCase());
  const match = requireMatch(room);

  const result = applyCall(match, { playerId, number, at: Date.now() });
  if (!result.ok) {
    throw toAppError(result.error);
  }

  room.match = result.state;
  room.updatedAt = result.call.at;
  return { room, call: result.call };
}

export function markNumber(
  service: RoomService,
  code: string,
  playerId: string,
  number: unknown,
): { room: Room; won: boolean; lineCount: number; markedCount: number } {
  const room = service.store.require(code.trim().toUpperCase());
  const match = requireMatch(room);

  const result = applyMark(match, { playerId, number, at: Date.now() });
  if (!result.ok) {
    throw toAppError(result.error);
  }

  room.match = result.state;
  room.updatedAt = Date.now();

  if (result.state.status === 'finished') {
    room.status = 'finished';
  }

  return {
    room,
    won: result.won,
    lineCount: result.progress.lineCount,
    markedCount: result.progress.markedCount,
  };
}

/** Explicit leave during a match: the player forfeits and the removal is broadcast. */
export function forfeitMatch(service: RoomService, code: string, playerId: string): Room {
  const room = service.store.require(code.trim().toUpperCase());
  if (!room.match) {
    return room;
  }

  room.match = applyForfeit(room.match, { playerId, at: Date.now() });
  if (room.match.status === 'finished') {
    room.status = 'finished';
  }
  room.players.delete(playerId);
  room.updatedAt = Date.now();

  if (room.players.size === 0) {
    service.store.remove(room.code);
  }

  return room;
}

export interface MatchSnapshot {
  match: Record<string, unknown>;
  you: Record<string, unknown> | null;
}

/** Per-player payload: shared match state plus that player's own board only. */
export function matchSnapshot(room: Room, viewerId: string): MatchSnapshot | null {
  if (!room.match) {
    return null;
  }

  return {
    match: matchPublicView(room.match),
    you: playerPrivateView(room.match, viewerId),
  };
}

export function progressFor(room: Room, playerId: string) {
  if (!room.match) {
    return null;
  }
  return playerProgress(room.match, playerId);
}
import { randomUUID } from 'node:crypto';

import {
  ERROR_CODES,
  MIN_PLAYERS_TO_START,
  ROOM_STATUS,
  ROOM_VISIBILITY,
  createMatch,
  createTurnOrder,
  describeWinRules,
  normalizeNickname,
  normalizeWinRules,
  setConnection as setMatchConnection,
  validateBoard,
} from '../../../shared/game-engine.js';
import type { RoomStatus, RoomVisibility, WinRules } from '../../../shared/domain.js';
import { AppError } from './errors.js';
import { RoomStore } from './room-store.js';
import type { PublicRoomSummary, Room, RoomMembership, RoomPlayer } from './room-types.js';

export interface CreateRoomInput {
  nickname: unknown;
  board: unknown;
  visibility: unknown;
  rules?: unknown;
}

export interface JoinRoomInput {
  nickname: unknown;
  board: unknown;
}

export interface RoomPlayerView {
  id: string;
  nickname: string;
  connected: boolean;
  forfeited: boolean;
  isHost: boolean;
  joinedAt: number;
}

export interface RoomView {
  code: string;
  visibility: RoomVisibility;
  status: RoomStatus;
  hostId: string;
  hostNickname: string;
  capacity: number;
  rules: WinRules;
  rulesLabel: string;
  players: RoomPlayerView[];
  canStart: boolean;
  startedAt: number | null;
}

export interface RoomListFilter {
  status?: string | undefined;
  includeFinished?: boolean;
}

function parseVisibility(value: unknown): RoomVisibility {
  if (value === ROOM_VISIBILITY.PRIVATE || value === ROOM_VISIBILITY.PUBLIC) {
    return value;
  }
  throw new AppError('invalid_visibility', 'visibility must be "public" or "private".', 400);
}

function parseNickname(value: unknown): string {
  const result = normalizeNickname(value);
  if (!result.ok) {
    throw new AppError(
      ERROR_CODES.INVALID_NICKNAME,
      'Nickname must be 2-16 characters.',
      400,
    );
  }
  return result.nickname;
}

function parseBoard(value: unknown): number[] {
  const result = validateBoard(value);
  if (!result.ok) {
    throw new AppError(
      ERROR_CODES.INVALID_BOARD,
      'Board must contain all 25 numbers from 1 to 25 exactly once.',
      400,
      result.errors,
    );
  }
  return result.board;
}

function parseRules(value: unknown, fallback: WinRules): WinRules {
  if (value === undefined) {
    return fallback;
  }
  const result = normalizeWinRules(value);
  if (!result.ok) {
    throw new AppError(
      ERROR_CODES.INVALID_RULES,
      'Win rules must be "lines" (1-5) or "fullHouse".',
      400,
    );
  }
  return result.rules;
}

/**
 * Room lifecycle and membership rules.
 *
 * Every method is synchronous so a request is applied to the room in a single
 * event-loop turn; that is what makes "two simultaneous calls" resolvable to
 * exactly one accepted call.
 */
export class RoomService {
  readonly store: RoomStore;
  readonly #capacity: number;
  readonly #defaultRules: WinRules;
  readonly #now: () => number;

  constructor(options: {
    capacity: number;
    defaultRules: WinRules;
    now?: () => number;
    store?: RoomStore;
  }) {
    this.#capacity = options.capacity;
    this.#defaultRules = options.defaultRules;
    this.#now = options.now ?? (() => Date.now());
    this.store = options.store ?? new RoomStore();
  }

  createRoom(input: CreateRoomInput): RoomMembership {
    const nickname = parseNickname(input.nickname);
    const board = parseBoard(input.board);
    const visibility = parseVisibility(input.visibility);
    const rules = parseRules(input.rules, this.#defaultRules);
    const now = this.#now();

    const player: RoomPlayer = {
      id: randomUUID(),
      token: randomUUID(),
      nickname,
      board,
      joinedAt: now,
      connected: true,
      forfeited: false,
    };

    const room: Room = {
      code: this.store.generateCode(),
      visibility,
      rules,
      capacity: this.#capacity,
      createdAt: now,
      status: ROOM_STATUS.WAITING,
      hostId: player.id,
      players: new Map([[player.id, player]]),
      match: null,
      updatedAt: now,
    };

    this.store.add(room);
    return { room, player };
  }

  joinRoom(code: string, input: JoinRoomInput): RoomMembership {
    const room = this.store.require(this.#normalizeCode(code));
    this.#assertJoinable(room);

    const nickname = parseNickname(input.nickname);
    const board = parseBoard(input.board);
    const now = this.#now();

    const player: RoomPlayer = {
      id: randomUUID(),
      token: randomUUID(),
      nickname,
      board,
      joinedAt: now,
      connected: true,
      forfeited: false,
    };

    room.players.set(player.id, player);
    room.updatedAt = now;
    return { room, player };
  }

  /** Reclaims an existing seat with the token issued at join time. */
  rejoinRoom(code: string, playerId: string, token: string): RoomMembership {
    const room = this.store.require(this.#normalizeCode(code));
    const player = room.players.get(playerId);

    if (!player || player.token !== token) {
      throw new AppError(
        ERROR_CODES.PLAYER_NOT_IN_ROOM,
        'This seat does not belong to you.',
        403,
      );
    }

    return { room, player };
  }

  leaveRoom(code: string, playerId: string): { room: Room; removed: boolean } {
    const room = this.store.require(this.#normalizeCode(code));
    const player = room.players.get(playerId);

    if (!player) {
      return { room, removed: false };
    }

    room.players.delete(playerId);
    room.updatedAt = this.#now();

    if (room.hostId === playerId) {
      const next = [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (next) {
        room.hostId = next.id;
      }
    }

    if (room.players.size === 0) {
      this.store.remove(room.code);
    }

    return { room, removed: true };
  }

  setConnected(code: string, playerId: string, connected: boolean): Room {
    const room = this.store.require(this.#normalizeCode(code));
    const player = room.players.get(playerId);

    if (player) {
      player.connected = connected;
      room.updatedAt = this.#now();
    }

    if (room.match) {
      room.match = setMatchConnection(room.match, { playerId, connected });
    }

    return room;
  }

  startMatch(code: string, playerId: string): Room {
    const room = this.store.require(this.#normalizeCode(code));

    if (room.hostId !== playerId) {
      throw new AppError(ERROR_CODES.NOT_ROOM_HOST, 'Only the host can start the match.', 403);
    }

    if (room.status !== ROOM_STATUS.WAITING) {
      throw new AppError(ERROR_CODES.ROOM_CLOSED, 'This room is not accepting a new match.', 409);
    }

    const seated = [...room.players.values()].filter((player) => !player.forfeited);
    if (seated.length < MIN_PLAYERS_TO_START) {
      throw new AppError(
        ERROR_CODES.NOT_ENOUGH_PLAYERS,
        `At least ${MIN_PLAYERS_TO_START} players are needed to start.`,
        409,
      );
    }

    const now = this.#now();
    room.match = createMatch({
      roomCode: room.code,
      rules: room.rules,
      players: seated.map((player) => ({
        id: player.id,
        nickname: player.nickname,
        board: player.board,
        joinedAt: player.joinedAt,
      })),
      startedAt: now,
    });
    room.status = ROOM_STATUS.IN_PROGRESS;
    room.updatedAt = now;

    return room;
  }

  /** Broadcast-safe description of a room: never includes any player board. */
  toRoomView(room: Room): RoomView {
    const players: RoomPlayerView[] = [...room.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((player) => ({
        id: player.id,
        nickname: player.nickname,
        connected: player.connected,
        forfeited: player.forfeited,
        isHost: player.id === room.hostId,
        joinedAt: player.joinedAt,
      }));

    const activePlayers = players.filter((player) => !player.forfeited).length;

    return {
      code: room.code,
      visibility: room.visibility,
      status: room.status,
      hostId: room.hostId,
      hostNickname: players.find((player) => player.isHost)?.nickname ?? 'Unknown host',
      capacity: room.capacity,
      rules: room.rules,
      rulesLabel: describeWinRules(room.rules),
      players,
      canStart: room.status === ROOM_STATUS.WAITING && activePlayers >= MIN_PLAYERS_TO_START,
      startedAt: room.match?.startedAt ?? null,
    };
  }

  toPublicSummary(room: Room): PublicRoomSummary {
    const view = this.toRoomView(room);
    const activePlayers = view.players.filter((player) => !player.forfeited).length;

    return {
      code: room.code,
      visibility: room.visibility,
      status: room.status,
      hostNickname: view.hostNickname,
      playerCount: activePlayers,
      capacity: room.capacity,
      rulesLabel: view.rulesLabel,
      joinable:
        room.status === ROOM_STATUS.WAITING &&
        room.visibility === ROOM_VISIBILITY.PUBLIC &&
        activePlayers < room.capacity,
      createdAt: room.createdAt,
    };
  }

  listPublicRooms(filter: RoomListFilter = {}): PublicRoomSummary[] {
    const wanted = filter.status;

    return this.store
      .list()
      .filter((room) => room.visibility === ROOM_VISIBILITY.PUBLIC)
      .filter((room) => (filter.includeFinished === true ? true : room.status !== ROOM_STATUS.FINISHED))
      .filter((room) => (wanted === undefined ? true : room.status === wanted))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((room) => this.toPublicSummary(room));
  }

  turnOrderPreview(room: Room): string[] {
    return createTurnOrder(
      [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt).map((player) => player.id),
    );
  }

  #normalizeCode(code: string): string {
    const normalized = code.trim().toUpperCase();
    if (normalized.length === 0) {
      throw new AppError(ERROR_CODES.ROOM_CODE_INVALID, 'A room code is required.', 400);
    }
    return normalized;
  }

  #assertJoinable(room: Room): void {
    if (room.status !== ROOM_STATUS.WAITING) {
      throw new AppError(
        ERROR_CODES.ROOM_CLOSED,
        'This match is already under way.',
        409,
      );
    }

    const activePlayers = [...room.players.values()].filter((player) => !player.forfeited).length;
    if (activePlayers >= room.capacity) {
      throw new AppError(ERROR_CODES.ROOM_FULL, 'This room is full.', 409);
    }
  }
}
import { randomInt } from 'node:crypto';

import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../../../shared/game-engine.js';
import { AppError } from './errors.js';
import type { Room } from './room-types.js';

const MAX_CODE_ATTEMPTS = 500;

/**
 * In-memory room repository.
 *
 * Deliberately a thin, synchronous store: Node's single-threaded event loop makes
 * every mutation here atomic with respect to other requests, which is what the
 * turn-order guarantees rely on. Persistence arrives in a later milestone and
 * will keep this interface.
 */
export class RoomStore {
  readonly #rooms = new Map<string, Room>();

  get size(): number {
    return this.#rooms.size;
  }

  add(room: Room): Room {
    this.#rooms.set(room.code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.#rooms.get(code);
  }

  /** Returns the room or throws the standard not-found error. */
  require(code: string): Room {
    const room = this.#rooms.get(code);
    if (!room) {
      throw new AppError('room_not_found', `Room ${code} does not exist.`, 404);
    }
    return room;
  }

  findByHost(hostId: string): Room | undefined {
    for (const room of this.#rooms.values()) {
      if (room.hostId === hostId) {
        return room;
      }
    }
    return undefined;
  }

  list(): Room[] {
    return [...this.#rooms.values()];
  }

  remove(code: string): boolean {
    return this.#rooms.delete(code);
  }

  /** Unused codes only; collisions are retried rather than overwritten. */
  generateCode(): string {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      let code = '';
      for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
        code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)] ?? 'A';
      }
      if (!this.#rooms.has(code)) {
        return code;
      }
    }

    throw new AppError(
      'room_code_exhausted',
      'Could not allocate a free room code. Please retry.',
      503,
    );
  }
}
import type { MatchState, RoomStatus, RoomVisibility, WinRules } from '../../../shared/domain.js';

/**
 * A player inside a room. `id` and `token` are issued by the server: the id is
 * public (it appears in match payloads) while the token is the private
 * credential used to reclaim the seat after a reconnect.
 */
export interface RoomPlayer {
  readonly id: string;
  readonly token: string;
  readonly nickname: string;
  readonly board: number[];
  readonly joinedAt: number;
  connected: boolean;
  forfeited: boolean;
}

export interface Room {
  readonly code: string;
  readonly visibility: RoomVisibility;
  readonly rules: WinRules;
  readonly capacity: number;
  readonly createdAt: number;
  status: RoomStatus;
  hostId: string;
  players: Map<string, RoomPlayer>;
  match: MatchState | null;
  updatedAt: number;
}

export interface PublicRoomSummary {
  code: string;
  visibility: RoomVisibility;
  status: RoomStatus;
  hostNickname: string;
  playerCount: number;
  capacity: number;
  rulesLabel: string;
  /** True only when a join would be accepted right now. */
  joinable: boolean;
  createdAt: number;
}

export interface JoinCredentials {
  playerId: string;
  playerToken: string;
  roomCode: string;
}

export interface RoomMembership {
  room: Room;
  player: RoomPlayer;
}
import type { Server, Socket } from 'socket.io';

import { AppError, asAppError } from '../rooms/errors.js';
import { callNumber, forfeitMatch, markNumber, matchSnapshot } from '../rooms/match-service.js';
import type { RoomService } from '../rooms/room-service.js';
import type { Room } from '../rooms/room-types.js';

type Ack = (response: Record<string, unknown>) => void;

interface Session {
  roomCode: string | null;
  playerId: string | null;
}

const CHANNEL_PREFIX = 'room:';

function channelOf(code: string): string {
  return `${CHANNEL_PREFIX}${code}`;
}

function ok(payload: Record<string, unknown> = {}): Record<string, unknown> {
  return { ok: true, ...payload };
}

function fail(error: unknown): Record<string, unknown> {
  const appError = asAppError(error);
  return { ok: false, error: { code: appError.code, message: appError.message } };
}

function payloadFor(room: Room, viewerId: string): Record<string, unknown> {
  const snapshot = matchSnapshot(room, viewerId);
  return {
    room: { code: room.code, status: room.status, visibility: room.visibility },
    match: snapshot?.match ?? null,
    you: snapshot?.you ?? null,
  };
}

/**
 * Realtime transport.
 *
 * Socket.IO only carries messages: every decision (whose turn it is, which
 * numbers exist, who won) is made by the room service against server state. Each
 * member receives a freshly built payload so a player's own board is never sent
 * to anybody else.
 */
export function attachRealtime(io: Server, service: RoomService): void {
  const sessions = new Map<string, Session>();
  const pausedRooms = new Set<string>();

  function emitRoomState(room: Room): void {
    const sockets = io.sockets.adapter.rooms.get(channelOf(room.code));
    if (!sockets) {
      return;
    }

    for (const socketId of sockets) {
      const socket = io.sockets.sockets.get(socketId);
      const session = sessions.get(socketId);
      if (!socket || !session?.playerId) {
        continue;
      }

      socket.emit('room:state', {
        roomCode: room.code,
        roomView: service.toRoomView(room),
        ...payloadFor(room, session.playerId),
      });
    }

    const paused = room.match ? room.match.status === 'in_progress' && isPaused(room) : false;
    if (paused && !pausedRooms.has(room.code)) {
      pausedRooms.add(room.code);
      io.to(channelOf(room.code)).emit('match:paused', {
        roomCode: room.code,
        reason: 'caller_disconnected',
      });
    } else if (!paused && pausedRooms.has(room.code)) {
      pausedRooms.delete(room.code);
      io.to(channelOf(room.code)).emit('match:resumed', { roomCode: room.code });
    }
  }

  function isPaused(room: Room): boolean {
    const match = room.match;
    if (!match) {
      return false;
    }
    const callerId = match.turnOrder[match.calls.length % Math.max(match.turnOrder.length, 1)];
    const caller = callerId ? match.players[callerId] : undefined;
    return caller ? caller.connected === false : false;
  }

  io.on('connection', (socket: Socket) => {
    sessions.set(socket.id, { roomCode: null, playerId: null });

    socket.on('room:subscribe', (raw: unknown, ack?: Ack) => {
      try {
        const body = (raw ?? {}) as Record<string, unknown>;
        const roomCode = String(body.roomCode ?? '').toUpperCase();
        const playerId = String(body.playerId ?? '');
        const playerToken = String(body.playerToken ?? '');

        const membership = service.rejoinRoom(roomCode, playerId, playerToken);
        const room = service.setConnected(roomCode, playerId, true);

        sessions.set(socket.id, { roomCode: room.code, playerId });
        awaitJoin(socket, room.code);
        emitRoomState(room);

        ack?.(ok({ joined: true, ...payloadFor(room, playerId) }));
      } catch (error) {
        ack?.(fail(error));
      }
    });

    socket.on('room:leave', (_raw: unknown, ack?: Ack) => {
      const session = sessions.get(socket.id);
      if (!session?.roomCode || !session.playerId) {
        ack?.(ok({ left: false }));
        return;
      }

      try {
        const room = forfeitMatch(service, session.roomCode, session.playerId);
        socket.leave(channelOf(session.roomCode));
        sessions.set(socket.id, { roomCode: null, playerId: null });
        emitRoomState(room);
        ack?.(ok({ left: true }));
      } catch (error) {
        ack?.(fail(error));
      }
    });

    socket.on('match:start', (_raw: unknown, ack?: Ack) => {
      try {
        const session = requireSession(sessions, socket.id);
        const room = service.startMatch(session.roomCode, session.playerId);
        emitRoomState(room);
        io.to(channelOf(room.code)).emit('match:started', {
          roomCode: room.code,
          turnOrder: room.match?.turnOrder ?? [],
        });
        ack?.(ok({ started: true }));
      } catch (error) {
        ack?.(fail(error));
      }
    });

    socket.on('match:call', (raw: unknown, ack?: Ack) => {
      try {
        const session = requireSession(sessions, socket.id);
        const body = (raw ?? {}) as Record<string, unknown>;
        const { room, call } = callNumber(service, session.roomCode, session.playerId, body.number);

        emitRoomState(room);
        io.to(channelOf(room.code)).emit('match:called', { roomCode: room.code, call });
        ack?.(ok({ number: call.number }));
      } catch (error) {
        ack?.(fail(error));
      }
    });

    socket.on('match:mark', (raw: unknown, ack?: Ack) => {
      try {
        const session = requireSession(sessions, socket.id);
        const body = (raw ?? {}) as Record<string, unknown>;
        const result = markNumber(service, session.roomCode, session.playerId, body.number);

        emitRoomState(result.room);

        if (result.won && result.room.match) {
          io.to(channelOf(result.room.code)).emit('match:finished', {
            roomCode: result.room.code,
            winnerId: result.room.match.winnerId,
            outcome: result.room.match.outcome,
            winningLines: result.room.match.winningLines,
          });
        }

        ack?.(ok({ won: result.won, lineCount: result.lineCount }));
      } catch (error) {
        ack?.(fail(error));
      }
    });

    socket.on('disconnect', () => {
      const session = sessions.get(socket.id);
      sessions.delete(socket.id);

      if (!session?.roomCode || !session.playerId) {
        return;
      }

      try {
        const room = service.setConnected(session.roomCode, session.playerId, false);
        emitRoomState(room);
      } catch {
        // A room that no longer exists needs no disconnect bookkeeping.
      }
    });
  });

  /** Joining the Socket.IO channel is what makes a player a broadcast target. */
  function awaitJoin(socket: Socket, roomCode: string): void {
    socket.join(channelOf(roomCode));
  }
}

function requireSession(sessions: Map<string, Session>, socketId: string): {
  roomCode: string;
  playerId: string;
} {
  const session = sessions.get(socketId);
  if (!session?.roomCode || !session.playerId) {
    throw new AppError('player_not_in_room', 'Join a room before acting.', 409);
  }
  return { roomCode: session.roomCode, playerId: session.playerId };
}
import path from 'node:path';

import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';

import type { AppConfig } from '../config.js';
import { AppError, asAppError, toErrorBody } from '../rooms/errors.js';
import { RoomService } from '../rooms/room-service.js';
import { registerApiRoutes } from './routes.js';

export interface AppContext {
  app: Express;
  service: RoomService;
  config: AppConfig;
}

function applyCors(app: Express, config: AppConfig): void {
  if (config.corsOrigin === false) {
    return;
  }
  app.use(cors({ origin: config.corsOrigin, credentials: false }));
}

/** JSON 404 for unknown API routes; the SPA fallback handles everything else. */
function applyApiNotFound(app: Express): void {
  app.use('/api', (req: Request, res: Response) => {
    res.status(404).json({
      error: { code: 'not_found', message: `No API route matches ${req.method} ${req.originalUrl}.` },
    });
  });
}

function applyErrorHandler(app: Express): void {
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const appError = asAppError(error);
    if (appError.status >= 500) {
      console.error('[bingo-arena] request failed:', appError.message);
    }
    res.status(appError.status).json(toErrorBody(appError));
  });
}

export function createApp(config: AppConfig, service = new RoomService({
  capacity: config.roomCapacity,
  defaultRules: config.defaultRules,
})): AppContext {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  applyCors(app, config);

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      version: '0.1.0',
      uptimeSeconds: Math.round(process.uptime()),
      rooms: service.store.size,
    });
  });

  registerApiRoutes(app, service);
  applyApiNotFound(app);

  app.use(
    express.static(config.staticDir, {
      index: 'index.html',
      extensions: ['html'],
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );

  // Single-page app fallback: any non-API GET returns the shell so deep links work.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET') {
      next();
      return;
    }
    res.sendFile(path.join(config.staticDir, 'index.html'), (error) => {
      if (error) {
        next(new AppError('not_found', 'Not found.', 404));
      }
    });
  });

  applyErrorHandler(app);

  return { app, service, config };
}
import type { Express, Request, Response } from 'express';

import { AppError } from '../rooms/errors.js';
import { matchSnapshot } from '../rooms/match-service.js';
import { RoomService } from '../rooms/room-service.js';
import type { Room, RoomPlayer } from '../rooms/room-types.js';

const PLAYER_ID_HEADER = 'x-player-id';
const PLAYER_TOKEN_HEADER = 'x-player-token';

function headerValue(req: Request, name: string): string {
  const raw = req.headers[name];
  if (typeof raw === 'string') {
    return raw;
  }
  if (Array.isArray(raw) && raw.length > 0) {
    return raw[0] ?? '';
  }
  return '';
}

function bodyOf(req: Request): Record<string, unknown> {
  const body: unknown = req.body;
  if (typeof body === 'object' && body !== null) {
    return body as Record<string, unknown>;
  }
  return {};
}

/** Resolves the caller from the credential headers issued at join time. */
function authenticate(service: RoomService, req: Request, code: string): RoomPlayer {
  const playerId = headerValue(req, PLAYER_ID_HEADER);
  const token = headerValue(req, PLAYER_TOKEN_HEADER);

  if (playerId === '' || token === '') {
    throw new AppError('player_not_in_room', 'Missing player credentials.', 401);
  }

  return service.rejoinRoom(code, playerId, token).player;
}

function membershipPayload(room: Room, player: RoomPlayer, service: RoomService) {
  return {
    room: service.toRoomView(room),
    you: {
      id: player.id,
      nickname: player.nickname,
      board: player.board,
    },
    playerId: player.id,
    playerToken: player.token,
    match: matchSnapshot(room, player.id),
  };
}

export function registerApiRoutes(app: Express, service: RoomService): void {
  app.get('/api/rooms', (req: Request, res: Response) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const includeFinished = req.query.includeFinished === 'true';

    res.json({ rooms: service.listPublicRooms({ status, includeFinished }) });
  });

  app.get('/api/rooms/:code', (req: Request, res: Response) => {
    const code = String(req.params.code ?? '').toUpperCase();
    const room = service.store.require(code);

    if (room.visibility === 'private') {
      // Private rooms must not be discoverable: without valid credentials the
      // answer is identical to a room that does not exist.
      try {
        const player = authenticate(service, req, code);
        res.json({
          room: service.toRoomView(room),
          match: matchSnapshot(room, player.id),
        });
      } catch {
        throw new AppError('room_not_found', 'Room not found.', 404);
      }
      return;
    }

    res.json({ room: service.toRoomView(room) });
  });

  app.post('/api/rooms', (req: Request, res: Response) => {
    const body = bodyOf(req);
    const { room, player } = service.createRoom({
      nickname: body.nickname,
      board: body.board,
      visibility: body.visibility,
      rules: body.rules,
    });

    res.status(201).json(membershipPayload(room, player, service));
  });

  app.post('/api/rooms/:code/join', (req: Request, res: Response) => {
    const body = bodyOf(req);
    const { room, player } = service.joinRoom(String(req.params.code ?? ''), {
      nickname: body.nickname,
      board: body.board,
    });

    res.status(201).json(membershipPayload(room, player, service));
  });

  app.post('/api/rooms/:code/rejoin', (req: Request, res: Response) => {
    const code = String(req.params.code ?? '');
    const player = authenticate(service, req, code);
    const room = service.setConnected(code.toUpperCase(), player.id, true);

    res.json(membershipPayload(room, player, service));
  });

  app.get('/api/rooms/:code/state', (req: Request, res: Response) => {
    const code = String(req.params.code ?? '');
    const player = authenticate(service, req, code);
    const room = service.store.require(code.toUpperCase());

    res.json({
      room: service.toRoomView(room),
      match: matchSnapshot(room, player.id),
      you: { id: player.id, nickname: player.nickname, board: player.board },
    });
  });

  app.post('/api/rooms/:code/start', (req: Request, res: Response) => {
    const code = String(req.params.code ?? '');
    const player = authenticate(service, req, code);
    const room = service.startMatch(code, player.id);

    res.json({
      room: service.toRoomView(room),
      match: matchSnapshot(room, player.id),
    });
  });

  app.post('/api/rooms/:code/leave', (req: Request, res: Response) => {
    const code = String(req.params.code ?? '');
    const player = authenticate(service, req, code);
    const result = service.leaveRoom(code, player.id);
    const remaining = service.store.get(result.room.code);

    res.json({
      left: result.removed,
      room: remaining ? service.toRoomView(remaining) : null,
    });
  });
}
