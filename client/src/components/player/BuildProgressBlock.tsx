import type { ReactNode } from 'react';
import type { CityPlayerInfo, UpgradeCategory } from '../../../../shared/types';
import { UPGRADE_PROGRESS, UPGRADE_UNLOCK_COST, PROGRESS_PER_BUILDER } from '../../../../shared/constants';

interface BuildProgressBlockProps {
  category: UpgradeCategory;
  me: CityPlayerInfo;
  localBuilders: Record<UpgradeCategory, number>;
  onAdjustBuilder: (category: UpgradeCategory, delta: number) => void;
  onUnlockUpgrade: (category: UpgradeCategory) => void;
  unassigned: number;
  controlsDisabled: boolean;
  canAffordUpgrade: boolean;
  progressBarClass?: string;
  unlockBtnClass?: string;
  buildingLabel?: string;
  maxLabel: string;
  unlockLabel?: string;
  effectText: ReactNode;
  explainerText?: ReactNode;
}

export default function BuildProgressBlock({
  category,
  me,
  localBuilders,
  onAdjustBuilder,
  onUnlockUpgrade,
  unassigned,
  controlsDisabled,
  canAffordUpgrade,
  progressBarClass,
  unlockBtnClass = 'upgrade-science',
  buildingLabel = 'Building Upgrade',
  maxLabel,
  unlockLabel = '📜 Unlock Upgrade',
  effectText,
  explainerText,
}: BuildProgressBlockProps) {
  const completed = me.upgradesCompleted[category];
  const hasBuildSlot = completed < me.upgradeLevel[category];
  const atMax = completed >= UPGRADE_PROGRESS[category].length;
  const canAfford = !atMax && me.upgradeLevel[category] < UPGRADE_PROGRESS[category].length && canAffordUpgrade;

  if (hasBuildSlot) {
    const required = UPGRADE_PROGRESS[category][completed];
    const remaining = required - me.upgradeProgress[category];

    return (
      <div className="build-progress-container">
        <div className="build-progress-header">
          <span>{buildingLabel} {completed + 1}</span>
          <span>{me.upgradeProgress[category]}/{required}</span>
        </div>
        <div className="build-progress-bar-wrapper">
          <div
            className={`build-progress-bar-fill${progressBarClass ? ` ${progressBarClass}` : ''}`}
            style={{ width: `${Math.min(100, (me.upgradeProgress[category] / required) * 100)}%` }}
          />
        </div>
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <div className="builder-assignment">
          <span className="builder-label">Builders</span>
          <div className="section-header-workers" onClick={e => e.stopPropagation()}>
            <button
              className="worker-btn"
              onClick={() => onAdjustBuilder(category, -1)}
              disabled={localBuilders[category] <= 0 || controlsDisabled}
            >-</button>
            <span className="worker-count">{localBuilders[category]}</span>
            <button
              className="worker-btn"
              onClick={() => onAdjustBuilder(category, 1)}
              disabled={unassigned <= 0 || controlsDisabled || localBuilders[category] >= remaining}
            >+</button>
          </div>
        </div>
        {localBuilders[category] > 0 && (
          <div className="build-eta">
            ~{Math.ceil(remaining / (localBuilders[category] * PROGRESS_PER_BUILDER))} turns remaining
          </div>
        )}
        {explainerText && <p className="section-explainer">{explainerText}</p>}
      </div>
    );
  }

  if (atMax) {
    return (
      <div className="resource-row">
        <span className="resource-label">{maxLabel}</span>
      </div>
    );
  }

  return (
    <div className="upgrade-buttons">
      <button
        className={`upgrade-btn ${unlockBtnClass}`}
        onClick={() => onUnlockUpgrade(category)}
        disabled={!canAfford || controlsDisabled}
        title={`Costs ${UPGRADE_UNLOCK_COST.materials} materials + ${UPGRADE_UNLOCK_COST.gold} gold`}
      >
        <span className="upgrade-btn-title">{unlockLabel}</span>
        <span className="upgrade-btn-cost">{UPGRADE_UNLOCK_COST.materials} materials + {UPGRADE_UNLOCK_COST.gold} gold</span>
        <span className="upgrade-btn-effect">{effectText}</span>
      </button>
    </div>
  );
}
