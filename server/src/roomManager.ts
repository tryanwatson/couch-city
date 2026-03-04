import type { ServerRoom, ServerCityPlayer, RoomStatePayload, TroopGroup, TroopType, UpgradeCategory } from '../../shared/types';
import {
  PLAYER_COLORS,
  INITIAL_FOOD,
  INITIAL_MATERIALS,
  INITIAL_GOLD,
  FOOD_PER_FARMER,
  MATERIALS_PER_MINER,
  GOLD_PER_MERCHANT,
  FOOD_PER_CITIZEN,
  FOOD_PER_TROOP,
  POP_GROWTH_RATE,
  POP_STARVATION_RATE,
  VALID_GROWTH_MULTIPLIERS,
  INITIAL_POPULATION,
  MONUMENT_CULTURE_PER_TURN,
  UPGRADE_UNLOCK_COST,
  UPGRADE_PROGRESS,
  ALL_UPGRADE_CATEGORIES,
  zeroUpgradeRecord,
  yieldMultiplier,
  PROGRESS_PER_BUILDER,
  CULTURE_WIN_THRESHOLD,
  INITIAL_MILITARY,
  ZERO_MILITARY,
  TROOP_TYPES,
  COMBAT_POWER,
  TRAINING_CONFIG,
  SIEGE_DAMAGE_PER_CP,
  INITIAL_HP,
  MAX_HP,
  HP_REGEN_PERCENT,
  DEFENSE_HP_PER_LEVEL,
  TROOP_TRAVEL_TURNS,
  VALID_ATTACK_AMOUNTS,
  RESOLVING_PHASE_DURATION_MS,
  troopGroupRadius,
  PROMISED_LAND_ID,
  PROMISED_LAND_X,
  PROMISED_LAND_Y,
  PROMISED_LAND_TRAVEL_TURNS,
  PROMISED_LAND_HOLD_TURNS,
  PLAYER_POSITION_SLOTS,
  PLAYER_SLOT_FILL_ORDER,
  PLAYER_POSITION_RX,
  PLAYER_POSITION_RY,
} from '../../shared/constants';
import { generateRoomCode } from './utils';

const rooms = new Map<string, ServerRoom>();


function totalBuilders(builders: Record<UpgradeCategory, number>): number {
  return Object.values(builders).reduce((s, n) => s + n, 0);
}

function clampWorkers(player: ServerCityPlayer): void {
  const civilians = Math.max(0, Math.floor(player.population));
  const tb = totalBuilders(player.builders);
  const total = player.farmers + player.miners + player.merchants + tb;
  if (total <= civilians) return;

  if (civilians <= 0) {
    player.farmers = 0;
    player.miners = 0;
    player.merchants = 0;
    player.builders = zeroUpgradeRecord();
  } else {
    const ratio = civilians / total;
    player.farmers = Math.floor(player.farmers * ratio);
    player.miners = Math.floor(player.miners * ratio);
    player.merchants = Math.floor(player.merchants * ratio);
    for (const cat of Object.keys(player.builders) as UpgradeCategory[]) {
      player.builders[cat] = Math.floor(player.builders[cat] * ratio);
    }
  }
  player.goldIncome = player.merchants * GOLD_PER_MERCHANT * yieldMultiplier(player.upgradesCompleted.trade);

  // Zero out builders for categories with no active build slot
  for (const cat of ALL_UPGRADE_CATEGORIES) {
    if (player.upgradesCompleted[cat] >= player.upgradeLevel[cat]) {
      player.builders[cat] = 0;
    }
  }
}

function countPlayerTroops(player: ServerCityPlayer, room: ServerRoom): number {
  let total = 0;
  for (const type of TROOP_TYPES) {
    total += player.militaryAtHome[type] + player.militaryDefending[type];
  }
  for (const tg of room.troopsInTransit) {
    if (tg.attackerPlayerId === player.playerId) {
      total += tg.units;
    }
  }
  for (const tg of room.occupyingTroops) {
    if (tg.attackerPlayerId === player.playerId) {
      total += tg.units;
    }
  }
  return total;
}

function disbandTroops(player: ServerCityPlayer, room: ServerRoom, count: number): void {
  if (count <= 0) return;
  let remaining = count;

  // Phase 1: disband from militaryAtHome (proportional across types)
  remaining = disbandFromPool(player.militaryAtHome, remaining);

  // Phase 2: disband from militaryDefending
  if (remaining > 0) {
    remaining = disbandFromPool(player.militaryDefending, remaining);
  }

  // Phase 3: disband from troopsInTransit belonging to this player
  if (remaining > 0) {
    const playerGroups = room.troopsInTransit.filter(tg => tg.attackerPlayerId === player.playerId);
    const transitTotal = playerGroups.reduce((s, tg) => s + tg.units, 0);
    if (transitTotal > 0) {
      const ratio = Math.max(0, (transitTotal - remaining) / transitTotal);
      for (const tg of playerGroups) {
        tg.units = Math.floor(tg.units * ratio);
      }
      room.troopsInTransit = room.troopsInTransit.filter(tg => tg.units > 0);
    }
  }

  // Phase 4: disband from occupyingTroops belonging to this player
  if (remaining > 0) {
    const playerGroups = room.occupyingTroops.filter(tg => tg.attackerPlayerId === player.playerId);
    const occTotal = playerGroups.reduce((s, tg) => s + tg.units, 0);
    if (occTotal > 0) {
      const ratio = Math.max(0, (occTotal - remaining) / occTotal);
      for (const tg of playerGroups) {
        tg.units = Math.floor(tg.units * ratio);
      }
      room.occupyingTroops = room.occupyingTroops.filter(tg => tg.units > 0);
    }
  }
}

function disbandFromPool(pool: Record<TroopType, number>, count: number): number {
  const total = TROOP_TYPES.reduce((s, t) => s + pool[t], 0);
  if (total <= 0) return count;
  if (count >= total) {
    for (const type of TROOP_TYPES) pool[type] = 0;
    return count - total;
  }
  const ratio = (total - count) / total;
  for (const type of TROOP_TYPES) {
    pool[type] = Math.floor(pool[type] * ratio);
  }
  return 0;
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

/** Resolve combat between two multi-type forces. Losses distributed proportionally. */
function resolveMultiTypeCombat(
  sideA: Record<TroopType, number>,
  sideB: Record<TroopType, number>,
): { survivorsA: Record<TroopType, number>; survivorsB: Record<TroopType, number> } {
  let cpA = 0;
  let cpB = 0;
  for (const type of TROOP_TYPES) {
    cpA += sideA[type] * COMBAT_POWER[type];
    cpB += sideB[type] * COMBAT_POWER[type];
  }

  if (cpA === 0 || cpB === 0) {
    return { survivorsA: { ...sideA }, survivorsB: { ...sideB } };
  }

  if (cpA > cpB) {
    const lossRatio = cpB / cpA;
    const survivorsA: Record<TroopType, number> = { ...ZERO_MILITARY };
    for (const type of TROOP_TYPES) {
      survivorsA[type] = sideA[type] - Math.ceil(sideA[type] * lossRatio);
    }
    return { survivorsA, survivorsB: { ...ZERO_MILITARY } };
  } else if (cpB > cpA) {
    const lossRatio = cpA / cpB;
    const survivorsB: Record<TroopType, number> = { ...ZERO_MILITARY };
    for (const type of TROOP_TYPES) {
      survivorsB[type] = sideB[type] - Math.ceil(sideB[type] * lossRatio);
    }
    return { survivorsA: { ...ZERO_MILITARY }, survivorsB };
  }
  return { survivorsA: { ...ZERO_MILITARY }, survivorsB: { ...ZERO_MILITARY } };
}

/** Collect transit troops owned by defender within 1 turn of their home city. */
function gatherNearHomeTroops(room: ServerRoom, defenderId: string): TroopGroup[] {
  const nearHome: TroopGroup[] = [];
  for (const tg of room.troopsInTransit) {
    if (tg.attackerPlayerId !== defenderId) continue;
    if (tg.units <= 0) continue;
    if (tg.turnsRemaining <= 0) continue; // already arrived, handled separately
    if (tg.paused) continue;
    if (tg.isDonation) continue;
    if (tg.targetPlayerId === PROMISED_LAND_ID) continue;

    const isHeadingHome = tg.targetPlayerId === tg.attackerPlayerId;
    if (isHeadingHome) {
      if (tg.turnsRemaining <= 1) nearHome.push(tg);
    } else {
      if ((tg.totalTurns - tg.turnsRemaining) <= 1) nearHome.push(tg);
    }
  }
  return nearHome;
}

/** Add surviving attackers to the occupying troops pool at a city. */
function mergeIntoCityOccupiers(room: ServerRoom, tg: TroopGroup): void {
  const existing = room.occupyingTroops.find(
    occ => occ.attackerPlayerId === tg.attackerPlayerId
      && occ.targetPlayerId === tg.targetPlayerId
      && occ.troopType === tg.troopType
  );
  if (existing) {
    existing.units += tg.units;
  } else {
    room.occupyingTroops.push({
      id: tg.id,
      attackerPlayerId: tg.attackerPlayerId,
      targetPlayerId: tg.targetPlayerId,
      troopType: tg.troopType,
      units: tg.units,
      turnsRemaining: 0,
      totalTurns: 0,
    });
  }
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
    occupyingTroops: [],
    combatHitPlayerIds: [],
    winnerPlayerId: null,
    promisedLandOwnerId: null,
    promisedLandHoldTurns: 0,
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
    materials: 0,
    gold: 0,
    goldIncome: 0,
    farmers: 0,
    miners: 0,
    merchants: 0,
    growthMultiplier: 1,
    militaryAtHome: { ...ZERO_MILITARY },
    militaryDefending: { ...ZERO_MILITARY },
    population: 0,
    culture: 0,
    upgradeLevel: zeroUpgradeRecord(),
    builders: zeroUpgradeRecord(),
    upgradesCompleted: zeroUpgradeRecord(),
    upgradeProgress: zeroUpgradeRecord(),
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
          // Auto-allocate idle civilians to farming
          const civilians = Math.max(0, Math.floor(player.population));
          const allocated = player.farmers + player.miners + player.merchants + totalBuilders(player.builders);
          const idle = civilians - allocated;
          if (idle > 0) {
            player.farmers += idle;
          }
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

  // Assign colors and positions around the Promised Land using fixed slots.
  // First 4 players get cardinal directions (W/E/N/S), rest fill gaps as opposite pairs.
  playerList.forEach((player, index) => {
    player.color = PLAYER_COLORS[index % PLAYER_COLORS.length];

    const slot = PLAYER_SLOT_FILL_ORDER[index % PLAYER_SLOT_FILL_ORDER.length];
    const angle = (2 * Math.PI * slot) / PLAYER_POSITION_SLOTS;
    player.x = parseFloat((PROMISED_LAND_X + PLAYER_POSITION_RX * Math.cos(angle)).toFixed(3));
    player.y = parseFloat((PROMISED_LAND_Y + PLAYER_POSITION_RY * Math.sin(angle)).toFixed(3));

    player.food = INITIAL_FOOD;
    player.materials = INITIAL_MATERIALS;
    player.gold = INITIAL_GOLD;
    player.goldIncome = 0;
    player.farmers = 0;
    player.miners = 0;
    player.merchants = 0;
    player.growthMultiplier = 1;
    player.militaryAtHome = { ...INITIAL_MILITARY };
    player.militaryDefending = { ...ZERO_MILITARY };
    player.population = INITIAL_POPULATION;
    player.culture = 0;
    player.upgradeLevel = zeroUpgradeRecord();
    player.builders = zeroUpgradeRecord();
    player.upgradesCompleted = zeroUpgradeRecord();
    player.upgradeProgress = zeroUpgradeRecord();
    player.hp = INITIAL_HP;
    player.maxHp = MAX_HP;
    player.alive = true;
    player.endedTurn = false;
  });

  room.phase = 'playing';
  room.subPhase = 'planning';
  room.turnNumber = 1;
  room.troopsInTransit = [];
  room.occupyingTroops = [];
  room.winnerPlayerId = null;
  room.promisedLandOwnerId = null;
  room.promisedLandHoldTurns = 0;

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

  // Auto-allocate idle civilians to farming
  const civilians = Math.max(0, Math.floor(player.population));
  const allocated = player.farmers + player.miners + player.merchants + totalBuilders(player.builders);
  const idle = civilians - allocated;
  if (idle > 0) {
    player.farmers += idle;
  }

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

  // Worker-based economy
  for (const player of alivePlayers) {
    player.food += player.farmers * FOOD_PER_FARMER * yieldMultiplier(player.upgradesCompleted.farming);
    player.materials += player.miners * MATERIALS_PER_MINER * yieldMultiplier(player.upgradesCompleted.mining);
    player.goldIncome = player.merchants * GOLD_PER_MERCHANT * yieldMultiplier(player.upgradesCompleted.trade);
    player.gold += player.goldIncome;
    player.culture += player.upgradesCompleted.culture * MONUMENT_CULTURE_PER_TURN;

    // Cap builders to remaining build points (return excess to unallocated pool)
    for (const cat of ALL_UPGRADE_CATEGORIES) {
      if (player.upgradesCompleted[cat] < player.upgradeLevel[cat] && player.builders[cat] > 0) {
        const remaining = UPGRADE_PROGRESS[cat][player.upgradesCompleted[cat]] - player.upgradeProgress[cat];
        player.builders[cat] = Math.min(player.builders[cat], remaining);
      }
    }

    // Build progress (all categories)
    for (const cat of ALL_UPGRADE_CATEGORIES) {
      const level = player.upgradeLevel[cat];
      if (player.upgradesCompleted[cat] < level && player.builders[cat] > 0) {
        player.upgradeProgress[cat] += player.builders[cat] * PROGRESS_PER_BUILDER;
        const required = UPGRADE_PROGRESS[cat][player.upgradesCompleted[cat]];
        if (player.upgradeProgress[cat] >= required) {
          player.upgradesCompleted[cat] += 1;
          player.upgradeProgress[cat] = 0;
          player.builders[cat] = 0;
        }
      }
    }

    // Recalculate max HP from defense upgrades (grants bonus HP on completion)
    let bonusHp = 0;
    for (let i = 0; i < player.upgradesCompleted.defense; i++) {
      bonusHp += DEFENSE_HP_PER_LEVEL[i] ?? 0;
    }
    const newMaxHp = MAX_HP + bonusHp;
    if (newMaxHp > player.maxHp) {
      player.hp += (newMaxHp - player.maxHp);
      player.maxHp = newMaxHp;
    }
  }

  // Food consumption & population growth/starvation
  for (const player of alivePlayers) {
    const pop = Math.floor(player.population);
    const foodNeeded = pop * FOOD_PER_CITIZEN * player.growthMultiplier;
    const growthRate = POP_GROWTH_RATE * player.growthMultiplier;

    if (player.food >= foodNeeded) {
      // Fed: consume food, then grow by multiplied rate
      player.food -= foodNeeded;
      player.population = Math.floor(pop * (1 + growthRate));
    } else {
      // Starving: consume all remaining food, population shrinks 20%
      player.food = 0;
      player.population = Math.max(1, Math.floor(pop * (1 - POP_STARVATION_RATE)));
      clampWorkers(player);
    }

    // Troop food consumption (troops eat after population — last to be affected)
    const totalTroops = countPlayerTroops(player, room);
    const troopFoodNeeded = totalTroops * FOOD_PER_TROOP;
    if (player.food >= troopFoodNeeded) {
      player.food -= troopFoodNeeded;
    } else {
      const fedTroops = Math.floor(player.food / FOOD_PER_TROOP);
      player.food = 0;
      disbandTroops(player, room, totalTroops - fedTroops);
    }
  }

  // HP regeneration (percentage-based, scales with defense upgrades)
  for (const player of alivePlayers) {
    const regen = Math.ceil(player.maxHp * HP_REGEN_PERCENT);
    player.hp = Math.min(player.maxHp, player.hp + regen);
  }

  // Existing occupying troops fight garrison and deal siege damage
  room.combatHitPlayerIds = [];
  resolveSiege(room);

  // Advance all troops by 1 turn (skip paused troops)
  for (const tg of room.troopsInTransit) {
    if (!tg.paused) {
      tg.turnsRemaining = Math.max(0, tg.turnsRemaining - 1);
    }
  }

  // Detect and resolve field collisions (turn-based)
  detectFieldCollisions(room);

  // Resolve arrived troop groups (turnsRemaining === 0, skip field combat casualties)
  const arrived = room.troopsInTransit.filter(tg => tg.turnsRemaining <= 0 && tg.units > 0);

  // Batch mine arrivals for simultaneous resolution (prevents first-in-array advantage)
  const mineArrivals = arrived.filter(tg => tg.targetPlayerId === PROMISED_LAND_ID);
  if (mineArrivals.length > 0) {
    resolveMineCombat(room, mineArrivals);
  }

  // Promised Land ownership — after combat so it reflects this turn's outcome
  const landOccupiers = new Set(
    room.occupyingTroops
      .filter(occ => occ.targetPlayerId === PROMISED_LAND_ID && occ.units > 0)
      .map(occ => occ.attackerPlayerId)
  );
  if (landOccupiers.size === 1) {
    const ownerId = Array.from(landOccupiers)[0];
    if (room.players.get(ownerId)?.alive) {
      room.promisedLandHoldTurns = room.promisedLandOwnerId === ownerId
        ? room.promisedLandHoldTurns + 1
        : 0;
      room.promisedLandOwnerId = ownerId;
    } else {
      room.promisedLandOwnerId = null;
      room.promisedLandHoldTurns = 0;
    }
  } else {
    room.promisedLandOwnerId = null;
    room.promisedLandHoldTurns = 0;
  }

  // Process city arrivals: donations, returning troops, then batched attacks
  for (const tg of arrived) {
    if (tg.targetPlayerId === PROMISED_LAND_ID) continue;
    // Donations: add troops to recipient's garrison instead of fighting
    if (tg.isDonation) {
      const recipient = room.players.get(tg.targetPlayerId);
      if (recipient && recipient.alive) {
        recipient.militaryAtHome[tg.troopType] += tg.units;
      }
      tg.units = 0; // mark as processed
      continue;
    }
    // Returning home: add to garrison
    if (tg.attackerPlayerId === tg.targetPlayerId) {
      const player = room.players.get(tg.attackerPlayerId);
      if (player && player.alive) {
        player.militaryAtHome[tg.troopType] += tg.units;
      }
      tg.units = 0; // mark as processed
      continue;
    }
  }

  // Batch attack arrivals by target city for simultaneous resolution
  const attacksByTarget = new Map<string, TroopGroup[]>();
  for (const tg of arrived) {
    if (tg.units <= 0) continue; // already processed (donations/returns)
    if (tg.targetPlayerId === PROMISED_LAND_ID) continue;
    const list = attacksByTarget.get(tg.targetPlayerId) ?? [];
    list.push(tg);
    attacksByTarget.set(tg.targetPlayerId, list);
  }
  for (const [targetId, attackGroups] of attacksByTarget) {
    if (!room.combatHitPlayerIds.includes(targetId)) {
      room.combatHitPlayerIds.push(targetId);
    }
    resolveCombatBatched(room, targetId, attackGroups);
  }

  // Auto-recall donations heading to dead cities
  for (const tg of room.troopsInTransit) {
    if (tg.isDonation && tg.turnsRemaining > 0) {
      const recipient = room.players.get(tg.targetPlayerId);
      if (recipient && !recipient.alive) {
        const currentPos = getTroopCurrentPosition(tg, room.players);
        const turnsTraveled = tg.totalTurns - tg.turnsRemaining;
        tg.startX = currentPos.x;
        tg.startY = currentPos.y;
        tg.targetPlayerId = tg.attackerPlayerId;
        tg.turnsRemaining = Math.max(1, turnsTraveled);
        tg.totalTurns = tg.turnsRemaining;
        tg.isDonation = false;
      }
    }
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
    room.combatHitPlayerIds = [];

    // Promised Land win condition: hold uncontested for N consecutive turns
    // Checked here (after resolving animation) so players see combat play out first
    if (room.promisedLandHoldTurns >= PROMISED_LAND_HOLD_TURNS && room.promisedLandOwnerId) {
      const landWinner = room.players.get(room.promisedLandOwnerId);
      if (landWinner && landWinner.alive) {
        room.phase = 'gameover';
        room.subPhase = null;
        room.winnerPlayerId = landWinner.playerId;
        if (broadcastFn) broadcastFn(room.roomId);
        return;
      }
    }

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
    // Skip mine-bound troops (separate lane, no player target to look up)
    if (tg1.targetPlayerId === PROMISED_LAND_ID || tg1.attackerPlayerId === PROMISED_LAND_ID) continue;
    if (tg1.isDonation) continue; // donations are peaceful — no field combat

    for (let j = i + 1; j < transit.length; j++) {
      const tg2 = transit[j];
      if (tg2.units <= 0) continue;
      if (tg2.targetPlayerId === PROMISED_LAND_ID || tg2.attackerPlayerId === PROMISED_LAND_ID) continue;
      if (tg2.isDonation) continue;

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

      // Collision point = midpoint of pre-advance positions (equal walk distances)
      const att2 = room.players.get(tg2.attackerPlayerId)!;
      const tgt2 = room.players.get(tg2.targetPlayerId)!;

      const origin1x = tg1.startX ?? att1.x;
      const origin1y = tg1.startY ?? att1.y;
      const origin2x = tg2.startX ?? att2.x;
      const origin2y = tg2.startY ?? att2.y;

      const preP1 = tg1.totalTurns > 0 ? Math.max(0, tg1.totalTurns - tg1.turnsRemaining - 1) / tg1.totalTurns : 0;
      const preP2 = tg2.totalTurns > 0 ? Math.max(0, tg2.totalTurns - tg2.turnsRemaining - 1) / tg2.totalTurns : 0;

      const pre1x = origin1x + (tgt1.x - origin1x) * preP1;
      const pre1y = origin1y + (tgt1.y - origin1y) * preP1;
      const pre2x = origin2x + (tgt2.x - origin2x) * preP2;
      const pre2y = origin2y + (tgt2.y - origin2y) * preP2;

      const collisionX = (pre1x + pre2x) / 2;
      const collisionY = (pre1y + pre2y) / 2;

      // Mark field combat location for animation (preserved until setTimeout cleanup)
      tg1.fieldCombatX = collisionX;
      tg1.fieldCombatY = collisionY;
      tg1.fieldCombatUnits = tg1.units;
      tg2.fieldCombatX = collisionX;
      tg2.fieldCombatY = collisionY;
      tg2.fieldCombatUnits = tg2.units;

      tg1.inFieldCombat = true;
      tg2.inFieldCombat = true;

      tg1.units = result.survivorsA;
      tg2.units = result.survivorsB;

      // Winner continues to their post-advance destination step
      for (const tg of [tg1, tg2]) {
        if (tg.units > 0) {
          const attacker = room.players.get(tg.attackerPlayerId)!;
          const target = room.players.get(tg.targetPlayerId)!;
          const originX = tg.startX ?? attacker.x;
          const originY = tg.startY ?? attacker.y;
          const postProgress = tg.totalTurns > 0 ? (tg.totalTurns - tg.turnsRemaining) / tg.totalTurns : 1;
          tg.startX = originX + (target.x - originX) * postProgress;
          tg.startY = originY + (target.y - originY) * postProgress;
          tg.totalTurns = tg.turnsRemaining; // remaining journey from new start
        }
      }
    }
  }
  // Destroyed groups kept in transit for resolving animation (cleaned up in setTimeout)
}

// ============================================================
// Combat resolution
// ============================================================

function mergeIntoOccupiers(room: ServerRoom, tg: TroopGroup): void {
  const existing = room.occupyingTroops.find(
    occ => occ.attackerPlayerId === tg.attackerPlayerId
      && occ.targetPlayerId === PROMISED_LAND_ID
      && occ.troopType === tg.troopType
  );
  if (existing) {
    existing.units += tg.units;
  } else {
    room.occupyingTroops.push({
      id: tg.id,
      attackerPlayerId: tg.attackerPlayerId,
      targetPlayerId: PROMISED_LAND_ID,
      troopType: tg.troopType,
      units: tg.units,
      turnsRemaining: 0,
      totalTurns: 0,
    });
  }
}

function resolveMineCombat(room: ServerRoom, arrivingMineGroups: TroopGroup[]): void {
  // Pool all troops at the mine per player (existing occupiers + new arrivals)
  const playerGroups = new Map<string, {
    arriving: TroopGroup[];
    occupying: TroopGroup[];
    totalCP: number;
  }>();

  for (const occ of room.occupyingTroops) {
    if (occ.targetPlayerId !== PROMISED_LAND_ID || occ.units <= 0) continue;
    let entry = playerGroups.get(occ.attackerPlayerId);
    if (!entry) {
      entry = { arriving: [], occupying: [], totalCP: 0 };
      playerGroups.set(occ.attackerPlayerId, entry);
    }
    entry.occupying.push(occ);
    entry.totalCP += occ.units * COMBAT_POWER[occ.troopType];
  }

  for (const tg of arrivingMineGroups) {
    let entry = playerGroups.get(tg.attackerPlayerId);
    if (!entry) {
      entry = { arriving: [], occupying: [], totalCP: 0 };
      playerGroups.set(tg.attackerPlayerId, entry);
    }
    entry.arriving.push(tg);
    entry.totalCP += tg.units * COMBAT_POWER[tg.troopType];
  }

  const playerIds = Array.from(playerGroups.keys());

  // No combat if only one player involved — just merge arrivals
  if (playerIds.length <= 1) {
    for (const tg of arrivingMineGroups) {
      mergeIntoOccupiers(room, tg);
    }
    return;
  }

  // Mark all arriving groups for combat animation
  for (const tg of arrivingMineGroups) {
    tg.fieldCombatUnits = tg.units;
    tg.fieldCombatX = PROMISED_LAND_X;
    tg.fieldCombatY = PROMISED_LAND_Y;
    tg.inFieldCombat = true;
  }

  // Find the strongest player by total CP
  let maxCP = 0;
  let winnerId: string | null = null;
  let tied = false;
  for (const [pid, entry] of playerGroups) {
    if (entry.totalCP > maxCP) {
      maxCP = entry.totalCP;
      winnerId = pid;
      tied = false;
    } else if (entry.totalCP === maxCP) {
      tied = true;
    }
  }

  if (tied) {
    // Exact tie — all sides wiped (consistent with cpBasedTrade)
    for (const [, entry] of playerGroups) {
      // Add synthetic transit entries for dying occupiers so they animate (fight → fade)
      for (const occ of entry.occupying) {
        room.troopsInTransit.push({
          id: occ.id + '-minefight',
          attackerPlayerId: occ.attackerPlayerId,
          targetPlayerId: PROMISED_LAND_ID,
          troopType: occ.troopType,
          units: 0,
          turnsRemaining: 0,
          totalTurns: 0,
          fieldCombatX: PROMISED_LAND_X,
          fieldCombatY: PROMISED_LAND_Y,
          fieldCombatUnits: occ.units,
          inFieldCombat: true,
        });
        occ.units = 0;
      }
      for (const tg of entry.arriving) tg.units = 0;
    }
    room.occupyingTroops = room.occupyingTroops.filter(occ => occ.units > 0);
    return;
  }

  // Winner determined — wipe all losers
  let enemyTotalCP = 0;
  for (const [pid, entry] of playerGroups) {
    if (pid === winnerId) continue;
    enemyTotalCP += entry.totalCP;
    // Add synthetic transit entries for dying occupiers so they animate (fight → fade)
    for (const occ of entry.occupying) {
      room.troopsInTransit.push({
        id: occ.id + '-minefight',
        attackerPlayerId: occ.attackerPlayerId,
        targetPlayerId: PROMISED_LAND_ID,
        troopType: occ.troopType,
        units: 0,
        turnsRemaining: 0,
        totalTurns: 0,
        fieldCombatX: PROMISED_LAND_X,
        fieldCombatY: PROMISED_LAND_Y,
        fieldCombatUnits: occ.units,
        inFieldCombat: true,
      });
      occ.units = 0;
    }
    for (const tg of entry.arriving) tg.units = 0;
  }

  // Winner takes proportional losses across all their groups
  const winnerEntry = playerGroups.get(winnerId!)!;
  const lossRatio = enemyTotalCP / winnerEntry.totalCP;
  for (const group of [...winnerEntry.occupying, ...winnerEntry.arriving]) {
    group.units -= Math.floor(group.units * lossRatio);
  }

  // Clean up dead occupiers
  room.occupyingTroops = room.occupyingTroops.filter(occ => occ.units > 0);

  // Merge surviving arrivals into occupying troops
  for (const tg of arrivingMineGroups) {
    if (tg.units > 0) {
      mergeIntoOccupiers(room, tg);
    }
  }
}

/** Batched combat resolution: all attacks arriving at the same city this turn. */
function resolveCombatBatched(room: ServerRoom, targetId: string, attackGroups: TroopGroup[]): void {
  const defender = room.players.get(targetId);
  if (!defender || !defender.alive) return;

  // === STEP 1: City takes full damage from ALL arriving attackers ===
  let totalAttackerCP = 0;
  for (const tg of attackGroups) {
    totalAttackerCP += tg.units * COMBAT_POWER[tg.troopType];
  }
  defender.hp -= totalAttackerCP * SIEGE_DAMAGE_PER_CP;

  // === STEP 2: Check if city dies from initial damage ===
  if (defender.hp <= 0) {
    defender.hp = 0;
    defender.alive = false;
    for (const type of TROOP_TYPES) {
      defender.militaryAtHome[type] = 0;
      defender.militaryDefending[type] = 0;
    }
    // Remove transit troops owned by dead player
    room.troopsInTransit = room.troopsInTransit.filter(
      t => t.attackerPlayerId !== defender.playerId
    );
    // Remove occupying troops owned by dead player at other cities
    room.occupyingTroops = room.occupyingTroops.filter(
      occ => occ.attackerPlayerId !== defender.playerId
    );
    // Surviving occupiers at this city travel home
    const occupiersHere = room.occupyingTroops.filter(
      occ => occ.targetPlayerId === targetId && occ.units > 0
    );
    for (const occ of occupiersHere) {
      room.troopsInTransit.push({
        id: occ.id + '-return',
        attackerPlayerId: occ.attackerPlayerId,
        targetPlayerId: occ.attackerPlayerId,
        troopType: occ.troopType,
        units: occ.units,
        turnsRemaining: TROOP_TRAVEL_TURNS,
        totalTurns: TROOP_TRAVEL_TURNS,
        startX: defender.x,
        startY: defender.y,
      });
    }
    room.occupyingTroops = room.occupyingTroops.filter(
      occ => occ.targetPlayerId !== targetId
    );
    // Attackers also go home (city is dead, nothing to occupy)
    for (const tg of attackGroups) {
      if (tg.units > 0) {
        room.troopsInTransit.push({
          id: tg.id + '-return',
          attackerPlayerId: tg.attackerPlayerId,
          targetPlayerId: tg.attackerPlayerId,
          troopType: tg.troopType,
          units: tg.units,
          turnsRemaining: TROOP_TRAVEL_TURNS,
          totalTurns: TROOP_TRAVEL_TURNS,
          startX: defender.x,
          startY: defender.y,
        });
      }
    }
    return;
  }

  // === STEP 3: Gather ALL defenders (militaryDefending + near-home transit) ===
  const defenderForce: Record<TroopType, number> = { ...defender.militaryDefending };
  const nearHomeTroops = gatherNearHomeTroops(room, targetId);
  for (const tg of nearHomeTroops) {
    defenderForce[tg.troopType] += tg.units;
  }

  let totalDefenderCP = 0;
  for (const type of TROOP_TYPES) {
    totalDefenderCP += defenderForce[type] * COMBAT_POWER[type];
  }

  // === STEP 4: No defenders — attackers become occupying troops unopposed ===
  if (totalDefenderCP === 0) {
    for (const tg of attackGroups) {
      mergeIntoCityOccupiers(room, tg);
    }
    return;
  }

  // === STEP 5: Attacker vs Defender combat ===
  const attackerForce: Record<TroopType, number> = { ...ZERO_MILITARY };
  for (const tg of attackGroups) {
    attackerForce[tg.troopType] += tg.units;
  }

  const { survivorsA, survivorsB } = resolveMultiTypeCombat(attackerForce, defenderForce);

  // === STEP 6: Apply results to defenders ===
  for (const type of TROOP_TYPES) {
    // Distribute defender losses proportionally between militaryDefending and near-home transit
    const totalOfType = defenderForce[type];
    const survivingOfType = survivorsB[type];
    if (totalOfType === 0) continue;

    const survivalRatio = survivingOfType / totalOfType;

    // Apply to militaryDefending
    defender.militaryDefending[type] = Math.floor(defender.militaryDefending[type] * survivalRatio);

    // Apply to near-home transit troops of this type
    for (const tg of nearHomeTroops) {
      if (tg.troopType === type) {
        tg.units = Math.floor(tg.units * survivalRatio);
      }
    }
  }

  // === STEP 7: Apply results to attackers — surviving attackers become occupying troops ===
  for (const tg of attackGroups) {
    const totalOfType = attackerForce[tg.troopType];
    if (totalOfType === 0) continue;
    const survivingOfType = survivorsA[tg.troopType];
    // Distribute survivors proportionally back to original TroopGroups
    const share = Math.floor(survivingOfType * (tg.units / totalOfType));
    tg.units = share;
    if (tg.units > 0) {
      mergeIntoCityOccupiers(room, tg);
    }
  }

  // === STEP 8: Convert surviving near-home transit troops to militaryDefending ===
  for (const tg of nearHomeTroops) {
    if (tg.units > 0) {
      defender.militaryDefending[tg.troopType] += tg.units;
      tg.units = 0; // remove from transit
    }
  }
}

function resolveSiege(room: ServerRoom): void {
  // Group occupying troops by target city
  const occupiersByTarget = new Map<string, TroopGroup[]>();
  for (const occ of room.occupyingTroops) {
    const list = occupiersByTarget.get(occ.targetPlayerId) ?? [];
    list.push(occ);
    occupiersByTarget.set(occ.targetPlayerId, list);
  }

  for (const [targetId, occupiers] of occupiersByTarget) {
    if (targetId === PROMISED_LAND_ID) continue; // Mine occupiers don't siege — handled separately
    const defender = room.players.get(targetId);
    if (!defender || !defender.alive) continue;

    // Gather defenders: militaryDefending + near-home transit troops
    const defenderForce: Record<TroopType, number> = { ...defender.militaryDefending };
    const nearHomeTroops = gatherNearHomeTroops(room, targetId);
    for (const tg of nearHomeTroops) {
      defenderForce[tg.troopType] += tg.units;
    }

    let defenderCP = 0;
    for (const type of TROOP_TYPES) {
      defenderCP += defenderForce[type] * COMBAT_POWER[type];
    }

    // Pool all occupiers into one multi-type attacker force
    const attackerForce: Record<TroopType, number> = { ...ZERO_MILITARY };
    let attackerCP = 0;
    for (const occ of occupiers) {
      attackerForce[occ.troopType] += occ.units;
      attackerCP += occ.units * COMBAT_POWER[occ.troopType];
    }

    if (defenderCP > 0 && attackerCP > 0) {
      const { survivorsA, survivorsB } = resolveMultiTypeCombat(attackerForce, defenderForce);

      // Apply results to defenders
      for (const type of TROOP_TYPES) {
        const totalOfType = defenderForce[type];
        if (totalOfType === 0) continue;
        const survivalRatio = survivorsB[type] / totalOfType;
        defender.militaryDefending[type] = Math.floor(defender.militaryDefending[type] * survivalRatio);
        for (const tg of nearHomeTroops) {
          if (tg.troopType === type) {
            tg.units = Math.floor(tg.units * survivalRatio);
          }
        }
      }

      // Apply results to occupiers — distribute survivors proportionally
      for (const occ of occupiers) {
        const totalOfType = attackerForce[occ.troopType];
        if (totalOfType === 0) { occ.units = 0; continue; }
        occ.units = Math.floor(survivorsA[occ.troopType] * (occ.units / totalOfType));
      }
    }

    // Convert surviving near-home transit troops to militaryDefending
    for (const tg of nearHomeTroops) {
      if (tg.units > 0) {
        defender.militaryDefending[tg.troopType] += tg.units;
        tg.units = 0;
      }
    }

    // Surviving occupiers deal siege damage
    let survivingOccCP = 0;
    for (const occ of occupiers) {
      if (occ.units > 0) {
        survivingOccCP += occ.units * COMBAT_POWER[occ.troopType];
      }
    }
    if (survivingOccCP > 0) {
      defender.hp -= survivingOccCP * SIEGE_DAMAGE_PER_CP;
      if (!room.combatHitPlayerIds.includes(targetId)) {
        room.combatHitPlayerIds.push(targetId);
      }
    }

    // Check if city dies from siege
    if (defender.hp <= 0) {
      defender.hp = 0;
      defender.alive = false;
      for (const type of TROOP_TYPES) {
        defender.militaryAtHome[type] = 0;
        defender.militaryDefending[type] = 0;
      }
      // Remove transit troops owned by dead player
      room.troopsInTransit = room.troopsInTransit.filter(
        t => t.attackerPlayerId !== defender.playerId
      );
      // Remove occupying troops owned by dead player at other cities
      room.occupyingTroops = room.occupyingTroops.filter(
        occ => occ.attackerPlayerId !== defender.playerId
      );
      // Surviving occupiers at this city travel home
      const occupiersHere = room.occupyingTroops.filter(
        occ => occ.targetPlayerId === targetId && occ.units > 0
      );
      for (const occ of occupiersHere) {
        room.troopsInTransit.push({
          id: occ.id + '-return',
          attackerPlayerId: occ.attackerPlayerId,
          targetPlayerId: occ.attackerPlayerId,
          troopType: occ.troopType,
          units: occ.units,
          turnsRemaining: TROOP_TRAVEL_TURNS,
          totalTurns: TROOP_TRAVEL_TURNS,
          startX: defender.x,
          startY: defender.y,
        });
      }
      // Remove all occupying troops targeting dead city
      room.occupyingTroops = room.occupyingTroops.filter(
        occ => occ.targetPlayerId !== targetId
      );
    }
  }

  // Clean up dead occupier groups
  room.occupyingTroops = room.occupyingTroops.filter(occ => occ.units > 0);
}

// ============================================================
// Player actions (immediate during planning)
// ============================================================

function guardAction(room: ServerRoom, playerId: string): ServerCityPlayer | string {
  if (room.phase !== 'playing') return 'Game not in progress';
  if (room.subPhase !== 'planning') return 'Cannot act during update phase';
  const player = room.players.get(playerId);
  if (!player) return 'Player not found';
  if (!player.alive) return 'City is eliminated';
  if (player.endedTurn) return 'Turn already ended';
  return player;
}

export function allocateWorkers(
  roomId: string,
  playerId: string,
  farmers: number,
  miners: number,
  merchants: number,
  builders: Record<UpgradeCategory, number>
): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  const guard = guardAction(room, playerId);
  if (typeof guard === 'string') return { error: guard };
  const player = guard;

  if (!Number.isInteger(farmers) || farmers < 0 ||
      !Number.isInteger(miners) || miners < 0 ||
      !Number.isInteger(merchants) || merchants < 0) {
    return { error: 'Worker counts must be non-negative integers' };
  }

  for (const cat of Object.keys(builders) as UpgradeCategory[]) {
    if (!Number.isInteger(builders[cat]) || builders[cat] < 0) {
      return { error: 'Builder counts must be non-negative integers' };
    }
  }

  for (const cat of ALL_UPGRADE_CATEGORIES) {
    if ((builders[cat] ?? 0) > 0 && player.upgradesCompleted[cat] >= player.upgradeLevel[cat]) {
      return { error: `No active ${cat} build project` };
    }
  }

  for (const cat of ALL_UPGRADE_CATEGORIES) {
    if ((builders[cat] ?? 0) > 0 && player.upgradesCompleted[cat] < player.upgradeLevel[cat]) {
      const remaining = UPGRADE_PROGRESS[cat][player.upgradesCompleted[cat]] - player.upgradeProgress[cat];
      if (builders[cat] > remaining) {
        return { error: `Too many builders for ${cat} (only ${remaining} build points remaining)` };
      }
    }
  }

  const tb = totalBuilders(builders);
  const civilians = Math.floor(player.population);
  if (farmers + miners + merchants + tb > civilians) {
    return { error: 'Not enough civilians for this allocation' };
  }

  player.farmers = farmers;
  player.miners = miners;
  player.merchants = merchants;
  player.builders = builders;
  player.goldIncome = merchants * GOLD_PER_MERCHANT * yieldMultiplier(player.upgradesCompleted.trade);

  return { room };
}

export function setGrowthMultiplier(
  roomId: string,
  playerId: string,
  multiplier: number
): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  const guard = guardAction(room, playerId);
  if (typeof guard === 'string') return { error: guard };
  const player = guard;

  if (!(VALID_GROWTH_MULTIPLIERS as readonly number[]).includes(multiplier)) {
    return { error: 'Invalid growth multiplier' };
  }

  player.growthMultiplier = multiplier;

  return { room };
}

export function unlockUpgrade(
  roomId: string,
  playerId: string,
  category: UpgradeCategory
): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  const guard = guardAction(room, playerId);
  if (typeof guard === 'string') return { error: guard };
  const player = guard;

  const maxLevel = UPGRADE_PROGRESS[category].length;
  if (player.upgradeLevel[category] >= maxLevel) return { error: `Maximum ${category} level reached` };
  if (player.materials < UPGRADE_UNLOCK_COST.materials) return { error: 'Not enough materials' };
  if (player.gold < UPGRADE_UNLOCK_COST.gold) return { error: 'Not enough gold' };

  player.materials -= UPGRADE_UNLOCK_COST.materials;
  player.gold -= UPGRADE_UNLOCK_COST.gold;
  player.upgradeLevel[category] += 1;

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

  // Gate troop types behind military upgrades (warriors always available)
  const troopIndex = TROOP_TYPES.indexOf(troopType);
  if (troopIndex > 0 && player.upgradesCompleted.military < troopIndex) {
    return { error: `${troopType} not yet unlocked` };
  }

  if (player.materials < config.materials || player.gold < config.gold) {
    return { error: 'Not enough materials or gold' };
  }

  player.materials -= config.materials;
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

  // Gold mine is always a valid target; player targets must exist and be alive
  if (targetPlayerId !== PROMISED_LAND_ID) {
    const target = room.players.get(targetPlayerId);
    if (!target) return { error: 'Target not found' };
    if (!target.alive) return { error: 'Target city is already eliminated' };
  }

  if (!(VALID_ATTACK_AMOUNTS as readonly number[]).includes(units)) {
    return { error: 'Invalid unit count' };
  }
  if (!COMBAT_POWER[troopType]) return { error: 'Invalid troop type' };
  if (attacker.militaryAtHome[troopType] < units) return { error: 'Not enough troops' };

  attacker.militaryAtHome[troopType] -= units;

  const travelTurns = targetPlayerId === PROMISED_LAND_ID ? PROMISED_LAND_TRAVEL_TURNS : TROOP_TRAVEL_TURNS;

  // Merge into existing group sent this same planning phase (same target, same type, freshly created)
  const existing = room.troopsInTransit.find(
    tg =>
      tg.attackerPlayerId === attackerPlayerId &&
      tg.targetPlayerId === targetPlayerId &&
      tg.troopType === troopType &&
      tg.turnsRemaining === travelTurns &&
      tg.totalTurns === travelTurns &&
      !tg.isDonation,
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
      turnsRemaining: travelTurns,
      totalTurns: travelTurns,
    });
  }

  return { room };
}

export function sendDonation(
  roomId: string,
  senderPlayerId: string,
  targetPlayerId: string,
  units: number,
  troopType: TroopType
): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  const guard = guardAction(room, senderPlayerId);
  if (typeof guard === 'string') return { error: guard };
  const sender = guard;

  if (senderPlayerId === targetPlayerId) return { error: 'Cannot donate to yourself' };
  if (targetPlayerId === PROMISED_LAND_ID) return { error: 'Cannot donate to the Promised Land' };

  const target = room.players.get(targetPlayerId);
  if (!target) return { error: 'Target not found' };
  if (!target.alive) return { error: 'Target city is already eliminated' };

  if (!(VALID_ATTACK_AMOUNTS as readonly number[]).includes(units)) {
    return { error: 'Invalid unit count' };
  }
  if (!COMBAT_POWER[troopType]) return { error: 'Invalid troop type' };
  if (sender.militaryAtHome[troopType] < units) return { error: 'Not enough troops' };

  sender.militaryAtHome[troopType] -= units;

  const travelTurns = PROMISED_LAND_TRAVEL_TURNS; // donations travel fast (2 turns)

  // Merge into existing donation group sent this same planning phase
  const existing = room.troopsInTransit.find(
    tg =>
      tg.attackerPlayerId === senderPlayerId &&
      tg.targetPlayerId === targetPlayerId &&
      tg.troopType === troopType &&
      tg.turnsRemaining === travelTurns &&
      tg.totalTurns === travelTurns &&
      tg.isDonation === true,
  );

  if (existing) {
    existing.units += units;
  } else {
    room.troopsInTransit.push({
      id: 'tg_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36),
      attackerPlayerId: senderPlayerId,
      targetPlayerId,
      troopType,
      units,
      turnsRemaining: travelTurns,
      totalTurns: travelTurns,
      isDonation: true,
    });
  }

  return { room };
}

// ============================================================
// Defend / recall defenders (instant transfer, no travel)
// ============================================================

export function sendDefend(
  roomId: string,
  playerId: string,
  units: number,
  troopType: TroopType
): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  const guard = guardAction(room, playerId);
  if (typeof guard === 'string') return { error: guard };
  const player = guard;

  if (!(VALID_ATTACK_AMOUNTS as readonly number[]).includes(units)) {
    return { error: 'Invalid unit count' };
  }
  if (!COMBAT_POWER[troopType]) return { error: 'Invalid troop type' };
  if (player.militaryAtHome[troopType] < units) return { error: 'Not enough troops' };

  player.militaryAtHome[troopType] -= units;
  player.militaryDefending[troopType] += units;

  return { room };
}

export function recallDefenders(
  roomId: string,
  playerId: string,
  units: number,
  troopType: TroopType
): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  const guard = guardAction(room, playerId);
  if (typeof guard === 'string') return { error: guard };
  const player = guard;

  if (!(VALID_ATTACK_AMOUNTS as readonly number[]).includes(units)) {
    return { error: 'Invalid unit count' };
  }
  if (!COMBAT_POWER[troopType]) return { error: 'Invalid troop type' };
  if (player.militaryDefending[troopType] < units) return { error: 'Not enough defending troops' };

  player.militaryDefending[troopType] -= units;
  player.militaryAtHome[troopType] += units;

  return { room };
}

// ============================================================
// Troop management (recall, pause, resume, redirect)
// ============================================================

/** Compute the current interpolated position of a troop group */
function getTroopCurrentPosition(
  tg: TroopGroup,
  players: Map<string, ServerCityPlayer>
): { x: number; y: number } {
  const attacker = players.get(tg.attackerPlayerId);
  const originX = tg.startX ?? (attacker?.x ?? 0);
  const originY = tg.startY ?? (attacker?.y ?? 0);

  let targetX: number, targetY: number;
  if (tg.targetPlayerId === PROMISED_LAND_ID) {
    targetX = PROMISED_LAND_X;
    targetY = PROMISED_LAND_Y;
  } else if (tg.targetPlayerId === tg.attackerPlayerId) {
    targetX = attacker?.x ?? 0;
    targetY = attacker?.y ?? 0;
  } else {
    const target = players.get(tg.targetPlayerId);
    targetX = target?.x ?? 0;
    targetY = target?.y ?? 0;
  }

  const progress = tg.totalTurns > 0
    ? (tg.totalTurns - tg.turnsRemaining) / tg.totalTurns
    : 1;
  return {
    x: originX + (targetX - originX) * progress,
    y: originY + (targetY - originY) * progress,
  };
}

export function recallTroops(
  roomId: string,
  playerId: string,
  troopGroupId: string
): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  const guard = guardAction(room, playerId);
  if (typeof guard === 'string') return { error: guard };

  const tg = room.troopsInTransit.find(
    t => t.id === troopGroupId && t.attackerPlayerId === playerId
  );
  if (!tg) return { error: 'Troop group not found' };
  if (tg.targetPlayerId === tg.attackerPlayerId) return { error: 'Troops are already returning home' };
  if (tg.turnsRemaining <= 0) return { error: 'Troops have already arrived' };

  const currentPos = getTroopCurrentPosition(tg, room.players);
  const turnsTraveled = tg.totalTurns - tg.turnsRemaining;
  const returnTurns = Math.max(1, turnsTraveled);

  tg.startX = currentPos.x;
  tg.startY = currentPos.y;
  tg.targetPlayerId = tg.attackerPlayerId;
  tg.turnsRemaining = returnTurns;
  tg.totalTurns = returnTurns;
  tg.paused = false;

  return { room };
}

export function pauseTroops(
  roomId: string,
  playerId: string,
  troopGroupId: string
): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  const guard = guardAction(room, playerId);
  if (typeof guard === 'string') return { error: guard };

  const tg = room.troopsInTransit.find(
    t => t.id === troopGroupId && t.attackerPlayerId === playerId
  );
  if (!tg) return { error: 'Troop group not found' };
  if (tg.paused) return { error: 'Troops are already paused' };
  if (tg.turnsRemaining <= 0) return { error: 'Troops have already arrived' };

  tg.paused = true;
  return { room };
}

export function resumeTroops(
  roomId: string,
  playerId: string,
  troopGroupId: string
): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  const guard = guardAction(room, playerId);
  if (typeof guard === 'string') return { error: guard };

  const tg = room.troopsInTransit.find(
    t => t.id === troopGroupId && t.attackerPlayerId === playerId
  );
  if (!tg) return { error: 'Troop group not found' };
  if (!tg.paused) return { error: 'Troops are not paused' };

  tg.paused = false;
  return { room };
}

export function redirectTroops(
  roomId: string,
  playerId: string,
  troopGroupId: string,
  newTargetPlayerId: string
): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  const guard = guardAction(room, playerId);
  if (typeof guard === 'string') return { error: guard };

  const tg = room.troopsInTransit.find(
    t => t.id === troopGroupId && t.attackerPlayerId === playerId
  );
  if (!tg) return { error: 'Troop group not found' };
  if (tg.turnsRemaining <= 0) return { error: 'Troops have already arrived' };
  if (newTargetPlayerId === playerId) return { error: 'Use recall to send troops home' };
  if (newTargetPlayerId === tg.targetPlayerId) return { error: 'Already heading to that target' };

  // Validate new target
  if (tg.isDonation && newTargetPlayerId === PROMISED_LAND_ID) {
    return { error: 'Cannot redirect donations to the Promised Land' };
  }
  if (newTargetPlayerId !== PROMISED_LAND_ID) {
    const newTarget = room.players.get(newTargetPlayerId);
    if (!newTarget) return { error: 'Target not found' };
    if (!newTarget.alive) return { error: 'Target is eliminated' };
  }

  const currentPos = getTroopCurrentPosition(tg, room.players);

  // Resolve new target position
  let newTargetX: number, newTargetY: number;
  if (newTargetPlayerId === PROMISED_LAND_ID) {
    newTargetX = PROMISED_LAND_X;
    newTargetY = PROMISED_LAND_Y;
  } else {
    const newTarget = room.players.get(newTargetPlayerId)!;
    newTargetX = newTarget.x;
    newTargetY = newTarget.y;
  }

  // Calculate new travel time proportionally
  const newDist = Math.hypot(newTargetX - currentPos.x, newTargetY - currentPos.y);

  // Resolve old target position for ratio calculation
  let oldTargetX: number, oldTargetY: number;
  if (tg.targetPlayerId === PROMISED_LAND_ID) {
    oldTargetX = PROMISED_LAND_X;
    oldTargetY = PROMISED_LAND_Y;
  } else {
    const oldTarget = room.players.get(tg.targetPlayerId);
    oldTargetX = oldTarget?.x ?? currentPos.x;
    oldTargetY = oldTarget?.y ?? currentPos.y;
  }
  const oldRemainingDist = Math.hypot(oldTargetX - currentPos.x, oldTargetY - currentPos.y);

  let newTurns: number;
  if (oldRemainingDist > 0.001) {
    newTurns = Math.max(1, Math.round(tg.turnsRemaining * (newDist / oldRemainingDist)));
  } else {
    const baseTurns = (newTargetPlayerId === PROMISED_LAND_ID || tg.targetPlayerId === PROMISED_LAND_ID)
      ? PROMISED_LAND_TRAVEL_TURNS
      : TROOP_TRAVEL_TURNS;
    newTurns = Math.max(1, Math.round(baseTurns * (newDist / 0.7)));
  }

  tg.startX = currentPos.x;
  tg.startY = currentPos.y;
  tg.targetPlayerId = newTargetPlayerId;
  tg.turnsRemaining = newTurns;
  tg.totalTurns = newTurns;
  tg.paused = false;

  return { room };
}

export function recallOccupyingTroops(
  roomId: string,
  playerId: string,
  troopGroupId: string
): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  const guard = guardAction(room, playerId);
  if (typeof guard === 'string') return { error: guard };

  const occIndex = room.occupyingTroops.findIndex(
    occ => occ.id === troopGroupId && occ.attackerPlayerId === playerId
  );
  if (occIndex === -1) return { error: 'Occupying troop group not found' };

  const occ = room.occupyingTroops[occIndex];

  // Determine start position (where the troops currently are)
  let startX: number, startY: number;
  if (occ.targetPlayerId === PROMISED_LAND_ID) {
    startX = PROMISED_LAND_X;
    startY = PROMISED_LAND_Y;
  } else {
    const targetCity = room.players.get(occ.targetPlayerId);
    startX = targetCity?.x ?? 0.5;
    startY = targetCity?.y ?? 0.5;
  }

  // PL is closer than a city — use the appropriate travel time
  const returnTurns = occ.targetPlayerId === PROMISED_LAND_ID
    ? PROMISED_LAND_TRAVEL_TURNS
    : TROOP_TRAVEL_TURNS;

  // Move from occupying to transit (heading home)
  room.occupyingTroops.splice(occIndex, 1);
  room.troopsInTransit.push({
    id: occ.id + '-recalled',
    attackerPlayerId: playerId,
    targetPlayerId: playerId, // heading home
    troopType: occ.troopType,
    units: occ.units,
    turnsRemaining: returnTurns,
    totalTurns: returnTurns,
    startX,
    startY,
  });

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
  room.occupyingTroops = [];
  room.winnerPlayerId = null;
  room.promisedLandOwnerId = null;
  room.promisedLandHoldTurns = 0;

  for (const [, player] of room.players) {
    player.color = '';
    player.alive = true;
    player.food = 0;
    player.materials = 0;
    player.gold = 0;
    player.goldIncome = 0;
    player.farmers = 0;
    player.miners = 0;
    player.merchants = 0;
    player.growthMultiplier = 1;
    player.militaryAtHome = { ...ZERO_MILITARY };
    player.militaryDefending = { ...ZERO_MILITARY };
    player.population = 0;
    player.culture = 0;
    player.upgradeLevel = zeroUpgradeRecord();
    player.builders = zeroUpgradeRecord();
    player.upgradesCompleted = zeroUpgradeRecord();
    player.upgradeProgress = zeroUpgradeRecord();
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
    materials: p.materials,
    gold: p.gold,
    goldIncome: p.goldIncome,
    farmers: p.farmers,
    miners: p.miners,
    merchants: p.merchants,
    growthMultiplier: p.growthMultiplier,
    militaryAtHome: p.militaryAtHome,
    militaryDefending: p.militaryDefending,
    population: p.population,
    culture: p.culture,
    upgradeLevel: p.upgradeLevel,
    builders: p.builders,
    upgradesCompleted: p.upgradesCompleted,
    upgradeProgress: p.upgradeProgress,
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
    occupyingTroops: room.occupyingTroops,
    combatHitPlayerIds: room.combatHitPlayerIds,
    winnerPlayerId: room.winnerPlayerId,
    promisedLandOwnerId: room.promisedLandOwnerId,
    promisedLandHoldTurns: room.promisedLandHoldTurns,
  };
}
