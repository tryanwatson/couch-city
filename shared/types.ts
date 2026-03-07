export type Phase = 'lobby' | 'playing' | 'gameover';
export type PlayingSubPhase = 'planning' | 'resolving';
export type TroopType = 'warrior' | 'cavalry' | 'rifleman' | 'truck';
export type UpgradeCategory = 'culture' | 'military' | 'farming' | 'mining' | 'trade' | 'walls' | 'housing';

// Client-safe player stats — zeros during lobby, populated on startGame
export interface CityPlayerInfo {
  playerId: string;
  name: string;
  color: string;
  connected: boolean;
  alive: boolean;
  food: number;
  materials: number;
  gold: number;
  goldIncome: number; // derived: merchants × GOLD_PER_MERCHANT (display convenience)
  farmers: number;    // worker allocation: food producers
  miners: number;     // worker allocation: material producers
  merchants: number;  // worker allocation: gold producers
  growthMultiplier: number; // 1/2/3 — scales food cost and growth rate
  militaryAtHome: Record<TroopType, number>;
  militaryDefending: Record<TroopType, number>; // troops deployed outside city for active defense
  population: number;
  culture: number;       // passive score from completed upgrades
  upgradeLevel: Record<UpgradeCategory, number>; // unlock count per category — gates how many upgrades can be built
  builders: Record<UpgradeCategory, number>; // workers assigned to building per category
  upgradesCompleted: Record<UpgradeCategory, number>;  // completed upgrades per category
  upgradeProgress: Record<UpgradeCategory, number>;    // current build progress per category
  hp: number;
  maxHp: number;
  x: number; // 0–1 normalized map position (derived from hex)
  y: number;
  hexQ: number; // axial hex coordinate
  hexR: number;
  endedTurn: boolean;    // whether player clicked "End Turn" this round
}

export interface TroopGroup {
  id: string;
  attackerPlayerId: string;
  targetPlayerId: string;
  troopType: TroopType;
  units: number;
  // Hex-based position & destination (axial coordinates)
  hexQ: number;
  hexR: number;
  destHexQ: number;
  destHexR: number;
  prevHexQ?: number; // position before this turn's move (for animation)
  prevHexR?: number;
  // Field combat (set when opposing groups collide on the same hex)
  fieldCombatHexQ?: number;
  fieldCombatHexR?: number;
  inFieldCombat?: boolean;
  fieldCombatUnits?: number; // original unit count before field combat (for animation)
  // Troop management
  paused?: boolean;
  isDonation?: boolean;
  defendOnArrival?: boolean;
}

// Broadcast payload — everything clients need to render
export interface RoomStatePayload {
  roomId: string;
  phase: Phase;
  subPhase: PlayingSubPhase | null;
  turnNumber: number;
  players: CityPlayerInfo[];
  troopsInTransit: TroopGroup[];
  occupyingTroops: TroopGroup[];
  combatHitPlayerIds: string[];
  diceResults: Record<string, number>; // playerId → dice roll 1-6
  winnerPlayerId: string | null;
  promisedLandOwnerId: string | null; // playerId of uncontested holder, or null
  promisedLandHoldTurns: number; // consecutive turns held by current owner
  resolvingDurationMs: number | null; // dynamic animation duration (null during planning)
}

/** Host-configurable initial economy values, sent with host:start_game. */
export interface GameSettings {
  initialGold: number;
  initialMaterials: number;
  initialFood: number;
}

// ============================================================
// Server-only types
// ============================================================

export interface ServerCityPlayer {
  playerId: string;
  name: string;
  color: string;
  socketId: string | null;
  connected: boolean;
  lastSeen: number;
  alive: boolean;
  food: number;
  materials: number;
  gold: number;
  goldIncome: number;
  farmers: number;
  miners: number;
  merchants: number;
  growthMultiplier: number;
  militaryAtHome: Record<TroopType, number>;
  militaryDefending: Record<TroopType, number>;
  population: number;
  culture: number;
  upgradeLevel: Record<UpgradeCategory, number>;
  builders: Record<UpgradeCategory, number>;
  upgradesCompleted: Record<UpgradeCategory, number>;
  upgradeProgress: Record<UpgradeCategory, number>;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  hexQ: number;
  hexR: number;
  endedTurn: boolean;
}

export interface ServerRoom {
  roomId: string;
  hostSocketId: string | null;
  phase: Phase;
  subPhase: PlayingSubPhase | null;
  turnNumber: number;
  players: Map<string, ServerCityPlayer>;
  troopsInTransit: TroopGroup[];
  occupyingTroops: TroopGroup[];
  combatHitPlayerIds: string[];
  diceResults: Record<string, number>;
  winnerPlayerId: string | null;
  promisedLandOwnerId: string | null;
  promisedLandHoldTurns: number;
  resolvingDurationMs: number | null;
}
