import type { Socket } from 'socket.io-client';
import type { RoomStatePayload } from '../../../../shared/types';
import {
  ECONOMY_UPGRADE_COST_A,
  ECONOMY_UPGRADE_COST_B,
  ECONOMY_UPGRADE_INCOME_A,
  ECONOMY_UPGRADE_INCOME_B,
  MILITARY_UPGRADE_COST_A,
  MILITARY_UPGRADE_COST_B,
  MILITARY_UPGRADE_TROOPS,
  VALID_ATTACK_AMOUNTS,
} from '../../../../shared/constants';

interface GameControlsProps {
  roomState: RoomStatePayload;
  playerId: string;
  socket: Socket;
}

export default function GameControls({ roomState, playerId, socket }: GameControlsProps) {
  const me = roomState.players.find((p) => p.playerId === playerId) ?? null;

  const handleSpendEconomy = () => {
    socket.emit('player:spend_economy', { roomId: roomState.roomId, playerId });
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

  const canAffordEconomy = me.resourceA >= ECONOMY_UPGRADE_COST_A && me.resourceB >= ECONOMY_UPGRADE_COST_B;
  const canAffordMilitary = me.resourceA >= MILITARY_UPGRADE_COST_A && me.resourceB >= MILITARY_UPGRADE_COST_B;
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
            <span className="stat-label">Resource A</span>
            <span className="stat-value">{Math.floor(me.resourceA)}</span>
            <span className="stat-rate">+{me.incomeRateA}/s</span>
          </div>
          <div className="stat-block">
            <span className="stat-label">Resource B</span>
            <span className="stat-value">{Math.floor(me.resourceB)}</span>
            <span className="stat-rate">+{me.incomeRateB}/s</span>
          </div>
          <div className="stat-block">
            <span className="stat-label">Troops</span>
            <span className="stat-value">{me.militaryAtHome}</span>
          </div>
        </div>
      </div>

      {/* UPGRADES */}
      <div className="upgrades-section">
        <h3 className="section-title">Upgrades</h3>
        <div className="upgrade-buttons">
          <button
            className="upgrade-btn upgrade-economy"
            onClick={handleSpendEconomy}
            disabled={!canAffordEconomy}
          >
            <span className="upgrade-btn-title">Economy</span>
            <span className="upgrade-btn-cost">{ECONOMY_UPGRADE_COST_A}A + {ECONOMY_UPGRADE_COST_B}B</span>
            <span className="upgrade-btn-effect">+{ECONOMY_UPGRADE_INCOME_A}/s income</span>
          </button>

          <button
            className="upgrade-btn upgrade-military"
            onClick={handleSpendMilitary}
            disabled={!canAffordMilitary}
          >
            <span className="upgrade-btn-title">Military</span>
            <span className="upgrade-btn-cost">{MILITARY_UPGRADE_COST_A}A + {MILITARY_UPGRADE_COST_B}B</span>
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
