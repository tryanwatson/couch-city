export type Phase = 'lobby' | 'playing' | 'gameover';

// Client-safe player stats — zeros during lobby, populated on startGame
export interface CityPlayerInfo {
  playerId: string;
  name: string;
  color: string;
  connected: boolean;
  alive: boolean;
  wood: number;
  food: number;
  stone: number;
  metal: number;
  woodIncome: number;
  foodIncome: number;
  stoneIncome: number;
  metalIncome: number;
  militaryAtHome: number;
  population: number;
  culture: number;
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
  wood: number;
  food: number;
  stone: number;
  metal: number;
  woodIncome: number;
  foodIncome: number;
  stoneIncome: number;
  metalIncome: number;
  militaryAtHome: number;
  population: number;
  culture: number;
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
  tickIntervalId: ReturnType<typeof setInterval> | null;
  winnerPlayerId: string | null;
}
