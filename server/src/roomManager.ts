import type { ServerRoom, ServerCityPlayer, RoomStatePayload, TroopGroup, TroopType, UpgradeCategory, GameSettings } from '../../shared/types';
import {
  PLAYER_COLORS,
  INITIAL_FOOD,
  INITIAL_MATERIALS,
  INITIAL_GOLD,
  FOOD_PER_FARMER,
  MATERIALS_PER_MINER,
  GOLD_PER_MERCHANT,
  FOOD_PER_CITIZEN,
  POP_GROWTH_RATE,
  POP_STARVATION_RATE,
  VALID_GROWTH_MULTIPLIERS,
  INITIAL_POPULATION,
  MONUMENT_CULTURE_PER_TURN,
  getUpgradeUnlockCost,
  UPGRADE_PROGRESS,
  ALL_UPGRADE_CATEGORIES,
  zeroUpgradeRecord,
  yieldMultiplier,
  PROGRESS_PER_BUILDER,
  CULTURE_WIN_THRESHOLD,

  ZERO_MILITARY,
  TROOP_TYPES,
  COMBAT_POWER,
  DICE_CP_MULTIPLIER,
  TRAINING_CONFIG,
  SIEGE_DAMAGE_PER_CP,
  INITIAL_HP,
  MAX_HP,
  HP_REGEN_PERCENT,
  WALLS_HP_PER_LEVEL,
  MOVEMENT_SPEED,
  RESOLVING_PHASE_DURATION_MS,
  RESOLVING_PHASE_DURATION_SHORT_MS,
  DICE_LINGER_MS,
  PROMISED_LAND_ID,
  PROMISED_LAND_X,
  PROMISED_LAND_Y,
  PROMISED_LAND_HOLD_TURNS,
  PLAYER_START_ANGLE,
  PLAYER_POSITION_RX,
  PLAYER_POSITION_RY,
  getHousingCap,
} from '../../shared/constants';
import { pixelToHex, hexToPixel, hexLineDraw, hexDistance, hexEqual, hexKey } from '../../shared/hexGrid';
import type { Hex } from '../../shared/hexGrid';
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

/**
 * Returns true if every alive player has either ended their turn or is disconnected,
 * AND at least one alive player is still connected (game pauses if everyone leaves).
 */
function allAlivePlayersEffectivelyEnded(room: ServerRoom): boolean {
  const alivePlayers = Array.from(room.players.values()).filter(p => p.alive);
  if (alivePlayers.length === 0) return false;
  if (!alivePlayers.some(p => p.connected)) return false;
  return alivePlayers.every(p => p.endedTurn || !p.connected);
}

/**
 * For each alive, disconnected player who hasn't ended their turn,
 * set endedTurn = true and auto-allocate idle civilians to farming.
 * Call this right before runUpdatePhase.
 */
function autoEndDisconnectedPlayers(room: ServerRoom): void {
  for (const [, player] of room.players) {
    if (player.alive && !player.connected && !player.endedTurn) {
      player.endedTurn = true;
      const civilians = Math.max(0, Math.floor(player.population));
      const allocated = player.farmers + player.miners + player.merchants + totalBuilders(player.builders);
      const idle = civilians - allocated;
      if (idle > 0) {
        player.farmers += idle;
      }
    }
  }
}

function cpBasedTrade(unitsA: number, cpPerA: number, unitsB: number, cpPerB: number, multiplierA = 1, multiplierB = 1): { survivorsA: number; survivorsB: number } {
  const cpA = unitsA * cpPerA * multiplierA;
  const cpB = unitsB * cpPerB * multiplierB;
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
  multiplierA = 1,
  multiplierB = 1,
): { survivorsA: Record<TroopType, number>; survivorsB: Record<TroopType, number> } {
  let cpA = 0;
  let cpB = 0;
  for (const type of TROOP_TYPES) {
    cpA += sideA[type] * COMBAT_POWER[type];
    cpB += sideB[type] * COMBAT_POWER[type];
  }
  cpA *= multiplierA;
  cpB *= multiplierB;

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

/** Distribute defender survivors proportionally between militaryDefending and near-home transit troops. */
function applyDefenderSurvivors(
  defender: ServerCityPlayer,
  defenderForce: Record<TroopType, number>,
  survivors: Record<TroopType, number>,
  nearHomeTroops: TroopGroup[]
): void {
  for (const type of TROOP_TYPES) {
    const totalOfType = defenderForce[type];
    if (totalOfType === 0) continue;
    const survivalRatio = survivors[type] / totalOfType;
    defender.militaryDefending[type] = Math.floor(defender.militaryDefending[type] * survivalRatio);
    for (const tg of nearHomeTroops) {
      if (tg.troopType === type) {
        tg.units = Math.floor(tg.units * survivalRatio);
      }
    }
  }
}

/** Distribute attacker/occupier survivors proportionally across TroopGroups. */
function applyAttackerSurvivors(
  groups: TroopGroup[],
  pooledForce: Record<TroopType, number>,
  survivors: Record<TroopType, number>
): void {
  for (const tg of groups) {
    const totalOfType = pooledForce[tg.troopType];
    if (totalOfType === 0) { tg.units = 0; continue; }
    tg.units = Math.floor(survivors[tg.troopType] * (tg.units / totalOfType));
  }
}

/** Collect transit troops owned by defender within 1 move of their home city. */
function gatherNearHomeTroops(room: ServerRoom, defenderId: string): TroopGroup[] {
  const defender = room.players.get(defenderId);
  if (!defender) return [];
  const nearHome: TroopGroup[] = [];
  for (const tg of room.troopsInTransit) {
    if (tg.attackerPlayerId !== defenderId) continue;
    if (tg.units <= 0) continue;
    if (tg.paused) continue;
    if (tg.isDonation) continue;
    if (tg.targetPlayerId === PROMISED_LAND_ID) continue;
    // Already at destination
    if (tg.hexQ === tg.destHexQ && tg.hexR === tg.destHexR) continue;

    const distToHome = hexDistance({ q: tg.hexQ, r: tg.hexR }, { q: defender.hexQ, r: defender.hexR });
    if (distToHome <= MOVEMENT_SPEED[tg.troopType]) nearHome.push(tg);
  }
  return nearHome;
}

/** Handle all cleanup when a city dies: wipe military, remove dead player's
 *  transit/occupying troops, send occupiers at the dead city home. */
function handleCityDeath(
  room: ServerRoom,
  defender: ServerCityPlayer,
  extraReturnGroups?: TroopGroup[]
): void {
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
    occ => occ.targetPlayerId === defender.playerId && occ.units > 0
  );
  for (const occ of occupiersHere) {
    const home = room.players.get(occ.attackerPlayerId);
    room.troopsInTransit.push({
      id: occ.id + '-return',
      attackerPlayerId: occ.attackerPlayerId,
      targetPlayerId: occ.attackerPlayerId,
      troopType: occ.troopType,
      units: occ.units,
      hexQ: defender.hexQ,
      hexR: defender.hexR,
      destHexQ: home?.hexQ ?? 0,
      destHexR: home?.hexR ?? 0,
    });
  }
  room.occupyingTroops = room.occupyingTroops.filter(
    occ => occ.targetPlayerId !== defender.playerId
  );
  // Send extra groups home (e.g. arriving attackers when city dies on arrival)
  if (extraReturnGroups) {
    for (const tg of extraReturnGroups) {
      if (tg.units > 0) {
        const home = room.players.get(tg.attackerPlayerId);
        room.troopsInTransit.push({
          id: tg.id + '-return',
          attackerPlayerId: tg.attackerPlayerId,
          targetPlayerId: tg.attackerPlayerId,
          troopType: tg.troopType,
          units: tg.units,
          hexQ: defender.hexQ,
          hexR: defender.hexR,
          destHexQ: home?.hexQ ?? 0,
          destHexR: home?.hexR ?? 0,
        });
      }
    }
  }
}

/** Add surviving attackers to the occupying troops pool. */
function mergeIntoOccupiers(room: ServerRoom, tg: TroopGroup): void {
  const existing = room.occupyingTroops.find(
    occ => occ.attackerPlayerId === tg.attackerPlayerId
      && occ.targetPlayerId === tg.targetPlayerId
      && occ.troopType === tg.troopType
  );
  if (existing) {
    existing.units += tg.units;
  } else {
    const destHex = resolveTargetHex(tg.targetPlayerId, room.players);
    room.occupyingTroops.push({
      id: tg.id,
      attackerPlayerId: tg.attackerPlayerId,
      targetPlayerId: tg.targetPlayerId,
      troopType: tg.troopType,
      units: tg.units,
      hexQ: destHex.q,
      hexR: destHex.r,
      destHexQ: destHex.q,
      destHexR: destHex.r,
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
    diceResults: {},
    winnerPlayerId: null,
    promisedLandOwnerId: null,
    promisedLandHoldTurns: 0,
    resolvingDurationMs: null,
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

    // If this reconnection completes a paused turn (e.g. everyone disconnected
    // and this player had already ended), finalize and advance.
    if (room.phase === 'playing' && room.subPhase === 'planning') {
      if (allAlivePlayersEffectivelyEnded(room)) {
        autoEndDisconnectedPlayers(room);
        runUpdatePhase(room);
      }
    }

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
    hexQ: 0,
    hexR: 0,
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

        // If this disconnect completes the turn (all remaining connected players already ended),
        // finalize disconnected players and advance. Does NOT eagerly auto-end this player's turn
        // to avoid the race condition where a disconnect after turn-reset triggers an extra turn.
        if (room.phase === 'playing' && room.subPhase === 'planning') {
          if (allAlivePlayersEffectivelyEnded(room)) {
            autoEndDisconnectedPlayers(room);
            runUpdatePhase(room);
          }
        }

        return { roomId, wasHost: false };
      }
    }
  }
  return null;
}

export function chooseColor(
  roomId: string,
  playerId: string,
  color: string
): { error?: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };
  if (room.phase !== 'lobby') return { error: 'Game already started' };

  const player = room.players.get(playerId);
  if (!player) return { error: 'Player not found' };

  if (!PLAYER_COLORS.includes(color)) return { error: 'Invalid color' };

  for (const [id, p] of room.players) {
    if (id !== playerId && p.color === color) {
      return { error: 'Color already taken' };
    }
  }

  player.color = color;
  return {};
}

export function startGame(
  roomId: string,
  settings?: GameSettings
): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };
  if (room.phase !== 'lobby') return { error: 'Game already started' };
  if (room.players.size === 0) return { error: 'Need at least 1 player' };

  const clamp = (v: number | undefined, fallback: number) =>
    v != null ? Math.min(999, Math.max(0, Math.floor(v))) : fallback;
  const gold = clamp(settings?.initialGold, INITIAL_GOLD);
  const materials = clamp(settings?.initialMaterials, INITIAL_MATERIALS);
  const food = clamp(settings?.initialFood, INITIAL_FOOD);

  const playerList = Array.from(room.players.values());

  // Respect colors chosen during lobby; assign remaining colors to players who didn't pick.
  const chosenColors = new Set(playerList.map(p => p.color).filter(c => c !== ''));
  const availableColors = PLAYER_COLORS.filter(c => !chosenColors.has(c));
  let availIdx = 0;

  // Assign positions equidistantly around the Promised Land.
  // N players are spaced 360/N degrees apart, starting from PLAYER_START_ANGLE (West).
  const n = playerList.length;
  playerList.forEach((player, index) => {
    if (!player.color) {
      player.color = availableColors[availIdx % availableColors.length];
      availIdx++;
    }

    const angle = PLAYER_START_ANGLE + (2 * Math.PI * index) / n;
    const rawX = PROMISED_LAND_X + PLAYER_POSITION_RX * Math.cos(angle);
    const rawY = PROMISED_LAND_Y + PLAYER_POSITION_RY * Math.sin(angle);
    // Snap to nearest hex
    const hex = pixelToHex(rawX, rawY);
    player.hexQ = hex.q;
    player.hexR = hex.r;
    const snapped = hexToPixel(hex);
    player.x = parseFloat(snapped.x.toFixed(3));
    player.y = parseFloat(snapped.y.toFixed(3));

    player.food = food;
    player.materials = materials;
    player.gold = gold;
    player.goldIncome = 0;
    player.farmers = 0;
    player.miners = 0;
    player.merchants = 0;
    player.growthMultiplier = 1;
    player.militaryAtHome = { ...ZERO_MILITARY };
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

  // Check if all alive players have ended (treating disconnected as effectively ended)
  if (allAlivePlayersEffectivelyEnded(room)) {
    autoEndDisconnectedPlayers(room);
    runUpdatePhase(room);
  }

  return { room };
}

function runUpdatePhase(room: ServerRoom): void {
  if (room.subPhase === 'resolving') return; // guard against double-invocation
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

    // Recalculate max HP from walls upgrades (grants bonus HP on completion)
    let bonusHp = 0;
    for (let i = 0; i < player.upgradesCompleted.walls; i++) {
      bonusHp += WALLS_HP_PER_LEVEL[i] ?? 0;
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

    // Housing cap — clamp population to current housing level
    const housingCap = getHousingCap(player.upgradesCompleted.housing);
    if (player.population > housingCap) {
      player.population = housingCap;
    }
  }

  // Generate dice rolls per player for combat multipliers
  room.diceResults = {};
  for (const player of alivePlayers) {
    room.diceResults[player.playerId] = Math.floor(Math.random() * 6) + 1;
  }

  // Snapshot all combat-affected state before resolving so we can defer
  // casualties for the animation broadcast (clients see pre-combat values
  // during animation, then post-combat values are applied after timeout).
  const preResolvingDefenders = new Map<string, Record<TroopType, number>>();
  for (const [pid, player] of room.players) {
    preResolvingDefenders.set(pid, { ...player.militaryDefending });
  }
  const preResolvingTransitUnits = new Map<string, number>();
  for (const tg of room.troopsInTransit) {
    preResolvingTransitUnits.set(tg.id, tg.units);
  }
  const preResolvingOccupiers = room.occupyingTroops.map(occ => ({ ...occ }));

  // Existing occupying troops fight garrison and deal siege damage
  room.combatHitPlayerIds = [];
  resolveSiege(room);

  // Advance all troops along hex path (skip paused troops)
  for (const tg of room.troopsInTransit) {
    tg.prevHexQ = tg.hexQ;
    tg.prevHexR = tg.hexR;
    if (!tg.paused) {
      const from: Hex = { q: tg.hexQ, r: tg.hexR };
      const to: Hex = { q: tg.destHexQ, r: tg.destHexR };
      if (!hexEqual(from, to)) {
        const path = hexLineDraw(from, to);
        const speed = MOVEMENT_SPEED[tg.troopType];
        const stepIndex = Math.min(speed, path.length - 1);
        tg.hexQ = path[stepIndex].q;
        tg.hexR = path[stepIndex].r;
      }
    }
  }

  // Detect and resolve field collisions (same-hex)
  detectFieldCollisions(room);

  // Resolve arrived troop groups (reached destination hex)
  const arrived = room.troopsInTransit.filter(
    tg => tg.hexQ === tg.destHexQ && tg.hexR === tg.destHexR && tg.units > 0
  );

  // Batch promised land arrivals for simultaneous resolution (prevents first-in-array advantage)
  const promisedLandArrivals = arrived.filter(tg => tg.targetPlayerId === PROMISED_LAND_ID);
  if (promisedLandArrivals.length > 0) {
    resolvePromisedLandCombat(room, promisedLandArrivals);
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
      continue;
    }
    // Returning home: add to garrison or defending
    if (tg.attackerPlayerId === tg.targetPlayerId) {
      const player = room.players.get(tg.attackerPlayerId);
      if (player && player.alive) {
        if (tg.defendOnArrival) {
          player.militaryDefending[tg.troopType] += tg.units;
        } else {
          player.militaryAtHome[tg.troopType] += tg.units;
        }
      }
      continue;
    }
  }

  // Batch attack arrivals by target city for simultaneous resolution
  const attacksByTarget = new Map<string, TroopGroup[]>();
  for (const tg of arrived) {
    if (tg.units <= 0) continue;
    if (tg.targetPlayerId === PROMISED_LAND_ID) continue;
    if (tg.isDonation) continue;
    if (tg.attackerPlayerId === tg.targetPlayerId) continue;
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

  // Save post-combat state, then restore pre-combat values for animation broadcast.
  // Field combat troops are skipped — they already handle this via fieldCombatUnits.
  const postResolvingDefenders = new Map<string, Record<TroopType, number>>();
  for (const [pid, player] of room.players) {
    postResolvingDefenders.set(pid, { ...player.militaryDefending });
    const pre = preResolvingDefenders.get(pid);
    if (pre) player.militaryDefending = { ...pre };
  }
  const postResolvingTransitUnits = new Map<string, number>();
  for (const tg of room.troopsInTransit) {
    postResolvingTransitUnits.set(tg.id, tg.units);
  }
  const postResolvingOccupiers = [...room.occupyingTroops];
  for (const tg of room.troopsInTransit) {
    if (tg.inFieldCombat) continue;
    const preUnits = preResolvingTransitUnits.get(tg.id);
    if (preUnits != null) tg.units = preUnits;
  }
  room.occupyingTroops = preResolvingOccupiers;

  // Auto-recall donations heading to dead cities
  for (const tg of room.troopsInTransit) {
    if (tg.isDonation && !(tg.hexQ === tg.destHexQ && tg.hexR === tg.destHexR)) {
      const recipient = room.players.get(tg.targetPlayerId);
      if (recipient && !recipient.alive) {
        const home = room.players.get(tg.attackerPlayerId);
        tg.targetPlayerId = tg.attackerPlayerId;
        tg.destHexQ = home?.hexQ ?? 0;
        tg.destHexR = home?.hexR ?? 0;
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

  // Determine resolving duration based on whether visual events occurred
  const hasVisualEvents =
    room.troopsInTransit.some(tg => !tg.paused) ||
    room.combatHitPlayerIds.length > 0;
  const hasCombat =
    room.troopsInTransit.some(tg => tg.inFieldCombat) ||
    room.occupyingTroops.length > 0;
  const resolvingDuration = hasVisualEvents
    ? RESOLVING_PHASE_DURATION_MS + (hasCombat ? DICE_LINGER_MS : 0)
    : RESOLVING_PHASE_DURATION_SHORT_MS;
  room.resolvingDurationMs = resolvingDuration;

  // Broadcast resolving state (clients can show animation)
  if (broadcastFn) broadcastFn(room.roomId);

  // After animation duration, transition to next planning phase
  setTimeout(() => {
    if (room.phase !== 'playing') return;
    // Clear field combat markers on survivors
    for (const tg of room.troopsInTransit) {
      tg.fieldCombatHexQ = undefined;
      tg.fieldCombatHexR = undefined;
      tg.inFieldCombat = undefined;
      tg.fieldCombatUnits = undefined;
    }
    // Apply deferred combat casualties now that animation has played
    for (const tg of room.troopsInTransit) {
      const postUnits = postResolvingTransitUnits.get(tg.id);
      if (postUnits != null) tg.units = postUnits;
    }
    room.occupyingTroops = postResolvingOccupiers;
    // Remove arrived troops and field combat casualties (uses post-combat units)
    room.troopsInTransit = room.troopsInTransit.filter(
      tg => !(tg.hexQ === tg.destHexQ && tg.hexR === tg.destHexR) && tg.units > 0
    );
    for (const [pid, post] of postResolvingDefenders) {
      const player = room.players.get(pid);
      if (player) player.militaryDefending = { ...post };
    }
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

    // HP regeneration at the start of planning phase (after combat resolved)
    for (const [, player] of room.players) {
      if (!player.alive) continue;
      const regen = Math.ceil(player.maxHp * HP_REGEN_PERCENT);
      player.hp = Math.min(player.maxHp, player.hp + regen);
    }

    room.turnNumber += 1;
    room.diceResults = {};
    room.resolvingDurationMs = null;
    for (const [, player] of room.players) {
      player.endedTurn = false;
    }
    if (broadcastFn) broadcastFn(room.roomId);
  }, resolvingDuration);
}

// ============================================================
// Field combat detection (same-hex collision)
// ============================================================

function detectFieldCollisions(room: ServerRoom): void {
  // Group all in-transit troops by their current hex
  const byHex = new Map<string, TroopGroup[]>();
  for (const tg of room.troopsInTransit) {
    if (tg.units <= 0) continue;
    if (tg.isDonation) continue; // donations are peaceful
    const key = hexKey({ q: tg.hexQ, r: tg.hexR });
    const list = byHex.get(key) ?? [];
    list.push(tg);
    byHex.set(key, list);
  }

  for (const [, groups] of byHex) {
    if (groups.length < 2) continue;

    // Check for opposing owners on this hex
    const owners = new Set(groups.map(tg => tg.attackerPlayerId));
    if (owners.size < 2) continue;

    // Resolve all pairwise combats on this hex
    for (let i = 0; i < groups.length; i++) {
      const tg1 = groups[i];
      if (tg1.units <= 0) continue;
      for (let j = i + 1; j < groups.length; j++) {
        const tg2 = groups[j];
        if (tg2.units <= 0) continue;
        if (tg1.attackerPlayerId === tg2.attackerPlayerId) continue; // allies don't fight

        const result = cpBasedTrade(
          tg1.units, COMBAT_POWER[tg1.troopType],
          tg2.units, COMBAT_POWER[tg2.troopType],
          DICE_CP_MULTIPLIER[room.diceResults[tg1.attackerPlayerId] ?? 3],
          DICE_CP_MULTIPLIER[room.diceResults[tg2.attackerPlayerId] ?? 3],
        );

        // Mark field combat on this hex for animation
        tg1.fieldCombatHexQ = tg1.hexQ;
        tg1.fieldCombatHexR = tg1.hexR;
        tg1.fieldCombatUnits = tg1.units;
        tg2.fieldCombatHexQ = tg2.hexQ;
        tg2.fieldCombatHexR = tg2.hexR;
        tg2.fieldCombatUnits = tg2.units;

        tg1.inFieldCombat = true;
        tg2.inFieldCombat = true;

        tg1.units = result.survivorsA;
        tg2.units = result.survivorsB;
      }
    }
  }
  // Destroyed groups kept in transit for resolving animation (cleaned up in setTimeout)
}

// ============================================================
// Combat resolution
// ============================================================

function resolvePromisedLandCombat(room: ServerRoom, arrivingPromisedLandGroups: TroopGroup[]): void {
  // Pool all troops at the promised land per player (existing occupiers + new arrivals)
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

  for (const tg of arrivingPromisedLandGroups) {
    let entry = playerGroups.get(tg.attackerPlayerId);
    if (!entry) {
      entry = { arriving: [], occupying: [], totalCP: 0 };
      playerGroups.set(tg.attackerPlayerId, entry);
    }
    entry.arriving.push(tg);
    entry.totalCP += tg.units * COMBAT_POWER[tg.troopType];
  }

  // Apply dice multiplier to each player's total CP
  for (const [pid, entry] of playerGroups) {
    entry.totalCP *= DICE_CP_MULTIPLIER[room.diceResults[pid] ?? 3];
  }

  const playerIds = Array.from(playerGroups.keys());

  // No combat if only one player involved — just merge arrivals
  if (playerIds.length <= 1) {
    for (const tg of arrivingPromisedLandGroups) {
      mergeIntoOccupiers(room, tg);
    }
    return;
  }

  // Mark all arriving groups for combat animation
  for (const tg of arrivingPromisedLandGroups) {
    tg.fieldCombatUnits = tg.units;
    tg.fieldCombatHexQ = 0;
    tg.fieldCombatHexR = 0;
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
          id: occ.id + '-promisedlandfight',
          attackerPlayerId: occ.attackerPlayerId,
          targetPlayerId: PROMISED_LAND_ID,
          troopType: occ.troopType,
          units: 0,
          hexQ: 0,
          hexR: 0,
          destHexQ: 0,
          destHexR: 0,
          fieldCombatHexQ: 0,
          fieldCombatHexR: 0,
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
        id: occ.id + '-promisedlandfight',
        attackerPlayerId: occ.attackerPlayerId,
        targetPlayerId: PROMISED_LAND_ID,
        troopType: occ.troopType,
        units: 0,
          hexQ: 0,
          hexR: 0,
          destHexQ: 0,
          destHexR: 0,
          fieldCombatHexQ: 0,
          fieldCombatHexR: 0,
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
  for (const tg of arrivingPromisedLandGroups) {
    if (tg.units > 0) {
      mergeIntoOccupiers(room, tg);
    }
  }
}

/** Batched combat resolution: all attacks arriving at the same city this turn. */
function resolveCombatBatched(room: ServerRoom, targetId: string, attackGroups: TroopGroup[]): void {
  const defender = room.players.get(targetId);
  if (!defender || !defender.alive) return;

  // === STEP 1: Calculate total attacker CP (dice-adjusted) ===
  let totalAttackerCP = 0;
  for (const tg of attackGroups) {
    totalAttackerCP += tg.units * COMBAT_POWER[tg.troopType] * DICE_CP_MULTIPLIER[room.diceResults[tg.attackerPlayerId] ?? 3];
  }

  // === STEP 2: Gather ALL defenders (militaryDefending + near-home transit) ===
  const defenderForce: Record<TroopType, number> = { ...defender.militaryDefending };
  const nearHomeTroops = gatherNearHomeTroops(room, targetId);
  for (const tg of nearHomeTroops) {
    defenderForce[tg.troopType] += tg.units;
  }

  let totalDefenderCP = 0;
  for (const type of TROOP_TYPES) {
    totalDefenderCP += defenderForce[type] * COMBAT_POWER[type];
  }

  // === STEP 3: No defenders — full attacker CP overflows to city damage ===
  if (totalDefenderCP === 0) {
    defender.hp -= totalAttackerCP * SIEGE_DAMAGE_PER_CP;
    if (defender.hp <= 0) {
      handleCityDeath(room, defender, attackGroups);
      return;
    }
    for (const tg of attackGroups) {
      mergeIntoOccupiers(room, tg);
    }
    return;
  }

  // === STEP 4: Attacker vs Defender combat ===
  const attackerForce: Record<TroopType, number> = { ...ZERO_MILITARY };
  let attackerBaseCP = 0;
  for (const tg of attackGroups) {
    attackerForce[tg.troopType] += tg.units;
    attackerBaseCP += tg.units * COMBAT_POWER[tg.troopType];
  }
  // Weighted average dice multiplier for mixed-player attacker groups
  const attackerMultiplier = attackerBaseCP > 0 ? totalAttackerCP / attackerBaseCP : 1;
  const defenderMultiplier = DICE_CP_MULTIPLIER[room.diceResults[targetId] ?? 3];

  const { survivorsA, survivorsB } = resolveMultiTypeCombat(attackerForce, defenderForce, attackerMultiplier, defenderMultiplier);

  // === STEP 5: Apply results to defenders ===
  applyDefenderSurvivors(defender, defenderForce, survivorsB, nearHomeTroops);

  // === STEP 6: Apply results to attackers ===
  applyAttackerSurvivors(attackGroups, attackerForce, survivorsA);

  // === STEP 7: Overflow damage — surviving attacker CP damages the city ===
  let survivingAttackerCP = 0;
  for (const tg of attackGroups) {
    if (tg.units > 0) {
      survivingAttackerCP += tg.units * COMBAT_POWER[tg.troopType] * DICE_CP_MULTIPLIER[room.diceResults[tg.attackerPlayerId] ?? 3];
    }
  }
  if (survivingAttackerCP > 0) {
    defender.hp -= survivingAttackerCP * SIEGE_DAMAGE_PER_CP;
  }
  if (defender.hp <= 0) {
    handleCityDeath(room, defender, attackGroups);
    return;
  }

  // === STEP 8: Surviving attackers become occupying troops ===
  for (const tg of attackGroups) {
    if (tg.units > 0) {
      mergeIntoOccupiers(room, tg);
    }
  }

  // === STEP 9: Convert surviving near-home transit troops to militaryDefending ===
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
    if (targetId === PROMISED_LAND_ID) continue; // Promised land occupiers don't siege — handled separately
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
    let attackerBaseCP = 0;
    let attackerDiceCP = 0;
    for (const occ of occupiers) {
      attackerForce[occ.troopType] += occ.units;
      const cp = occ.units * COMBAT_POWER[occ.troopType];
      attackerBaseCP += cp;
      attackerDiceCP += cp * DICE_CP_MULTIPLIER[room.diceResults[occ.attackerPlayerId] ?? 3];
    }
    const siegeAttackerMultiplier = attackerBaseCP > 0 ? attackerDiceCP / attackerBaseCP : 1;
    const siegeDefenderMultiplier = DICE_CP_MULTIPLIER[room.diceResults[targetId] ?? 3];

    if (defenderCP > 0 && attackerBaseCP > 0) {
      const { survivorsA, survivorsB } = resolveMultiTypeCombat(attackerForce, defenderForce, siegeAttackerMultiplier, siegeDefenderMultiplier);

      applyDefenderSurvivors(defender, defenderForce, survivorsB, nearHomeTroops);
      applyAttackerSurvivors(occupiers, attackerForce, survivorsA);

      // Mark as visual event whenever siege combat occurs (not just when damage is dealt)
      if (!room.combatHitPlayerIds.includes(targetId)) {
        room.combatHitPlayerIds.push(targetId);
      }
    }

    // Convert surviving near-home transit troops to militaryDefending
    for (const tg of nearHomeTroops) {
      if (tg.units > 0) {
        defender.militaryDefending[tg.troopType] += tg.units;
        tg.units = 0;
      }
    }

    // Surviving occupiers deal siege damage (dice-adjusted)
    let survivingOccCP = 0;
    for (const occ of occupiers) {
      if (occ.units > 0) {
        survivingOccCP += occ.units * COMBAT_POWER[occ.troopType] * DICE_CP_MULTIPLIER[room.diceResults[occ.attackerPlayerId] ?? 3];
      }
    }
    if (survivingOccCP > 0) {
      defender.hp -= survivingOccCP * SIEGE_DAMAGE_PER_CP;
    }

    // Check if city dies from siege
    if (defender.hp <= 0) {
      handleCityDeath(room, defender);
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
  const cost = getUpgradeUnlockCost(category, player.upgradeLevel[category]);
  if (player.materials < cost) return { error: 'Not enough materials' };

  player.materials -= cost;
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

  if (player.gold < config.gold) {
    return { error: 'Not enough gold' };
  }

  player.gold -= config.gold;
  player.militaryAtHome[troopType] += config.troops;

  return { room };
}

export function sendAttack(
  roomId: string,
  attackerPlayerId: string,
  targetPlayerId: string,
  units: number,
  troopType: TroopType,
  fromDefending?: boolean
): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  const guard = guardAction(room, attackerPlayerId);
  if (typeof guard === 'string') return { error: guard };
  const attacker = guard;

  if (attackerPlayerId === targetPlayerId) return { error: 'Cannot attack yourself' };

  // Promised land is always a valid target; player targets must exist and be alive
  if (targetPlayerId !== PROMISED_LAND_ID) {
    const target = room.players.get(targetPlayerId);
    if (!target) return { error: 'Target not found' };
    if (!target.alive) return { error: 'Target city is already eliminated' };
  }

  if (!Number.isInteger(units) || units < 1) {
    return { error: 'Invalid unit count' };
  }
  if (!COMBAT_POWER[troopType]) return { error: 'Invalid troop type' };
  const source = fromDefending ? attacker.militaryDefending : attacker.militaryAtHome;
  if (source[troopType] < units) return { error: 'Not enough troops' };

  source[troopType] -= units;

  // Resolve destination hex
  const destHex = targetPlayerId === PROMISED_LAND_ID
    ? { q: 0, r: 0 }
    : { q: room.players.get(targetPlayerId)!.hexQ, r: room.players.get(targetPlayerId)!.hexR };

  // Merge into existing group sent this same planning phase (same hex, same target, same type)
  const existing = room.troopsInTransit.find(
    tg =>
      tg.attackerPlayerId === attackerPlayerId &&
      tg.targetPlayerId === targetPlayerId &&
      tg.troopType === troopType &&
      tg.hexQ === attacker.hexQ && tg.hexR === attacker.hexR &&
      tg.destHexQ === destHex.q && tg.destHexR === destHex.r &&
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
      hexQ: attacker.hexQ,
      hexR: attacker.hexR,
      destHexQ: destHex.q,
      destHexR: destHex.r,
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

  if (!Number.isInteger(units) || units < 1) {
    return { error: 'Invalid unit count' };
  }
  if (!COMBAT_POWER[troopType]) return { error: 'Invalid troop type' };
  if (sender.militaryAtHome[troopType] < units) return { error: 'Not enough troops' };

  sender.militaryAtHome[troopType] -= units;

  const destHex = { q: target.hexQ, r: target.hexR };

  // Merge into existing donation group sent this same planning phase
  const existing = room.troopsInTransit.find(
    tg =>
      tg.attackerPlayerId === senderPlayerId &&
      tg.targetPlayerId === targetPlayerId &&
      tg.troopType === troopType &&
      tg.hexQ === sender.hexQ && tg.hexR === sender.hexR &&
      tg.destHexQ === destHex.q && tg.destHexR === destHex.r &&
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
      hexQ: sender.hexQ,
      hexR: sender.hexR,
      destHexQ: destHex.q,
      destHexR: destHex.r,
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

  if (!Number.isInteger(units) || units < 1) {
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

  if (!Number.isInteger(units) || units < 1) {
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

/** Resolve the hex position for a target (Promised Land or player city). */
function resolveTargetHex(
  targetPlayerId: string,
  players: Map<string, ServerCityPlayer>,
): Hex {
  if (targetPlayerId === PROMISED_LAND_ID) {
    return { q: 0, r: 0 };
  }
  const target = players.get(targetPlayerId);
  return { q: target?.hexQ ?? 0, r: target?.hexR ?? 0 };
}

export function recallTroops(
  roomId: string,
  playerId: string,
  troopGroupId: string,
  defendOnArrival?: boolean
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
  const arrived = tg.hexQ === tg.destHexQ && tg.hexR === tg.destHexR;
  if (arrived) return { error: 'Troops have already arrived' };

  const player = room.players.get(playerId);
  if (!player) return { error: 'Player not found' };

  // Instant recall: troops still on home hex haven't moved yet — return immediately
  if (tg.hexQ === player.hexQ && tg.hexR === player.hexR) {
    if (player.alive) {
      if (defendOnArrival) {
        player.militaryDefending[tg.troopType] += tg.units;
      } else {
        player.militaryAtHome[tg.troopType] += tg.units;
      }
    }
    const idx = room.troopsInTransit.indexOf(tg);
    if (idx !== -1) room.troopsInTransit.splice(idx, 1);
    return { room };
  }

  tg.targetPlayerId = tg.attackerPlayerId;
  tg.destHexQ = player.hexQ;
  tg.destHexR = player.hexR;
  tg.paused = false;
  tg.defendOnArrival = defendOnArrival ?? false;

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
  if (tg.hexQ === tg.destHexQ && tg.hexR === tg.destHexR) return { error: 'Troops have already arrived' };

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

export function setDefendOnArrival(
  roomId: string,
  playerId: string,
  troopGroupId: string,
  defendOnArrival: boolean
): { room: ServerRoom; error?: string } | { room?: undefined; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  const guard = guardAction(room, playerId);
  if (typeof guard === 'string') return { error: guard };

  const tg = room.troopsInTransit.find(
    t => t.id === troopGroupId && t.attackerPlayerId === playerId
  );
  if (!tg) return { error: 'Troop group not found' };
  if (tg.attackerPlayerId !== tg.targetPlayerId) {
    return { error: 'Troops are not returning home' };
  }
  if (tg.hexQ === tg.destHexQ && tg.hexR === tg.destHexR) return { error: 'Troops have already arrived' };

  tg.defendOnArrival = defendOnArrival;
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
  if (tg.hexQ === tg.destHexQ && tg.hexR === tg.destHexR) return { error: 'Troops have already arrived' };
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

  const newDestHex = resolveTargetHex(newTargetPlayerId, room.players);
  tg.targetPlayerId = newTargetPlayerId;
  tg.destHexQ = newDestHex.q;
  tg.destHexR = newDestHex.r;
  tg.paused = false;
  tg.defendOnArrival = false;

  return { room };
}

export function recallOccupyingTroops(
  roomId: string,
  playerId: string,
  troopGroupId: string,
  defendOnArrival?: boolean
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

  // Current hex = where they're occupying
  const occHex = resolveTargetHex(occ.targetPlayerId, room.players);
  const homeHex = resolveTargetHex(playerId, room.players);

  // Move from occupying to transit (heading home)
  room.occupyingTroops.splice(occIndex, 1);
  room.troopsInTransit.push({
    id: occ.id + '-recalled',
    attackerPlayerId: playerId,
    targetPlayerId: playerId,
    troopType: occ.troopType,
    units: occ.units,
    hexQ: occHex.q,
    hexR: occHex.r,
    destHexQ: homeHex.q,
    destHexR: homeHex.r,
    defendOnArrival: defendOnArrival ?? false,
  });

  return { room };
}

export function redirectOccupyingTroops(
  roomId: string,
  playerId: string,
  troopGroupId: string,
  newTargetPlayerId: string
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

  if (newTargetPlayerId === playerId) return { error: 'Use recall to send troops home' };
  if (newTargetPlayerId === occ.targetPlayerId) return { error: 'Already occupying that target' };

  if (newTargetPlayerId !== PROMISED_LAND_ID) {
    const newTarget = room.players.get(newTargetPlayerId);
    if (!newTarget) return { error: 'Target not found' };
    if (!newTarget.alive) return { error: 'Target is eliminated' };
  }

  const occHex = resolveTargetHex(occ.targetPlayerId, room.players);
  const newDestHex = resolveTargetHex(newTargetPlayerId, room.players);

  // Move from occupying to transit (heading to new target)
  room.occupyingTroops.splice(occIndex, 1);
  room.troopsInTransit.push({
    id: occ.id + '-redirected',
    attackerPlayerId: playerId,
    targetPlayerId: newTargetPlayerId,
    troopType: occ.troopType,
    units: occ.units,
    hexQ: occHex.q,
    hexR: occHex.r,
    destHexQ: newDestHex.q,
    destHexR: newDestHex.r,
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
  room.resolvingDurationMs = null;

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
    player.hexQ = 0;
    player.hexR = 0;
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
    hexQ: p.hexQ,
    hexR: p.hexR,
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
    diceResults: room.diceResults,
    winnerPlayerId: room.winnerPlayerId,
    promisedLandOwnerId: room.promisedLandOwnerId,
    promisedLandHoldTurns: room.promisedLandHoldTurns,
    resolvingDurationMs: room.resolvingDurationMs,
  };
}
