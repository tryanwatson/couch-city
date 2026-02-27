// Economy — initial resource amounts
export const INITIAL_FOOD = 50;
export const INITIAL_RESOURCES = 50;
export const INITIAL_GOLD = 0;

// Economy — initial income rates (per second)
export const INITIAL_FOOD_INCOME = 3;
export const INITIAL_RESOURCES_INCOME = 3;
// Gold income is derived: population × GOLD_INCOME_PER_POP per tick (not manually upgradeable)
export const GOLD_INCOME_PER_POP = 0.5;

// Investment costs per +1 income rate (scales linearly for +5 and +25)
export const INVEST_FOOD_COST_GOLD = 15;      // food income costs gold
export const INVEST_RESOURCES_COST_GOLD = 15; // resources income costs gold

export const VALID_INVEST_AMOUNTS = [1, 5, 25] as const;

// Population
export const INITIAL_POPULATION = 10;
export const POP_CAP_MULTIPLIER = 10; // populationCap = foodIncome × POP_CAP_MULTIPLIER
export const POP_GROWTH_RATE = 0.1;   // pop grows by foodIncome × POP_GROWTH_RATE per tick

// Culture upgrade — unlocks monument building slots
export const CULTURE_UPGRADE_COST_FOOD = 30;
export const CULTURE_UPGRADE_COST_GOLD = 50;

// Monuments
export const MONUMENT_COST_GOLD = 100;      // base cost (multiply by MONUMENT_COST_MULTIPLIERS[monuments])
export const MONUMENT_COST_RESOURCES = 150;
export const MONUMENT_CULTURE_PER_TICK = 5; // passive culture score per monument per tick
// Cost multiplier per monument index (0=first, 1=second, ...); length caps max monuments at 5
export const MONUMENT_COST_MULTIPLIERS = [1, 5, 25, 100, 200] as const;
export const CULTURE_WIN_THRESHOLD = 1000;  // first player to reach this culture score wins

// Military
export const MILITARY_COST_FOOD = 20;
export const MILITARY_COST_GOLD = 20;
export const MILITARY_UPGRADE_TROOPS = 10; // troops added per upgrade
export const INITIAL_MILITARY_AT_HOME = 10;

// HP
export const INITIAL_HP = 100;
export const MAX_HP = 100;
export const HP_REGEN_PER_SECOND = 2;

// Combat
export const TROOP_TRAVEL_MS = 20000; // 20 seconds travel time
export const TROOP_GROUP_MERGE_WINDOW_MS = 2000; // merge attacks within 2s
export const DAMAGE_PER_UNIT = 5; // HP damage per surviving attacker
export const VALID_ATTACK_AMOUNTS = [5, 10, 25] as const;

// Field combat (opposing troops collide mid-map)
export const FIELD_COMBAT_INSTANT_RATIO = 0.2; // power ratio below this → instant resolve
export const FIELD_COMBAT_MS_PER_UNIT = 100;   // 0.1s per unit at equal strength
export const FIELD_COMBAT_MIN_MS = 1000;        // minimum animation duration

// Tick
export const TICK_INTERVAL_MS = 1000;

// City colors — assigned in join order
export const PLAYER_COLORS = [
  '#e94560',
  '#3498db',
  '#2ecc71',
  '#f1c40f',
  '#9b59b6',
  '#e67e22',
  '#1abc9c',
  '#e91e63',
  '#00bcd4',
  '#ff5722',
  '#8bc34a',
  '#673ab7',
];
