import type { Socket } from 'socket.io-client';
import type { RoomStatePayload } from '../../../../shared/types';
import {
  INVEST_FOOD_COST_GOLD,
  INVEST_RESOURCES_COST_GOLD,
  VALID_INVEST_AMOUNTS,
  CULTURE_UPGRADE_COST_FOOD,
  CULTURE_UPGRADE_COST_GOLD,
  MONUMENT_COST_GOLD,
  MONUMENT_COST_RESOURCES,
  MONUMENT_COST_MULTIPLIERS,
  MONUMENT_CULTURE_PER_TICK,
  CULTURE_WIN_THRESHOLD,
  MILITARY_COST_FOOD,
  MILITARY_COST_GOLD,
  MILITARY_UPGRADE_TROOPS,
  VALID_ATTACK_AMOUNTS,
} from '../../../../shared/constants';

type IncomeType = 'food' | 'resources';
type InvestAmount = typeof VALID_INVEST_AMOUNTS[number];

interface GameControlsProps {
  roomState: RoomStatePayload;
  playerId: string;
  socket: Socket;
}

const INCOME_CONFIG: {
  key: IncomeType;
  label: string;
  emoji: string;
  costLabel: (amt: number) => string;
  canAfford: (me: RoomStatePayload['players'][0], amt: InvestAmount) => boolean;
  getIncome: (me: RoomStatePayload['players'][0]) => number;
  getAmount: (me: RoomStatePayload['players'][0]) => number;
}[] = [
  {
    key: 'resources',
    label: 'Resources',
    emoji: '🪨',
    costLabel: (amt) => `${INVEST_RESOURCES_COST_GOLD * amt} gold`,
    canAfford: (me, amt) => me.gold >= INVEST_RESOURCES_COST_GOLD * amt,
    getIncome: (me) => me.resourcesIncome,
    getAmount: (me) => me.resources,
  },
  {
    key: 'food',
    label: 'Food',
    emoji: '🌾',
    costLabel: (amt) => `${INVEST_FOOD_COST_GOLD * amt} gold`,
    canAfford: (me, amt) => me.gold >= INVEST_FOOD_COST_GOLD * amt,
    getIncome: (me) => me.foodIncome,
    getAmount: (me) => me.food,
  },
];

export default function GameControls({ roomState, playerId, socket }: GameControlsProps) {
  const me = roomState.players.find((p) => p.playerId === playerId) ?? null;

  const handleInvestIncome = (income: IncomeType, amount: InvestAmount) => {
    socket.emit('player:invest_income', { roomId: roomState.roomId, playerId, income, amount });
  };

  const handleUpgradeCulture = () => {
    socket.emit('player:upgrade_culture', { roomId: roomState.roomId, playerId });
  };

  const handleBuildMonument = () => {
    socket.emit('player:build_monument', { roomId: roomState.roomId, playerId });
  };

  const handleSpendMilitary = () => {
    socket.emit('player:spend_military', { roomId: roomState.roomId, playerId });
  };

  const handleSendAttack = (targetPlayerId: string, units: number) => {
    socket.emit('player:send_attack', { roomId: roomState.roomId, playerId, targetPlayerId, units });
  };

  if (!me) {
    return (
      <div className="game-controls">
        <p className="waiting-text">Reconnecting...</p>
      </div>
    );
  }

  // Eliminated view
  if (!me.alive) {
    const survivors = roomState.players.filter((p) => p.alive);
    return (
      <div className="game-controls eliminated-view">
        <div className="eliminated-banner">
          <div className="eliminated-icon">&#10007;</div>
          <h2>Your city has fallen</h2>
          <p className="waiting-text">Watch the battle unfold...</p>
        </div>
        <div className="survivors-list">
          <h3 className="section-title">Remaining Cities</h3>
          {survivors.map((p) => (
            <div key={p.playerId} className="survivor-row" style={{ borderLeftColor: p.color }}>
              <span className="survivor-name">{p.name}</span>
              <span className="survivor-hp">{Math.ceil(p.hp)} HP</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const civilians = Math.floor(me.population) - me.militaryAtHome;
  const canAffordMilitary = me.food >= MILITARY_COST_FOOD && me.gold >= MILITARY_COST_GOLD;
  const canTrainTroops = canAffordMilitary && civilians >= MILITARY_UPGRADE_TROOPS;
  const canAffordCultureUpgrade = me.food >= CULTURE_UPGRADE_COST_FOOD && me.gold >= CULTURE_UPGRADE_COST_GOLD;
  const nextMonumentMultiplier = MONUMENT_COST_MULTIPLIERS[me.monuments] ?? 0;
  const nextMonumentGoldCost = MONUMENT_COST_GOLD * nextMonumentMultiplier;
  const nextMonumentResourcesCost = MONUMENT_COST_RESOURCES * nextMonumentMultiplier;
  const canBuildMonument = me.monuments < me.cultureLevel
    && me.monuments < MONUMENT_COST_MULTIPLIERS.length
    && me.gold >= nextMonumentGoldCost
    && me.resources >= nextMonumentResourcesCost;
  const targets = roomState.players.filter((p) => p.alive && p.playerId !== playerId);
  const myTransit = roomState.troopsInTransit.filter((tg) => tg.attackerPlayerId === playerId);

  const hpPct = (me.hp / me.maxHp) * 100;
  const culturePct = Math.min(100, (me.culture / CULTURE_WIN_THRESHOLD) * 100);

  return (
    <div className="game-controls">
      {/* CULTURE PROGRESS */}
      <div className="culture-bar-wrapper">
        <div className="culture-bar-fill" style={{ width: `${culturePct}%` }} />
        <span className="culture-label">🏛️ Culture {Math.floor(me.culture)} / {CULTURE_WIN_THRESHOLD}</span>
      </div>

      {/* STATS HEADER */}
      <div className="stats-header" style={{ borderTopColor: me.color }}>
        <div className="city-name">{me.name}</div>

        <div className="hp-bar-wrapper">
          <div
            className={`hp-bar-fill${hpPct <= 30 ? ' hp-low' : ''}`}
            style={{ width: `${hpPct}%` }}
          />
          <span className="hp-label">{Math.ceil(me.hp)} / {me.maxHp} HP</span>
        </div>

        <div className="stats-row">
          <div className="stat-block">
            <span className="stat-label">👥 Pop</span>
            <span className="stat-value">{Math.floor(me.population)}</span>
            <span className="stat-rate">cap {me.foodIncome * 10}</span>
          </div>
          <div className="stat-block">
            <span className="stat-label">⚔️ Troops</span>
            <span className="stat-value">{me.militaryAtHome}</span>
            <span className="stat-rate">{civilians} civ</span>
          </div>
          <div className="stat-block">
            <span className="stat-label">💰 Gold</span>
            <span className="stat-value">{Math.floor(me.gold)}</span>
            <span className="stat-rate">+{me.goldIncome.toFixed(1)}/s</span>
          </div>
        </div>
      </div>

      {/* RESOURCES */}
      <div className="upgrades-section">
        <h3 className="section-title">Resources</h3>
        <div className="resource-list">
          {INCOME_CONFIG.map((res) => {
            const income = res.getIncome(me);
            const amount = res.getAmount(me);
            return (
              <div key={res.key} className="resource-row">
                <div className="resource-info">
                  <span className="resource-label">{res.emoji} {res.label}</span>
                  <span className="resource-amount">{Math.floor(amount)}</span>
                  <span className="resource-rate">+{income}/s</span>
                </div>
                <div className="resource-invest-buttons">
                  {(VALID_INVEST_AMOUNTS as readonly number[]).map((amt) => {
                    const canAfford = res.canAfford(me, amt as InvestAmount);
                    return (
                      <button
                        key={amt}
                        className="invest-btn"
                        onClick={() => handleInvestIncome(res.key, amt as InvestAmount)}
                        disabled={!canAfford}
                        title={`+${amt}/s — costs ${res.costLabel(amt)}`}
                      >
                        +{amt}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* CULTURE & MONUMENTS */}
      <div className="upgrades-section">
        <h3 className="section-title">Culture & Monuments</h3>
        <div className="upgrade-buttons">
          <button
            className="upgrade-btn upgrade-science"
            onClick={handleUpgradeCulture}
            disabled={!canAffordCultureUpgrade}
            title={`Costs ${CULTURE_UPGRADE_COST_FOOD} food + ${CULTURE_UPGRADE_COST_GOLD} gold`}
          >
            <span className="upgrade-btn-title">📜 Upgrade Culture</span>
            <span className="upgrade-btn-cost">{CULTURE_UPGRADE_COST_FOOD} food + {CULTURE_UPGRADE_COST_GOLD} gold</span>
            <span className="upgrade-btn-effect">Level {me.cultureLevel} → {me.cultureLevel + 1} (unlocks monument slot)</span>
          </button>

          <button
            className="upgrade-btn upgrade-military"
            onClick={handleBuildMonument}
            disabled={!canBuildMonument}
            title={
              me.monuments >= MONUMENT_COST_MULTIPLIERS.length ? 'Maximum monuments built' :
              me.monuments >= me.cultureLevel ? 'Upgrade culture first' :
              `Costs ${nextMonumentGoldCost} gold + ${nextMonumentResourcesCost} resources`
            }
          >
            <span className="upgrade-btn-title">🏛️ Build Monument</span>
            <span className="upgrade-btn-cost">
              {me.monuments < MONUMENT_COST_MULTIPLIERS.length
                ? `${nextMonumentGoldCost} gold + ${nextMonumentResourcesCost} resources`
                : 'Max built'}
            </span>
            <span className="upgrade-btn-effect">{me.monuments}/{me.cultureLevel} slots used · {me.monuments}/{MONUMENT_COST_MULTIPLIERS.length} max</span>
          </button>
        </div>
        {me.monuments > 0 && (
          <div className="resource-row" style={{ marginTop: 4 }}>
            <span className="resource-label">✨ Culture/tick</span>
            <span className="resource-amount">{Math.floor(me.culture)}</span>
            <span className="resource-rate">+{me.monuments * MONUMENT_CULTURE_PER_TICK}/s</span>
          </div>
        )}
      </div>

      {/* MILITARY */}
      <div className="upgrades-section">
        <h3 className="section-title">Military</h3>
        <div className="upgrade-buttons">
          <button
            className="upgrade-btn upgrade-military"
            onClick={handleSpendMilitary}
            disabled={!canTrainTroops}
            title={!canAffordMilitary ? 'Not enough resources' : civilians < MILITARY_UPGRADE_TROOPS ? `Need ${MILITARY_UPGRADE_TROOPS - civilians} more civilians` : ''}
          >
            <span className="upgrade-btn-title">⚔️ Train Troops</span>
            <span className="upgrade-btn-cost">{MILITARY_COST_FOOD} food + {MILITARY_COST_GOLD} gold</span>
            <span className="upgrade-btn-effect">+{MILITARY_UPGRADE_TROOPS} troops ({civilians} civ avail)</span>
          </button>
        </div>
      </div>

      {/* ATTACK */}
      <div className="attack-section">
        <h3 className="section-title">Attack</h3>
        {targets.length === 0 ? (
          <p className="waiting-text">No targets available</p>
        ) : (
          <div className="target-list">
            {targets.map((target) => (
              <div key={target.playerId} className="target-row">
                <div className="target-info">
                  <span className="target-color-dot" style={{ backgroundColor: target.color }} />
                  <span className="target-name">{target.name}</span>
                  <span className="target-hp-small">{Math.ceil(target.hp)} HP</span>
                </div>
                <div className="attack-amounts">
                  {(VALID_ATTACK_AMOUNTS as readonly number[]).map((amount) => (
                    <button
                      key={amount}
                      className="attack-amount-btn"
                      onClick={() => handleSendAttack(target.playerId, amount)}
                      disabled={me.militaryAtHome < amount}
                    >
                      Send {amount}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* IN-TRANSIT INDICATOR */}
      {myTransit.length > 0 && (
        <div className="transit-indicator">
          {myTransit.map((tg) => {
            const targetName = roomState.players.find((p) => p.playerId === tg.targetPlayerId)?.name ?? '?';
            const secsLeft = Math.max(0, Math.ceil((tg.arrivalAtMs - Date.now()) / 1000));
            return (
              <div key={tg.id} className="transit-row">
                {tg.units} troops &#8594; {targetName} (~{secsLeft}s)
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
