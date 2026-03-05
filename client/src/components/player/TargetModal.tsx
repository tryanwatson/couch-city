import { useState, useEffect } from "react";
import type { TroopType, CityPlayerInfo } from "../../../../shared/types";
import {
  TROOP_TYPES,
  VALID_ATTACK_AMOUNTS,
  COMBAT_POWER,
  ZERO_MILITARY,
} from "../../../../shared/constants";

type ModalAction = "attack" | "defend" | "alliance" | "promised-land";

interface TargetInfo {
  id: string;
  name: string;
  color: string;
  hp?: number;
  isPromisedLand: boolean;
  isDefend?: boolean;
  action?: ModalAction;
}

interface PlayerTarget {
  playerId: string;
  name: string;
  color: string;
  hp: number;
}

interface TargetModalProps {
  target: TargetInfo;
  me: CityPlayerInfo;
  controlsDisabled: boolean;
  targets: PlayerTarget[];
  onAttack: (targetId: string, amount: number, troopType: TroopType) => void;
  onDonate: (targetId: string, amount: number, troopType: TroopType) => void;
  onDefend: (amount: number, troopType: TroopType) => void;
  onRecall: (amount: number, troopType: TroopType) => void;
  onSelectTarget: (target: PlayerTarget) => void;
  onClose: () => void;
}

export type { TargetInfo };

export default function TargetModal({
  target,
  me,
  controlsDisabled,
  targets,
  onAttack,
  onDonate,
  onDefend,
  onRecall,
  onSelectTarget,
  onClose,
}: TargetModalProps) {
  const [staged, setStaged] = useState<Record<TroopType, number>>({
    ...ZERO_MILITARY,
  });

  // Clamp staged if server state changes (e.g. troops killed mid-planning)
  useEffect(() => {
    setStaged((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const t of TROOP_TYPES) {
        if (next[t] > me.militaryAtHome[t]) {
          next[t] = me.militaryAtHome[t];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [me.militaryAtHome]);

  // Derived values
  const effectiveAvailable = (type: TroopType) =>
    me.militaryAtHome[type] - staged[type];
  const totalStagedUnits = TROOP_TYPES.reduce(
    (sum, t) => sum + staged[t],
    0,
  );
  const totalStagedCP = TROOP_TYPES.reduce(
    (sum, t) => sum + staged[t] * COMBAT_POWER[t],
    0,
  );
  const hasStagedTroops = totalStagedUnits > 0;

  const isAttackMode = target.action === "attack";
  const isAllianceMode = target.action === "alliance";
  const needsTargetSelection = (isAttackMode || isAllianceMode) && !target.id;

  const handleStage = (amount: number, troopType: TroopType) => {
    const maxCanAdd = me.militaryAtHome[troopType] - staged[troopType];
    const clamped = Math.min(amount, maxCanAdd);
    if (clamped <= 0) return;
    setStaged((prev) => ({ ...prev, [troopType]: prev[troopType] + clamped }));
  };

  const handleUnstage = (amount: number, troopType: TroopType) => {
    const clamped = Math.min(amount, staged[troopType]);
    if (clamped <= 0) return;
    setStaged((prev) => ({ ...prev, [troopType]: prev[troopType] - clamped }));
  };

  const handleCommit = () => {
    const action = isAllianceMode ? onDonate : onAttack;
    for (const troopType of TROOP_TYPES) {
      if (staged[troopType] > 0) {
        action(target.id, staged[troopType], troopType);
      }
    }
    setStaged({ ...ZERO_MILITARY });
    onClose();
  };

  const handleCancel = () => {
    setStaged({ ...ZERO_MILITARY });
    onClose();
  };

  // Defend mode
  if (target.isDefend) {
    const defendTypes = TROOP_TYPES.filter(
      (t) => me.militaryAtHome[t] > 0 || me.militaryDefending[t] > 0,
    );

    return (
      <div className="target-modal-backdrop" onClick={onClose}>
        <div className="target-modal" onClick={(e) => e.stopPropagation()}>
          <div className="target-modal-header">
            <span
              className="target-color-dot"
              style={{ backgroundColor: target.color }}
            />
            <span className="target-modal-name">{target.name}</span>
            <button className="target-modal-close" onClick={onClose}>
              ✕
            </button>
          </div>

          <div className="target-modal-troops">
            {defendTypes.length === 0 && (
              <div className="target-modal-empty">No troops available</div>
            )}
            {defendTypes.map((type) => {
              const atHome = me.militaryAtHome[type];
              const defending = me.militaryDefending[type];
              return (
                <div key={type} className="target-modal-troop-row">
                  <div className="target-modal-troop-info">
                    <span className="target-modal-troop-name">
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </span>
                    <span className="target-modal-troop-count">
                      {atHome} home, {defending} defending
                    </span>
                  </div>
                  <div className="target-modal-amounts">
                    {(VALID_ATTACK_AMOUNTS as readonly number[]).map((amount) =>
                      amount <= atHome ? (
                        <button
                          key={`deploy-${amount}`}
                          className="attack-amount-btn defend-amount-btn"
                          onClick={() => onDefend(amount, type)}
                          disabled={controlsDisabled}
                        >
                          +{amount}
                        </button>
                      ) : null,
                    )}
                    {(VALID_ATTACK_AMOUNTS as readonly number[]).map((amount) =>
                      amount <= defending ? (
                        <button
                          key={`recall-${amount}`}
                          className="attack-amount-btn recall-amount-btn"
                          onClick={() => onRecall(amount, type)}
                          disabled={controlsDisabled}
                        >
                          -{amount}
                        </button>
                      ) : null,
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Target selection step (for attack/alliance when no target picked yet)
  if (needsTargetSelection) {
    const actionLabel = isAttackMode ? "⚔️ Attack" : "🤝 Alliance";
    return (
      <div className="target-modal-backdrop" onClick={onClose}>
        <div className="target-modal" onClick={(e) => e.stopPropagation()}>
          <div className="target-modal-header">
            <span className="target-modal-name">{actionLabel}</span>
            <button className="target-modal-close" onClick={onClose}>
              ✕
            </button>
          </div>
          <div className="target-modal-troops">
            {targets.length === 0 && (
              <div className="target-modal-empty">No targets available</div>
            )}
            {targets.map((t) => (
              <button
                key={t.playerId}
                className="target-picker-row"
                onClick={() => onSelectTarget(t)}
              >
                <span
                  className="target-color-dot"
                  style={{ backgroundColor: t.color }}
                />
                <span className="target-picker-name">{t.name}</span>
                <span className="target-picker-hp">
                  {Math.ceil(t.hp)} HP
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Attack / Alliance / Promised Land — troop staging
  const availableTypes = TROOP_TYPES.filter((t) => me.militaryAtHome[t] > 0);
  const actionLabel = isAllianceMode ? "Alliance" : "Attack";
  const sendLabel = isAllianceMode ? "Send Alliance" : "Send Attack";

  return (
    <div
      className="target-modal-backdrop"
      onClick={() => {
        if (!hasStagedTroops) onClose();
      }}
    >
      <div className="target-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="target-modal-header">
          <span
            className="target-color-dot"
            style={{ backgroundColor: target.color }}
          />
          <span className="target-modal-name">{target.name}</span>
          {target.hp != null && (
            <span className="target-modal-hp">
              {Math.ceil(target.hp)} HP
            </span>
          )}
          <button className="target-modal-close" onClick={handleCancel}>
            ✕
          </button>
        </div>

        {/* Troop rows */}
        <div className="target-modal-troops">
          {availableTypes.length === 0 && (
            <div className="target-modal-empty">No troops at home</div>
          )}
          {availableTypes.map((type) => {
            const available = effectiveAvailable(type);
            const stagedCount = staged[type];
            return (
              <div key={type} className="target-modal-troop-row">
                <div className="target-modal-troop-info">
                  <span className="target-modal-troop-name">
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </span>
                  <span className="target-modal-troop-count">
                    {available} available · CP:{COMBAT_POWER[type]}
                    {stagedCount > 0 && (
                      <span className="staged-count">
                        {" "}· {stagedCount} staged
                      </span>
                    )}
                  </span>
                </div>
                <div className="target-modal-amounts">
                  {stagedCount > 0 &&
                    (VALID_ATTACK_AMOUNTS as readonly number[]).map((amount) =>
                      amount <= stagedCount ? (
                        <button
                          key={`unstage-${amount}`}
                          className="attack-amount-btn unstage-amount-btn"
                          onClick={() => handleUnstage(amount, type)}
                          disabled={controlsDisabled}
                        >
                          -{amount}
                        </button>
                      ) : null,
                    )}
                  {(VALID_ATTACK_AMOUNTS as readonly number[]).map((amount) =>
                    amount <= available ? (
                      <button
                        key={`stage-${amount}`}
                        className={`attack-amount-btn${isAllianceMode ? " donate-amount-btn" : ""}`}
                        onClick={() => handleStage(amount, type)}
                        disabled={controlsDisabled}
                      >
                        +{amount}
                      </button>
                    ) : null,
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Staging footer */}
        {hasStagedTroops && (
          <div className="target-modal-footer">
            <div className="target-modal-staging-summary">
              <span className="staging-total-label">
                {actionLabel} total:
              </span>
              <span className="staging-total-value">
                {totalStagedUnits} units · {totalStagedCP} CP
              </span>
            </div>
            <div className="target-modal-footer-actions">
              <button
                className="target-modal-cancel-btn"
                onClick={handleCancel}
              >
                Cancel
              </button>
              <button
                className={`target-modal-send-btn${isAllianceMode ? " donate-send-btn" : ""}`}
                onClick={handleCommit}
                disabled={controlsDisabled}
              >
                {sendLabel}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
