import type { ServerRoom, ServerCityPlayer, RoomStatePayload, TroopGroup, TroopType } from '../../shared/types';
import {
  PLAYER_COLORS,
  INITIAL_FOOD,
  INITIAL_RESOURCES,
  INITIAL_GOLD,
  FOOD_PER_FARMER,
  RESOURCES_PER_MINER,
  GOLD_PER_MERCHANT,
  FOOD_PER_CITIZEN,
  POP_GROWTH_RATE,
  POP_STARVATION_RATE,
  VALID_GROWTH_MULTIPLIERS,
  INITIAL_POPULATION,
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
  SIEGE_DAMAGE_PER_CP,
  INITIAL_HP,
  MAX_HP,
  HP_REGEN_PER_TURN,
  TROOP_TRAVEL_TURNS,
  VALID_ATTACK_AMOUNTS,
  RESOLVING_PHASE_DURATION_MS,
  troopGroupRadius,
  GOLD_MINE_ID,
  GOLD_MINE_X,
  GOLD_MINE_Y,
  GOLD_MINE_INCOME,
  GOLD_MINE_TRAVEL_TURNS,
} from '../../shared/constants';
import { generateRoomCode } from './utils';

const rooms = new Map<string, ServerRoom>();

function totalMilitaryAtHome(mil: Record<TroopType, number>): number {
  return Object.values(mil).reduce((sum, n) => sum + n, 0);
}

function clampWorkers(player: ServerCityPlayer): void {
  const civilians = Math.max(0, Math.floor(player.population) - totalMilitaryAtHome(player.militaryAtHome));
  const total = player.farmers + player.miners + player.merchants;
  if (total <= civilians) return;

  if (civilians <= 0) {
    player.farmers = 0;
    player.miners = 0;
    player.merchants = 0;
  } else {
    const ratio = civilians / total;
    player.farmers = Math.floor(player.farmers * ratio);
    player.miners = Math.floor(player.miners * ratio);
    player.merchants = Math.floor(player.merchants * ratio);
  }
  player.goldIncome = player.merchants * GOLD_PER_MERCHANT;
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
    occupyingTroops: [],
    combatHitPlayerIds: [],
    winnerPlayerId: null,
    goldMineOwnerId: null,
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
    resources: 0,
    gold: 0,
    goldIncome: 0,
    farmers: 0,
    miners: 0,
    merchants: 0,
    growthMultiplier: 1,
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
    player.goldIncome = 0;
    player.farmers = 0;
    player.miners = 0;
    player.merchants = 0;
    player.growthMultiplier = 1;
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
  room.occupyingTroops = [];
  room.winnerPlayerId = null;
  room.goldMineOwnerId = null;

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

  // Worker-based economy
  for (const player of alivePlayers) {
    player.food += player.farmers * FOOD_PER_FARMER;
    player.resources += player.miners * RESOURCES_PER_MINER;
    player.goldIncome = player.merchants * GOLD_PER_MERCHANT;
    player.gold += player.goldIncome;
    player.culture += player.monuments * MONUMENT_CULTURE_PER_TURN;
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
  }

  // HP regeneration
  for (const player of alivePlayers) {
    player.hp = Math.min(player.maxHp, player.hp + HP_REGEN_PER_TURN);
  }

  // Gold mine income — before combat so income is awarded even if troops die this turn
  const mineOccupierPlayerIds = new Set(
    room.occupyingTroops
      .filter(occ => occ.targetPlayerId === GOLD_MINE_ID && occ.units > 0)
      .map(occ => occ.attackerPlayerId)
  );
  if (mineOccupierPlayerIds.size === 1) {
    const ownerId = Array.from(mineOccupierPlayerIds)[0];
    const owner = room.players.get(ownerId);
    if (owner && owner.alive) {
      owner.gold += GOLD_MINE_INCOME;
      room.goldMineOwnerId = ownerId;
    } else {
      room.goldMineOwnerId = null;
    }
  } else {
    room.goldMineOwnerId = null; // contested or empty
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
  for (const tg of arrived) {
    if (tg.targetPlayerId !== GOLD_MINE_ID && !room.combatHitPlayerIds.includes(tg.targetPlayerId) && tg.attackerPlayerId !== tg.targetPlayerId) {
      room.combatHitPlayerIds.push(tg.targetPlayerId);
    }
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
    // Skip mine-bound troops (separate lane, no player target to look up)
    if (tg1.targetPlayerId === GOLD_MINE_ID || tg1.attackerPlayerId === GOLD_MINE_ID) continue;

    for (let j = i + 1; j < transit.length; j++) {
      const tg2 = transit[j];
      if (tg2.units <= 0) continue;
      if (tg2.targetPlayerId === GOLD_MINE_ID || tg2.attackerPlayerId === GOLD_MINE_ID) continue;

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

function resolveMineArrival(room: ServerRoom, tg: TroopGroup): void {
  // Fight any existing occupiers from OTHER players
  const enemyOccupiers = room.occupyingTroops.filter(
    occ => occ.targetPlayerId === GOLD_MINE_ID && occ.attackerPlayerId !== tg.attackerPlayerId && occ.units > 0
  );

  let remainingUnits = tg.units;

  for (const enemy of enemyOccupiers) {
    if (remainingUnits <= 0) break;
    const result = cpBasedTrade(
      remainingUnits, COMBAT_POWER[tg.troopType],
      enemy.units, COMBAT_POWER[enemy.troopType]
    );
    remainingUnits = result.survivorsA;
    enemy.units = result.survivorsB;
  }

  // Clean up dead occupiers
  room.occupyingTroops = room.occupyingTroops.filter(occ => occ.units > 0);

  if (remainingUnits > 0) {
    // Merge with existing friendly occupiers or add new
    const existing = room.occupyingTroops.find(
      occ => occ.attackerPlayerId === tg.attackerPlayerId
        && occ.targetPlayerId === GOLD_MINE_ID
        && occ.troopType === tg.troopType
    );
    if (existing) {
      existing.units += remainingUnits;
    } else {
      room.occupyingTroops.push({
        id: tg.id,
        attackerPlayerId: tg.attackerPlayerId,
        targetPlayerId: GOLD_MINE_ID,
        troopType: tg.troopType,
        units: remainingUnits,
        turnsRemaining: 0,
        totalTurns: 0,
      });
    }
  }
}

function resolveCombat(room: ServerRoom, tg: TroopGroup): void {
  // Troops returning home — add to garrison
  if (tg.attackerPlayerId === tg.targetPlayerId) {
    const player = room.players.get(tg.attackerPlayerId);
    if (player && player.alive) {
      player.militaryAtHome[tg.troopType] += tg.units;
    }
    return;
  }

  // Troops arriving at the gold mine
  if (tg.targetPlayerId === GOLD_MINE_ID) {
    resolveMineArrival(room, tg);
    return;
  }

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

  if (survivingUnits > 0) {
    // Survivors become occupying troops (no instant damage)
    const existing = room.occupyingTroops.find(
      occ => occ.attackerPlayerId === tg.attackerPlayerId
        && occ.targetPlayerId === tg.targetPlayerId
        && occ.troopType === tg.troopType
    );
    if (existing) {
      existing.units += survivingUnits;
    } else {
      room.occupyingTroops.push({
        id: tg.id,
        attackerPlayerId: tg.attackerPlayerId,
        targetPlayerId: tg.targetPlayerId,
        troopType: tg.troopType,
        units: survivingUnits,
        turnsRemaining: 0,
        totalTurns: 0,
      });
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
    if (targetId === GOLD_MINE_ID) continue; // Mine occupiers don't siege — handled separately
    const defender = room.players.get(targetId);
    if (!defender || !defender.alive) continue;

    // Each occupying group fights the garrison independently
    for (const occ of occupiers) {
      const cpPerOcc = COMBAT_POWER[occ.troopType];
      const occCP = occ.units * cpPerOcc;

      let garrisonCP = 0;
      for (const type of TROOP_TYPES) {
        garrisonCP += defender.militaryAtHome[type] * COMBAT_POWER[type];
      }

      if (garrisonCP > 0) {
        if (garrisonCP >= occCP) {
          // Garrison wins or ties — occupier wiped out
          if (garrisonCP === occCP) {
            for (const type of TROOP_TYPES) {
              defender.militaryAtHome[type] = 0;
            }
          } else {
            const lossRatio = occCP / garrisonCP;
            for (const type of TROOP_TYPES) {
              defender.militaryAtHome[type] -= Math.floor(
                defender.militaryAtHome[type] * lossRatio
              );
            }
          }
          occ.units = 0;
          continue;
        }

        // Occupier wins — garrison wiped out, occupier takes losses
        for (const type of TROOP_TYPES) {
          defender.militaryAtHome[type] = 0;
        }
        const losses = Math.ceil(garrisonCP / cpPerOcc);
        occ.units -= losses;
      }

      // Surviving occupiers deal siege damage
      if (occ.units > 0) {
        const siegeDmg = occ.units * cpPerOcc * SIEGE_DAMAGE_PER_CP;
        defender.hp -= siegeDmg;
        if (!room.combatHitPlayerIds.includes(targetId)) {
          room.combatHitPlayerIds.push(targetId);
        }
      }
    }

    // Check if city dies from siege
    if (defender.hp <= 0) {
      defender.hp = 0;
      defender.alive = false;
      for (const type of TROOP_TYPES) {
        defender.militaryAtHome[type] = 0;
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
  merchants: number
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

  const civilians = Math.floor(player.population) - totalMilitaryAtHome(player.militaryAtHome);
  if (farmers + miners + merchants > civilians) {
    return { error: 'Not enough civilians for this allocation' };
  }

  player.farmers = farmers;
  player.miners = miners;
  player.merchants = merchants;
  player.goldIncome = merchants * GOLD_PER_MERCHANT;

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
  clampWorkers(player);

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
  if (targetPlayerId !== GOLD_MINE_ID) {
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
  attacker.population -= units;
  clampWorkers(attacker);

  const travelTurns = targetPlayerId === GOLD_MINE_ID ? GOLD_MINE_TRAVEL_TURNS : TROOP_TRAVEL_TURNS;

  // Merge into existing group sent this same planning phase (same target, same type, freshly created)
  const existing = room.troopsInTransit.find(
    tg =>
      tg.attackerPlayerId === attackerPlayerId &&
      tg.targetPlayerId === targetPlayerId &&
      tg.troopType === troopType &&
      tg.turnsRemaining === travelTurns &&
      tg.totalTurns === travelTurns,
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
  if (tg.targetPlayerId === GOLD_MINE_ID) {
    targetX = GOLD_MINE_X;
    targetY = GOLD_MINE_Y;
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
  if (newTargetPlayerId !== GOLD_MINE_ID) {
    const newTarget = room.players.get(newTargetPlayerId);
    if (!newTarget) return { error: 'Target not found' };
    if (!newTarget.alive) return { error: 'Target is eliminated' };
  }

  const currentPos = getTroopCurrentPosition(tg, room.players);

  // Resolve new target position
  let newTargetX: number, newTargetY: number;
  if (newTargetPlayerId === GOLD_MINE_ID) {
    newTargetX = GOLD_MINE_X;
    newTargetY = GOLD_MINE_Y;
  } else {
    const newTarget = room.players.get(newTargetPlayerId)!;
    newTargetX = newTarget.x;
    newTargetY = newTarget.y;
  }

  // Calculate new travel time proportionally
  const newDist = Math.hypot(newTargetX - currentPos.x, newTargetY - currentPos.y);

  // Resolve old target position for ratio calculation
  let oldTargetX: number, oldTargetY: number;
  if (tg.targetPlayerId === GOLD_MINE_ID) {
    oldTargetX = GOLD_MINE_X;
    oldTargetY = GOLD_MINE_Y;
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
    newTurns = Math.max(1, Math.round(TROOP_TRAVEL_TURNS * (newDist / 0.7)));
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
  if (occ.targetPlayerId === GOLD_MINE_ID) {
    startX = GOLD_MINE_X;
    startY = GOLD_MINE_Y;
  } else {
    const targetCity = room.players.get(occ.targetPlayerId);
    startX = targetCity?.x ?? 0.5;
    startY = targetCity?.y ?? 0.5;
  }

  // Move from occupying to transit (heading home)
  room.occupyingTroops.splice(occIndex, 1);
  room.troopsInTransit.push({
    id: occ.id + '-recalled',
    attackerPlayerId: playerId,
    targetPlayerId: playerId, // heading home
    troopType: occ.troopType,
    units: occ.units,
    turnsRemaining: TROOP_TRAVEL_TURNS,
    totalTurns: TROOP_TRAVEL_TURNS,
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
  room.goldMineOwnerId = null;

  for (const [, player] of room.players) {
    player.color = '';
    player.alive = true;
    player.food = 0;
    player.resources = 0;
    player.gold = 0;
    player.goldIncome = 0;
    player.farmers = 0;
    player.miners = 0;
    player.merchants = 0;
    player.growthMultiplier = 1;
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
    goldIncome: p.goldIncome,
    farmers: p.farmers,
    miners: p.miners,
    merchants: p.merchants,
    growthMultiplier: p.growthMultiplier,
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
    occupyingTroops: room.occupyingTroops,
    combatHitPlayerIds: room.combatHitPlayerIds,
    winnerPlayerId: room.winnerPlayerId,
    goldMineOwnerId: room.goldMineOwnerId,
  };
}
