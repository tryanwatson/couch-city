// Economy — initial amounts
export const INITIAL_FOOD = 0;
export const INITIAL_MATERIALS = 0;
export const INITIAL_GOLD = 0;

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

// Upgrades — unlock costs & build progress system
import type { UpgradeCategory } from "./types";

export function getUpgradeUnlockCost(
  category: UpgradeCategory,
  level: number,
): number {
  const progressArr = UPGRADE_PROGRESS[category];
  const ratio =
    progressArr[Math.min(level, progressArr.length - 1)] / progressArr[0];
  return Math.round(25 * ratio);
}

export const UPGRADE_PROGRESS: Record<UpgradeCategory, readonly number[]> = {
  culture: [3, 5, 8, 12, 16],
  military: [4, 7, 12],
  farming: [4, 8],
  mining: [4, 8],
  trade: [4, 8],
  defense: [5, 10, 16],
};

export const ALL_UPGRADE_CATEGORIES: readonly UpgradeCategory[] = [
  "culture",
  "military",
  "farming",
  "mining",
  "trade",
  "defense",
] as const;

export function zeroUpgradeRecord(): Record<UpgradeCategory, number> {
  return {
    culture: 0,
    military: 0,
    farming: 0,
    mining: 0,
    trade: 0,
    defense: 0,
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
  truck: 100,
};

export const TRAINING_CONFIG: Record<
  TroopType,
  { gold: number; troops: number }
> = {
  warrior: { gold: 20, troops: 10 },
  cavalry: { gold: 50, troops: 5 },
  rifleman: { gold: 125, troops: 3 },
  truck: { gold: 300, troops: 1 },
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
export const HP_REGEN_PERCENT = 0.03; // 3% of maxHp per turn (ceil'd) — scales with defense upgrades

// Defense upgrades — max HP bonus per completed level
export const DEFENSE_HP_PER_LEVEL: readonly number[] = [50, 75, 100];

// Combat
export const TROOP_TRAVEL_TURNS = 4; // turns for troops to reach target (5 positions: home,1,2,3,enemy)
export const SIEGE_DAMAGE_PER_CP = 1; // HP damage per CP per turn from occupying troops
export const VALID_ATTACK_AMOUNTS = [1, 5, 25] as const;

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
export const PROMISED_LAND_TRAVEL_TURNS = 2; // turns for troops to reach it (arrive the turn after sending)
export const PROMISED_LAND_HOLD_TURNS = 3; // consecutive uncontested turns to win

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

// Player position layout — 12 evenly-spaced slots at 30° intervals around the Promised Land
// Slot i sits at angle (i * 2π / 12) radians: slot 0 = East, 3 = South, 6 = West, 9 = North
export const PLAYER_POSITION_SLOTS = 12;

// Fill order: player join index → slot index
// Cardinals first (W/E/N/S), then opposite pairs filling largest gaps
export const PLAYER_SLOT_FILL_ORDER: readonly number[] = [
  6, // 1st: 180° (West)
  0, // 2nd: 0°   (East)
  9, // 3rd: 270° (North)
  3, // 4th: 90°  (South)
  2, // 5th: 60°
  8, // 6th: 240°
  5, // 7th: 150°
  11, // 8th: 330°
  1, // 9th: 30°
  7, // 10th: 210°
  4, // 11th: 120°
  10, // 12th: 300°
] as const;

// Oval radii for player placement (equal = circle, different = oval)
export const PLAYER_POSITION_RX = 0.35;
export const PLAYER_POSITION_RY = 0.35;

/** Diameter of the player placement circle — used to normalize distance-based travel time. */
export const PLAYER_PLACEMENT_DIAMETER =
  PLAYER_POSITION_RX + PLAYER_POSITION_RY;
