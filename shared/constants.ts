// Economy — initial resource amounts
export const INITIAL_FOOD = 50;
export const INITIAL_RESOURCES = 50;
export const INITIAL_GOLD = 0;

// Economy — initial income rates (per turn)
export const INITIAL_FOOD_INCOME = 3;
export const INITIAL_RESOURCES_INCOME = 3;
// Gold income is derived: population × GOLD_INCOME_PER_POP per turn (not manually upgradeable)
export const GOLD_INCOME_PER_POP = 0.5;

// Investment costs per +1 income rate (scales linearly for +5 and +25)
export const INVEST_FOOD_COST_GOLD = 15; // food income costs gold
export const INVEST_RESOURCES_COST_GOLD = 15; // resources income costs gold

export const VALID_INVEST_AMOUNTS = [1, 5, 25] as const;

// Population
export const INITIAL_POPULATION = 10;
export const POP_CAP_MULTIPLIER = 10; // populationCap = foodIncome × POP_CAP_MULTIPLIER
export const POP_GROWTH_RATE = 0.1; // pop grows by foodIncome × POP_GROWTH_RATE per turn

// Culture upgrade — unlocks monument building slots
export const CULTURE_UPGRADE_COST_FOOD = 30;
export const CULTURE_UPGRADE_COST_GOLD = 50;

// Monuments
export const MONUMENT_COST_GOLD = 100; // base cost (multiply by MONUMENT_COST_MULTIPLIERS[monuments])
export const MONUMENT_COST_RESOURCES = 150;
export const MONUMENT_CULTURE_PER_TURN = 5; // passive culture score per monument per turn
// Cost multiplier per monument index (0=first, 1=second, ...); length caps max monuments at 5
export const MONUMENT_COST_MULTIPLIERS = [1, 5, 25, 100, 200] as const;
export const CULTURE_WIN_THRESHOLD = 1000; // first player to reach this culture score wins

// Military — troop types
import type { TroopType } from "./types";

export const TROOP_TYPES: readonly TroopType[] = [
  "warrior",
  "cavalry",
  "rifleman",
  "truck",
] as const;

export const COMBAT_POWER: Record<TroopType, number> = {
  warrior: 1,
  cavalry: 5,
  rifleman: 25,
  truck: 100,
};

export const TRAINING_CONFIG: Record<
  TroopType,
  { food: number; gold: number; troops: number }
> = {
  warrior: { food: 20, gold: 20, troops: 10 },
  cavalry: { food: 50, gold: 50, troops: 5 },
  rifleman: { food: 100, gold: 150, troops: 3 },
  truck: { food: 200, gold: 400, troops: 1 },
};

export const INITIAL_MILITARY: Record<TroopType, number> = {
  warrior: 100,
  cavalry: 0,
  rifleman: 0,
  truck: 0,
};

export const ZERO_MILITARY: Record<TroopType, number> = {
  warrior: 0,
  cavalry: 0,
  rifleman: 0,
  truck: 0,
};

// HP
export const INITIAL_HP = 100;
export const MAX_HP = 100;
export const HP_REGEN_PER_TURN = 2;

// Combat
export const TROOP_TRAVEL_TURNS = 3; // turns for troops to reach target
export const DAMAGE_PER_CP = 5; // HP damage per surviving combat power
export const VALID_ATTACK_AMOUNTS = [5, 10, 25] as const;

// Visual radius of a troop group in normalized (0–1) map coordinates
// Matches the client's golden-angle spiral cluster + half sprite size
export function troopGroupRadius(units: number): number {
  const cluster = units <= 1 ? 0 : 15 + Math.sqrt(units) * 8;
  return (cluster + 32) / 1000; // 32 = half of 64px sprite display size
}

// Field combat (opposing troops collide mid-map) — resolved instantly per turn
export const FIELD_COMBAT_INSTANT_RATIO = 0.2; // power ratio below this → instant resolve

// Turn-based timing
export const RESOLVING_PHASE_DURATION_MS = 3000; // client-side animation duration

// City colors — assigned in join order
export const PLAYER_COLORS = [
  "#e94560",
  "#3498db",
  "#2ecc71",
  "#f1c40f",
  "#9b59b6",
  "#e67e22",
  "#1abc9c",
  "#e91e63",
  "#00bcd4",
  "#ff5722",
  "#8bc34a",
  "#673ab7",
];
