// Economy — initial resource amounts
export const INITIAL_FOOD = 100;
export const INITIAL_RESOURCES = 100;
export const INITIAL_GOLD = 100;

// Worker yields (per turn per worker)
export const FOOD_PER_FARMER = 3;
export const RESOURCES_PER_MINER = 1;
export const GOLD_PER_MERCHANT = 1;

// Food consumption & population dynamics
export const FOOD_PER_CITIZEN = 1; // each citizen eats 1 food/turn from stockpile
export const POP_GROWTH_RATE = 0.2; // +20% population when fed (base rate, scales with multiplier)
export const POP_STARVATION_RATE = 0.2; // -20% population per turn when starving
export const VALID_GROWTH_MULTIPLIERS = [1, 2, 3] as const; // 1x/2x/3x food cost & growth rate

// Population
export const INITIAL_POPULATION = 10;

// Culture upgrade — unlocks upgrade building slots
export const CULTURE_UPGRADE_COST_FOOD = 30;
export const CULTURE_UPGRADE_COST_GOLD = 50;

// Military upgrade — unlocks troop types
export const MILITARY_UPGRADE_COST_FOOD = 30;
export const MILITARY_UPGRADE_COST_GOLD = 50;

// Upgrades — build progress system
import type { UpgradeCategory } from "./types";
export const UPGRADE_PROGRESS: Record<UpgradeCategory, readonly number[]> = {
  culture: [10, 30, 80, 200, 500],
  military: [20, 60, 150],
};
export const PROGRESS_PER_BUILDER = 1; // progress per builder per turn
export const MONUMENT_CULTURE_PER_TURN = 5; // passive culture score per completed upgrade per turn
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
  warrior: 0,
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
export const TROOP_TRAVEL_TURNS = 4; // turns for troops to reach target (5 positions: home,1,2,3,enemy)
export const SIEGE_DAMAGE_PER_CP = 1; // HP damage per CP per turn from occupying troops
export const VALID_ATTACK_AMOUNTS = [5, 10, 25] as const;

// Visual radius of a troop group in normalized (0–1) map coordinates
// Matches the client's golden-angle spiral cluster + half sprite size
export function troopGroupRadius(units: number): number {
  const cluster = units <= 1 ? 0 : 15 + Math.sqrt(units) * 8;
  return (cluster + 32) / 1000; // 32 = half of 64px sprite display size
}

// Field combat (opposing troops collide mid-map) — resolved instantly per turn
export const FIELD_COMBAT_INSTANT_RATIO = 0.2; // power ratio below this → instant resolve

// Field combat animation phase fractions (of RESOLVING_PHASE_DURATION_MS)
export const FIELD_COMBAT_WALK_FRAC = 0.3; // 1500ms — walk to collision point
export const FIELD_COMBAT_FIGHT_FRAC = 0.5; // 2500ms — fight at collision point
export const FIELD_COMBAT_ADVANCE_FRAC = 0.2; // 1000ms — winner advances to destination / loser fades

// Gold Mine (center-of-map objective)
export const GOLD_MINE_ID = '__GOLD_MINE__';
export const GOLD_MINE_X = 0.5;
export const GOLD_MINE_Y = 0.5;
export const GOLD_MINE_INCOME = 100; // gold per turn when occupied uncontested
export const GOLD_MINE_TRAVEL_TURNS = 2; // turns for troops to reach the mine (shorter than city attacks)

// Turn-based timing
export const RESOLVING_PHASE_DURATION_MS = 5000; // client-side animation duration

// City name generation
export const CITY_SUFFIXES = [
  "ville",
  "opolis",
  "burg",
  "town",
  "shire",
  "land",
  "grad",
  "stan",
  "topia",
  "ford",
  "haven",
  "dale",
  "worth",
  "chester",
] as const;

export const CITY_TEMPLATES = [
  "New {name} City",
  "Fort {name}",
  "Port {name}",
  "San {name}",
  "Mount {name}",
  "{name} Springs",
  "{name} Heights",
  "{name} Kingdom",
  "Greater {name}",
  "East {name}",
  "Lake {name}",
  "{name} Falls",
  "{name} Bay",
  "St. {name}",
  "Cape {name}",
  "Isle of {name}",
  "North {name}",
  "{name} Creek",
  "Old {name}",
  "{name} Republic",
] as const;

export function generateCityName(
  rawName: string,
  existingNames?: string[],
): string {
  const existing = new Set((existingNames ?? []).map((n) => n.toLowerCase()));
  const allOptions: string[] = [];

  for (const suffix of CITY_SUFFIXES) {
    allOptions.push(rawName + suffix);
  }
  for (const template of CITY_TEMPLATES) {
    allOptions.push(template.replace("{name}", rawName));
  }

  // Fisher-Yates shuffle
  for (let i = allOptions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allOptions[i], allOptions[j]] = [allOptions[j], allOptions[i]];
  }

  for (const candidate of allOptions) {
    if (!existing.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  return rawName + " City " + Math.floor(Math.random() * 100);
}

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
