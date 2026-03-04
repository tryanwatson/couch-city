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
}

interface TargetModalProps {
  target: TargetInfo;
  me: CityPlayerInfo;
  controlsDisabled: boolean;
  onAttack: (targetId: string, amount: number, troopType: TroopType) => void;
  onDonate: (targetId: string, amount: number, troopType: TroopType) => void;
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
  onClose,
}: TargetModalProps) {
  const [activeTab, setActiveTab] = useState<ModalTab>("attack");

  const availableTypes = TROOP_TYPES.filter((t) => me.militaryAtHome[t] > 0);

  const handleAction = (amount: number, troopType: TroopType) => {
    if (activeTab === "attack") {
      onAttack(target.id, amount, troopType);
    } else {
      onDonate(target.id, amount, troopType);
    }
  };

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
