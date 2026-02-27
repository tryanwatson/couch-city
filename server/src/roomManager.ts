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
  MONUMENT_CULTURE_PER_TICK,
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
  HP_REGEN_PER_SECOND,
  TROOP_TRAVEL_MS,
  TROOP_GROUP_MERGE_WINDOW_MS,
  VALID_ATTACK_AMOUNTS,
  TICK_INTERVAL_MS,
  FIELD_COMBAT_INSTANT_RATIO,
  FIELD_COMBAT_MS_PER_UNIT,
  FIELD_COMBAT_MIN_MS,
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
    players: new Map(),
    troopsInTransit: [],
    combatHitPlayerIds: [],
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
  });

  room.phase = 'playing';
  room.troopsInTransit = [];
  room.winnerPlayerId = null;

  room.tickIntervalId = setInterval(() => {
    gameTick(roomId);
  }, TICK_INTERVAL_MS);

  return { room };
}

/** Calculate field combat duration based on power ratio and unit count. */
function fieldCombatDuration(totalCpA: number, totalCpB: number, unitsA: number, unitsB: number): number {
  const ratio = Math.min(totalCpA, totalCpB) / Math.max(totalCpA, totalCpB);
  if (ratio <= FIELD_COMBAT_INSTANT_RATIO) return 0;
  const scaledRatio = (ratio - FIELD_COMBAT_INSTANT_RATIO) / (1 - FIELD_COMBAT_INSTANT_RATIO);
  const fullDuration = Math.max(FIELD_COMBAT_MIN_MS, (unitsA + unitsB) * FIELD_COMBAT_MS_PER_UNIT);
  return Math.round(scaledRatio * fullDuration);
}

/** Detect and initiate collisions between opposing troop groups. */
function detectFieldCollisions(room: ServerRoom, now: number): void {
  const transit = room.troopsInTransit;
  for (let i = 0; i < transit.length; i++) {
    const tg1 = transit[i];
    // Skip groups already in field combat (but NOT arrived groups — collision takes priority)
    if (tg1.fieldCombatEndMs != null) continue;

    for (let j = i + 1; j < transit.length; j++) {
      const tg2 = transit[j];
      if (tg2.fieldCombatEndMs != null) continue;

      // Only opposing groups on the same lane (A→B vs B→A)
      if (
        tg1.attackerPlayerId !== tg2.targetPlayerId ||
        tg2.attackerPlayerId !== tg1.targetPlayerId
      ) continue;

      const d1 = tg1.arrivalAtMs - tg1.departedAtMs;
      const d2 = tg2.arrivalAtMs - tg2.departedAtMs;
      if (d1 <= 0 || d2 <= 0) continue;

      // Account for visual group radius — collide when fronts touch, not centers
      const att1 = room.players.get(tg1.attackerPlayerId)!;
      const tgt1 = room.players.get(tg1.targetPlayerId)!;
      const laneDist = Math.hypot(tgt1.x - att1.x, tgt1.y - att1.y);
      const r1 = troopGroupRadius(tg1.units);
      const r2 = troopGroupRadius(tg2.units);
      const radiusOffset = laneDist > 0 ? (r1 + r2) / laneDist : 0;
      const threshold = 1 - radiusOffset;

      const p1 = (now - tg1.departedAtMs) / d1;
      const p2 = (now - tg2.departedAtMs) / d2;
      if (p1 + p2 < threshold) continue; // fronts haven't touched yet

      // Solve for exact collision time: p1(t) + p2(t) = threshold
      const tCollision = (threshold + tg1.departedAtMs / d1 + tg2.departedAtMs / d2) / (1 / d1 + 1 / d2);
      const p1AtCollision = Math.max(0, Math.min(1, (tCollision - tg1.departedAtMs) / d1));

      // Group 1 center at collision time
      const center1X = att1.x + (tgt1.x - att1.x) * p1AtCollision;
      const center1Y = att1.y + (tgt1.y - att1.y) * p1AtCollision;

      // Contact point: offset from group 1's center toward target by r1
      const nxLane = laneDist > 0 ? (tgt1.x - att1.x) / laneDist : 0;
      const nyLane = laneDist > 0 ? (tgt1.y - att1.y) / laneDist : 0;
      const collisionX = center1X + r1 * nxLane;
      const collisionY = center1Y + r1 * nyLane;

      const cp1 = tg1.units * COMBAT_POWER[tg1.troopType];
      const cp2 = tg2.units * COMBAT_POWER[tg2.troopType];
      const duration = fieldCombatDuration(cp1, cp2, tg1.units, tg2.units);
      const combatEndMs = tCollision + duration;

      if (duration === 0 || combatEndMs <= now) {
        // Instant resolve or combat already expired — CP-based trade
        const result = cpBasedTrade(tg1.units, COMBAT_POWER[tg1.troopType], tg2.units, COMBAT_POWER[tg2.troopType]);
        tg1.units = result.survivorsA;
        tg2.units = result.survivorsB;

        // Recalculate arrival for survivors: offset from contact point to each group's center
        for (const tg of [tg1, tg2]) {
          if (tg.units <= 0) continue;
          const target = room.players.get(tg.targetPlayerId);
          const attacker = room.players.get(tg.attackerPlayerId);
          if (!target || !attacker) continue;
          const totalDist = Math.hypot(target.x - attacker.x, target.y - attacker.y);
          const backNx = totalDist > 0 ? (attacker.x - target.x) / totalDist : 0;
          const backNy = totalDist > 0 ? (attacker.y - target.y) / totalDist : 0;
          const r = troopGroupRadius(tg.units);
          const centerX = collisionX + backNx * r;
          const centerY = collisionY + backNy * r;
          const remainDist = Math.hypot(target.x - centerX, target.y - centerY);
          const remainFrac = totalDist > 0 ? remainDist / totalDist : 0;
          tg.arrivalAtMs = now + remainFrac * TROOP_TRAVEL_MS;
          tg.departedAtMs = now - (1 - remainFrac) * TROOP_TRAVEL_MS;
        }
      } else {
        // Animated field combat
        tg1.fieldCombatX = collisionX;
        tg1.fieldCombatY = collisionY;
        tg1.fieldCombatEndMs = combatEndMs;

        tg2.fieldCombatX = collisionX;
        tg2.fieldCombatY = collisionY;
        tg2.fieldCombatEndMs = combatEndMs;
      }
    }
  }
  // Remove groups that were instantly killed
  room.troopsInTransit = room.troopsInTransit.filter((tg) => tg.units > 0);
}

/** Resolve field combats whose animation has ended. */
function resolveFieldCombats(room: ServerRoom, now: number): void {
  const resolved = new Set<string>();

  for (const tg of room.troopsInTransit) {
    if (tg.fieldCombatEndMs == null || tg.fieldCombatEndMs > now || resolved.has(tg.id)) continue;

    // Find the paired enemy group at the same combat position
    const enemy = room.troopsInTransit.find(
      (other) =>
        other.id !== tg.id &&
        other.fieldCombatEndMs != null &&
        other.fieldCombatEndMs <= now &&
        !resolved.has(other.id) &&
        other.attackerPlayerId === tg.targetPlayerId &&
        other.targetPlayerId === tg.attackerPlayerId,
    );

    if (enemy) {
      // CP-based trade
      const result = cpBasedTrade(tg.units, COMBAT_POWER[tg.troopType], enemy.units, COMBAT_POWER[enemy.troopType]);
      tg.units = result.survivorsA;
      enemy.units = result.survivorsB;
      resolved.add(tg.id);
      resolved.add(enemy.id);
    }

    // Clear field combat state for survivors so they resume travel
    if (tg.units > 0) {
      // Recalculate arrivalAtMs: offset from contact point to group center, then measure to target
      const target = room.players.get(tg.targetPlayerId);
      const attacker = room.players.get(tg.attackerPlayerId);
      if (target && attacker) {
        const totalDist = Math.hypot(target.x - attacker.x, target.y - attacker.y);
        const backNx = totalDist > 0 ? (attacker.x - target.x) / totalDist : 0;
        const backNy = totalDist > 0 ? (attacker.y - target.y) / totalDist : 0;
        const r = troopGroupRadius(tg.units);
        const centerX = tg.fieldCombatX! + backNx * r;
        const centerY = tg.fieldCombatY! + backNy * r;
        const remainDist = Math.hypot(target.x - centerX, target.y - centerY);
        const remainFrac = totalDist > 0 ? remainDist / totalDist : 0;
        tg.arrivalAtMs = now + remainFrac * TROOP_TRAVEL_MS;
        tg.departedAtMs = now - (1 - remainFrac) * TROOP_TRAVEL_MS;
      }
      tg.fieldCombatX = undefined;
      tg.fieldCombatY = undefined;
      tg.fieldCombatEndMs = undefined;
    }
  }

  // Remove eliminated groups
  room.troopsInTransit = room.troopsInTransit.filter((tg) => tg.units > 0);
}

/** Merge friendly traveling groups into allied groups that are in field combat. */
function mergeIntoFieldCombat(room: ServerRoom, now: number): void {
  const toRemove = new Set<string>();

  for (const g of room.troopsInTransit) {
    // Only check traveling groups (not in field combat themselves)
    if (g.fieldCombatEndMs != null || toRemove.has(g.id)) continue;

    // Find a friendly group of the same type in field combat on the same lane
    const combatGroup = room.troopsInTransit.find(
      (f) =>
        f.id !== g.id &&
        f.fieldCombatEndMs != null &&
        f.fieldCombatEndMs > now &&
        f.attackerPlayerId === g.attackerPlayerId &&
        f.targetPlayerId === g.targetPlayerId &&
        f.troopType === g.troopType &&
        !toRemove.has(f.id),
    );
    if (!combatGroup) continue;

    // Check if the traveling group has reached the combat position
    const attacker = room.players.get(g.attackerPlayerId);
    const target = room.players.get(g.targetPlayerId);
    if (!attacker || !target) continue;

    const totalDist = Math.hypot(target.x - attacker.x, target.y - attacker.y);
    if (totalDist === 0) continue;
    const progress = (now - g.departedAtMs) / (g.arrivalAtMs - g.departedAtMs);
    const combatDist = Math.hypot(combatGroup.fieldCombatX! - attacker.x, combatGroup.fieldCombatY! - attacker.y);
    const combatProgress = combatDist / totalDist;

    if (progress >= combatProgress) {
      combatGroup.units += g.units;
      toRemove.add(g.id);
    }
  }

  if (toRemove.size > 0) {
    room.troopsInTransit = room.troopsInTransit.filter((tg) => !toRemove.has(tg.id));
  }
}

function gameTick(roomId: string): void {
  const room = rooms.get(roomId);
  if (!room || room.phase !== 'playing') return;

  const now = Date.now();
  const alivePlayers = Array.from(room.players.values()).filter((p) => p.alive);

  // Economy accumulation
  for (const player of alivePlayers) {
    player.food += player.foodIncome;
    player.resources += player.resourcesIncome;
    // Gold income scales with current population
    player.goldIncome = player.population * GOLD_INCOME_PER_POP;
    player.gold += player.goldIncome;
    // Passive culture score from monuments
    player.culture += player.monuments * MONUMENT_CULTURE_PER_TICK;
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

  // Field combat: detect collisions, resolve ended combats, merge friendlies
  detectFieldCollisions(room, now);
  resolveFieldCombats(room, now);
  mergeIntoFieldCombat(room, now);

  // Resolve arrived troop groups
  const arrived = room.troopsInTransit.filter((tg) => tg.arrivalAtMs <= now && tg.fieldCombatEndMs == null);
  room.troopsInTransit = room.troopsInTransit.filter((tg) => tg.arrivalAtMs > now || tg.fieldCombatEndMs != null);
  room.combatHitPlayerIds = arrived.map((tg) => tg.targetPlayerId);
  for (const tg of arrived) {
    resolveCombat(room, tg);
  }

  // Culture win condition: first player to reach CULTURE_WIN_THRESHOLD culture points
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
      // Equal: both sides wiped
      for (const type of TROOP_TYPES) {
        defender.militaryAtHome[type] = 0;
      }
    } else {
      // Defender wins: lose units proportionally
      const lossRatio = attackerTotalCP / defenderTotalCP;
      for (const type of TROOP_TYPES) {
        const typeLoss = Math.floor(defender.militaryAtHome[type] * lossRatio);
        defender.militaryAtHome[type] -= typeLoss;
      }
    }
    // Attackers all die — no city damage
    return;
  }

  // Attacker wins — all defenders die
  for (const type of TROOP_TYPES) {
    defender.militaryAtHome[type] = 0;
  }

  // Attacker loses units worth defenderTotalCP
  const attackerLosses = Math.ceil(defenderTotalCP / cpPerAttacker);
  const survivingUnits = tg.units - attackerLosses;

  // Surviving attackers deal HP damage scaled by combat power
  const damage = survivingUnits * cpPerAttacker * DAMAGE_PER_CP;
  defender.hp -= damage;

  if (defender.hp <= 0) {
    defender.hp = 0;
    defender.alive = false;
    for (const type of TROOP_TYPES) {
      defender.militaryAtHome[type] = 0;
    }
    // Cancel any in-flight attacks from the eliminated city
    room.troopsInTransit = room.troopsInTransit.filter(
      (t) => t.attackerPlayerId !== defender.playerId
    );
  }
}

export type IncomeType = 'food' | 'resources';
export type InvestAmount = typeof VALID_INVEST_AMOUNTS[number];

export function investIncome(
  roomId: string,
  playerId: string,
  income: IncomeType,
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
  if (room.phase !== 'playing') return { error: 'Game not in progress' };

  const player = room.players.get(playerId);
  if (!player) return { error: 'Player not found' };
  if (!player.alive) return { error: 'City is eliminated' };

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
  if (room.phase !== 'playing') return { error: 'Game not in progress' };

  const player = room.players.get(playerId);
  if (!player) return { error: 'Player not found' };
  if (!player.alive) return { error: 'City is eliminated' };

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
  if (room.phase !== 'playing') return { error: 'Game not in progress' };

  const player = room.players.get(playerId);
  if (!player) return { error: 'Player not found' };
  if (!player.alive) return { error: 'City is eliminated' };

  const config = TRAINING_CONFIG[troopType];
  if (!config) return { error: 'Invalid troop type' };

  if (player.food < config.food || player.gold < config.gold) {
    return { error: 'Not enough resources' };
  }

  // Training converts civilians to troops — need enough civilians
  const civilians = Math.floor(player.population) - totalMilitaryAtHome(player.militaryAtHome);
  if (civilians < config.troops) {
    return { error: 'Not enough civilians to train' };
  }

  player.food -= config.food;
  player.gold -= config.gold;
  player.militaryAtHome[troopType] += config.troops;
  // population unchanged — civilians converted to military, not created

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
  if (!COMBAT_POWER[troopType]) return { error: 'Invalid troop type' };
  if (attacker.militaryAtHome[troopType] < units) return { error: 'Not enough troops' };

  attacker.militaryAtHome[troopType] -= units;
  attacker.population -= units; // troops leaving the city permanently reduce population

  const now = Date.now();

  // Merge into existing group if same attacker→target→type within merge window
  const existing = room.troopsInTransit.find(
    (tg) =>
      tg.attackerPlayerId === attackerPlayerId &&
      tg.targetPlayerId === targetPlayerId &&
      tg.troopType === troopType &&
      now - tg.departedAtMs <= TROOP_GROUP_MERGE_WINDOW_MS,
  );

  if (existing) {
    existing.units += units;
  } else {
    room.troopsInTransit.push({
      id: 'tg_' + Math.random().toString(36).substring(2, 10) + now.toString(36),
      attackerPlayerId,
      targetPlayerId,
      troopType,
      units,
      departedAtMs: now,
      arrivalAtMs: now + TROOP_TRAVEL_MS,
    });
  }

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
  }));

  return {
    roomId: room.roomId,
    phase: room.phase,
    players,
    troopsInTransit: room.troopsInTransit,
    combatHitPlayerIds: room.combatHitPlayerIds,
    winnerPlayerId: room.winnerPlayerId,
  };
}
