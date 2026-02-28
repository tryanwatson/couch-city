import { useState, useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import type { RoomStatePayload, TroopType } from '../../../../shared/types';
import {
  FOOD_PER_FARMER,
  RESOURCES_PER_MINER,
  GOLD_PER_MERCHANT,
  FOOD_PER_CITIZEN,
  CULTURE_UPGRADE_COST_FOOD,
  CULTURE_UPGRADE_COST_GOLD,
  MONUMENT_COST_GOLD,
  MONUMENT_COST_RESOURCES,
  MONUMENT_COST_MULTIPLIERS,
  MONUMENT_CULTURE_PER_TURN,
  CULTURE_WIN_THRESHOLD,
  TROOP_TYPES,
  TRAINING_CONFIG,
  COMBAT_POWER,
  VALID_ATTACK_AMOUNTS,
} from '../../../../shared/constants';

interface GameControlsProps {
  roomState: RoomStatePayload;
  playerId: string;
  socket: Socket;
}

export default function GameControls({ roomState, playerId, socket }: GameControlsProps) {
  const me = roomState.players.find((p) => p.playerId === playerId) ?? null;

  const [hit, setHit] = useState(false);
  const [localFarmers, setLocalFarmers] = useState(0);
  const [localMiners, setLocalMiners] = useState(0);
  const [localMerchants, setLocalMerchants] = useState(0);

  useEffect(() => {
    if (roomState.combatHitPlayerIds.includes(playerId)) {
      setHit(true);
      const id = setTimeout(() => setHit(false), 800);
      return () => clearTimeout(id);
    }
  }, [roomState.combatHitPlayerIds, playerId]);

  useEffect(() => {
    if (me) {
      setLocalFarmers(me.farmers);
      setLocalMiners(me.miners);
      setLocalMerchants(me.merchants);
    }
  }, [me?.farmers, me?.miners, me?.merchants]);

  const handleAllocateWorkers = (farmers: number, miners: number, merchants: number) => {
    socket.emit('player:allocate_workers', { roomId: roomState.roomId, playerId, farmers, miners, merchants });
  };

  const handleUpgradeCulture = () => {
    socket.emit('player:upgrade_culture', { roomId: roomState.roomId, playerId });
  };

  const handleBuildMonument = () => {
    socket.emit('player:build_monument', { roomId: roomState.roomId, playerId });
  };

  const handleSpendMilitary = (troopType: TroopType) => {
    socket.emit('player:spend_military', { roomId: roomState.roomId, playerId, troopType });
  };

  const handleSendAttack = (targetPlayerId: string, units: number, troopType: TroopType) => {
    socket.emit('player:send_attack', { roomId: roomState.roomId, playerId, targetPlayerId, units, troopType });
  };

  const handleEndTurn = () => {
    socket.emit('player:end_turn', { roomId: roomState.roomId, playerId });
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

  const hasEndedTurn = me.endedTurn;
  const isResolving = roomState.subPhase === 'resolving';
  const controlsDisabled = hasEndedTurn || isResolving;

  const totalMilitary = Object.values(me.militaryAtHome).reduce((s, n) => s + n, 0);
  const civilians = Math.floor(me.population) - totalMilitary;
  const totalWorkers = localFarmers + localMiners + localMerchants;
  const unassigned = civilians - totalWorkers;
  const foodPerTurn = localFarmers * FOOD_PER_FARMER;
  const resourcesPerTurn = localMiners * RESOURCES_PER_MINER;
  const goldPerTurn = localMerchants * GOLD_PER_MERCHANT;
  const foodConsumption = Math.floor(me.population) * FOOD_PER_CITIZEN;
  const netFood = foodPerTurn - foodConsumption;
  const canAffordCultureUpgrade = me.cultureLevel < MONUMENT_COST_MULTIPLIERS.length && me.food >= CULTURE_UPGRADE_COST_FOOD && me.gold >= CULTURE_UPGRADE_COST_GOLD;
  const nextMonumentMultiplier = MONUMENT_COST_MULTIPLIERS[me.monuments] ?? 0;
  const nextMonumentGoldCost = MONUMENT_COST_GOLD * nextMonumentMultiplier;
  const nextMonumentResourcesCost = MONUMENT_COST_RESOURCES * nextMonumentMultiplier;
  const canBuildMonument = me.monuments < me.cultureLevel
    && me.monuments < MONUMENT_COST_MULTIPLIERS.length
    && me.gold >= nextMonumentGoldCost
    && me.resources >= nextMonumentResourcesCost;
  const targets = roomState.players.filter((p) => p.alive && p.playerId !== playerId);
  const myTransit = roomState.troopsInTransit.filter((tg) => tg.attackerPlayerId === playerId);

  const alivePlayers = roomState.players.filter(p => p.alive);
  const endedCount = alivePlayers.filter(p => p.endedTurn).length;

  const hpPct = (me.hp / me.maxHp) * 100;
  const culturePct = Math.min(100, (me.culture / CULTURE_WIN_THRESHOLD) * 100);

  return (
    <div className={`game-controls${controlsDisabled ? ' turn-ended' : ''}`}>
      {/* SCREEN EDGE FLASH ON ATTACK */}
      {hit && <div className="attack-flash-overlay" />}

      {/* STICKY HP BAR */}
      <div className="hp-bar-sticky">
        <div className={`hp-bar-wrapper${hit ? ' hp-hit' : ''}`}>
          <div
            className={`hp-bar-fill${hpPct <= 30 ? ' hp-low' : ''}`}
            style={{ width: `${hpPct}%` }}
          />
          <span className="hp-label">{Math.ceil(me.hp)} / {me.maxHp} HP</span>
        </div>
      </div>

      {/* CULTURE PROGRESS */}
      <div className="culture-bar-wrapper">
        <div className="culture-bar-fill" style={{ width: `${culturePct}%` }} />
        <span className="culture-label">🏛️ Culture {Math.floor(me.culture)} / {CULTURE_WIN_THRESHOLD}</span>
      </div>

      {/* STATS HEADER */}
      <div className="stats-header" style={{ borderTopColor: me.color }}>
        <div className="city-name">{me.name}</div>

        <div className="stats-row">
          <div className="stat-block">
            <span className="stat-label">👥 Pop</span>
            <span className="stat-value">{Math.floor(me.population)}</span>
            <span className="stat-rate">{unassigned} idle</span>
          </div>
          <div className="stat-block">
            <span className="stat-label">⚔️ Troops</span>
            <span className="stat-value">{totalMilitary}</span>
            <span className="stat-rate">{civilians} civ</span>
          </div>
          <div className="stat-block">
            <span className="stat-label">💰 Gold</span>
            <span className="stat-value">{Math.floor(me.gold)}</span>
            <span className="stat-rate">+{goldPerTurn}/turn</span>
          </div>
        </div>
      </div>

      {/* WORKER ALLOCATION */}
      <div className="upgrades-section">
        <h3 className="section-title">Workers ({unassigned} unassigned)</h3>
        <div className="worker-list">
          <div className="worker-row">
            <div className="worker-info">
              <span className="worker-label">🌾 Farmers</span>
              <span className="worker-yield">+{FOOD_PER_FARMER}/ea</span>
            </div>
            <div className="worker-controls">
              <button
                className="worker-btn"
                onClick={() => { const v = localFarmers - 1; setLocalFarmers(v); handleAllocateWorkers(v, localMiners, localMerchants); }}
                disabled={localFarmers <= 0 || controlsDisabled}
              >-</button>
              <span className="worker-count">{localFarmers}</span>
              <button
                className="worker-btn"
                onClick={() => { const v = localFarmers + 1; setLocalFarmers(v); handleAllocateWorkers(v, localMiners, localMerchants); }}
                disabled={unassigned <= 0 || controlsDisabled}
              >+</button>
            </div>
          </div>

          <div className="worker-row">
            <div className="worker-info">
              <span className="worker-label">🪨 Miners</span>
              <span className="worker-yield">+{RESOURCES_PER_MINER}/ea</span>
            </div>
            <div className="worker-controls">
              <button
                className="worker-btn"
                onClick={() => { const v = localMiners - 1; setLocalMiners(v); handleAllocateWorkers(localFarmers, v, localMerchants); }}
                disabled={localMiners <= 0 || controlsDisabled}
              >-</button>
              <span className="worker-count">{localMiners}</span>
              <button
                className="worker-btn"
                onClick={() => { const v = localMiners + 1; setLocalMiners(v); handleAllocateWorkers(localFarmers, v, localMerchants); }}
                disabled={unassigned <= 0 || controlsDisabled}
              >+</button>
            </div>
          </div>

          <div className="worker-row">
            <div className="worker-info">
              <span className="worker-label">💰 Merchants</span>
              <span className="worker-yield">+{GOLD_PER_MERCHANT}/ea</span>
            </div>
            <div className="worker-controls">
              <button
                className="worker-btn"
                onClick={() => { const v = localMerchants - 1; setLocalMerchants(v); handleAllocateWorkers(localFarmers, localMiners, v); }}
                disabled={localMerchants <= 0 || controlsDisabled}
              >-</button>
              <span className="worker-count">{localMerchants}</span>
              <button
                className="worker-btn"
                onClick={() => { const v = localMerchants + 1; setLocalMerchants(v); handleAllocateWorkers(localFarmers, localMiners, v); }}
                disabled={unassigned <= 0 || controlsDisabled}
              >+</button>
            </div>
          </div>
        </div>

        {/* Income summary */}
        <div className="worker-summary">
          <div className="resource-row">
            <span className="resource-label">🌾 Food</span>
            <span className="resource-amount">{Math.floor(me.food)}</span>
            <span className={`resource-rate${netFood < 0 ? ' rate-negative' : ''}`}>
              {netFood >= 0 ? '+' : ''}{netFood}/turn
            </span>
          </div>
          <div className="resource-row">
            <span className="resource-label">🪨 Resources</span>
            <span className="resource-amount">{Math.floor(me.resources)}</span>
            <span className="resource-rate">+{resourcesPerTurn}/turn</span>
          </div>
          <div className="resource-row">
            <span className="resource-label">💰 Gold</span>
            <span className="resource-amount">{Math.floor(me.gold)}</span>
            <span className="resource-rate">+{goldPerTurn}/turn</span>
          </div>
        </div>
      </div>

      {/* CULTURE & MONUMENTS */}
      <div className="upgrades-section">
        <h3 className="section-title">Culture & Monuments</h3>
        <div className="upgrade-buttons">
          <button
            className="upgrade-btn upgrade-science"
            onClick={handleUpgradeCulture}
            disabled={!canAffordCultureUpgrade || controlsDisabled}
            title={`Costs ${CULTURE_UPGRADE_COST_FOOD} food + ${CULTURE_UPGRADE_COST_GOLD} gold`}
          >
            <span className="upgrade-btn-title">📜 Upgrade Culture</span>
            <span className="upgrade-btn-cost">{CULTURE_UPGRADE_COST_FOOD} food + {CULTURE_UPGRADE_COST_GOLD} gold</span>
            <span className="upgrade-btn-effect">Level {me.cultureLevel} → {me.cultureLevel + 1} (unlocks monument slot)</span>
          </button>

          <button
            className="upgrade-btn upgrade-military"
            onClick={handleBuildMonument}
            disabled={!canBuildMonument || controlsDisabled}
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
            <span className="resource-label">✨ Culture/turn</span>
            <span className="resource-amount">{Math.floor(me.culture)}</span>
            <span className="resource-rate">+{me.monuments * MONUMENT_CULTURE_PER_TURN}/turn</span>
          </div>
        )}
      </div>

      {/* MILITARY */}
      <div className="upgrades-section">
        <h3 className="section-title">Military ({civilians} civ avail)</h3>
        <div className="upgrade-buttons">
          {TROOP_TYPES.map((type) => {
            const config = TRAINING_CONFIG[type];
            const count = me.militaryAtHome[type];
            const canAfford = me.food >= config.food && me.gold >= config.gold;
            const canTrain = canAfford && civilians >= config.troops;
            return (
              <button
                key={type}
                className="upgrade-btn upgrade-military"
                onClick={() => handleSpendMilitary(type)}
                disabled={!canTrain || controlsDisabled}
                title={!canAfford ? 'Not enough resources' : civilians < config.troops ? `Need ${config.troops - civilians} more civilians` : ''}
              >
                <span className="upgrade-btn-title">Train {type.charAt(0).toUpperCase() + type.slice(1)} (CP:{COMBAT_POWER[type]})</span>
                <span className="upgrade-btn-cost">{config.food} food + {config.gold} gold</span>
                <span className="upgrade-btn-effect">+{config.troops} units | At home: {count}</span>
              </button>
            );
          })}
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
                {TROOP_TYPES.map((type) => {
                  const count = me.militaryAtHome[type];
                  if (count === 0) return null;
                  return (
                    <div key={type} className="attack-type-row">
                      <span className="attack-type-label">{type.charAt(0).toUpperCase() + type.slice(1)} ({count})</span>
                      <div className="attack-amounts">
                        {(VALID_ATTACK_AMOUNTS as readonly number[]).map((amount) => (
                          <button
                            key={amount}
                            className="attack-amount-btn"
                            onClick={() => handleSendAttack(target.playerId, amount, type)}
                            disabled={count < amount || controlsDisabled}
                          >
                            Send {amount}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
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
            return (
              <div key={tg.id} className="transit-row">
                {tg.units} {tg.troopType} &#8594; {targetName} ({tg.turnsRemaining} {tg.turnsRemaining === 1 ? 'turn' : 'turns'})
              </div>
            );
          })}
        </div>
      )}

      {/* END TURN BUTTON */}
      <div className="end-turn-section">
        <div className="turn-status">
          <span className="turn-number">Turn {roomState.turnNumber}</span>
          <span className="ended-count">
            {endedCount} / {alivePlayers.length} ready
          </span>
        </div>
        <button
          className={`end-turn-btn${hasEndedTurn ? ' ended' : ''}`}
          onClick={handleEndTurn}
          disabled={hasEndedTurn || isResolving}
        >
          {isResolving ? 'Resolving...' : hasEndedTurn ? 'Waiting for others...' : 'End Turn'}
        </button>
      </div>
    </div>
  );
}
