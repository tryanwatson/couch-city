export type Phase = 'lobby' | 'playing' | 'gameover';
export type PlayingSubPhase = 'planning' | 'resolving';
export type TroopType = 'warrior' | 'cavalry' | 'rifleman' | 'truck';
export type UpgradeCategory = 'culture' | 'military';

// Client-safe player stats — zeros during lobby, populated on startGame
export interface CityPlayerInfo {
  playerId: string;
  name: string;
  color: string;
  connected: boolean;
  alive: boolean;
  food: number;
  resources: number;
  gold: number;
  goldIncome: number; // derived: merchants × GOLD_PER_MERCHANT (display convenience)
  farmers: number;    // worker allocation: food producers
  miners: number;     // worker allocation: resource producers
  merchants: number;  // worker allocation: gold producers
  growthMultiplier: number; // 1/2/3 — scales food cost and growth rate
  militaryAtHome: Record<TroopType, number>;
  population: number;
  culture: number;       // passive score from completed upgrades
  cultureLevel: number;  // unlock count — gates how many culture upgrades can be built
  militaryLevel: number; // unlock count — gates how many military upgrades can be built
  builders: Record<UpgradeCategory, number>; // workers assigned to building per category
  upgradesCompleted: Record<UpgradeCategory, number>;  // completed upgrades per category
  upgradeProgress: Record<UpgradeCategory, number>;    // current build progress per category
  hp: number;
  maxHp: number;
  x: number; // 0–1 normalized map position
  y: number;
  endedTurn: boolean;    // whether player clicked "End Turn" this round
}

export interface TroopGroup {
  id: string;
  attackerPlayerId: string;
  targetPlayerId: string;
  troopType: TroopType;
  units: number;
  turnsRemaining: number;  // decrements each update phase; arrives at 0
  totalTurns: number;      // original travel distance in turns (for progress calculation)
  // Custom journey origin (set after field combat so survivors continue from collision point)
  startX?: number;
  startY?: number;
  // Field combat (set when opposing groups collide mid-map)
  fieldCombatX?: number;
  fieldCombatY?: number;
  inFieldCombat?: boolean; // resolved same turn during update phase
  fieldCombatUnits?: number; // original unit count before field combat (for animation)
  // Troop management
  paused?: boolean; // when true, turnsRemaining does NOT decrement
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
  winnerPlayerId: string | null;
  goldMineOwnerId: string | null; // playerId of uncontested mine owner, or null
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
  resources: number;
  gold: number;
  goldIncome: number;
  farmers: number;
  miners: number;
  merchants: number;
  growthMultiplier: number;
  militaryAtHome: Record<TroopType, number>;
  population: number;
  culture: number;
  cultureLevel: number;
  militaryLevel: number;
  builders: Record<UpgradeCategory, number>;
  upgradesCompleted: Record<UpgradeCategory, number>;
  upgradeProgress: Record<UpgradeCategory, number>;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
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
  winnerPlayerId: string | null;
  goldMineOwnerId: string | null;
}
