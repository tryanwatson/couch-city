import { useState } from "react";
import type { TroopType, CityPlayerInfo } from "../../../../shared/types";
import {
  TROOP_TYPES,
  VALID_ATTACK_AMOUNTS,
  COMBAT_POWER,
} from "../../../../shared/constants";

interface TargetInfo {
  id: string;
  name: string;
  color: string;
  hp?: number;
  isPromisedLand: boolean;
  isDefend?: boolean;
}

interface TargetModalProps {
  target: TargetInfo;
  me: CityPlayerInfo;
  controlsDisabled: boolean;
  onAttack: (targetId: string, amount: number, troopType: TroopType) => void;
  onDonate: (targetId: string, amount: number, troopType: TroopType) => void;
  onDefend: (amount: number, troopType: TroopType) => void;
  onRecall: (amount: number, troopType: TroopType) => void;
  onClose: () => void;
}

type ModalTab = "attack" | "donate";

export type { TargetInfo };

export default function TargetModal({
  target,
  me,
  controlsDisabled,
  onAttack,
  onDonate,
  onDefend,
  onRecall,
  onClose,
}: TargetModalProps) {
  const [activeTab, setActiveTab] = useState<ModalTab>("attack");

  const handleAction = (amount: number, troopType: TroopType) => {
    if (activeTab === "attack") {
      onAttack(target.id, amount, troopType);
    } else {
      onDonate(target.id, amount, troopType);
    }
  };

  // Defend mode: show troop types with atHome > 0 OR defending > 0
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

  // Attack / Donate mode
  const availableTypes = TROOP_TYPES.filter((t) => me.militaryAtHome[t] > 0);

  return (
    <div className="target-modal-backdrop" onClick={onClose}>
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
          <button className="target-modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Tabs (hidden for Promised Land) */}
        {!target.isPromisedLand && (
          <div className="target-modal-tabs">
            <button
              className={`target-modal-tab${activeTab === "attack" ? " active" : ""}`}
              onClick={() => setActiveTab("attack")}
            >
              Attack
            </button>
            <button
              className={`target-modal-tab${activeTab === "donate" ? " active" : ""}`}
              onClick={() => setActiveTab("donate")}
            >
              Donate
            </button>
          </div>
        )}

        {/* Troop rows */}
        <div className="target-modal-troops">
          {availableTypes.length === 0 && (
            <div className="target-modal-empty">No troops at home</div>
          )}
          {availableTypes.map((type) => {
            const count = me.militaryAtHome[type];
            return (
              <div key={type} className="target-modal-troop-row">
                <div className="target-modal-troop-info">
                  <span className="target-modal-troop-name">
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </span>
                  <span className="target-modal-troop-count">
                    {count} at home · CP:{COMBAT_POWER[type]}
                  </span>
                </div>
                <div className="target-modal-amounts">
                  {(VALID_ATTACK_AMOUNTS as readonly number[]).map((amount) =>
                    amount <= count ? (
                      <button
                        key={amount}
                        className={`attack-amount-btn${activeTab === "donate" ? " donate-amount-btn" : ""}`}
                        onClick={() => handleAction(amount, type)}
                        disabled={controlsDisabled}
                      >
                        {amount}
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
