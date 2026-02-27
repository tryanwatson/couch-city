import type { ServerRoom, ServerCityPlayer, RoomStatePayload, TroopGroup, TroopType } from '../../shared/types';
import {
  PLAYER_COLORS,
  INITIAL_FOOD,
  INITIAL_RESOURCES,
  INITIAL_GOLD,
  INITIAL_FOOD_INCOME,
  INITIAL_RESOURCES_INCOME,
  GOLD_INCOME_PER_POP,
  INVEST_FOOD_COST_GOLD,
  INVEST_RESOURCES_COST_GOLD,
  VALID_INVEST_AMOUNTS,
  INITIAL_POPULATION,
  POP_CAP_MULTIPLIER,
  POP_GROWTH_RATE,
  CULTURE_UPGRADE_COST_FOOD,
  CULTURE_UPGRADE_COST_GOLD,
  MONUMENT_COST_GOLD,
  MONUMENT_COST_RESOURCES,
  MONUMENT_CULTURE_PER_TURN,
  MONUMENT_COST_MULTIPLIERS,
  CULTURE_WIN_THRESHOLD,
  INITIAL_MILITARY,
  ZERO_MILITARY,
  TROOP_TYPES,
  COMBAT_POWER,
  TRAINING_CONFIG,
  DAMAGE_PER_CP,
  INITIAL_HP,
  MAX_HP,
  HP_REGEN_PER_TURN,
  TROOP_TRAVEL_TURNS,
  VALID_ATTACK_AMOUNTS,
  RESOLVING_PHASE_DURATION_MS,
  troopGroupRadius,
} from '../../shared/constants';
import { generateRoomCode } from './utils';

const rooms = new Map<string, ServerRoom>();

function totalMilitaryAtHome(mil: Record<TroopType, number>): number {
  return Object.values(mil).reduce((sum, n) => sum + n, 0);
}

function cpBasedTrade(unitsA: number, cpPerA: number, unitsB: number, cpPerB: number): { survivorsA: number; survivorsB: number } {
  const cpA = unitsA * cpPerA;
  const cpB = unitsB * cpPerB;
  if (cpA > cpB) {
    return { survivorsA: unitsA - Math.ceil(cpB / cpPerA), survivorsB: 0 };
  } else if (cpB > cpA) {
    return { survivorsA: 0, survivorsB: unitsB - Math.ceil(cpA / cpPerB) };
  }
  return { survivorsA: 0, survivorsB: 0 };
}

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
    subPhase: null,
    turnNumber: 0,
    players: new Map(),
    troopsInTransit: [],
    combatHitPlayerIds: [],
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
    food: 0,
    resources: 0,
    gold: 0,
    foodIncome: 0,
    resourcesIncome: 0,
    goldIncome: 0,
    militaryAtHome: { ...ZERO_MILITARY },
    population: 0,
    culture: 0,
    cultureLevel: 0,
    monuments: 0,
    hp: 0,
    maxHp: MAX_HP,
    x: 0,
    y: 0,
    endedTurn: false,
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

        // Auto-end turn for disconnected player during planning
        if (room.phase === 'playing' && room.subPhase === 'planning' && player.alive && !player.endedTurn) {
          player.endedTurn = true;
          const alivePlayers = Array.from(room.players.values()).filter(p => p.alive);
          const allEnded = alivePlayers.every(p => p.endedTurn);
          if (allEnded) {
            runUpdatePhase(room);
          }
        }

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

    player.food = INITIAL_FOOD;
    player.resources = INITIAL_RESOURCES;
    player.gold = INITIAL_GOLD;
    player.foodIncome = INITIAL_FOOD_INCOME;
    player.resourcesIncome = INITIAL_RESOURCES_INCOME;
    player.goldIncome = INITIAL_POPULATION * GOLD_INCOME_PER_POP;
    player.militaryAtHome = { ...INITIAL_MILITARY };
    player.population = INITIAL_POPULATION;
    player.culture = 0;
    player.cultureLevel = 0;
    player.monuments = 0;
    player.hp = INITIAL_HP;
    player.maxHp = MAX_HP;
    player.alive = true;
    player.endedTurn = false;
  });

  room.phase = 'playing';
  room.subPhase = 'planning';
  room.turnNumber = 1;
  room.troopsInTransit = [];
  room.winnerPlayerId = null;

  return { room };
}

// ============================================================
// Turn-based update phase
// ============================================================

export function endTurn(
  roomId: string,
  playerId: string
): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };
  if (room.phase !== 'playing') return { error: 'Game not in progress' };
  if (room.subPhase !== 'planning') return { error: 'Not in planning phase' };

  const player = room.players.get(playerId);
  if (!player) return { error: 'Player not found' };
  if (!player.alive) return { error: 'City is eliminated' };
  if (player.endedTurn) return { error: 'Already ended turn' };

  player.endedTurn = true;

  // Check if all alive players have ended their turn
  const alivePlayers = Array.from(room.players.values()).filter(p => p.alive);
  const allEnded = alivePlayers.every(p => p.endedTurn);

  if (allEnded) {
    runUpdatePhase(room);
  }

  return { room };
}

function runUpdatePhase(room: ServerRoom): void {
  room.subPhase = 'resolving';

  const alivePlayers = Array.from(room.players.values()).filter(p => p.alive);

  // Economy accumulation
  for (const player of alivePlayers) {
    player.food += player.foodIncome;
    player.resources += player.resourcesIncome;
    player.goldIncome = player.population * GOLD_INCOME_PER_POP;
    player.gold += player.goldIncome;
    player.culture += player.monuments * MONUMENT_CULTURE_PER_TURN;
  }

  // Population growth
  for (const player of alivePlayers) {
    const populationCap = player.foodIncome * POP_CAP_MULTIPLIER;
    if (player.population < populationCap) {
      player.population = Math.min(populationCap, player.population + player.foodIncome * POP_GROWTH_RATE);
    }
  }

  // HP regeneration
  for (const player of alivePlayers) {
    player.hp = Math.min(player.maxHp, player.hp + HP_REGEN_PER_TURN);
  }

  // Advance all troops by 1 turn
  for (const tg of room.troopsInTransit) {
    tg.turnsRemaining = Math.max(0, tg.turnsRemaining - 1);
  }

  // Detect and resolve field collisions (turn-based)
  detectFieldCollisions(room);

  // Resolve arrived troop groups (turnsRemaining === 0, skip field combat casualties)
  const arrived = room.troopsInTransit.filter(tg => tg.turnsRemaining <= 0 && tg.units > 0);
  // Keep arrived troops in transit for resolving broadcast (removed in setTimeout below)
  room.combatHitPlayerIds = arrived.map(tg => tg.targetPlayerId);
  for (const tg of arrived) {
    resolveCombat(room, tg);
  }

  // Culture win condition
  const cultureWinner = Array.from(room.players.values()).find(
    p => p.alive && p.culture >= CULTURE_WIN_THRESHOLD
  );
  if (cultureWinner) {
    room.phase = 'gameover';
    room.subPhase = null;
    room.winnerPlayerId = cultureWinner.playerId;
    if (broadcastFn) broadcastFn(room.roomId);
    return;
  }

  // Military win condition: <= 1 alive (skip if solo game)
  const stillAlive = Array.from(room.players.values()).filter(p => p.alive);
  if (stillAlive.length <= 1 && room.players.size > 1) {
    room.phase = 'gameover';
    room.subPhase = null;
    room.winnerPlayerId = stillAlive.length === 1 ? stillAlive[0].playerId : null;
    if (broadcastFn) broadcastFn(room.roomId);
    return;
  }

  // Broadcast resolving state (clients can show animation)
  if (broadcastFn) broadcastFn(room.roomId);

  // After animation duration, transition to next planning phase
  setTimeout(() => {
    if (room.phase !== 'playing') return;
    // Clear field combat markers on survivors
    for (const tg of room.troopsInTransit) {
      tg.fieldCombatX = undefined;
      tg.fieldCombatY = undefined;
      tg.inFieldCombat = undefined;
      tg.fieldCombatUnits = undefined;
    }
    // Remove arrived troops and field combat casualties now that animation has played
    room.troopsInTransit = room.troopsInTransit.filter(tg => tg.turnsRemaining > 0 && tg.units > 0);
    room.subPhase = 'planning';
    room.turnNumber += 1;
    for (const [, player] of room.players) {
      player.endedTurn = false;
    }
    if (broadcastFn) broadcastFn(room.roomId);
  }, RESOLVING_PHASE_DURATION_MS);
}

// ============================================================
// Field combat detection (turn-based)
// ============================================================

function detectFieldCollisions(room: ServerRoom): void {
  const transit = room.troopsInTransit;
  for (let i = 0; i < transit.length; i++) {
    const tg1 = transit[i];
    if (tg1.units <= 0) continue;

    for (let j = i + 1; j < transit.length; j++) {
      const tg2 = transit[j];
      if (tg2.units <= 0) continue;

      // Only opposing groups on the same lane (A→B vs B→A)
      if (
        tg1.attackerPlayerId !== tg2.targetPlayerId ||
        tg2.attackerPlayerId !== tg1.targetPlayerId
      ) continue;

      // Calculate progress as fraction
      const p1 = tg1.totalTurns > 0 ? (tg1.totalTurns - tg1.turnsRemaining) / tg1.totalTurns : 1;
      const p2 = tg2.totalTurns > 0 ? (tg2.totalTurns - tg2.turnsRemaining) / tg2.totalTurns : 1;

      // Account for visual radius
      const att1 = room.players.get(tg1.attackerPlayerId)!;
      const tgt1 = room.players.get(tg1.targetPlayerId)!;
      const laneDist = Math.hypot(tgt1.x - att1.x, tgt1.y - att1.y);
      const r1 = troopGroupRadius(tg1.units);
      const r2 = troopGroupRadius(tg2.units);
      const radiusOffset = laneDist > 0 ? (r1 + r2) / laneDist : 0;
      const threshold = 1 - radiusOffset;

      if (p1 + p2 < threshold) continue;

      // Collision! CP-based trade
      const result = cpBasedTrade(
        tg1.units, COMBAT_POWER[tg1.troopType],
        tg2.units, COMBAT_POWER[tg2.troopType]
      );

      // Calculate collision point for client animation
      const sumP = p1 + p2;
      const p1AtCollision = sumP > 0 ? (p1 / sumP) * threshold : 0.5;
      const collisionX = att1.x + (tgt1.x - att1.x) * p1AtCollision;
      const collisionY = att1.y + (tgt1.y - att1.y) * p1AtCollision;

      // Mark field combat location for animation (preserved until setTimeout cleanup)
      tg1.fieldCombatX = collisionX;
      tg1.fieldCombatY = collisionY;
      tg1.fieldCombatUnits = tg1.units;
      tg2.fieldCombatX = collisionX;
      tg2.fieldCombatY = collisionY;
      tg2.fieldCombatUnits = tg2.units;

      tg1.units = result.survivorsA;
      tg2.units = result.survivorsB;

      // Recalculate turnsRemaining for survivors, starting from collision point
      for (const tg of [tg1, tg2]) {
        if (tg.units > 0) {
          const target = room.players.get(tg.targetPlayerId)!;
          const attacker = room.players.get(tg.attackerPlayerId)!;
          const totalDist = Math.hypot(target.x - attacker.x, target.y - attacker.y);
          const backNx = totalDist > 0 ? (attacker.x - target.x) / totalDist : 0;
          const backNy = totalDist > 0 ? (attacker.y - target.y) / totalDist : 0;
          const r = troopGroupRadius(tg.units);
          const centerX = collisionX + backNx * r;
          const centerY = collisionY + backNy * r;
          const remainDist = Math.hypot(target.x - centerX, target.y - centerY);
          const remainFrac = totalDist > 0 ? remainDist / totalDist : 0;
          // Restart journey from collision point so progress=0 maps to here, not home
          tg.startX = collisionX;
          tg.startY = collisionY;
          tg.turnsRemaining = Math.max(1, Math.ceil(remainFrac * TROOP_TRAVEL_TURNS));
          tg.totalTurns = tg.turnsRemaining;
        }
        // Field combat markers preserved for client animation (cleared in setTimeout)
      }
    }
  }
  // Destroyed groups kept in transit for resolving animation (cleaned up in setTimeout)
}

// ============================================================
// Combat resolution
// ============================================================

function resolveCombat(room: ServerRoom, tg: TroopGroup): void {
  const defender = room.players.get(tg.targetPlayerId);
  if (!defender || !defender.alive) return;

  const cpPerAttacker = COMBAT_POWER[tg.troopType];
  const attackerTotalCP = tg.units * cpPerAttacker;

  // Calculate total defender CP from all troop types at home
  let defenderTotalCP = 0;
  for (const type of TROOP_TYPES) {
    defenderTotalCP += defender.militaryAtHome[type] * COMBAT_POWER[type];
  }

  if (defenderTotalCP >= attackerTotalCP) {
    // Defender wins (or tie) — all attackers die
    if (defenderTotalCP === attackerTotalCP) {
      for (const type of TROOP_TYPES) {
        defender.militaryAtHome[type] = 0;
      }
    } else {
      const lossRatio = attackerTotalCP / defenderTotalCP;
      for (const type of TROOP_TYPES) {
        const typeLoss = Math.floor(defender.militaryAtHome[type] * lossRatio);
        defender.militaryAtHome[type] -= typeLoss;
      }
    }
    return;
  }

  // Attacker wins — all defenders die
  for (const type of TROOP_TYPES) {
    defender.militaryAtHome[type] = 0;
  }

  const attackerLosses = Math.ceil(defenderTotalCP / cpPerAttacker);
  const survivingUnits = tg.units - attackerLosses;

  const damage = survivingUnits * cpPerAttacker * DAMAGE_PER_CP;
  defender.hp -= damage;

  if (defender.hp <= 0) {
    defender.hp = 0;
    defender.alive = false;
    for (const type of TROOP_TYPES) {
      defender.militaryAtHome[type] = 0;
    }
    room.troopsInTransit = room.troopsInTransit.filter(
      t => t.attackerPlayerId !== defender.playerId
    );
  }
}

// ============================================================
// Player actions (immediate during planning)
// ============================================================

export type IncomeType = 'food' | 'resources';
export type InvestAmount = typeof VALID_INVEST_AMOUNTS[number];

function guardAction(room: ServerRoom, playerId: string): ServerCityPlayer | string {
  if (room.phase !== 'playing') return 'Game not in progress';
  if (room.subPhase !== 'planning') return 'Cannot act during update phase';
  const player = room.players.get(playerId);
  if (!player) return 'Player not found';
  if (!player.alive) return 'City is eliminated';
  if (player.endedTurn) return 'Turn already ended';
  return player;
}

export function investIncome(
  roomId: string,
  playerId: string,
  income: IncomeType,
  amount: InvestAmount
): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  const guard = guardAction(room, playerId);
  if (typeof guard === 'string') return { error: guard };
  const player = guard;

  if (!(VALID_INVEST_AMOUNTS as readonly number[]).includes(amount)) {
    return { error: 'Invalid investment amount' };
  }

  const goldCost = (income === 'food' ? INVEST_FOOD_COST_GOLD : INVEST_RESOURCES_COST_GOLD) * amount;
  if (player.gold < goldCost) return { error: 'Not enough gold' };

  player.gold -= goldCost;

  if (income === 'food') {
    player.foodIncome += amount;
  } else {
    player.resourcesIncome += amount;
  }

  return { room };
}

export function upgradeCulture(
  roomId: string,
  playerId: string
): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  const guard = guardAction(room, playerId);
  if (typeof guard === 'string') return { error: guard };
  const player = guard;

  if (player.cultureLevel >= MONUMENT_COST_MULTIPLIERS.length) return { error: 'Maximum culture level reached' };
  if (player.food < CULTURE_UPGRADE_COST_FOOD) return { error: 'Not enough food' };
  if (player.gold < CULTURE_UPGRADE_COST_GOLD) return { error: 'Not enough gold' };

  player.food -= CULTURE_UPGRADE_COST_FOOD;
  player.gold -= CULTURE_UPGRADE_COST_GOLD;
  player.cultureLevel += 1;

  return { room };
}

export function buildMonument(
  roomId: string,
  playerId: string
): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  const guard = guardAction(room, playerId);
  if (typeof guard === 'string') return { error: guard };
  const player = guard;

  if (player.monuments >= player.cultureLevel) {
    return { error: 'Upgrade culture first to unlock a monument slot' };
  }
  if (player.monuments >= MONUMENT_COST_MULTIPLIERS.length) {
    return { error: 'Maximum monuments already built' };
  }

  const multiplier = MONUMENT_COST_MULTIPLIERS[player.monuments];
  const goldCost = MONUMENT_COST_GOLD * multiplier;
  const resourcesCost = MONUMENT_COST_RESOURCES * multiplier;

  if (player.gold < goldCost) return { error: 'Not enough gold' };
  if (player.resources < resourcesCost) return { error: 'Not enough resources' };

  player.gold -= goldCost;
  player.resources -= resourcesCost;
  player.monuments += 1;

  return { room };
}

export function spendMilitary(
  roomId: string,
  playerId: string,
  troopType: TroopType
): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  const guard = guardAction(room, playerId);
  if (typeof guard === 'string') return { error: guard };
  const player = guard;

  const config = TRAINING_CONFIG[troopType];
  if (!config) return { error: 'Invalid troop type' };

  if (player.food < config.food || player.gold < config.gold) {
    return { error: 'Not enough resources' };
  }

  const civilians = Math.floor(player.population) - totalMilitaryAtHome(player.militaryAtHome);
  if (civilians < config.troops) {
    return { error: 'Not enough civilians to train' };
  }

  player.food -= config.food;
  player.gold -= config.gold;
  player.militaryAtHome[troopType] += config.troops;

  return { room };
}

export function sendAttack(
  roomId: string,
  attackerPlayerId: string,
  targetPlayerId: string,
  units: number,
  troopType: TroopType
): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  const guard = guardAction(room, attackerPlayerId);
  if (typeof guard === 'string') return { error: guard };
  const attacker = guard;

  if (attackerPlayerId === targetPlayerId) return { error: 'Cannot attack yourself' };

  const target = room.players.get(targetPlayerId);
  if (!target) return { error: 'Target not found' };
  if (!target.alive) return { error: 'Target city is already eliminated' };

  if (!(VALID_ATTACK_AMOUNTS as readonly number[]).includes(units)) {
    return { error: 'Invalid unit count' };
  }
  if (!COMBAT_POWER[troopType]) return { error: 'Invalid troop type' };
  if (attacker.militaryAtHome[troopType] < units) return { error: 'Not enough troops' };

  attacker.militaryAtHome[troopType] -= units;
  attacker.population -= units;

  // Merge into existing group sent this same planning phase (same target, same type, freshly created)
  const existing = room.troopsInTransit.find(
    tg =>
      tg.attackerPlayerId === attackerPlayerId &&
      tg.targetPlayerId === targetPlayerId &&
      tg.troopType === troopType &&
      tg.turnsRemaining === TROOP_TRAVEL_TURNS &&
      tg.totalTurns === TROOP_TRAVEL_TURNS,
  );

  if (existing) {
    existing.units += units;
  } else {
    room.troopsInTransit.push({
      id: 'tg_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36),
      attackerPlayerId,
      targetPlayerId,
      troopType,
      units,
      turnsRemaining: TROOP_TRAVEL_TURNS,
      totalTurns: TROOP_TRAVEL_TURNS,
    });
  }

  return { room };
}

// ============================================================
// Room management
// ============================================================

export function resetRoom(
  roomId: string
): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  room.phase = 'lobby';
  room.subPhase = null;
  room.turnNumber = 0;
  room.troopsInTransit = [];
  room.winnerPlayerId = null;

  for (const [, player] of room.players) {
    player.color = '';
    player.alive = true;
    player.food = 0;
    player.resources = 0;
    player.gold = 0;
    player.foodIncome = 0;
    player.resourcesIncome = 0;
    player.goldIncome = 0;
    player.militaryAtHome = { ...ZERO_MILITARY };
    player.population = 0;
    player.culture = 0;
    player.cultureLevel = 0;
    player.monuments = 0;
    player.hp = 0;
    player.maxHp = MAX_HP;
    player.x = 0;
    player.y = 0;
    player.endedTurn = false;
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
    food: p.food,
    resources: p.resources,
    gold: p.gold,
    foodIncome: p.foodIncome,
    resourcesIncome: p.resourcesIncome,
    goldIncome: p.goldIncome,
    militaryAtHome: p.militaryAtHome,
    population: p.population,
    culture: p.culture,
    cultureLevel: p.cultureLevel,
    monuments: p.monuments,
    hp: p.hp,
    maxHp: p.maxHp,
    x: p.x,
    y: p.y,
    endedTurn: p.endedTurn,
  }));

  return {
    roomId: room.roomId,
    phase: room.phase,
    subPhase: room.subPhase,
    turnNumber: room.turnNumber,
    players,
    troopsInTransit: room.troopsInTransit,
    combatHitPlayerIds: room.combatHitPlayerIds,
    winnerPlayerId: room.winnerPlayerId,
  };
}
