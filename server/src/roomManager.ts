import type {
  ServerRoom,
  ServerPlayer,
  RoomStatePayload,
  AnswerRecord,
  OptionKey,
} from '../../shared/types';
import { generateRoomCode, questionBank } from './utils';

const rooms = new Map<string, ServerRoom>();

export function createRoom(hostSocketId: string): ServerRoom {
  const existingCodes = new Set(rooms.keys());
  const roomId = generateRoomCode(existingCodes);

  const room: ServerRoom = {
    roomId,
    hostSocketId,
    phase: 'lobby',
    players: new Map(),
    question: null,
    answers: new Map(),
    questionStartAtMs: null,
  };

  rooms.set(roomId, room);
  return room;
}

export function getRoom(roomId: string): ServerRoom | undefined {
  return rooms.get(roomId);
}

export function attachHost(roomId: string, hostSocketId: string): ServerRoom | undefined {
  const room = rooms.get(roomId);
  if (!room) return undefined;
  room.hostSocketId = hostSocketId;
  return room;
}

export function addPlayer(
  roomId: string,
  playerId: string,
  name: string,
  socketId: string
): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  // Check if this is a reconnecting player
  const existing = room.players.get(playerId);
  if (existing) {
    existing.socketId = socketId;
    existing.connected = true;
    existing.lastSeen = Date.now();
    existing.name = name; // allow name update on rejoin
    return { room };
  }

  // New player - only allow joining in lobby
  if (room.phase !== 'lobby') {
    return { error: 'Game already in progress' };
  }

  // Check for duplicate names
  for (const [, p] of room.players) {
    if (p.name.toLowerCase() === name.toLowerCase()) {
      return { error: 'Name already taken' };
    }
  }

  const player: ServerPlayer = {
    playerId,
    name,
    socketId,
    connected: true,
    lastSeen: Date.now(),
  };

  room.players.set(playerId, player);
  return { room };
}

export function disconnectSocket(socketId: string): { roomId: string; wasHost: boolean } | null {
  for (const [roomId, room] of rooms) {
    // Check if host disconnected
    if (room.hostSocketId === socketId) {
      room.hostSocketId = null;
      return { roomId, wasHost: true };
    }

    // Check if a player disconnected
    for (const [, player] of room.players) {
      if (player.socketId === socketId) {
        player.connected = false;
        player.socketId = null;
        player.lastSeen = Date.now();
        return { roomId, wasHost: false };
      }
    }
  }
  return null;
}

export function startGame(roomId: string): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };
  if (room.phase !== 'lobby') return { error: 'Game already started' };
  if (room.players.size === 0) return { error: 'Need at least 1 player' };

  // Pick a random question from the bank
  const question = questionBank[Math.floor(Math.random() * questionBank.length)];
  room.question = question;
  room.phase = 'question';
  room.answers = new Map();
  room.questionStartAtMs = Date.now();

  return { room };
}

export function submitAnswer(
  roomId: string,
  playerId: string,
  optionKey: OptionKey
): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };
  if (room.phase !== 'question') return { error: 'Not in question phase' };
  if (!room.players.has(playerId)) return { error: 'Player not in room' };
  if (room.answers.has(playerId)) return { error: 'Already answered' };

  const validKeys: OptionKey[] = ['A', 'B', 'C', 'D'];
  if (!validKeys.includes(optionKey)) return { error: 'Invalid option' };

  const answer: AnswerRecord = {
    playerId,
    optionKey,
    submittedAtMs: Date.now(),
  };
  room.answers.set(playerId, answer);

  // Check if all connected players have answered
  const connectedPlayers = Array.from(room.players.values()).filter((p) => p.connected);
  const allAnswered = connectedPlayers.every((p) => room.answers.has(p.playerId));
  if (allAnswered) {
    room.phase = 'results';
  }

  return { room };
}

export function resetRoom(roomId: string): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  room.phase = 'lobby';
  room.question = null;
  room.answers = new Map();
  room.questionStartAtMs = null;

  return { room };
}

export function sanitizeState(room: ServerRoom): RoomStatePayload {
  const players = Array.from(room.players.values()).map((p) => ({
    playerId: p.playerId,
    name: p.name,
    connected: p.connected,
  }));

  const isResults = room.phase === 'results';

  // During question phase, send question without correct answer
  // During results, include correct answer
  const question = room.question
    ? {
        id: room.question.id,
        text: room.question.text,
        options: room.question.options,
      }
    : null;

  // Only send answers during results
  const answers = isResults
    ? Array.from(room.answers.values()).sort((a, b) => a.submittedAtMs - b.submittedAtMs)
    : null;

  return {
    roomId: room.roomId,
    phase: room.phase,
    players,
    question,
    correctKey: isResults && room.question ? room.question.correctKey : null,
    answers,
    questionStartAtMs: room.questionStartAtMs,
    answerCount: room.answers.size,
    playerCount: players.filter((p) => p.connected).length,
  };
}
