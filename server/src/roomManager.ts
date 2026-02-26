import type { ServerRoom, ServerCityPlayer, RoomStatePayload, TroopGroup } from '../../shared/types';
import {
  PLAYER_COLORS,
  INITIAL_RESOURCE_A,
  INITIAL_RESOURCE_B,
  INITIAL_INCOME_RATE_A,
  INITIAL_INCOME_RATE_B,
  ECONOMY_UPGRADE_COST_A,
  ECONOMY_UPGRADE_COST_B,
  ECONOMY_UPGRADE_INCOME_A,
  ECONOMY_UPGRADE_INCOME_B,
  MILITARY_UPGRADE_COST_A,
  MILITARY_UPGRADE_COST_B,
  MILITARY_UPGRADE_TROOPS,
  INITIAL_MILITARY_AT_HOME,
  INITIAL_HP,
  MAX_HP,
  HP_REGEN_PER_SECOND,
  TROOP_TRAVEL_MS,
  DAMAGE_PER_UNIT,
  VALID_ATTACK_AMOUNTS,
  TICK_INTERVAL_MS,
} from '../../shared/constants';
import { generateRoomCode } from './utils';

const rooms = new Map<string, ServerRoom>();

// Injected by socketHandlers to avoid circular dependency
let broadcastFn: ((roomId: string) => void) | null = null;

export function setBroadcastFn(fn: (roomId: string) => void): void {
  broadcastFn = fn;
}

export function createRoom(hostSocketId: string): ServerRoom {
  const existingCodes = new Set(rooms.keys());
  const roomId = generateRoomCode(existingCodes);

  const room: ServerRoom = {
    roomId,
    hostSocketId,
    phase: 'lobby',
    players: new Map(),
    troopsInTransit: [],
    tickIntervalId: null,
    winnerPlayerId: null,
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

  // Reconnecting player — update socket, preserve game state
  const existing = room.players.get(playerId);
  if (existing) {
    existing.socketId = socketId;
    existing.connected = true;
    existing.lastSeen = Date.now();
    existing.name = name;
    return { room };
  }

  // New player — only allowed during lobby
  if (room.phase !== 'lobby') {
    return { error: 'Game already in progress' };
  }

  // Reject duplicate names
  for (const [, p] of room.players) {
    if (p.name.toLowerCase() === name.toLowerCase()) {
      return { error: 'Name already taken' };
    }
  }

  const player: ServerCityPlayer = {
    playerId,
    name,
    color: '',
    socketId,
    connected: true,
    lastSeen: Date.now(),
    alive: true,
    resourceA: 0,
    resourceB: 0,
    incomeRateA: 0,
    incomeRateB: 0,
    militaryAtHome: 0,
    hp: 0,
    maxHp: MAX_HP,
    x: 0,
    y: 0,
  };

  room.players.set(playerId, player);
  return { room };
}

export function disconnectSocket(socketId: string): { roomId: string; wasHost: boolean } | null {
  for (const [roomId, room] of rooms) {
    if (room.hostSocketId === socketId) {
      room.hostSocketId = null;
      return { roomId, wasHost: true };
    }
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

export function startGame(
  roomId: string
): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };
  if (room.phase !== 'lobby') return { error: 'Game already started' };
  if (room.players.size === 0) return { error: 'Need at least 1 player' };

  const playerList = Array.from(room.players.values());

  // Assign colors and evenly-spaced positions around a circle
  playerList.forEach((player, index) => {
    player.color = PLAYER_COLORS[index % PLAYER_COLORS.length];

    const angle = (2 * Math.PI * index) / playerList.length;
    player.x = parseFloat((0.5 + 0.35 * Math.cos(angle)).toFixed(3));
    player.y = parseFloat((0.5 + 0.35 * Math.sin(angle)).toFixed(3));

    player.resourceA = INITIAL_RESOURCE_A;
    player.resourceB = INITIAL_RESOURCE_B;
    player.incomeRateA = INITIAL_INCOME_RATE_A;
    player.incomeRateB = INITIAL_INCOME_RATE_B;
    player.militaryAtHome = INITIAL_MILITARY_AT_HOME;
    player.hp = INITIAL_HP;
    player.maxHp = MAX_HP;
    player.alive = true;
  });

  room.phase = 'playing';
  room.troopsInTransit = [];
  room.winnerPlayerId = null;

  room.tickIntervalId = setInterval(() => {
    gameTick(roomId);
  }, TICK_INTERVAL_MS);

  return { room };
}

function gameTick(roomId: string): void {
  const room = rooms.get(roomId);
  if (!room || room.phase !== 'playing') return;

  const now = Date.now();
  const alivePlayers = Array.from(room.players.values()).filter((p) => p.alive);

  // Economy accumulation
  for (const player of alivePlayers) {
    player.resourceA += player.incomeRateA;
    player.resourceB += player.incomeRateB;
  }

  // HP regeneration
  for (const player of alivePlayers) {
    player.hp = Math.min(player.maxHp, player.hp + HP_REGEN_PER_SECOND);
  }

  // Resolve arrived troop groups
  const arrived = room.troopsInTransit.filter((tg) => tg.arrivalAtMs <= now);
  room.troopsInTransit = room.troopsInTransit.filter((tg) => tg.arrivalAtMs > now);
  for (const tg of arrived) {
    resolveCombat(room, tg);
  }

  // Win condition: <= 1 alive (skip if solo game)
  const stillAlive = Array.from(room.players.values()).filter((p) => p.alive);
  if (stillAlive.length <= 1 && room.players.size > 1) {
    room.phase = 'gameover';
    room.winnerPlayerId = stillAlive.length === 1 ? stillAlive[0].playerId : null;
    if (room.tickIntervalId !== null) {
      clearInterval(room.tickIntervalId);
      room.tickIntervalId = null;
    }
  }

  if (broadcastFn) {
    broadcastFn(roomId);
  }
}

function resolveCombat(room: ServerRoom, tg: TroopGroup): void {
  const defender = room.players.get(tg.targetPlayerId);
  if (!defender || !defender.alive) return; // troops lost, target already gone

  let attackerUnits = tg.units;

  // Trade phase: troops vs troops
  const traded = Math.min(attackerUnits, defender.militaryAtHome);
  attackerUnits -= traded;
  defender.militaryAtHome -= traded;

  // Surviving attackers deal HP damage
  defender.hp -= attackerUnits * DAMAGE_PER_UNIT;

  if (defender.hp <= 0) {
    defender.hp = 0;
    defender.alive = false;
    defender.militaryAtHome = 0;
    // Cancel any in-flight attacks from the eliminated city
    room.troopsInTransit = room.troopsInTransit.filter(
      (t) => t.attackerPlayerId !== defender.playerId
    );
  }
}

export function spendEconomy(
  roomId: string,
  playerId: string
): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };
  if (room.phase !== 'playing') return { error: 'Game not in progress' };

  const player = room.players.get(playerId);
  if (!player) return { error: 'Player not found' };
  if (!player.alive) return { error: 'City is eliminated' };

  if (player.resourceA < ECONOMY_UPGRADE_COST_A || player.resourceB < ECONOMY_UPGRADE_COST_B) {
    return { error: 'Not enough resources' };
  }

  player.resourceA -= ECONOMY_UPGRADE_COST_A;
  player.resourceB -= ECONOMY_UPGRADE_COST_B;
  player.incomeRateA += ECONOMY_UPGRADE_INCOME_A;
  player.incomeRateB += ECONOMY_UPGRADE_INCOME_B;

  return { room };
}

export function spendMilitary(
  roomId: string,
  playerId: string
): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };
  if (room.phase !== 'playing') return { error: 'Game not in progress' };

  const player = room.players.get(playerId);
  if (!player) return { error: 'Player not found' };
  if (!player.alive) return { error: 'City is eliminated' };

  if (player.resourceA < MILITARY_UPGRADE_COST_A || player.resourceB < MILITARY_UPGRADE_COST_B) {
    return { error: 'Not enough resources' };
  }

  player.resourceA -= MILITARY_UPGRADE_COST_A;
  player.resourceB -= MILITARY_UPGRADE_COST_B;
  player.militaryAtHome += MILITARY_UPGRADE_TROOPS;

  return { room };
}

export function sendAttack(
  roomId: string,
  attackerPlayerId: string,
  targetPlayerId: string,
  units: number
): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };
  if (room.phase !== 'playing') return { error: 'Game not in progress' };

  const attacker = room.players.get(attackerPlayerId);
  if (!attacker) return { error: 'Player not found' };
  if (!attacker.alive) return { error: 'City is eliminated' };

  if (attackerPlayerId === targetPlayerId) return { error: 'Cannot attack yourself' };

  const target = room.players.get(targetPlayerId);
  if (!target) return { error: 'Target not found' };
  if (!target.alive) return { error: 'Target city is already eliminated' };

  if (!(VALID_ATTACK_AMOUNTS as readonly number[]).includes(units)) {
    return { error: 'Invalid unit count' };
  }
  if (attacker.militaryAtHome < units) return { error: 'Not enough troops' };

  attacker.militaryAtHome -= units;

  const now = Date.now();
  const troopGroup: TroopGroup = {
    id: 'tg_' + Math.random().toString(36).substring(2, 10) + now.toString(36),
    attackerPlayerId,
    targetPlayerId,
    units,
    departedAtMs: now,
    arrivalAtMs: now + TROOP_TRAVEL_MS,
  };

  room.troopsInTransit.push(troopGroup);

  return { room };
}

export function resetRoom(
  roomId: string
): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  if (room.tickIntervalId !== null) {
    clearInterval(room.tickIntervalId);
    room.tickIntervalId = null;
  }

  room.phase = 'lobby';
  room.troopsInTransit = [];
  room.winnerPlayerId = null;

  for (const [, player] of room.players) {
    player.color = '';
    player.alive = true;
    player.resourceA = 0;
    player.resourceB = 0;
    player.incomeRateA = 0;
    player.incomeRateB = 0;
    player.militaryAtHome = 0;
    player.hp = 0;
    player.maxHp = MAX_HP;
    player.x = 0;
    player.y = 0;
  }

  return { room };
}

export function sanitizeState(room: ServerRoom): RoomStatePayload {
  const players = Array.from(room.players.values()).map((p) => ({
    playerId: p.playerId,
    name: p.name,
    color: p.color,
    connected: p.connected,
    alive: p.alive,
    resourceA: p.resourceA,
    resourceB: p.resourceB,
    incomeRateA: p.incomeRateA,
    incomeRateB: p.incomeRateB,
    militaryAtHome: p.militaryAtHome,
    hp: p.hp,
    maxHp: p.maxHp,
    x: p.x,
    y: p.y,
  }));

  return {
    roomId: room.roomId,
    phase: room.phase,
    players,
    troopsInTransit: room.troopsInTransit,
    winnerPlayerId: room.winnerPlayerId,
  };
}
