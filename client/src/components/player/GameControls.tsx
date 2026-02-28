import { useState, useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import type { RoomStatePayload, TroopType } from '../../../../shared/types';
import {
  FOOD_PER_FARMER,
  RESOURCES_PER_MINER,
  GOLD_PER_MERCHANT,
  FOOD_PER_CITIZEN,
  POP_GROWTH_RATE,
  POP_STARVATION_RATE,
  VALID_GROWTH_MULTIPLIERS,
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

type SectionId = 'farming' | 'mining' | 'trade' | 'culture' | 'military' | 'attack';

export default function GameControls({ roomState, playerId, socket }: GameControlsProps) {
  const me = roomState.players.find((p) => p.playerId === playerId) ?? null;

  const [hit, setHit] = useState(false);
  const [localFarmers, setLocalFarmers] = useState(0);
  const [localMiners, setLocalMiners] = useState(0);
  const [localMerchants, setLocalMerchants] = useState(0);
  const [localGrowthMultiplier, setLocalGrowthMultiplier] = useState(1);
  const [expandedSections, setExpandedSections] = useState<Record<SectionId, boolean>>({
    farming: true,
    mining: false,
    trade: false,
    culture: false,
    military: false,
    attack: false,
  });

  const toggleSection = (id: SectionId) => {
    setExpandedSections(prev => ({ ...prev, [id]: !prev[id] }));
  };

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
      setLocalGrowthMultiplier(me.growthMultiplier);
    }
  }, [me?.farmers, me?.miners, me?.merchants, me?.growthMultiplier]);

  const handleAllocateWorkers = (farmers: number, miners: number, merchants: number) => {
    socket.emit('player:allocate_workers', { roomId: roomState.roomId, playerId, farmers, miners, merchants });
  };

  const handleSetGrowthMultiplier = (multiplier: number) => {
    setLocalGrowthMultiplier(multiplier);
    socket.emit('player:set_growth_multiplier', { roomId: roomState.roomId, playerId, multiplier });
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

  // Farming / food calculations
  const foodProduced = localFarmers * FOOD_PER_FARMER;
  const foodConsumed = Math.floor(me.population) * FOOD_PER_CITIZEN * localGrowthMultiplier;
  const netFood = foodProduced - foodConsumed;
  const effectiveGrowthRate = POP_GROWTH_RATE * localGrowthMultiplier;
  const pop = Math.floor(me.population);
  const isFed = me.food + foodProduced >= foodConsumed;
  const projectedPop = isFed
    ? Math.floor(pop * (1 + effectiveGrowthRate))
    : Math.max(1, Math.floor(pop * (1 - POP_STARVATION_RATE)));

  // Mining
  const resourcesPerTurn = localMiners * RESOURCES_PER_MINER;

  // Trade
  const goldPerTurn = localMerchants * GOLD_PER_MERCHANT;

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

  // Military summary for collapsed header
  const troopBreakdown = TROOP_TYPES
    .filter(t => me.militaryAtHome[t] > 0)
    .map(t => `${t.charAt(0).toUpperCase()}:${me.militaryAtHome[t]}`)
    .join(' ');

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
            <span className="stat-value">{pop}</span>
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

      {/* ====== FARMING SECTION ====== */}
      <div className="upgrades-section section-farming">
        <button className="section-header" onClick={() => toggleSection('farming')}>
          <span className={`section-chevron${expandedSections.farming ? ' section-chevron-open' : ''}`}>&#9656;</span>
          <span className="section-header-title">🌾 Farming</span>
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div className="section-header-workers" onClick={e => e.stopPropagation()}>
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
          <span className="section-header-summary">
            <span className="summary-stockpile">🌾 {Math.floor(me.food)}</span>
            <span className={`summary-rate${netFood < 0 ? ' rate-negative' : ' rate-positive'}`}>
              {netFood >= 0 ? '+' : ''}{netFood}/t
            </span>
          </span>
        </button>

        <div className={`section-body${expandedSections.farming ? '' : ' collapsed'}`}>
          <div className="section-body-inner">
            {/* Growth multiplier */}
            <div className="growth-multiplier-row">
              <span className="growth-multiplier-label">Growth Rate</span>
              <div className="growth-multiplier-group">
                {(VALID_GROWTH_MULTIPLIERS as readonly number[]).map((m) => (
                  <button
                    key={m}
                    className={`growth-multiplier-btn${localGrowthMultiplier === m ? ' active' : ''}`}
                    onClick={() => handleSetGrowthMultiplier(m)}
                    disabled={controlsDisabled}
                  >
                    {m}x
                  </button>
                ))}
              </div>
            </div>

            {/* Food breakdown */}
            <div className="food-breakdown">
              <div className="food-breakdown-line">
                <span>🌾 Stockpile</span>
                <span>{Math.floor(me.food)}</span>
              </div>
              <div className="food-breakdown-line">
                <span>+ Produced</span>
                <span className="rate-positive">+{foodProduced}</span>
              </div>
              <div className="food-breakdown-line">
                <span>- Consumed ({pop} pop × {FOOD_PER_CITIZEN * localGrowthMultiplier})</span>
                <span className="rate-negative">-{foodConsumed}</span>
              </div>
              <div className={`food-breakdown-line food-breakdown-net${netFood < 0 ? ' rate-negative' : ''}`}>
                <span>= Net</span>
                <span>{netFood >= 0 ? '+' : ''}{netFood}/turn</span>
              </div>
            </div>

            {/* Population growth projection */}
            <div className="pop-growth-info">
              <span className="pop-growth-label">👥 Population</span>
              <span className={`pop-growth-projection${!isFed ? ' rate-negative' : ''}`}>
                {pop} → {projectedPop} next turn ({isFed ? `+${Math.round(effectiveGrowthRate * 100)}%` : `-${Math.round(POP_STARVATION_RATE * 100)}%`})
              </span>
            </div>

            <p className="section-explainer">
              Each citizen eats {FOOD_PER_CITIZEN} food/turn at 1x.
              Higher multipliers consume more food but grow population faster.
              Starving cities lose {Math.round(POP_STARVATION_RATE * 100)}% pop/turn.
            </p>
          </div>
        </div>
      </div>

      {/* ====== MINING SECTION ====== */}
      <div className="upgrades-section section-mining">
        <button className="section-header" onClick={() => toggleSection('mining')}>
          <span className={`section-chevron${expandedSections.mining ? ' section-chevron-open' : ''}`}>&#9656;</span>
          <span className="section-header-title">🪨 Mining</span>
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div className="section-header-workers" onClick={e => e.stopPropagation()}>
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
          <span className="section-header-summary">
            <span className="summary-stockpile">🪨 {Math.floor(me.resources)}</span>
            <span className="summary-rate rate-positive">+{resourcesPerTurn}/t</span>
          </span>
        </button>

        <div className={`section-body${expandedSections.mining ? '' : ' collapsed'}`}>
          <div className="section-body-inner">
            <div className="resource-row">
              <span className="resource-label">Per miner</span>
              <span className="resource-rate">+{RESOURCES_PER_MINER} resources/turn</span>
            </div>
          </div>
        </div>
      </div>

      {/* ====== TRADE SECTION ====== */}
      <div className="upgrades-section section-trade">
        <button className="section-header" onClick={() => toggleSection('trade')}>
          <span className={`section-chevron${expandedSections.trade ? ' section-chevron-open' : ''}`}>&#9656;</span>
          <span className="section-header-title">💰 Trade</span>
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div className="section-header-workers" onClick={e => e.stopPropagation()}>
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
          <span className="section-header-summary">
            <span className="summary-stockpile">💰 {Math.floor(me.gold)}</span>
            <span className="summary-rate rate-positive">+{goldPerTurn}/t</span>
          </span>
        </button>

        <div className={`section-body${expandedSections.trade ? '' : ' collapsed'}`}>
          <div className="section-body-inner">
            <div className="resource-row">
              <span className="resource-label">Per merchant</span>
              <span className="resource-rate">+{GOLD_PER_MERCHANT} gold/turn</span>
            </div>
          </div>
        </div>
      </div>

      {/* CULTURE & MONUMENTS */}
      <div className="upgrades-section section-culture">
        <button className="section-header" onClick={() => toggleSection('culture')}>
          <span className={`section-chevron${expandedSections.culture ? ' section-chevron-open' : ''}`}>&#9656;</span>
          <span className="section-header-title">🏛️ Culture</span>
          <span className="section-header-summary">
            <span className="summary-detail">Lvl {me.cultureLevel} · {me.monuments} mon</span>
            {me.monuments > 0 && (
              <span className="summary-rate rate-positive">+{me.monuments * MONUMENT_CULTURE_PER_TURN}/t</span>
            )}
          </span>
        </button>

        <div className={`section-body${expandedSections.culture ? '' : ' collapsed'}`}>
          <div className="section-body-inner">
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
                className="upgrade-btn upgrade-monument"
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
        </div>
      </div>

      {/* MILITARY */}
      <div className="upgrades-section section-military">
        <button className="section-header" onClick={() => toggleSection('military')}>
          <span className={`section-chevron${expandedSections.military ? ' section-chevron-open' : ''}`}>&#9656;</span>
          <span className="section-header-title">⚔️ Military</span>
          <span className="section-header-summary">
            <span className="summary-detail">{totalMilitary} troops · {civilians} civ</span>
            {troopBreakdown && <span className="summary-breakdown">{troopBreakdown}</span>}
          </span>
        </button>

        <div className={`section-body${expandedSections.military ? '' : ' collapsed'}`}>
          <div className="section-body-inner">
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
        </div>
      </div>

      {/* ATTACK */}
      <div className="attack-section section-attack">
        <button className="section-header" onClick={() => toggleSection('attack')}>
          <span className={`section-chevron${expandedSections.attack ? ' section-chevron-open' : ''}`}>&#9656;</span>
          <span className="section-header-title">🎯 Attack</span>
          <span className="section-header-summary">
            <span className="summary-detail">{targets.length} target{targets.length !== 1 ? 's' : ''}</span>
            <span className="summary-detail">{totalMilitary} at home</span>
          </span>
        </button>

        <div className={`section-body${expandedSections.attack ? '' : ' collapsed'}`}>
          <div className="section-body-inner">
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
        </div>
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
