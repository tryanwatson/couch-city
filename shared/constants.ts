// Economy — initial amounts
export const INITIAL_FOOD = 100;
export const INITIAL_MATERIALS = 100;
export const INITIAL_GOLD = 100;

// Worker yields (per turn per worker)
export const FOOD_PER_FARMER = 3;
export const MATERIALS_PER_MINER = 2;
export const GOLD_PER_MERCHANT = 2;

// Food consumption & population dynamics
export const FOOD_PER_CITIZEN = 1; // each citizen eats 1 food/turn from stockpile
export const POP_GROWTH_RATE = 0.2; // +20% population when fed (base rate, scales with multiplier)
export const POP_STARVATION_RATE = 0.2; // -20% population per turn when starving
export const VALID_GROWTH_MULTIPLIERS = [1, 2, 3] as const; // 1x/2x/3x food cost & growth rate

// Population
export const INITIAL_POPULATION = 10;

// Housing — population caps per completed housing upgrade (index 0 = base, no upgrades)
export const HOUSING_POP_CAPS = [50, 100, 150, 250] as const;
export const HOUSING_UPGRADE_COSTS = [50, 100, 200, 400] as const; // material cost per unlock level
export function getHousingCap(upgradesCompleted: number): number {
  if (upgradesCompleted >= HOUSING_POP_CAPS.length) return Infinity;
  return HOUSING_POP_CAPS[upgradesCompleted];
}

// Upgrades — unlock costs & build progress system
import type { UpgradeCategory } from "./types";

export function getUpgradeUnlockCost(
  category: UpgradeCategory,
  level: number,
): number {
  if (category === "housing") {
    return HOUSING_UPGRADE_COSTS[
      Math.min(level, HOUSING_UPGRADE_COSTS.length - 1)
    ];
  }
  const progressArr = UPGRADE_PROGRESS[category];
  const ratio =
    progressArr[Math.min(level, progressArr.length - 1)] / progressArr[0];
  return Math.round(25 * ratio);
}

export const UPGRADE_PROGRESS: Record<UpgradeCategory, readonly number[]> = {
  culture: [3, 5, 8, 12, 16],
  military: [4, 15, 30],
  farming: [10, 20],
  mining: [10, 20],
  trade: [10, 20],
  walls: [5, 10, 16],
  housing: [10, 25, 50, 100],
};

export const ALL_UPGRADE_CATEGORIES: readonly UpgradeCategory[] = [
  "culture",
  "military",
  "farming",
  "mining",
  "trade",
  "walls",
  "housing",
] as const;

export function zeroUpgradeRecord(): Record<UpgradeCategory, number> {
  return {
    culture: 0,
    military: 0,
    farming: 0,
    mining: 0,
    trade: 0,
    walls: 0,
    housing: 0,
  };
}

export function yieldMultiplier(upgradesCompleted: number): number {
  return 1 + upgradesCompleted;
}
export const PROGRESS_PER_BUILDER = 1; // progress per builder per turn
export const MONUMENT_CULTURE_PER_TURN = 10; // passive culture score per completed upgrade per turn
export const CULTURE_WIN_THRESHOLD = 300; // first player to reach this culture score wins

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
  truck: 600,
};

// Dice roll CP multiplier: index 1-6 maps to combat effectiveness
// 1=80%, 2=90%, 3=100%, 4=105%, 5=120%, 6=150%
export const DICE_CP_MULTIPLIER = [0, 0.8, 0.9, 1.0, 1.05, 1.2, 1.5];

export const TRAINING_CONFIG: Record<
  TroopType,
  { gold: number; troops: number }
> = {
  warrior: { gold: 40, troops: 10 }, //1 2:1
  cavalry: { gold: 100, troops: 10 }, //5 1:1
  rifleman: { gold: 200, troops: 8 }, //25 .5:1
  truck: { gold: 300, troops: 1 }, //100 .25:1
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
export const HP_REGEN_PERCENT = 0.03; // 3% of maxHp per turn (ceil'd) — scales with walls upgrades

// Walls upgrades — max HP bonus per completed level
export const WALLS_HP_PER_LEVEL: readonly number[] = [50, 75, 100];

// Combat
export const SIEGE_DAMAGE_PER_CP = 1; // HP damage per CP per turn from occupying troops
export const VALID_ATTACK_AMOUNTS = [1, 5, 25] as const;

// Hex-based movement speed (hexes per turn)
export const MOVEMENT_SPEED: Record<TroopType, number> = {
  warrior: 1,
  cavalry: 2,
  rifleman: 1,
  truck: 3,
};

// Visual radius of a troop group in normalized (0–1) map coordinates
// Matches the client's golden-angle spiral cluster + half sprite size
export function troopGroupRadius(units: number): number {
  const cluster = units <= 1 ? 0 : 15 + Math.sqrt(units) * 8;
  return (cluster + 32) / 1000; // 32 = half of 64px sprite display size
}

// Field combat animation phase fractions (of RESOLVING_PHASE_DURATION_MS)
export const FIELD_COMBAT_WALK_FRAC = 0.3; // 1500ms — walk to collision point
export const FIELD_COMBAT_FIGHT_FRAC = 0.5; // 2500ms — fight at collision point
export const FIELD_COMBAT_ADVANCE_FRAC = 0.2; // 1000ms — winner advances to destination / loser fades

// The Promised Land (center-of-map objective — hold to win)
export const PROMISED_LAND_ID = "__PROMISED_LAND__";
export const PROMISED_LAND_X = 0.5;
export const PROMISED_LAND_Y = 0.5;
export const PROMISED_LAND_HOLD_TURNS = 3; // consecutive uncontested turns to win

// Turn-based timing
export const RESOLVING_PHASE_DURATION_MS = 5000; // full duration (visual events)
export const RESOLVING_PHASE_DURATION_SHORT_MS = 1000; // short duration (no visual events)
export const DICE_LINGER_MS = 3000; // extra time to show dice results after combat

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
  "#e6194b", // Red
  "#3cb44b", // Green
  "#4363d8", // Blue
  "#f58231", // Orange
  "#911eb4", // Purple
  "#42d4f4", // Cyan
  "#f032e6", // Magenta
  "#bfef45", // Lime
  "#fabed4", // Pink
  "#469990", // Teal
  "#dcbeff", // Lavender
  "#ffe119", // Yellow
];

// Pre-colored castle sprite for each player color
export const PLAYER_CASTLE_IMAGES: Record<string, string> = {
  "#e6194b": "/red-castle.png",
  "#3cb44b": "/green-castle.png",
  "#4363d8": "/blue-castle.png",
  "#f58231": "/orange-castle.png",
  "#911eb4": "/purple-castle.png",
  "#42d4f4": "/cyan-castle.png",
  "#f032e6": "/magenta-castle.png",
  "#bfef45": "/lime-castle.png",
  "#fabed4": "/pink-castle.png",
  "#469990": "/teal-castle.png",
  "#dcbeff": "/lavendar-castle.png",
  "#ffe119": "/yellow-castle.png",
};

// Starting angle for the first player (radians). Math.PI = West/left side of map.
export const PLAYER_START_ANGLE = Math.PI;

// Oval radii for player placement (equal = circle, different = oval)
export const PLAYER_POSITION_RX = 0.35;
export const PLAYER_POSITION_RY = 0.35;
