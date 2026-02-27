// Economy — initial resource amounts
export const INITIAL_WOOD = 50;
export const INITIAL_FOOD = 50;
export const INITIAL_STONE = 0;
export const INITIAL_METAL = 0;

// Economy — initial income rates (per second)
export const INITIAL_WOOD_INCOME = 3;
export const INITIAL_FOOD_INCOME = 3;
export const INITIAL_STONE_INCOME = 0; // must invest to unlock
export const INITIAL_METAL_INCOME = 0; // must invest to unlock

// Investment costs per +1 income rate (scales linearly for +5 and +25)
export const INVEST_WOOD_COST_FOOD = 10;   // wood income costs food
export const INVEST_FOOD_COST_WOOD = 10;   // food income costs wood
export const INVEST_STONE_COST_WOOD = 15;  // stone income costs wood + food
export const INVEST_STONE_COST_FOOD = 15;
export const INVEST_METAL_COST_STONE = 20; // metal income costs stone + food
export const INVEST_METAL_COST_FOOD = 10;

export const VALID_INVEST_AMOUNTS = [1, 5, 25] as const;

// Population
export const INITIAL_POPULATION = 10; // starts equal to INITIAL_MILITARY_AT_HOME (all soldiers)
export const POP_CAP_MULTIPLIER = 10; // populationCap = foodIncome × POP_CAP_MULTIPLIER
export const POP_GROWTH_RATE = 0.1;   // pop grows by foodIncome × POP_GROWTH_RATE per tick

// Science / Culture
export const SCIENCE_COST_STONE = 50;
export const SCIENCE_COST_METAL = 50;
export const SCIENCE_CULTURE_GAIN = 100;
export const CULTURE_WIN_THRESHOLD = 1000;

// Military
export const MILITARY_UPGRADE_COST_WOOD = 20;
export const MILITARY_UPGRADE_COST_FOOD = 30;
export const MILITARY_UPGRADE_TROOPS = 10; // troops added per upgrade
export const INITIAL_MILITARY_AT_HOME = 10;

// HP
export const INITIAL_HP = 100;
export const MAX_HP = 100;
export const HP_REGEN_PER_SECOND = 2;

// Combat
export const TROOP_TRAVEL_MS = 6000; // 6 seconds travel time
export const DAMAGE_PER_UNIT = 5; // HP damage per surviving attacker
export const VALID_ATTACK_AMOUNTS = [5, 10, 25] as const;

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
