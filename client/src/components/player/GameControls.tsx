import type { Socket } from 'socket.io-client';
import type { RoomStatePayload } from '../../../../shared/types';
import {
  INVEST_WOOD_COST_FOOD,
  INVEST_FOOD_COST_WOOD,
  INVEST_STONE_COST_WOOD,
  INVEST_STONE_COST_FOOD,
  INVEST_METAL_COST_STONE,
  INVEST_METAL_COST_FOOD,
  VALID_INVEST_AMOUNTS,
  MILITARY_UPGRADE_COST_WOOD,
  MILITARY_UPGRADE_COST_FOOD,
  MILITARY_UPGRADE_TROOPS,
  VALID_ATTACK_AMOUNTS,
} from '../../../../shared/constants';

type ResourceType = 'wood' | 'food' | 'stone' | 'metal';
type InvestAmount = typeof VALID_INVEST_AMOUNTS[number];

interface GameControlsProps {
  roomState: RoomStatePayload;
  playerId: string;
  socket: Socket;
}

const RESOURCE_CONFIG: {
  key: ResourceType;
  label: string;
  emoji: string;
  costLabel: (amt: number) => string;
  canAfford: (me: RoomStatePayload['players'][0], amt: InvestAmount) => boolean;
}[] = [
  {
    key: 'wood',
    label: 'Wood',
    emoji: '🪵',
    costLabel: (amt) => `${INVEST_WOOD_COST_FOOD * amt} food`,
    canAfford: (me, amt) => me.food >= INVEST_WOOD_COST_FOOD * amt,
  },
  {
    key: 'food',
    label: 'Food',
    emoji: '🌾',
    costLabel: (amt) => `${INVEST_FOOD_COST_WOOD * amt} wood`,
    canAfford: (me, amt) => me.wood >= INVEST_FOOD_COST_WOOD * amt,
  },
  {
    key: 'stone',
    label: 'Stone',
    emoji: '🪨',
    costLabel: (amt) => `${INVEST_STONE_COST_WOOD * amt} wood + ${INVEST_STONE_COST_FOOD * amt} food`,
    canAfford: (me, amt) => me.wood >= INVEST_STONE_COST_WOOD * amt && me.food >= INVEST_STONE_COST_FOOD * amt,
  },
  {
    key: 'metal',
    label: 'Metal',
    emoji: '⚙️',
    costLabel: (amt) => `${INVEST_METAL_COST_STONE * amt} stone + ${INVEST_METAL_COST_FOOD * amt} food`,
    canAfford: (me, amt) => me.stone >= INVEST_METAL_COST_STONE * amt && me.food >= INVEST_METAL_COST_FOOD * amt,
  },
];

function getIncome(me: RoomStatePayload['players'][0], resource: ResourceType): number {
  switch (resource) {
    case 'wood':  return me.woodIncome;
    case 'food':  return me.foodIncome;
    case 'stone': return me.stoneIncome;
    case 'metal': return me.metalIncome;
  }
}

function getAmount(me: RoomStatePayload['players'][0], resource: ResourceType): number {
  switch (resource) {
    case 'wood':  return me.wood;
    case 'food':  return me.food;
    case 'stone': return me.stone;
    case 'metal': return me.metal;
  }
}

export default function GameControls({ roomState, playerId, socket }: GameControlsProps) {
  const me = roomState.players.find((p) => p.playerId === playerId) ?? null;

  const handleInvest = (resource: ResourceType, amount: InvestAmount) => {
    socket.emit('player:invest_resource', { roomId: roomState.roomId, playerId, resource, amount });
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

  const canAffordMilitary = me.wood >= MILITARY_UPGRADE_COST_WOOD && me.food >= MILITARY_UPGRADE_COST_FOOD;
  const targets = roomState.players.filter((p) => p.alive && p.playerId !== playerId);
  const myTransit = roomState.troopsInTransit.filter((tg) => tg.attackerPlayerId === playerId);

  const hpPct = (me.hp / me.maxHp) * 100;

  return (
    <div className="game-controls">
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
            <span className="stat-label">Troops</span>
            <span className="stat-value">{me.militaryAtHome}</span>
          </div>
        </div>
      </div>

      {/* RESOURCES */}
      <div className="upgrades-section">
        <h3 className="section-title">Resources</h3>
        <div className="resource-list">
          {RESOURCE_CONFIG.map((res) => {
            const income = getIncome(me, res.key);
            const amount = getAmount(me, res.key);
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
                        onClick={() => handleInvest(res.key, amt as InvestAmount)}
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

      {/* MILITARY */}
      <div className="upgrades-section">
        <h3 className="section-title">Military</h3>
        <div className="upgrade-buttons">
          <button
            className="upgrade-btn upgrade-military"
            onClick={handleSpendMilitary}
            disabled={!canAffordMilitary}
          >
            <span className="upgrade-btn-title">Train Troops</span>
            <span className="upgrade-btn-cost">{MILITARY_UPGRADE_COST_WOOD} wood + {MILITARY_UPGRADE_COST_FOOD} food</span>
            <span className="upgrade-btn-effect">+{MILITARY_UPGRADE_TROOPS} troops</span>
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
