// Economy
export const INITIAL_RESOURCE_A = 50;
export const INITIAL_RESOURCE_B = 50;
export const INITIAL_INCOME_RATE_A = 3; // units/sec
export const INITIAL_INCOME_RATE_B = 3; // units/sec

export const ECONOMY_UPGRADE_COST_A = 30;
export const ECONOMY_UPGRADE_COST_B = 20;
export const ECONOMY_UPGRADE_INCOME_A = 2; // +incomeRateA per upgrade
export const ECONOMY_UPGRADE_INCOME_B = 2; // +incomeRateB per upgrade

// Military
export const MILITARY_UPGRADE_COST_A = 20;
export const MILITARY_UPGRADE_COST_B = 30;
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
];
