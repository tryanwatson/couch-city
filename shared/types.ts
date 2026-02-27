export type Phase = 'lobby' | 'playing' | 'gameover';

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
  foodIncome: number;
  resourcesIncome: number;
  goldIncome: number; // derived: population × GOLD_INCOME_PER_POP, updated each tick
  militaryAtHome: number;
  population: number;
  culture: number;       // passive score from monuments (display/historical)
  cultureLevel: number;  // upgrade count — gates how many monuments can be built
  monuments: number;     // monuments built (win condition)
  hp: number;
  maxHp: number;
  x: number; // 0–1 normalized map position
  y: number;
}

export interface TroopGroup {
  id: string;
  attackerPlayerId: string;
  targetPlayerId: string;
  units: number;
  departedAtMs: number;
  arrivalAtMs: number;
}

// Broadcast payload — everything clients need to render
export interface RoomStatePayload {
  roomId: string;
  phase: Phase;
  players: CityPlayerInfo[];
  troopsInTransit: TroopGroup[];
  combatHitPlayerIds: string[];
  winnerPlayerId: string | null;
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
  foodIncome: number;
  resourcesIncome: number;
  goldIncome: number;
  militaryAtHome: number;
  population: number;
  culture: number;
  cultureLevel: number;
  monuments: number;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
}

export interface ServerRoom {
  roomId: string;
  hostSocketId: string | null;
  phase: Phase;
  players: Map<string, ServerCityPlayer>;
  troopsInTransit: TroopGroup[];
  combatHitPlayerIds: string[];
  tickIntervalId: ReturnType<typeof setInterval> | null;
  winnerPlayerId: string | null;
}
