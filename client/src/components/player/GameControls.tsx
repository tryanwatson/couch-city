import { useState, useEffect, useRef, useCallback } from "react";
import type { Socket } from "socket.io-client";
import type {
  RoomStatePayload,
  TroopType,
  UpgradeCategory,
} from "../../../../shared/types";
import {
  FOOD_PER_FARMER,
  MATERIALS_PER_MINER,
  GOLD_PER_MERCHANT,
  FOOD_PER_CITIZEN,
  POP_GROWTH_RATE,
  POP_STARVATION_RATE,
  VALID_GROWTH_MULTIPLIERS,
  getUpgradeUnlockCost,
  MONUMENT_CULTURE_PER_TURN,
  yieldMultiplier,
  CULTURE_WIN_THRESHOLD,
  TROOP_TYPES,
  TRAINING_CONFIG,
  COMBAT_POWER,
  PROMISED_LAND_ID,
  HP_REGEN_PERCENT,
  WALLS_HP_PER_LEVEL,
  UPGRADE_PROGRESS,
  PROGRESS_PER_BUILDER,
  HOUSING_POP_CAPS,
  getHousingCap,
} from "../../../../shared/constants";
import BuildProgressBlock from "./BuildProgressBlock";
import TargetModal from "./TargetModal";
import type { TargetInfo } from "./TargetModal";
import { useHoldToRepeat } from "../../hooks/useHoldToRepeat";

interface GameControlsProps {
  roomState: RoomStatePayload;
  playerId: string;
  socket: Socket;
}

type SectionId =
  | "population"
  | "farming"
  | "mining"
  | "trade"
  | "culture"
  | "walls"
  | "military"
  | "troops";

export default function GameControls({
  roomState,
  playerId,
  socket,
}: GameControlsProps) {
  const me = roomState.players.find((p) => p.playerId === playerId) ?? null;

  const [hit, setHit] = useState(false);
  const [localFarmers, setLocalFarmers] = useState(0);
  const [localMiners, setLocalMiners] = useState(0);
  const [localMerchants, setLocalMerchants] = useState(0);
  const [localBuilders, setLocalBuilders] = useState<
    Record<UpgradeCategory, number>
  >({
    culture: 0,
    military: 0,
    farming: 0,
    mining: 0,
    trade: 0,
    walls: 0,
    housing: 0,
  });
  const [localGrowthMultiplier, setLocalGrowthMultiplier] = useState(1);
  const [selectedTarget, setSelectedTarget] = useState<TargetInfo | null>(null);
  const [expandedSections, setExpandedSections] = useState<
    Record<SectionId, boolean>
  >({
    population: true,
    farming: true,
    mining: false,
    trade: false,
    culture: false,
    walls: false,
    military: false,
    troops: false,
  });

  const toggleSection = (id: SectionId) => {
    setExpandedSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  useEffect(() => {
    if (roomState.combatHitPlayerIds.includes(playerId)) {
      setHit(true);
      const id = setTimeout(() => setHit(false), 1200);
      return () => clearTimeout(id);
    }
  }, [roomState.combatHitPlayerIds, playerId]);

  const emitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAllocInteraction = useRef(0);

  useEffect(() => {
    if (!me) return;
    // Always sync growth multiplier (separate non-debounced handler)
    setLocalGrowthMultiplier(me.growthMultiplier);
    // Skip allocation sync while user is actively interacting
    if (Date.now() - lastAllocInteraction.current < 500) return;
    setLocalFarmers(me.farmers);
    setLocalMiners(me.miners);
    setLocalMerchants(me.merchants);
    setLocalBuilders(me.builders);
  }, [
    me?.farmers,
    me?.miners,
    me?.merchants,
    me?.builders,
    me?.growthMultiplier,
  ]);

  // --- Hold-to-repeat infrastructure (must be before early returns for hooks rules) ---
  const controlsDisabled =
    !me || !me.alive || me.endedTurn || roomState.subPhase === "resolving";
  const civilians = me ? Math.floor(me.population) : 0;
  const totalBuildersCount = Object.values(localBuilders).reduce(
    (s, n) => s + n,
    0,
  );
  const totalWorkers =
    localFarmers + localMiners + localMerchants + totalBuildersCount;
  const unassigned = civilians - totalWorkers;

  const latestAllocRef = useRef({
    farmers: localFarmers,
    miners: localMiners,
    merchants: localMerchants,
    builders: localBuilders,
  });
  useEffect(() => {
    latestAllocRef.current = {
      farmers: localFarmers,
      miners: localMiners,
      merchants: localMerchants,
      builders: localBuilders,
    };
  }, [localFarmers, localMiners, localMerchants, localBuilders]);
  const debouncedEmit = useCallback(() => {
    if (emitTimerRef.current) clearTimeout(emitTimerRef.current);
    emitTimerRef.current = setTimeout(() => {
      const { farmers, miners, merchants, builders } = latestAllocRef.current;
      socket.emit("player:allocate_workers", {
        roomId: roomState.roomId,
        playerId,
        farmers,
        miners,
        merchants,
        builders,
      });
      emitTimerRef.current = null;
    }, 100);
  }, [socket, roomState.roomId, playerId]);

  const workerHoldAction =
    (
      setter: React.Dispatch<React.SetStateAction<number>>,
      field: "farmers" | "miners" | "merchants",
      delta: number,
    ) =>
    () => {
      lastAllocInteraction.current = Date.now();
      setter((prev) => {
        const v = prev + delta;
        if (v < 0) return prev;
        if (delta > 0) {
          const ref = { ...latestAllocRef.current, [field]: prev };
          const tw =
            ref.farmers +
            ref.miners +
            ref.merchants +
            Object.values(ref.builders).reduce((s, n) => s + n, 0);
          if (tw >= civilians) return prev;
        }
        latestAllocRef.current[field] = v;
        return v;
      });
      debouncedEmit();
    };

  const farmersMinusHold = useHoldToRepeat({
    onAction: workerHoldAction(setLocalFarmers, "farmers", -1),
    disabled: localFarmers <= 0 || controlsDisabled,
  });
  const farmersPlusHold = useHoldToRepeat({
    onAction: workerHoldAction(setLocalFarmers, "farmers", 1),
    disabled: unassigned <= 0 || controlsDisabled,
  });
  const minersMinusHold = useHoldToRepeat({
    onAction: workerHoldAction(setLocalMiners, "miners", -1),
    disabled: localMiners <= 0 || controlsDisabled,
  });
  const minersPlusHold = useHoldToRepeat({
    onAction: workerHoldAction(setLocalMiners, "miners", 1),
    disabled: unassigned <= 0 || controlsDisabled,
  });
  const merchantsMinusHold = useHoldToRepeat({
    onAction: workerHoldAction(setLocalMerchants, "merchants", -1),
    disabled: localMerchants <= 0 || controlsDisabled,
  });
  const merchantsPlusHold = useHoldToRepeat({
    onAction: workerHoldAction(setLocalMerchants, "merchants", 1),
    disabled: unassigned <= 0 || controlsDisabled,
  });

  const handleSetGrowthMultiplier = (multiplier: number) => {
    setLocalGrowthMultiplier(multiplier);
    socket.emit("player:set_growth_multiplier", {
      roomId: roomState.roomId,
      playerId,
      multiplier,
    });
  };

  const handleUnlockUpgrade = (category: UpgradeCategory) => {
    socket.emit("player:unlock_upgrade", {
      roomId: roomState.roomId,
      playerId,
      category,
    });
  };

  const handleSpendMilitary = (troopType: TroopType) => {
    socket.emit("player:spend_military", {
      roomId: roomState.roomId,
      playerId,
      troopType,
    });
  };

  const handleSendAttack = (
    targetPlayerId: string,
    units: number,
    troopType: TroopType,
    fromDefending?: boolean,
  ) => {
    socket.emit("player:send_attack", {
      roomId: roomState.roomId,
      playerId,
      targetPlayerId,
      units,
      troopType,
      fromDefending,
    });
  };

  const handleSendDonation = (
    targetPlayerId: string,
    units: number,
    troopType: TroopType,
  ) => {
    socket.emit("player:send_donation", {
      roomId: roomState.roomId,
      playerId,
      targetPlayerId,
      units,
      troopType,
    });
  };

  const handleSendDefend = (units: number, troopType: TroopType) => {
    socket.emit("player:send_defend", {
      roomId: roomState.roomId,
      playerId,
      units,
      troopType,
    });
  };

  const handleRecallDefenders = (units: number, troopType: TroopType) => {
    socket.emit("player:recall_defenders", {
      roomId: roomState.roomId,
      playerId,
      units,
      troopType,
    });
  };

  const handleRecallTroops = (troopGroupId: string) => {
    socket.emit("player:recall_troops", {
      roomId: roomState.roomId,
      playerId,
      troopGroupId,
    });
  };

  const handlePauseTroops = (troopGroupId: string) => {
    socket.emit("player:pause_troops", {
      roomId: roomState.roomId,
      playerId,
      troopGroupId,
    });
  };

  const handleResumeTroops = (troopGroupId: string) => {
    socket.emit("player:resume_troops", {
      roomId: roomState.roomId,
      playerId,
      troopGroupId,
    });
  };

  const handleRedirectTroops = (
    troopGroupId: string,
    newTargetPlayerId: string,
  ) => {
    socket.emit("player:redirect_troops", {
      roomId: roomState.roomId,
      playerId,
      troopGroupId,
      newTargetPlayerId,
    });
  };

  const handleRecallTroopsToDefend = (troopGroupId: string) => {
    socket.emit("player:recall_troops", {
      roomId: roomState.roomId,
      playerId,
      troopGroupId,
      defendOnArrival: true,
    });
  };

  const handleToggleDefendOnArrival = (
    troopGroupId: string,
    currentValue: boolean,
  ) => {
    socket.emit("player:set_defend_on_arrival", {
      roomId: roomState.roomId,
      playerId,
      troopGroupId,
      defendOnArrival: !currentValue,
    });
  };

  const handleRecallOccupyingTroops = (troopGroupId: string) => {
    socket.emit("player:recall_occupying_troops", {
      roomId: roomState.roomId,
      playerId,
      troopGroupId,
    });
  };

  const handleRecallOccupyingTroopsToDefend = (troopGroupId: string) => {
    socket.emit("player:recall_occupying_troops", {
      roomId: roomState.roomId,
      playerId,
      troopGroupId,
      defendOnArrival: true,
    });
  };

  const handleRedirectOccupyingTroops = (
    troopGroupId: string,
    newTargetPlayerId: string,
  ) => {
    socket.emit("player:redirect_occupying_troops", {
      roomId: roomState.roomId,
      playerId,
      troopGroupId,
      newTargetPlayerId,
    });
  };

  const handleEndTurn = () => {
    socket.emit("player:end_turn", { roomId: roomState.roomId, playerId });
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
            <div
              key={p.playerId}
              className="survivor-row"
              style={{ borderLeftColor: p.color }}
            >
              <span className="survivor-name">{p.name}</span>
              <span className="survivor-hp">{Math.ceil(p.hp)} HP</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const hasEndedTurn = me.endedTurn;
  const isResolving = roomState.subPhase === "resolving";

  const totalMilitary = Object.values(me.militaryAtHome).reduce(
    (s, n) => s + n,
    0,
  );
  const totalCombatPower = TROOP_TYPES.reduce(
    (s, t) => s + me.militaryAtHome[t] * COMBAT_POWER[t],
    0,
  );

  // Yield multipliers
  const farmingMult = yieldMultiplier(me.upgradesCompleted.farming);
  const miningMult = yieldMultiplier(me.upgradesCompleted.mining);
  const tradeMult = yieldMultiplier(me.upgradesCompleted.trade);

  // Farming / food calculations
  const foodProduced = localFarmers * FOOD_PER_FARMER * farmingMult;
  const foodConsumed =
    Math.floor(me.population) * FOOD_PER_CITIZEN * localGrowthMultiplier;

  const netFood = foodProduced - foodConsumed;
  const effectiveGrowthRate = POP_GROWTH_RATE * localGrowthMultiplier;
  const pop = Math.floor(me.population);
  const isFed = me.food + foodProduced >= foodConsumed;
  const housingCap = getHousingCap(me.upgradesCompleted.housing);
  const projectedPopRaw = isFed
    ? Math.floor(pop * (1 + effectiveGrowthRate))
    : Math.max(1, Math.floor(pop * (1 - POP_STARVATION_RATE)));
  const projectedPop = Math.min(projectedPopRaw, housingCap);

  // Mining
  const materialsPerTurn = localMiners * MATERIALS_PER_MINER * miningMult;

  // Trade
  const goldPerTurn = localMerchants * GOLD_PER_MERCHANT * tradeMult;

  // Per-category upgrade unlock cost (scales with level)
  const getUnlockCost = (cat: UpgradeCategory) =>
    getUpgradeUnlockCost(cat, me.upgradeLevel[cat]);

  const completedCulture = me.upgradesCompleted.culture;

  const adjustBuilder = (category: UpgradeCategory, delta: number) => {
    lastAllocInteraction.current = Date.now();
    setLocalBuilders((prev) => {
      const updated = { ...prev, [category]: prev[category] + delta };
      latestAllocRef.current.builders = updated;
      return updated;
    });
    debouncedEmit();
  };

  const targets = roomState.players.filter(
    (p) => p.alive && p.playerId !== playerId,
  );
  const myTransit = roomState.troopsInTransit.filter(
    (tg) => tg.attackerPlayerId === playerId,
  );
  const defendingTypes = TROOP_TYPES.filter(
    (t) => me.militaryDefending[t] > 0,
  );
  const hasDefendingTroops = defendingTypes.length > 0;

  const alivePlayers = roomState.players.filter((p) => p.alive);
  const endedCount = alivePlayers.filter((p) => p.endedTurn).length;

  const hpPct = (me.hp / me.maxHp) * 100;
  const culturePct = Math.min(100, (me.culture / CULTURE_WIN_THRESHOLD) * 100);

  // Military summary for collapsed header
  const troopBreakdown = TROOP_TYPES.filter((t) => me.militaryAtHome[t] > 0)
    .map((t) => `${t.charAt(0).toUpperCase()}:${me.militaryAtHome[t]}`)
    .join(" ");

  return (
    <div className={`game-controls${controlsDisabled ? " turn-ended" : ""}`}>
      {/* SCREEN EDGE FLASH ON ATTACK */}
      {hit && <div className="attack-flash-overlay" />}

      {/* STICKY HP BAR */}
      <div className="hp-bar-sticky">
        <div className={`hp-bar-wrapper${hit ? " hp-hit" : ""}`}>
          <div
            className={`hp-bar-fill${hpPct <= 30 ? " hp-low" : ""}`}
            style={{ width: `${hpPct}%` }}
          />
          <span className="hp-label">
            {Math.ceil(me.hp)} / {me.maxHp} HP
          </span>
        </div>
      </div>

      {/* STATS HEADER */}
      <div className="stats-header" style={{ borderTopColor: me.color }}>
        <div className="city-name">{me.name}</div>

        <div className="stats-columns">
          <div className="stats-col-pop">
            <span className="stats-col-value">
              👥 {pop}
              {housingCap < Infinity ? `/${housingCap}` : ""}{" "}
              <span className="stats-idle">({unassigned} idle)</span>
            </span>
            <div
              className={`stats-row-warning${pop >= housingCap ? "" : " hidden"}`}
            >
              ⚠ Max reached, upgrade housing
            </div>
            <div className={`stats-row-warning${netFood < 0 ? "" : " hidden"}`}>
              ⚠ {netFood < 0 ? Math.floor(me.food / Math.abs(netFood)) : 0}{" "}
              turns of food left
            </div>
          </div>
          <div className="stats-col-cp">
            <span className="stats-col-value">⚔️ {totalCombatPower}</span>
            <span className="stats-col-subtitle">Combat Power at Home</span>
            <div className="stats-upgrade-levels">
              <div className="stats-upgrade-row">
                <span className="stats-upgrade-item">
                  🌾 {me.upgradesCompleted.farming}/
                  {UPGRADE_PROGRESS.farming.length}
                </span>
                <span className="stats-upgrade-item">
                  ⛏ {me.upgradesCompleted.mining}/
                  {UPGRADE_PROGRESS.mining.length}
                </span>
                <span className="stats-upgrade-item">
                  💰 {me.upgradesCompleted.trade}/
                  {UPGRADE_PROGRESS.trade.length}
                </span>
              </div>
              <div className="stats-upgrade-row">
                <span className="stats-upgrade-item">
                  🏛 {me.upgradesCompleted.culture}/
                  {UPGRADE_PROGRESS.culture.length}
                </span>
                <span className="stats-upgrade-item">
                  🛡 {me.upgradesCompleted.walls}/
                  {UPGRADE_PROGRESS.walls.length}
                </span>
                <span className="stats-upgrade-item">
                  ⚔ {me.upgradesCompleted.military}/
                  {UPGRADE_PROGRESS.military.length}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ====== POPULATION SECTION ====== */}
      <div className="upgrades-section section-population">
        <button
          className="section-header"
          onClick={() => toggleSection("population")}
        >
          <span
            className={`section-chevron${expandedSections.population ? " section-chevron-open" : ""}`}
          >
          </span>
          <span className="section-header-title">👥 Population</span>
          <span className="section-header-summary">
            <span className="summary-stockpile">
              👥 {pop}
              {housingCap < Infinity ? `/${housingCap}` : ""}
            </span>
            <span
              className={`summary-rate${!isFed ? " rate-negative" : " rate-positive"}`}
            >
              {isFed
                ? `+${Math.round(effectiveGrowthRate * 100)}%`
                : `-${Math.round(POP_STARVATION_RATE * 100)}%`}
              /t
            </span>
          </span>
        </button>

        <div
          className={`section-body${expandedSections.population ? "" : " collapsed"}`}
        >
          <div className="section-body-inner">
            {/* Growth multiplier */}
            <div className="stats-row-growth">
              <span
                className={`pop-growth-projection${!isFed ? " rate-negative" : ""}`}
              >
                👥 {pop} → {projectedPop} (
                {isFed
                  ? `+${Math.round(effectiveGrowthRate * 100)}%`
                  : `-${Math.round(POP_STARVATION_RATE * 100)}%`}
                )
              </span>
              <div className="stats-growth-buttons">
                {(VALID_GROWTH_MULTIPLIERS as readonly number[]).map((m) => (
                  <button
                    key={m}
                    className={`growth-multiplier-btn${localGrowthMultiplier === m ? " active" : ""}`}
                    onClick={() => handleSetGrowthMultiplier(m)}
                    disabled={controlsDisabled}
                  >
                    {m}x
                  </button>
                ))}
              </div>
            </div>

            <p className="section-explainer">
              When fed: population grows {Math.round(POP_GROWTH_RATE * 100)}% ×
              multiplier per turn. At {localGrowthMultiplier}x, each citizen
              eats {FOOD_PER_CITIZEN * localGrowthMultiplier} food/turn and pop
              grows {Math.round(effectiveGrowthRate * 100)}%.
            </p>
            <p className="section-explainer">
              When starving (food &lt; consumption): lose{" "}
              {Math.round(POP_STARVATION_RATE * 100)}% pop/turn.
            </p>
            <p className="section-explainer">
              Population is capped by housing level. Upgrade housing to raise
              the cap.
            </p>

            {/* Housing upgrade */}
            <BuildProgressBlock
              category="housing"
              me={me}
              localBuilders={localBuilders}
              onAdjustBuilder={adjustBuilder}
              onUnlockUpgrade={handleUnlockUpgrade}
              unassigned={unassigned}
              controlsDisabled={controlsDisabled}
              unlockCost={getUnlockCost("housing")}
              progressBarClass="population-progress-fill"
              buildingLabel="Building Housing"
              maxLabel="All housing upgrades completed! (Uncapped)"
              unlockLabel="🏠 Unlock Housing Upgrade"
              effectText={
                <>
                  Cap: {housingCap} →{" "}
                  {me.upgradesCompleted.housing + 1 < HOUSING_POP_CAPS.length
                    ? HOUSING_POP_CAPS[me.upgradesCompleted.housing + 1]
                    : "Uncapped"}
                </>
              }
            />
          </div>
        </div>
      </div>

      {/* ====== FARMING SECTION ====== */}
      <div className="upgrades-section section-farming">
        <button
          className="section-header"
          onClick={() => toggleSection("farming")}
        >
          <span
            className={`section-chevron${expandedSections.farming ? " section-chevron-open" : ""}`}
          >
          </span>
          <span className="section-header-title">🌾 Farming</span>
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div
            className="section-header-workers"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="worker-btn"
              {...farmersMinusHold}
              disabled={localFarmers <= 0 || controlsDisabled}
            >
              -
            </button>
            <span className="worker-count">{localFarmers}</span>
            <button
              className="worker-btn"
              {...farmersPlusHold}
              disabled={unassigned <= 0 || controlsDisabled}
            >
              +
            </button>
          </div>
          <span className="section-header-summary">
            <span className="summary-stockpile">🌾 {Math.floor(me.food)}</span>
            <span
              className={`summary-rate${netFood < 0 ? " rate-negative" : " rate-positive"}`}
            >
              {netFood >= 0 ? "+" : ""}
              {netFood}/t
            </span>
          </span>
        </button>

        <div
          className={`section-body${expandedSections.farming ? "" : " collapsed"}`}
        >
          <div className="section-body-inner">
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
                <span>
                  - Consumed ({pop} pop ×{" "}
                  {FOOD_PER_CITIZEN * localGrowthMultiplier})
                </span>
                <span className="rate-negative">-{foodConsumed}</span>
              </div>
              <div
                className={`food-breakdown-line food-breakdown-net${netFood < 0 ? " rate-negative" : ""}`}
              >
                <span>= Net</span>
                <span>
                  {netFood >= 0 ? "+" : ""}
                  {netFood}/turn
                </span>
              </div>
            </div>

            <p className="section-explainer">
              Each citizen eats {FOOD_PER_CITIZEN} food/turn at 1x. Higher
              multipliers consume more food but grow population faster. Starving
              cities lose {Math.round(POP_STARVATION_RATE * 100)}% pop/turn.
            </p>

            <BuildProgressBlock
              category="farming"
              me={me}
              localBuilders={localBuilders}
              onAdjustBuilder={adjustBuilder}
              onUnlockUpgrade={handleUnlockUpgrade}
              unassigned={unassigned}
              controlsDisabled={controlsDisabled}
              unlockCost={getUnlockCost("farming")}
              progressBarClass="farming-progress-fill"
              maxLabel={`All farming upgrades completed! (${farmingMult}x yield)`}
              unlockLabel="📜 Unlock Farming Upgrade"
              effectText={
                <>
                  🌾 Yield: {farmingMult}x → {farmingMult + 1}x
                </>
              }
              explainerText={
                <>
                  Yield: {FOOD_PER_FARMER} x {farmingMult} ={" "}
                  {FOOD_PER_FARMER * farmingMult}/farmer →{" "}
                  {FOOD_PER_FARMER * (farmingMult + 1)}/farmer
                </>
              }
            />
          </div>
        </div>
      </div>

      {/* ====== MINING SECTION ====== */}
      <div className="upgrades-section section-mining">
        <button
          className="section-header"
          onClick={() => toggleSection("mining")}
        >
          <span
            className={`section-chevron${expandedSections.mining ? " section-chevron-open" : ""}`}
          >
          </span>
          <span className="section-header-title">🪨 Mining</span>
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div
            className="section-header-workers"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="worker-btn"
              {...minersMinusHold}
              disabled={localMiners <= 0 || controlsDisabled}
            >
              -
            </button>
            <span className="worker-count">{localMiners}</span>
            <button
              className="worker-btn"
              {...minersPlusHold}
              disabled={unassigned <= 0 || controlsDisabled}
            >
              +
            </button>
          </div>
          <span className="section-header-summary">
            <span className="summary-stockpile">
              🪨 {Math.floor(me.materials)}
            </span>
            <span className="summary-rate rate-positive">
              +{materialsPerTurn}/t
            </span>
          </span>
        </button>

        <div
          className={`section-body${expandedSections.mining ? "" : " collapsed"}`}
        >
          <div className="section-body-inner">
            <div className="resource-row">
              <span className="resource-label">Per miner</span>
              <span className="resource-rate">
                +{MATERIALS_PER_MINER * miningMult}🪨/turn
              </span>
            </div>

            <BuildProgressBlock
              category="mining"
              me={me}
              localBuilders={localBuilders}
              onAdjustBuilder={adjustBuilder}
              onUnlockUpgrade={handleUnlockUpgrade}
              unassigned={unassigned}
              controlsDisabled={controlsDisabled}
              unlockCost={getUnlockCost("mining")}
              progressBarClass="mining-progress-fill"
              maxLabel={`All mining upgrades completed! (${miningMult}x yield)`}
              unlockLabel="📜 Unlock Mining Upgrade"
              effectText={
                <>
                  🪨 Yield: {miningMult}x → {miningMult + 1}x
                </>
              }
              explainerText={
                <>
                  Yield: {MATERIALS_PER_MINER} x {miningMult} ={" "}
                  {MATERIALS_PER_MINER * miningMult}/miner →{" "}
                  {MATERIALS_PER_MINER * (miningMult + 1)}/miner
                </>
              }
            />
          </div>
        </div>
      </div>

      {/* ====== TRADE SECTION ====== */}
      <div className="upgrades-section section-trade">
        <button
          className="section-header"
          onClick={() => toggleSection("trade")}
        >
          <span
            className={`section-chevron${expandedSections.trade ? " section-chevron-open" : ""}`}
          >
          </span>
          <span className="section-header-title">💰 Trade</span>
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div
            className="section-header-workers"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="worker-btn"
              {...merchantsMinusHold}
              disabled={localMerchants <= 0 || controlsDisabled}
            >
              -
            </button>
            <span className="worker-count">{localMerchants}</span>
            <button
              className="worker-btn"
              {...merchantsPlusHold}
              disabled={unassigned <= 0 || controlsDisabled}
            >
              +
            </button>
          </div>
          <span className="section-header-summary">
            <span className="summary-stockpile">💰 {Math.floor(me.gold)}</span>
            <span className="summary-rate rate-positive">+{goldPerTurn}/t</span>
          </span>
        </button>

        <div
          className={`section-body${expandedSections.trade ? "" : " collapsed"}`}
        >
          <div className="section-body-inner">
            <div className="resource-row">
              <span className="resource-label">Per merchant</span>
              <span className="resource-rate">
                +{GOLD_PER_MERCHANT * tradeMult}💰/turn
              </span>
            </div>

            <BuildProgressBlock
              category="trade"
              me={me}
              localBuilders={localBuilders}
              onAdjustBuilder={adjustBuilder}
              onUnlockUpgrade={handleUnlockUpgrade}
              unassigned={unassigned}
              controlsDisabled={controlsDisabled}
              unlockCost={getUnlockCost("trade")}
              progressBarClass="trade-progress-fill"
              maxLabel={`All trade upgrades completed! (${tradeMult}x yield)`}
              unlockLabel="📜 Unlock Trade Upgrade"
              effectText={
                <>
                  💰 Yield: {tradeMult}x → {tradeMult + 1}x
                </>
              }
              explainerText={
                <>
                  Yield: {GOLD_PER_MERCHANT} x {tradeMult} ={" "}
                  {GOLD_PER_MERCHANT * tradeMult}/merchant →{" "}
                  {GOLD_PER_MERCHANT * (tradeMult + 1)}/merchant
                </>
              }
            />
          </div>
        </div>
      </div>

      {/* CULTURE & UPGRADES */}
      <div className="upgrades-section section-culture">
        <button
          className="section-header"
          onClick={() => toggleSection("culture")}
        >
          <span
            className={`section-chevron${expandedSections.culture ? " section-chevron-open" : ""}`}
          >
          </span>
          <span className="section-header-title">🏛️ Culture</span>
          <span className="section-header-summary">
            <span className="summary-detail">
              Lvl {me.upgradeLevel.culture} · {completedCulture} built
            </span>
            {completedCulture > 0 && (
              <span className="summary-rate rate-positive">
                +{completedCulture * MONUMENT_CULTURE_PER_TURN}/t
              </span>
            )}
          </span>
        </button>

        {/* Culture progress bar — always visible */}
        <div className="culture-bar-wrapper">
          <div
            className="culture-bar-fill"
            style={{ width: `${culturePct}%` }}
          />
          <span className="culture-label">
            🏛️ {Math.floor(me.culture)} / {CULTURE_WIN_THRESHOLD}
          </span>
        </div>

        <div
          className={`section-body${expandedSections.culture ? "" : " collapsed"}`}
        >
          <div className="section-body-inner">
            {completedCulture > 0 && (
              <div className="resource-row" style={{ marginTop: 4 }}>
                <span className="resource-label">Culture/turn</span>
                <span className="resource-amount">
                  {Math.floor(me.culture)}
                </span>
                <span className="resource-rate">
                  +{completedCulture * MONUMENT_CULTURE_PER_TURN}/turn
                </span>
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
              unlockCost={getUnlockCost("culture")}
              maxLabel="All upgrades completed!"
              effectText={
                <>
                  Level {me.upgradeLevel.culture} →{" "}
                  {me.upgradeLevel.culture + 1}
                </>
              }
            />
          </div>
        </div>
      </div>

      {/* WALLS */}
      <div className="upgrades-section section-walls">
        <button
          className="section-header"
          onClick={() => toggleSection("walls")}
        >
          <span
            className={`section-chevron${expandedSections.walls ? " section-chevron-open" : ""}`}
          >
          </span>
          <span className="section-header-title">🧱 Walls</span>
          <span className="section-header-summary">
            <span className="summary-detail">{me.maxHp} max HP</span>
            <span className="summary-rate rate-positive">
              +{Math.ceil(me.maxHp * HP_REGEN_PERCENT)}/t regen
            </span>
          </span>
        </button>

        <div
          className={`section-body${expandedSections.walls ? "" : " collapsed"}`}
        >
          <div className="section-body-inner">
            <div className="resource-row">
              <span className="resource-label">City HP</span>
              <span className="resource-rate">
                {Math.ceil(me.hp)} / {me.maxHp}
              </span>
            </div>
            <div className="resource-row">
              <span className="resource-label">HP Regen</span>
              <span className="resource-rate">
                +{Math.ceil(me.maxHp * HP_REGEN_PERCENT)}/turn (3% of max)
              </span>
            </div>

            <BuildProgressBlock
              category="walls"
              me={me}
              localBuilders={localBuilders}
              onAdjustBuilder={adjustBuilder}
              onUnlockUpgrade={handleUnlockUpgrade}
              unassigned={unassigned}
              controlsDisabled={controlsDisabled}
              unlockCost={getUnlockCost("walls")}
              progressBarClass="walls-progress-fill"
              unlockBtnClass="upgrade-walls"
              buildingLabel="Building Fortification"
              maxLabel={`All fortifications completed! (${me.maxHp} max HP)`}
              unlockLabel="📜 Unlock Fortification"
              effectText={
                <>
                  +{WALLS_HP_PER_LEVEL[me.upgradesCompleted.walls] ?? "?"}{" "}
                  max HP
                </>
              }
              explainerText={
                <>
                  Reward: +{WALLS_HP_PER_LEVEL[me.upgradesCompleted.walls]}{" "}
                  max HP (→{" "}
                  {me.maxHp +
                    WALLS_HP_PER_LEVEL[me.upgradesCompleted.walls]}{" "}
                  total)
                </>
              }
            />
          </div>
        </div>
      </div>

      {/* MILITARY */}
      <div className="upgrades-section section-military">
        <button
          className="section-header"
          onClick={() => toggleSection("military")}
        >
          <span
            className={`section-chevron${expandedSections.military ? " section-chevron-open" : ""}`}
          >
          </span>
          <span className="section-header-title">⚔️ Military</span>
          <span className="section-header-summary">
            <span className="summary-detail">
              {totalMilitary} troops · {civilians} civ
            </span>
            {troopBreakdown && (
              <span className="summary-breakdown">{troopBreakdown}</span>
            )}
          </span>
        </button>

        <div
          className={`section-body${expandedSections.military ? "" : " collapsed"}`}
        >
          <div className="section-body-inner">
            {/* Troop training — all types, locked ones faded */}
            <div className="troop-sections">
              {TROOP_TYPES.map((type, troopIndex) => {
                const isUnlocked =
                  troopIndex === 0 ||
                  me.upgradesCompleted.military >= troopIndex;
                const isNext =
                  !isUnlocked &&
                  troopIndex === me.upgradesCompleted.military + 1;
                const config = TRAINING_CONFIG[type];
                const count = me.militaryAtHome[type];
                const canAfford = me.gold >= config.gold;

                // Build slot state for the next-to-unlock card
                const hasBuildSlot =
                  isNext &&
                  me.upgradeLevel.military > me.upgradesCompleted.military;
                const required = hasBuildSlot
                  ? UPGRADE_PROGRESS.military[me.upgradesCompleted.military]
                  : 0;
                const remaining = required - me.upgradeProgress.military;

                return (
                  <div
                    key={type}
                    className={`troop-card${isUnlocked || isNext ? "" : " troop-card-locked"}`}
                  >
                    <span className="troop-count">
                      {isUnlocked ? count : "🔒"}
                    </span>
                    <span className="troop-name">
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </span>
                    <span className="troop-cp">CP: {COMBAT_POWER[type]}</span>
                    {isUnlocked && (
                      <button
                        className="troop-buy-btn"
                        onClick={() => handleSpendMilitary(type)}
                        disabled={!canAfford || controlsDisabled}
                        title={!canAfford ? "Not enough 💰" : ""}
                      >
                        <span className="troop-buy-label">
                          Buy {config.troops}
                        </span>
                        <span className="troop-buy-cost">{config.gold}💰</span>
                      </button>
                    )}
                    {isNext &&
                      !hasBuildSlot &&
                      (() => {
                        const milCost = getUnlockCost("military");
                        return (
                          <button
                            className="troop-buy-btn troop-unlock-btn"
                            onClick={() => handleUnlockUpgrade("military")}
                            disabled={
                              me.materials < milCost || controlsDisabled
                            }
                          >
                            <span className="troop-buy-label">Unlock</span>
                            <span className="troop-buy-cost">{milCost}🪨</span>
                          </button>
                        );
                      })()}
                    {hasBuildSlot && (
                      <div className="troop-build-progress">
                        <div className="build-progress-bar-wrapper">
                          <div
                            className="build-progress-bar-fill military-progress-fill"
                            style={{
                              width: `${Math.min(100, (me.upgradeProgress.military / required) * 100)}%`,
                            }}
                          />
                          <span className="build-progress-bar-text">
                            <span>
                              {me.upgradeProgress.military}/{required}
                            </span>
                            {localBuilders.military > 0 && (
                              <span>
                                ~
                                {Math.ceil(
                                  remaining /
                                    (localBuilders.military *
                                      PROGRESS_PER_BUILDER),
                                )}{" "}
                                turns
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="troop-build-info">
                          <span className="builder-label">Builders</span>
                          <div className="section-header-workers">
                            <button
                              className="worker-btn"
                              onClick={() => adjustBuilder("military", -1)}
                              disabled={
                                localBuilders.military <= 0 || controlsDisabled
                              }
                            >
                              -
                            </button>
                            <span className="worker-count">
                              {localBuilders.military}
                            </span>
                            <button
                              className="worker-btn"
                              onClick={() => adjustBuilder("military", 1)}
                              disabled={
                                unassigned <= 0 ||
                                controlsDisabled ||
                                localBuilders.military >= remaining
                              }
                            >
                              +
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <hr className="section-divider" />

            {/* Military action buttons */}
            <div className="military-actions">
              <button
                className="military-action-btn military-action-attack"
                onClick={() =>
                  setSelectedTarget({
                    id: "",
                    name: "Attack",
                    color: "#c84555",
                    isPromisedLand: false,
                    action: "attack",
                  })
                }
                disabled={controlsDisabled || totalMilitary === 0}
              >
                <span className="military-action-icon">⚔️</span>
                <span className="military-action-label">Attack</span>
              </button>
              <button
                className="military-action-btn military-action-defend"
                onClick={() =>
                  setSelectedTarget({
                    id: me.playerId,
                    name: "Defend City",
                    color: "#3498db",
                    isPromisedLand: false,
                    isDefend: true,
                    action: "defend",
                  })
                }
                disabled={controlsDisabled || totalMilitary === 0}
              >
                <span className="military-action-icon">🛡️</span>
                <span className="military-action-label">Defend</span>
              </button>
              <button
                className="military-action-btn military-action-alliance"
                onClick={() =>
                  setSelectedTarget({
                    id: "",
                    name: "Alliance",
                    color: "#2ecc71",
                    isPromisedLand: false,
                    action: "alliance",
                  })
                }
                disabled={controlsDisabled || totalMilitary === 0}
              >
                <span className="military-action-icon">🤝</span>
                <span className="military-action-label">Alliance</span>
              </button>
              <button
                className="military-action-btn military-action-promised"
                onClick={() =>
                  setSelectedTarget({
                    id: PROMISED_LAND_ID,
                    name: "The Promised Land",
                    color: "#f4d03f",
                    isPromisedLand: true,
                    action: "promised-land",
                  })
                }
                disabled={controlsDisabled || totalMilitary === 0}
              >
                <span className="military-action-icon">👑</span>
                <span className="military-action-label">Promised Land</span>
              </button>
            </div>

            <hr className="section-divider" />
          </div>
        </div>
      </div>

      {/* TROOPS IN TRANSIT + DEFENDING — interactive management */}
      {(myTransit.length > 0 || hasDefendingTroops) && (
        <div className="upgrades-section section-troops">
          <button
            className="section-header"
            onClick={() => toggleSection("troops")}
          >
            <span
              className={`section-chevron${expandedSections.troops ? " section-chevron-open" : ""}`}
            >
            </span>
            <span className="section-header-title">🚶 Troop Management</span>
            <span className="section-header-summary">
              <span className="summary-detail">
                {myTransit.length > 0 &&
                  `${myTransit.length} in transit`}
                {myTransit.length > 0 && hasDefendingTroops && " · "}
                {hasDefendingTroops &&
                  `${defendingTypes.length} defending`}
              </span>
            </span>
          </button>

          <div
            className={`section-body${expandedSections.troops ? "" : " collapsed"}`}
          >
            <div className="section-body-inner">
              {myTransit.map((tg) => {
                const isReturning = tg.attackerPlayerId === tg.targetPlayerId;
                const isPaused = tg.paused;
                const targetName =
                  tg.targetPlayerId === PROMISED_LAND_ID
                    ? "The Promised Land"
                    : isReturning
                      ? "Home"
                      : (roomState.players.find(
                          (p) => p.playerId === tg.targetPlayerId,
                        )?.name ?? "?");

                // Redirect targets: alive players (excluding self and current target) + Promised Land
                const redirectTargets = [
                  ...roomState.players.filter(
                    (p) =>
                      p.alive &&
                      p.playerId !== playerId &&
                      p.playerId !== tg.targetPlayerId,
                  ),
                ];
                const canRedirectToLand =
                  tg.targetPlayerId !== PROMISED_LAND_ID && !tg.isDonation;

                return (
                  <div
                    key={tg.id}
                    className={`troop-manage-row${isPaused ? " troop-paused" : ""}`}
                  >
                    <div className="troop-manage-info">
                      <span className="troop-manage-units">
                        {tg.units} {tg.troopType}
                      </span>
                      <span className="troop-manage-target">
                        {isReturning
                          ? tg.defendOnArrival
                            ? "← Defend"
                            : "← Home"
                          : tg.isDonation
                            ? `🎁 → ${targetName}`
                            : `→ ${targetName}`}
                        {isPaused && " (PAUSED)"}
                      </span>
                      <span className="troop-manage-eta">
                        {isPaused ? "Paused" : `${tg.turnsRemaining}t`}
                      </span>
                    </div>

                    <div className="troop-manage-actions">
                      <button
                        className="troop-action-btn"
                        onClick={() =>
                          isPaused
                            ? handleResumeTroops(tg.id)
                            : handlePauseTroops(tg.id)
                        }
                        disabled={controlsDisabled}
                      >
                        {isPaused ? "Resume" : "Pause"}
                      </button>
                      {!isReturning && (
                        <>
                          <button
                            className="troop-action-btn"
                            onClick={() => handleRecallTroops(tg.id)}
                            disabled={controlsDisabled}
                          >
                            Recall
                          </button>
                          <button
                            className="troop-action-btn"
                            onClick={() => handleRecallTroopsToDefend(tg.id)}
                            disabled={controlsDisabled}
                          >
                            Defend
                          </button>
                        </>
                      )}
                      {isReturning && (
                        <button
                          className="troop-action-btn"
                          onClick={() =>
                            handleToggleDefendOnArrival(
                              tg.id,
                              !!tg.defendOnArrival,
                            )
                          }
                          disabled={controlsDisabled}
                        >
                          {tg.defendOnArrival ? "Defending" : "Defend"}
                        </button>
                      )}
                      {(redirectTargets.length > 0 || canRedirectToLand) && (
                        <select
                          className="troop-redirect-select"
                          value=""
                          onChange={(e) => {
                            if (e.target.value)
                              handleRedirectTroops(tg.id, e.target.value);
                          }}
                          disabled={controlsDisabled}
                        >
                          <option value="">Redirect...</option>
                          {canRedirectToLand && (
                            <option value={PROMISED_LAND_ID}>
                              The Promised Land
                            </option>
                          )}
                          {redirectTargets.map((t) => (
                            <option key={t.playerId} value={t.playerId}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

              {/* Defending troops — shown as manageable rows */}
              {hasDefendingTroops && (
                <div className="troop-manage-list">
                  <div
                    className="transit-row"
                    style={{ fontWeight: 700, marginTop: myTransit.length > 0 ? 8 : 0 }}
                  >
                    Defending
                  </div>
                  {defendingTypes.map((type) => {
                    const units = me.militaryDefending[type];
                    const defendRedirectTargets = roomState.players.filter(
                      (p) => p.alive && p.playerId !== playerId,
                    );
                    return (
                      <div key={type} className="troop-manage-row">
                        <div className="troop-manage-info">
                          <span className="troop-manage-units">
                            {units} {type}
                          </span>
                          <span className="troop-manage-target">
                            Defending
                          </span>
                          <span className="troop-manage-eta">
                            {units * COMBAT_POWER[type]} CP
                          </span>
                        </div>
                        <div className="troop-manage-actions">
                          <button
                            className="troop-action-btn"
                            onClick={() =>
                              handleRecallDefenders(units, type)
                            }
                            disabled={controlsDisabled}
                          >
                            Recall
                          </button>
                          {(defendRedirectTargets.length > 0) && (
                            <select
                              className="troop-redirect-select"
                              value=""
                              onChange={(e) => {
                                if (e.target.value)
                                  handleSendAttack(
                                    e.target.value,
                                    units,
                                    type,
                                    true,
                                  );
                              }}
                              disabled={controlsDisabled}
                            >
                              <option value="">Send to...</option>
                              <option value={PROMISED_LAND_ID}>
                                The Promised Land
                              </option>
                              {defendRedirectTargets.map((t) => (
                                <option
                                  key={t.playerId}
                                  value={t.playerId}
                                >
                                  {t.name}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
          </div>
        </div>
      )}

      {/* SIEGE STATUS */}
      {(() => {
        const mySieges = (roomState.occupyingTroops ?? []).filter(
          (occ) => occ.attackerPlayerId === playerId,
        );
        const siegesOnMe = (roomState.occupyingTroops ?? []).filter(
          (occ) => occ.targetPlayerId === playerId,
        );
        return (
          <>
            {mySieges.length > 0 && (
              <div className="transit-indicator">
                <div className="transit-row" style={{ fontWeight: 700 }}>
                  Your Occupying Forces
                </div>
                {mySieges.map((occ) => {
                  const isLand = occ.targetPlayerId === PROMISED_LAND_ID;
                  const targetName = isLand
                    ? "The Promised Land"
                    : (roomState.players.find(
                        (p) => p.playerId === occ.targetPlayerId,
                      )?.name ?? "?");
                  const occRedirectTargets = roomState.players.filter(
                    (p) =>
                      p.alive &&
                      p.playerId !== playerId &&
                      p.playerId !== occ.targetPlayerId,
                  );
                  const canRedirectToLand =
                    occ.targetPlayerId !== PROMISED_LAND_ID;
                  return (
                    <div
                      key={occ.id}
                      className="transit-row"
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span>
                        {occ.units} {occ.troopType}{" "}
                        {isLand ? "at" : "besieging"} {targetName}
                        {!isLand &&
                          ` (${occ.units * COMBAT_POWER[occ.troopType]} dmg/turn)`}
                      </span>
                      <span
                        style={{
                          display: "flex",
                          gap: 4,
                          alignItems: "center",
                        }}
                      >
                        <button
                          className="troop-action-btn"
                          onClick={() => handleRecallOccupyingTroops(occ.id)}
                          disabled={controlsDisabled}
                          style={{ fontSize: 11 }}
                        >
                          Recall
                        </button>
                        <button
                          className="troop-action-btn"
                          onClick={() =>
                            handleRecallOccupyingTroopsToDefend(occ.id)
                          }
                          disabled={controlsDisabled}
                          style={{ fontSize: 11 }}
                        >
                          Defend
                        </button>
                        {(occRedirectTargets.length > 0 ||
                          canRedirectToLand) && (
                          <select
                            className="troop-redirect-select"
                            value=""
                            onChange={(e) => {
                              if (e.target.value)
                                handleRedirectOccupyingTroops(
                                  occ.id,
                                  e.target.value,
                                );
                            }}
                            disabled={controlsDisabled}
                            style={{ fontSize: 11 }}
                          >
                            <option value="">Redirect...</option>
                            {canRedirectToLand && (
                              <option value={PROMISED_LAND_ID}>
                                The Promised Land
                              </option>
                            )}
                            {occRedirectTargets.map((t) => (
                              <option key={t.playerId} value={t.playerId}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {siegesOnMe.length > 0 && (
              <div
                className="transit-indicator"
                style={{ borderColor: "#e74c3c" }}
              >
                <div
                  className="transit-row"
                  style={{ fontWeight: 700, color: "#e74c3c" }}
                >
                  Under Siege!
                </div>
                {siegesOnMe.map((occ) => {
                  const attackerName =
                    roomState.players.find(
                      (p) => p.playerId === occ.attackerPlayerId,
                    )?.name ?? "?";
                  return (
                    <div
                      key={occ.id}
                      className="transit-row"
                      style={{ color: "#e74c3c" }}
                    >
                      {occ.units} {occ.troopType} from {attackerName} (
                      {occ.units * COMBAT_POWER[occ.troopType]} dmg/turn)
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
        <div className="end-turn-resources">
          <span>
            🌾 {Math.floor(me.food)}{" "}
            <span className={netFood < 0 ? "rate-negative" : "rate-positive"}>
              {netFood >= 0 ? "+" : ""}
              {netFood}/t
            </span>
          </span>
          <span>
            🪨 {Math.floor(me.materials)}{" "}
            <span className="rate-positive">+{materialsPerTurn}/t</span>
          </span>
          <span>
            💰 {Math.floor(me.gold)}{" "}
            <span className="rate-positive">+{goldPerTurn}/t</span>
          </span>
        </div>
        <button
          className={`end-turn-btn${hasEndedTurn ? " ended" : unassigned > 0 ? " idle-warning" : ""}`}
          onClick={() => {
            if (unassigned > 0) {
              if (
                !window.confirm(
                  `You have ${unassigned} unallocated population. They will be assigned to farming. End turn?`,
                )
              )
                return;
            }
            handleEndTurn();
          }}
          disabled={hasEndedTurn || isResolving}
        >
          {isResolving
            ? "Resolving..."
            : hasEndedTurn
              ? "Waiting for others..."
              : unassigned > 0
                ? `End Turn (${unassigned} idle)`
                : "End Turn"}
        </button>
      </div>

      {/* Target action modal (Attack / Donate / Defend) */}
      {selectedTarget && (
        <TargetModal
          target={selectedTarget}
          me={me}
          controlsDisabled={controlsDisabled}
          targets={targets}
          onAttack={handleSendAttack}
          onDonate={handleSendDonation}
          onDefend={handleSendDefend}
          onRecall={handleRecallDefenders}
          onSelectTarget={(t) =>
            setSelectedTarget((prev) =>
              prev
                ? {
                    ...prev,
                    id: t.playerId,
                    name: t.name,
                    color: t.color,
                    hp: t.hp,
                  }
                : null,
            )
          }
          onClose={() => setSelectedTarget(null)}
        />
      )}
    </div>
  );
}
