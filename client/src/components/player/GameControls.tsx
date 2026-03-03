import { useState, useEffect, useRef, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import type { RoomStatePayload, TroopType, UpgradeCategory } from '../../../../shared/types';
import {
  FOOD_PER_FARMER,
  MATERIALS_PER_MINER,
  GOLD_PER_MERCHANT,
  FOOD_PER_CITIZEN,
  POP_GROWTH_RATE,
  POP_STARVATION_RATE,
  VALID_GROWTH_MULTIPLIERS,
  UPGRADE_UNLOCK_COST,
  MONUMENT_CULTURE_PER_TURN,
  yieldMultiplier,
  CULTURE_WIN_THRESHOLD,
  TROOP_TYPES,
  TRAINING_CONFIG,
  COMBAT_POWER,
  VALID_ATTACK_AMOUNTS,
  PROMISED_LAND_ID,
  PROMISED_LAND_HOLD_TURNS,
  HP_REGEN_PERCENT,
  DEFENSE_HP_PER_LEVEL,
} from '../../../../shared/constants';
import BuildProgressBlock from './BuildProgressBlock';
import { useHoldToRepeat } from '../../hooks/useHoldToRepeat';

interface GameControlsProps {
  roomState: RoomStatePayload;
  playerId: string;
  socket: Socket;
}

type SectionId = 'farming' | 'mining' | 'trade' | 'culture' | 'defense' | 'military' | 'troops';

export default function GameControls({ roomState, playerId, socket }: GameControlsProps) {
  const me = roomState.players.find((p) => p.playerId === playerId) ?? null;

  const [hit, setHit] = useState(false);
  const [localFarmers, setLocalFarmers] = useState(0);
  const [localMiners, setLocalMiners] = useState(0);
  const [localMerchants, setLocalMerchants] = useState(0);
  const [localBuilders, setLocalBuilders] = useState<Record<UpgradeCategory, number>>({ culture: 0, military: 0, farming: 0, mining: 0, trade: 0, defense: 0 });
  const [localGrowthMultiplier, setLocalGrowthMultiplier] = useState(1);
  const [expandedSections, setExpandedSections] = useState<Record<SectionId, boolean>>({
    farming: true,
    mining: false,
    trade: false,
    culture: false,
    defense: false,
    military: false,
    troops: false,
  });

  const toggleSection = (id: SectionId) => {
    setExpandedSections(prev => ({ ...prev, [id]: !prev[id] }));
  };

  useEffect(() => {
    if (roomState.combatHitPlayerIds.includes(playerId)) {
      setHit(true);
      const id = setTimeout(() => setHit(false), 1200);
      return () => clearTimeout(id);
    }
  }, [roomState.combatHitPlayerIds, playerId]);

  useEffect(() => {
    if (me) {
      setLocalFarmers(me.farmers);
      setLocalMiners(me.miners);
      setLocalMerchants(me.merchants);
      setLocalBuilders(me.builders);
      setLocalGrowthMultiplier(me.growthMultiplier);
    }
  }, [me?.farmers, me?.miners, me?.merchants, me?.builders, me?.growthMultiplier]);

  // --- Hold-to-repeat infrastructure (must be before early returns for hooks rules) ---
  const controlsDisabled = !me || !me.alive || me.endedTurn || roomState.subPhase === 'resolving';
  const civilians = me ? Math.floor(me.population) : 0;
  const totalBuildersCount = Object.values(localBuilders).reduce((s, n) => s + n, 0);
  const totalWorkers = localFarmers + localMiners + localMerchants + totalBuildersCount;
  const unassigned = civilians - totalWorkers;

  const latestAllocRef = useRef({ farmers: localFarmers, miners: localMiners, merchants: localMerchants, builders: localBuilders });
  useEffect(() => {
    latestAllocRef.current = { farmers: localFarmers, miners: localMiners, merchants: localMerchants, builders: localBuilders };
  }, [localFarmers, localMiners, localMerchants, localBuilders]);

  const emitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedEmit = useCallback(() => {
    if (emitTimerRef.current) clearTimeout(emitTimerRef.current);
    emitTimerRef.current = setTimeout(() => {
      const { farmers, miners, merchants, builders } = latestAllocRef.current;
      socket.emit('player:allocate_workers', { roomId: roomState.roomId, playerId, farmers, miners, merchants, builders });
      emitTimerRef.current = null;
    }, 100);
  }, [socket, roomState.roomId, playerId]);

  const workerHoldAction = (
    setter: React.Dispatch<React.SetStateAction<number>>,
    field: 'farmers' | 'miners' | 'merchants',
    delta: number,
  ) => () => {
    setter(prev => {
      const v = prev + delta;
      if (v < 0) return prev;
      if (delta > 0) {
        const ref = { ...latestAllocRef.current, [field]: prev };
        const tw = ref.farmers + ref.miners + ref.merchants + Object.values(ref.builders).reduce((s, n) => s + n, 0);
        if (tw >= civilians) return prev;
      }
      latestAllocRef.current[field] = v;
      return v;
    });
    debouncedEmit();
  };

  const farmersMinusHold = useHoldToRepeat({ onAction: workerHoldAction(setLocalFarmers, 'farmers', -1), disabled: localFarmers <= 0 || controlsDisabled });
  const farmersPlusHold = useHoldToRepeat({ onAction: workerHoldAction(setLocalFarmers, 'farmers', 1), disabled: unassigned <= 0 || controlsDisabled });
  const minersMinusHold = useHoldToRepeat({ onAction: workerHoldAction(setLocalMiners, 'miners', -1), disabled: localMiners <= 0 || controlsDisabled });
  const minersPlusHold = useHoldToRepeat({ onAction: workerHoldAction(setLocalMiners, 'miners', 1), disabled: unassigned <= 0 || controlsDisabled });
  const merchantsMinusHold = useHoldToRepeat({ onAction: workerHoldAction(setLocalMerchants, 'merchants', -1), disabled: localMerchants <= 0 || controlsDisabled });
  const merchantsPlusHold = useHoldToRepeat({ onAction: workerHoldAction(setLocalMerchants, 'merchants', 1), disabled: unassigned <= 0 || controlsDisabled });

  const handleSetGrowthMultiplier = (multiplier: number) => {
    setLocalGrowthMultiplier(multiplier);
    socket.emit('player:set_growth_multiplier', { roomId: roomState.roomId, playerId, multiplier });
  };

  const handleUnlockUpgrade = (category: UpgradeCategory) => {
    socket.emit('player:unlock_upgrade', { roomId: roomState.roomId, playerId, category });
  };

  const handleSpendMilitary = (troopType: TroopType) => {
    socket.emit('player:spend_military', { roomId: roomState.roomId, playerId, troopType });
  };

  const handleSendAttack = (targetPlayerId: string, units: number, troopType: TroopType) => {
    socket.emit('player:send_attack', { roomId: roomState.roomId, playerId, targetPlayerId, units, troopType });
  };

  const handleSendDonation = (targetPlayerId: string, units: number, troopType: TroopType) => {
    socket.emit('player:send_donation', { roomId: roomState.roomId, playerId, targetPlayerId, units, troopType });
  };

  const handleRecallTroops = (troopGroupId: string) => {
    socket.emit('player:recall_troops', { roomId: roomState.roomId, playerId, troopGroupId });
  };

  const handlePauseTroops = (troopGroupId: string) => {
    socket.emit('player:pause_troops', { roomId: roomState.roomId, playerId, troopGroupId });
  };

  const handleResumeTroops = (troopGroupId: string) => {
    socket.emit('player:resume_troops', { roomId: roomState.roomId, playerId, troopGroupId });
  };

  const handleRedirectTroops = (troopGroupId: string, newTargetPlayerId: string) => {
    socket.emit('player:redirect_troops', { roomId: roomState.roomId, playerId, troopGroupId, newTargetPlayerId });
  };

  const handleRecallOccupyingTroops = (troopGroupId: string) => {
    socket.emit('player:recall_occupying_troops', { roomId: roomState.roomId, playerId, troopGroupId });
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

  const totalMilitary = Object.values(me.militaryAtHome).reduce((s, n) => s + n, 0);
  const totalCombatPower = TROOP_TYPES.reduce((s, t) => s + me.militaryAtHome[t] * COMBAT_POWER[t], 0);

  // Yield multipliers
  const farmingMult = yieldMultiplier(me.upgradesCompleted.farming);
  const miningMult = yieldMultiplier(me.upgradesCompleted.mining);
  const tradeMult = yieldMultiplier(me.upgradesCompleted.trade);

  // Farming / food calculations
  const foodProduced = localFarmers * FOOD_PER_FARMER * farmingMult;
  const foodConsumed = Math.floor(me.population) * FOOD_PER_CITIZEN * localGrowthMultiplier;
  const netFood = foodProduced - foodConsumed;
  const effectiveGrowthRate = POP_GROWTH_RATE * localGrowthMultiplier;
  const pop = Math.floor(me.population);
  const isFed = me.food + foodProduced >= foodConsumed;
  const projectedPop = isFed
    ? Math.floor(pop * (1 + effectiveGrowthRate))
    : Math.max(1, Math.floor(pop * (1 - POP_STARVATION_RATE)));

  // Mining
  const materialsPerTurn = localMiners * MATERIALS_PER_MINER * miningMult;

  // Trade
  const goldPerTurn = localMerchants * GOLD_PER_MERCHANT * tradeMult;

  // Generic upgrade affordability check
  const canAffordUpgrade = me.materials >= UPGRADE_UNLOCK_COST.materials && me.gold >= UPGRADE_UNLOCK_COST.gold;

  const completedCulture = me.upgradesCompleted.culture;

  const adjustBuilder = (category: UpgradeCategory, delta: number) => {
    setLocalBuilders(prev => {
      const updated = { ...prev, [category]: prev[category] + delta };
      latestAllocRef.current.builders = updated;
      return updated;
    });
    debouncedEmit();
  };

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
            <span className="stat-label">⚔️ Combat Power</span>
            <span className="stat-value">{totalCombatPower}</span>
            <span className="stat-rate">at home</span>
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
              {...farmersMinusHold}
              disabled={localFarmers <= 0 || controlsDisabled}
            >-</button>
            <span className="worker-count">{localFarmers}</span>
            <button
              className="worker-btn"
              {...farmersPlusHold}
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

            <BuildProgressBlock
              category="farming"
              me={me}
              localBuilders={localBuilders}
              onAdjustBuilder={adjustBuilder}
              onUnlockUpgrade={handleUnlockUpgrade}
              unassigned={unassigned}
              controlsDisabled={controlsDisabled}
              canAffordUpgrade={canAffordUpgrade}
              progressBarClass="farming-progress-fill"
              maxLabel={`All farming upgrades completed! (${farmingMult}x yield)`}
              unlockLabel="📜 Unlock Farming Upgrade"
              effectText={<>Yield: {farmingMult}x → {farmingMult + 1}x</>}
              explainerText={<>Yield: {FOOD_PER_FARMER} x {farmingMult} = {FOOD_PER_FARMER * farmingMult}/farmer → {FOOD_PER_FARMER * (farmingMult + 1)}/farmer</>}
            />
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
              {...minersMinusHold}
              disabled={localMiners <= 0 || controlsDisabled}
            >-</button>
            <span className="worker-count">{localMiners}</span>
            <button
              className="worker-btn"
              {...minersPlusHold}
              disabled={unassigned <= 0 || controlsDisabled}
            >+</button>
          </div>
          <span className="section-header-summary">
            <span className="summary-stockpile">🪨 {Math.floor(me.materials)}</span>
            <span className="summary-rate rate-positive">+{materialsPerTurn}/t</span>
          </span>
        </button>

        <div className={`section-body${expandedSections.mining ? '' : ' collapsed'}`}>
          <div className="section-body-inner">
            <div className="resource-row">
              <span className="resource-label">Per miner</span>
              <span className="resource-rate">+{MATERIALS_PER_MINER * miningMult} materials/turn</span>
            </div>

            <BuildProgressBlock
              category="mining"
              me={me}
              localBuilders={localBuilders}
              onAdjustBuilder={adjustBuilder}
              onUnlockUpgrade={handleUnlockUpgrade}
              unassigned={unassigned}
              controlsDisabled={controlsDisabled}
              canAffordUpgrade={canAffordUpgrade}
              progressBarClass="mining-progress-fill"
              maxLabel={`All mining upgrades completed! (${miningMult}x yield)`}
              unlockLabel="📜 Unlock Mining Upgrade"
              effectText={<>Yield: {miningMult}x → {miningMult + 1}x</>}
              explainerText={<>Yield: {MATERIALS_PER_MINER} x {miningMult} = {MATERIALS_PER_MINER * miningMult}/miner → {MATERIALS_PER_MINER * (miningMult + 1)}/miner</>}
            />
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
              {...merchantsMinusHold}
              disabled={localMerchants <= 0 || controlsDisabled}
            >-</button>
            <span className="worker-count">{localMerchants}</span>
            <button
              className="worker-btn"
              {...merchantsPlusHold}
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
              <span className="resource-rate">+{GOLD_PER_MERCHANT * tradeMult} gold/turn</span>
            </div>

            <BuildProgressBlock
              category="trade"
              me={me}
              localBuilders={localBuilders}
              onAdjustBuilder={adjustBuilder}
              onUnlockUpgrade={handleUnlockUpgrade}
              unassigned={unassigned}
              controlsDisabled={controlsDisabled}
              canAffordUpgrade={canAffordUpgrade}
              progressBarClass="trade-progress-fill"
              maxLabel={`All trade upgrades completed! (${tradeMult}x yield)`}
              unlockLabel="📜 Unlock Trade Upgrade"
              effectText={<>Yield: {tradeMult}x → {tradeMult + 1}x</>}
              explainerText={<>Yield: {GOLD_PER_MERCHANT} x {tradeMult} = {GOLD_PER_MERCHANT * tradeMult}/merchant → {GOLD_PER_MERCHANT * (tradeMult + 1)}/merchant</>}
            />
          </div>
        </div>
      </div>

      {/* CULTURE & UPGRADES */}
      <div className="upgrades-section section-culture">
        <button className="section-header" onClick={() => toggleSection('culture')}>
          <span className={`section-chevron${expandedSections.culture ? ' section-chevron-open' : ''}`}>&#9656;</span>
          <span className="section-header-title">🏛️ Culture</span>
          <span className="section-header-summary">
            <span className="summary-detail">Lvl {me.upgradeLevel.culture} · {completedCulture} built</span>
            {completedCulture > 0 && (
              <span className="summary-rate rate-positive">+{completedCulture * MONUMENT_CULTURE_PER_TURN}/t</span>
            )}
          </span>
        </button>

        {/* Culture progress bar — always visible */}
        <div className="culture-bar-wrapper">
          <div className="culture-bar-fill" style={{ width: `${culturePct}%` }} />
          <span className="culture-label">🏛️ {Math.floor(me.culture)} / {CULTURE_WIN_THRESHOLD}</span>
        </div>

        <div className={`section-body${expandedSections.culture ? '' : ' collapsed'}`}>
          <div className="section-body-inner">
            {completedCulture > 0 && (
              <div className="resource-row" style={{ marginTop: 4 }}>
                <span className="resource-label">Culture/turn</span>
                <span className="resource-amount">{Math.floor(me.culture)}</span>
                <span className="resource-rate">+{completedCulture * MONUMENT_CULTURE_PER_TURN}/turn</span>
              </div>
            )}

            <BuildProgressBlock
              category="culture"
              me={me}
              localBuilders={localBuilders}
              onAdjustBuilder={adjustBuilder}
              onUnlockUpgrade={handleUnlockUpgrade}
              unassigned={unassigned}
              controlsDisabled={controlsDisabled}
              canAffordUpgrade={canAffordUpgrade}
              maxLabel="All upgrades completed!"
              effectText={<>Level {me.upgradeLevel.culture} → {me.upgradeLevel.culture + 1}</>}
            />
          </div>
        </div>
      </div>

      {/* DEFENSE */}
      <div className="upgrades-section section-defense">
        <button className="section-header" onClick={() => toggleSection('defense')}>
          <span className={`section-chevron${expandedSections.defense ? ' section-chevron-open' : ''}`}>&#9656;</span>
          <span className="section-header-title">🛡️ Defense</span>
          <span className="section-header-summary">
            <span className="summary-detail">{me.maxHp} max HP</span>
            <span className="summary-rate rate-positive">+{Math.ceil(me.maxHp * HP_REGEN_PERCENT)}/t regen</span>
          </span>
        </button>

        <div className={`section-body${expandedSections.defense ? '' : ' collapsed'}`}>
          <div className="section-body-inner">
            <div className="resource-row">
              <span className="resource-label">City HP</span>
              <span className="resource-rate">{Math.ceil(me.hp)} / {me.maxHp}</span>
            </div>
            <div className="resource-row">
              <span className="resource-label">HP Regen</span>
              <span className="resource-rate">+{Math.ceil(me.maxHp * HP_REGEN_PERCENT)}/turn (3% of max)</span>
            </div>

            <BuildProgressBlock
              category="defense"
              me={me}
              localBuilders={localBuilders}
              onAdjustBuilder={adjustBuilder}
              onUnlockUpgrade={handleUnlockUpgrade}
              unassigned={unassigned}
              controlsDisabled={controlsDisabled}
              canAffordUpgrade={canAffordUpgrade}
              progressBarClass="defense-progress-fill"
              unlockBtnClass="upgrade-defense"
              buildingLabel="Building Fortification"
              maxLabel={`All fortifications completed! (${me.maxHp} max HP)`}
              unlockLabel="📜 Unlock Fortification"
              effectText={<>+{DEFENSE_HP_PER_LEVEL[me.upgradesCompleted.defense] ?? '?'} max HP</>}
              explainerText={<>Reward: +{DEFENSE_HP_PER_LEVEL[me.upgradesCompleted.defense]} max HP (→ {me.maxHp + DEFENSE_HP_PER_LEVEL[me.upgradesCompleted.defense]} total)</>}
            />
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
            {/* Troop training — only unlocked types */}
            <div className="upgrade-buttons">
              {TROOP_TYPES.map((type) => {
                const troopIndex = TROOP_TYPES.indexOf(type);
                const isUnlocked = troopIndex === 0 || me.upgradesCompleted.military >= troopIndex;
                if (!isUnlocked) return null;
                const config = TRAINING_CONFIG[type];
                const count = me.militaryAtHome[type];
                const canAfford = me.materials >= config.materials && me.gold >= config.gold;
                const canTrain = canAfford;
                return (
                  <button
                    key={type}
                    className="upgrade-btn upgrade-military"
                    onClick={() => handleSpendMilitary(type)}
                    disabled={!canTrain || controlsDisabled}
                    title={!canAfford ? 'Not enough materials or gold' : ''}
                  >
                    <span className="upgrade-btn-title">Buy {type.charAt(0).toUpperCase() + type.slice(1)} (CP:{COMBAT_POWER[type]})</span>
                    <span className="upgrade-btn-cost">{config.materials} materials + {config.gold} gold</span>
                    <span className="upgrade-btn-effect">+{config.troops} units | At home: {count}</span>
                  </button>
                );
              })}
            </div>

            <hr className="section-divider" />

            {/* Attack targets */}
            <div className="target-list">
              {/* The Promised Land target */}
              <div className="target-row" style={{ borderLeft: '3px solid #f4d03f' }}>
                <div className="target-info">
                  <span className="target-color-dot" style={{ backgroundColor: '#f4d03f' }} />
                  <span className="target-name">The Promised Land</span>
                  <span className="target-hp-small">Hold {PROMISED_LAND_HOLD_TURNS} turns to win</span>
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
                            onClick={() => handleSendAttack(PROMISED_LAND_ID, amount, type)}
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

              {/* Player targets */}
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

            <hr className="section-divider" />

            {/* Donate troops */}
            {targets.length > 0 && (
              <div className="target-list">
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#2ecc71', marginBottom: 4 }}>Donate Troops</div>
                {targets.map((target) => (
                  <div key={`donate-${target.playerId}`} className="target-row donate-target-row">
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
                                className="attack-amount-btn donate-amount-btn"
                                onClick={() => handleSendDonation(target.playerId, amount, type)}
                                disabled={count < amount || controlsDisabled}
                              >
                                Give {amount}
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

            <hr className="section-divider" />

            <BuildProgressBlock
              category="military"
              me={me}
              localBuilders={localBuilders}
              onAdjustBuilder={adjustBuilder}
              onUnlockUpgrade={handleUnlockUpgrade}
              unassigned={unassigned}
              controlsDisabled={controlsDisabled}
              canAffordUpgrade={canAffordUpgrade}
              progressBarClass="military-progress-fill"
              unlockBtnClass="upgrade-military"
              maxLabel="All troop types unlocked!"
              effectText={<>Unlocks: {TROOP_TYPES[me.upgradesCompleted.military + 1] ? TROOP_TYPES[me.upgradesCompleted.military + 1].charAt(0).toUpperCase() + TROOP_TYPES[me.upgradesCompleted.military + 1].slice(1) : 'next troop'}</>}
              explainerText={<>Unlocks: {TROOP_TYPES[me.upgradesCompleted.military + 1] ? TROOP_TYPES[me.upgradesCompleted.military + 1].charAt(0).toUpperCase() + TROOP_TYPES[me.upgradesCompleted.military + 1].slice(1) : '?'}</>}
            />
          </div>
        </div>
      </div>

      {/* TROOPS IN TRANSIT — interactive management */}
      {myTransit.length > 0 && (
        <div className="upgrades-section section-troops">
          <button className="section-header" onClick={() => toggleSection('troops')}>
            <span className={`section-chevron${expandedSections.troops ? ' section-chevron-open' : ''}`}>&#9656;</span>
            <span className="section-header-title">🚶 Troops In Transit</span>
            <span className="section-header-summary">
              <span className="summary-detail">{myTransit.length} group{myTransit.length !== 1 ? 's' : ''}</span>
            </span>
          </button>

          <div className={`section-body${expandedSections.troops ? '' : ' collapsed'}`}>
            <div className="section-body-inner">
              {myTransit.map((tg) => {
                const isReturning = tg.attackerPlayerId === tg.targetPlayerId;
                const isPaused = tg.paused;
                const targetName = tg.targetPlayerId === PROMISED_LAND_ID
                  ? 'The Promised Land'
                  : isReturning
                    ? 'Home'
                    : (roomState.players.find((p) => p.playerId === tg.targetPlayerId)?.name ?? '?');

                // Redirect targets: alive players (excluding self and current target) + Promised Land
                const redirectTargets = [
                  ...roomState.players.filter(p => p.alive && p.playerId !== playerId && p.playerId !== tg.targetPlayerId),
                ];
                const canRedirectToLand = tg.targetPlayerId !== PROMISED_LAND_ID && !tg.isDonation;

                return (
                  <div key={tg.id} className={`troop-manage-row${isPaused ? ' troop-paused' : ''}`}>
                    <div className="troop-manage-info">
                      <span className="troop-manage-units">
                        {tg.units} {tg.troopType}
                      </span>
                      <span className="troop-manage-target">
                        {isReturning ? '← Home' : tg.isDonation ? `🎁 → ${targetName}` : `→ ${targetName}`}
                        {isPaused && ' (PAUSED)'}
                      </span>
                      <span className="troop-manage-eta">
                        {isPaused ? 'Paused' : `${tg.turnsRemaining}t`}
                      </span>
                    </div>

                    {!isReturning && (
                      <div className="troop-manage-actions">
                        <button
                          className="troop-action-btn"
                          onClick={() => isPaused ? handleResumeTroops(tg.id) : handlePauseTroops(tg.id)}
                          disabled={controlsDisabled}
                        >
                          {isPaused ? 'Resume' : 'Pause'}
                        </button>
                        <button
                          className="troop-action-btn"
                          onClick={() => handleRecallTroops(tg.id)}
                          disabled={controlsDisabled}
                        >
                          Recall
                        </button>
                        {(redirectTargets.length > 0 || canRedirectToLand) && (
                          <select
                            className="troop-redirect-select"
                            value=""
                            onChange={(e) => {
                              if (e.target.value) handleRedirectTroops(tg.id, e.target.value);
                            }}
                            disabled={controlsDisabled}
                          >
                            <option value="">Redirect...</option>
                            {canRedirectToLand && <option value={PROMISED_LAND_ID}>The Promised Land</option>}
                            {redirectTargets.map(t => (
                              <option key={t.playerId} value={t.playerId}>{t.name}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* SIEGE STATUS */}
      {(() => {
        const mySieges = (roomState.occupyingTroops ?? []).filter(occ => occ.attackerPlayerId === playerId);
        const siegesOnMe = (roomState.occupyingTroops ?? []).filter(occ => occ.targetPlayerId === playerId);
        return (
          <>
            {mySieges.length > 0 && (
              <div className="transit-indicator">
                <div className="transit-row" style={{ fontWeight: 700 }}>Your Occupying Forces</div>
                {mySieges.map(occ => {
                  const isLand = occ.targetPlayerId === PROMISED_LAND_ID;
                  const targetName = isLand
                    ? 'The Promised Land'
                    : (roomState.players.find(p => p.playerId === occ.targetPlayerId)?.name ?? '?');
                  return (
                    <div key={occ.id} className="transit-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>
                        {occ.units} {occ.troopType} {isLand ? 'at' : 'besieging'} {targetName}
                        {!isLand && ` (${occ.units * COMBAT_POWER[occ.troopType]} dmg/turn)`}
                      </span>
                      <button
                        className="troop-action-btn"
                        onClick={() => handleRecallOccupyingTroops(occ.id)}
                        disabled={controlsDisabled}
                        style={{ marginLeft: 8, fontSize: 11 }}
                      >
                        Recall
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {siegesOnMe.length > 0 && (
              <div className="transit-indicator" style={{ borderColor: '#e74c3c' }}>
                <div className="transit-row" style={{ fontWeight: 700, color: '#e74c3c' }}>Under Siege!</div>
                {siegesOnMe.map(occ => {
                  const attackerName = roomState.players.find(p => p.playerId === occ.attackerPlayerId)?.name ?? '?';
                  return (
                    <div key={occ.id} className="transit-row" style={{ color: '#e74c3c' }}>
                      {occ.units} {occ.troopType} from {attackerName} ({occ.units * COMBAT_POWER[occ.troopType]} dmg/turn)
                    </div>
                  );
                })}
              </div>
            )}
          </>
        );
      })()}

      {/* END TURN BUTTON */}
      <div className="end-turn-section">
        <div className="turn-status">
          <span className="turn-number">Turn {roomState.turnNumber}</span>
          <span className="ended-count">
            {endedCount} / {alivePlayers.length} ready
          </span>
        </div>
        <button
          className={`end-turn-btn${hasEndedTurn ? ' ended' : unassigned > 0 ? ' idle-warning' : ''}`}
          onClick={() => {
            if (unassigned > 0) {
              if (!window.confirm(`You have ${unassigned} unallocated population. Are you sure you want to end your turn?`)) return;
            }
            handleEndTurn();
          }}
          disabled={hasEndedTurn || isResolving}
        >
          {isResolving ? 'Resolving...' : hasEndedTurn ? 'Waiting for others...' : unassigned > 0 ? `End Turn (${unassigned} idle)` : 'End Turn'}
        </button>
      </div>
    </div>
  );
}
