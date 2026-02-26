import type { ServerRoom, ServerCityPlayer, RoomStatePayload, TroopGroup } from '../../shared/types';
import {
  PLAYER_COLORS,
  INITIAL_WOOD,
  INITIAL_FOOD,
  INITIAL_STONE,
  INITIAL_METAL,
  INITIAL_WOOD_INCOME,
  INITIAL_FOOD_INCOME,
  INITIAL_STONE_INCOME,
  INITIAL_METAL_INCOME,
  INVEST_WOOD_COST_FOOD,
  INVEST_FOOD_COST_WOOD,
  INVEST_STONE_COST_WOOD,
  INVEST_STONE_COST_FOOD,
  INVEST_METAL_COST_STONE,
  INVEST_METAL_COST_FOOD,
  VALID_INVEST_AMOUNTS,
  INITIAL_POPULATION,
  POP_CAP_MULTIPLIER,
  POP_GROWTH_RATE,
  SCIENCE_COST_STONE,
  SCIENCE_COST_METAL,
  SCIENCE_CULTURE_GAIN,
  CULTURE_WIN_THRESHOLD,
  MILITARY_UPGRADE_COST_WOOD,
  MILITARY_UPGRADE_COST_FOOD,
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
    wood: 0,
    food: 0,
    stone: 0,
    metal: 0,
    woodIncome: 0,
    foodIncome: 0,
    stoneIncome: 0,
    metalIncome: 0,
    militaryAtHome: 0,
    population: 0,
    culture: 0,
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

    player.wood = INITIAL_WOOD;
    player.food = INITIAL_FOOD;
    player.stone = INITIAL_STONE;
    player.metal = INITIAL_METAL;
    player.woodIncome = INITIAL_WOOD_INCOME;
    player.foodIncome = INITIAL_FOOD_INCOME;
    player.stoneIncome = INITIAL_STONE_INCOME;
    player.metalIncome = INITIAL_METAL_INCOME;
    player.militaryAtHome = INITIAL_MILITARY_AT_HOME;
    player.population = INITIAL_POPULATION;
    player.culture = 0;
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
    player.wood += player.woodIncome;
    player.food += player.foodIncome;
    player.stone += player.stoneIncome;
    player.metal += player.metalIncome;
  }

  // Population growth: grows by foodIncome × POP_GROWTH_RATE per tick, capped at foodIncome × POP_CAP_MULTIPLIER
  for (const player of alivePlayers) {
    const populationCap = player.foodIncome * POP_CAP_MULTIPLIER;
    if (player.population < populationCap) {
      player.population = Math.min(populationCap, player.population + player.foodIncome * POP_GROWTH_RATE);
    }
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

  // Culture win condition: first player to reach CULTURE_WIN_THRESHOLD
  const cultureWinner = Array.from(room.players.values()).find(
    (p) => p.alive && p.culture >= CULTURE_WIN_THRESHOLD
  );
  if (cultureWinner) {
    room.phase = 'gameover';
    room.winnerPlayerId = cultureWinner.playerId;
    if (room.tickIntervalId !== null) {
      clearInterval(room.tickIntervalId);
      room.tickIntervalId = null;
    }
    if (broadcastFn) broadcastFn(roomId);
    return;
  }

  // Military win condition: <= 1 alive (skip if solo game)
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

export type ResourceType = 'wood' | 'food' | 'stone' | 'metal';
export type InvestAmount = typeof VALID_INVEST_AMOUNTS[number];

function getInvestmentCost(
  resource: ResourceType,
  amount: InvestAmount
): { wood?: number; food?: number; stone?: number } {
  switch (resource) {
    case 'wood':
      return { food: INVEST_WOOD_COST_FOOD * amount };
    case 'food':
      return { wood: INVEST_FOOD_COST_WOOD * amount };
    case 'stone':
      return { wood: INVEST_STONE_COST_WOOD * amount, food: INVEST_STONE_COST_FOOD * amount };
    case 'metal':
      return { stone: INVEST_METAL_COST_STONE * amount, food: INVEST_METAL_COST_FOOD * amount };
  }
}

function totalIncomeRate(player: ServerCityPlayer): number {
  return player.woodIncome + player.foodIncome + player.stoneIncome + player.metalIncome;
}

export function investResource(
  roomId: string,
  playerId: string,
  resource: ResourceType,
  amount: InvestAmount
): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };
  if (room.phase !== 'playing') return { error: 'Game not in progress' };

  const player = room.players.get(playerId);
  if (!player) return { error: 'Player not found' };
  if (!player.alive) return { error: 'City is eliminated' };

  if (!(VALID_INVEST_AMOUNTS as readonly number[]).includes(amount)) {
    return { error: 'Invalid investment amount' };
  }

  // Population cap: total income cannot exceed population
  if (totalIncomeRate(player) + amount > player.population) {
    return { error: 'Not enough population to support that income' };
  }

  const cost = getInvestmentCost(resource, amount);

  if (cost.wood !== undefined && player.wood < cost.wood) return { error: 'Not enough wood' };
  if (cost.food !== undefined && player.food < cost.food) return { error: 'Not enough food' };
  if (cost.stone !== undefined && player.stone < cost.stone) return { error: 'Not enough stone' };

  if (cost.wood !== undefined) player.wood -= cost.wood;
  if (cost.food !== undefined) player.food -= cost.food;
  if (cost.stone !== undefined) player.stone -= cost.stone;

  switch (resource) {
    case 'wood':  player.woodIncome  += amount; break;
    case 'food':  player.foodIncome  += amount; break;
    case 'stone': player.stoneIncome += amount; break;
    case 'metal': player.metalIncome += amount; break;
  }

  return { room };
}

export function investScience(
  roomId: string,
  playerId: string
): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };
  if (room.phase !== 'playing') return { error: 'Game not in progress' };

  const player = room.players.get(playerId);
  if (!player) return { error: 'Player not found' };
  if (!player.alive) return { error: 'City is eliminated' };

  if (player.stone < SCIENCE_COST_STONE) return { error: 'Not enough stone' };
  if (player.metal < SCIENCE_COST_METAL) return { error: 'Not enough metal' };

  player.stone -= SCIENCE_COST_STONE;
  player.metal -= SCIENCE_COST_METAL;
  player.culture += SCIENCE_CULTURE_GAIN;

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

  if (player.wood < MILITARY_UPGRADE_COST_WOOD || player.food < MILITARY_UPGRADE_COST_FOOD) {
    return { error: 'Not enough resources' };
  }

  // Training converts civilians to troops — need enough civilians
  const civilians = player.population - player.militaryAtHome;
  if (civilians < MILITARY_UPGRADE_TROOPS) {
    return { error: 'Not enough civilians to train' };
  }

  player.wood -= MILITARY_UPGRADE_COST_WOOD;
  player.food -= MILITARY_UPGRADE_COST_FOOD;
  player.militaryAtHome += MILITARY_UPGRADE_TROOPS;
  // population unchanged — civilians converted to military, not created

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
  attacker.population -= units; // troops leaving the city permanently reduce population

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
    player.wood = 0;
    player.food = 0;
    player.stone = 0;
    player.metal = 0;
    player.woodIncome = 0;
    player.foodIncome = 0;
    player.stoneIncome = 0;
    player.metalIncome = 0;
    player.militaryAtHome = 0;
    player.population = 0;
    player.culture = 0;
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
    wood: p.wood,
    food: p.food,
    stone: p.stone,
    metal: p.metal,
    woodIncome: p.woodIncome,
    foodIncome: p.foodIncome,
    stoneIncome: p.stoneIncome,
    metalIncome: p.metalIncome,
    militaryAtHome: p.militaryAtHome,
    population: p.population,
    culture: p.culture,
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
