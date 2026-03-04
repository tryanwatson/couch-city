import { useEffect, useRef, useState, useMemo } from "react";
import type {
  CityPlayerInfo,
  TroopGroup,
  TroopType,
  PlayingSubPhase,
} from "../../../../shared/types";
import {
  CULTURE_WIN_THRESHOLD,
  COMBAT_POWER,
  TROOP_TYPES,
  RESOLVING_PHASE_DURATION_MS,
  FIELD_COMBAT_WALK_FRAC,
  FIELD_COMBAT_FIGHT_FRAC,
  FIELD_COMBAT_ADVANCE_FRAC,
  PROMISED_LAND_ID,
  PROMISED_LAND_X,
  PROMISED_LAND_Y,
  PROMISED_LAND_HOLD_TURNS,
} from "../../../../shared/constants";

interface SpriteSheetConfig {
  image: string;
  startFrame: number;
  walkFrames: number;
  attackFrames: number;
  frameWidth: number;
  sheetWidth: number;
  sheetHeight: number;
}

const SPRITE_SHEETS: Record<TroopType, SpriteSheetConfig> = {
  warrior: {
    image: "/blue-warrior-ss.png",
    startFrame: 0,
    walkFrames: 8,
    attackFrames: 8,
    frameWidth: 32,
    sheetWidth: 512,
    sheetHeight: 32,
  },
  cavalry: {
    image: "/blue-horse-ss.png",
    startFrame: 0,
    walkFrames: 6,
    attackFrames: 10,
    frameWidth: 32,
    sheetWidth: 512,
    sheetHeight: 32,
  },
  rifleman: {
    image: "/blue-soldier-rifle.png",
    startFrame: 1,
    walkFrames: 8,
    attackFrames: 8,
    frameWidth: 32,
    sheetWidth: 544,
    sheetHeight: 32,
  },
  truck: {
    image: "/blue-truck.png",
    startFrame: 0,
    walkFrames: 5,
    attackFrames: 11,
    frameWidth: 32,
    sheetWidth: 512,
    sheetHeight: 32,
  },
};

function hexToHue(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return h;
}

const SOURCE_BLUE_HUE = 207; // hue of #3498db

function hueRotationForColor(targetHex: string): number {
  return hexToHue(targetHex) - SOURCE_BLUE_HUE;
}

function pureHueRgb(hex: string): { r: number; g: number; b: number } {
  const h = hexToHue(hex) / 60;
  const x = 1 - Math.abs((h % 2) - 1);
  let r = 0,
    g = 0,
    b = 0;
  if (h < 1) {
    r = 1;
    g = x;
  } else if (h < 2) {
    r = x;
    g = 1;
  } else if (h < 3) {
    g = 1;
    b = x;
  } else if (h < 4) {
    g = x;
    b = 1;
  } else if (h < 5) {
    r = x;
    b = 1;
  } else {
    r = 1;
    b = x;
  }
  return { r, g, b };
}

const TROOP_DISPLAY_SIZE = 64;
const ATTACK_STANDOFF = 0.09;
const ATTACK_LINGER_MS = 5000;

interface BattleMapProps {
  players: CityPlayerInfo[];
  troopsInTransit: TroopGroup[];
  occupyingTroops: TroopGroup[];
  animate: boolean;
  subPhase?: PlayingSubPhase | null;
  turnNumber?: number;
  promisedLandOwnerId?: string | null;
  promisedLandHoldTurns?: number;
}

function resolveTargetPos(
  targetPlayerId: string,
  playerMap: Map<string, CityPlayerInfo>,
): { x: number; y: number } | null {
  if (targetPlayerId === PROMISED_LAND_ID)
    return { x: PROMISED_LAND_X, y: PROMISED_LAND_Y };
  const target = playerMap.get(targetPlayerId);
  return target ? { x: target.x, y: target.y } : null;
}

const GOLDEN_ANGLE = 2.399963;

function TroopSprite({
  pos,
  units,
  frameIndex,
  animTime,
  isAttacking,
  isIdle,
  facingLeft,
  troopType,
  opacity = 1,
  playerColor,
  statusIcon,
  statusColor,
}: {
  pos: { x: number; y: number };
  units: number;
  frameIndex: number;
  animTime: number;
  isAttacking: boolean;
  isIdle: boolean;
  facingLeft: boolean;
  troopType: TroopType;
  opacity?: number;
  playerColor?: string;
  statusIcon?: string;
  statusColor?: string;
}) {
  const sheet = SPRITE_SHEETS[troopType];
  const cx = pos.x * 1000;
  const cy = pos.y * 1000;
  const scale = TROOP_DISPLAY_SIZE / sheet.frameWidth;
  const clusterRadius = units <= 1 ? 0 : 15 + Math.sqrt(units) * 8;

  // Compute sprite positions first, then sort by Y for depth ordering
  const spriteData = [];
  for (let i = 0; i < units; i++) {
    const angle = i * GOLDEN_ANGLE;
    const r = units <= 1 ? 0 : Math.sqrt((i + 0.5) / units) * clusterRadius;
    const sx = cx + r * Math.cos(angle);
    const sy = cy + r * Math.sin(angle);

    let fi: number;
    if (isAttacking) {
      fi =
        sheet.startFrame +
        sheet.walkFrames +
        ((frameIndex + i) % sheet.attackFrames);
    } else if (isIdle) {
      fi = sheet.startFrame;
    } else {
      fi = sheet.startFrame + ((frameIndex + i) % sheet.walkFrames);
    }
    const breathScale = isIdle
      ? 1 + Math.sin(animTime / 200 + i * 2.3) * 0.01
      : 1;
    const frameX = fi * sheet.frameWidth;
    const flipTransform = facingLeft
      ? `translate(${2 * sx}, 0) scale(-1, 1)`
      : undefined;

    spriteData.push({ i, sx, sy, frameX, flipTransform, breathScale });
  }
  spriteData.sort((a, b) => a.sy - b.sy);

  const sprites = spriteData.map(
    ({ i, sx, sy, frameX, flipTransform, breathScale }) => (
      <g key={i} transform={flipTransform}>
        <g
          transform={
            breathScale !== 1
              ? `translate(${sx}, ${sy + TROOP_DISPLAY_SIZE / 2}) scale(1, ${breathScale}) translate(${-sx}, ${-(sy + TROOP_DISPLAY_SIZE / 2)})`
              : undefined
          }
        >
          <svg
            x={sx - TROOP_DISPLAY_SIZE / 2}
            y={sy - TROOP_DISPLAY_SIZE / 2}
            width={TROOP_DISPLAY_SIZE}
            height={TROOP_DISPLAY_SIZE}
            overflow="hidden"
          >
            <image
              href={sheet.image}
              x={-frameX * scale}
              y={0}
              width={sheet.sheetWidth * scale}
              height={sheet.sheetHeight * scale}
            />
          </svg>
        </g>
      </g>
    ),
  );

  const hueRotation = playerColor ? hueRotationForColor(playerColor) : 0;
  const filterUrl =
    Math.abs(hueRotation) > 1
      ? `url(#recolor-${playerColor!.replace("#", "")})`
      : undefined;

  return (
    <g opacity={opacity}>
      <g filter={filterUrl}>{sprites}</g>
      <text
        x={cx}
        y={cy - clusterRadius - TROOP_DISPLAY_SIZE / 2 - 4}
        textAnchor="middle"
        fontSize={18}
        fontWeight="700"
        fill="white"
        stroke="black"
        strokeWidth={3}
        paintOrder="stroke"
      >
        {units * COMBAT_POWER[troopType]}
      </text>
      {statusIcon &&
        (() => {
          const iconY = cy - clusterRadius - TROOP_DISPLAY_SIZE / 2 - 24;
          if (statusIcon === "⚔") {
            return (
              <>
                <circle
                  cx={cx}
                  cy={iconY - 5}
                  r={14}
                  fill={statusColor ?? "white"}
                  stroke="black"
                  strokeWidth={2}
                />
                <text
                  x={cx}
                  y={iconY}
                  textAnchor="middle"
                  fontSize={16}
                  fontWeight="700"
                  fill="white"
                >
                  {statusIcon}
                </text>
              </>
            );
          }
          return (
            <text
              x={cx}
              y={iconY}
              textAnchor="middle"
              fontSize={16}
              fontWeight="700"
              fill={statusColor ?? "white"}
              stroke="black"
              strokeWidth={3}
              paintOrder="stroke"
            >
              {statusIcon}
            </text>
          );
        })()}
    </g>
  );
}

function CityImageNode({
  player,
  isUnderSiege,
}: {
  player: CityPlayerInfo;
  isUnderSiege: boolean;
}) {
  const cx = player.x * 1000;
  const cy = player.y * 1000;
  const isDead = !player.alive;

  return (
    <g opacity={isDead ? 0.35 : 1}>
      {/* Siege indicator ring */}
      {isUnderSiege && !isDead && (
        <circle
          cx={cx}
          cy={cy}
          r={80}
          fill="none"
          stroke="#e74c3c"
          strokeWidth={3}
          strokeDasharray="12 8"
          opacity={0.7}
        >
          <animate
            attributeName="stroke-dashoffset"
            from="0"
            to="20"
            dur="1s"
            repeatCount="indefinite"
          />
        </circle>
      )}
      {/* City castle */}
      <image
        href="/uncolored-castle.png"
        x={cx - 64}
        y={cy - 64}
        width={128}
        height={128}
        opacity={isDead ? 0.3 : 1}
        filter={`url(#castle-${player.color.replace("#", "")})`}
      />
    </g>
  );
}

function CityInfoNode({ player }: { player: CityPlayerInfo }) {
  const cx = player.x * 1000;
  const cy = player.y * 1000;
  const isDead = !player.alive;
  const hpPct = player.maxHp > 0 ? player.hp / player.maxHp : 0;

  const hasCulture = player.culture > 0;
  const BOX_W = 180;
  const BAR_W = 120;
  const BOX_H = hasCulture ? 90 : 58;
  const BOX_X = cx - BOX_W / 2;
  const BOX_Y = cy - 70 - BOX_H;

  const cp = TROOP_TYPES.reduce(
    (s, t) => s + player.militaryDefending[t] * COMBAT_POWER[t],
    0,
  );

  return (
    <g opacity={isDead ? 0.35 : 1}>
      {/* Box background */}
      <rect
        x={BOX_X}
        y={BOX_Y}
        width={BOX_W}
        height={BOX_H}
        rx={5}
        fill="#3a3a3a"
        stroke="black"
        strokeWidth={2}
      />
      {/* Player name */}
      <text
        x={cx}
        y={BOX_Y + 16}
        textAnchor="middle"
        fontSize={14}
        fontWeight="700"
        fill={player.color}
      >
        {player.name}
      </text>
      {/* End turn indicator */}
      {player.alive && (
        <circle
          cx={cx - BAR_W / 2 - 14}
          cy={BOX_Y + 30}
          r={6}
          fill={player.endedTurn ? "#2ecc71" : "#e74c3c"}
          stroke="white"
          strokeWidth={1.5}
        />
      )}
      {/* HP bar track */}
      <rect
        x={cx - BAR_W / 2}
        y={BOX_Y + 22}
        width={BAR_W}
        height={16}
        rx={4}
        fill="#1f2e50"
        stroke="black"
        strokeWidth={1}
      />
      {/* HP bar fill */}
      <rect
        x={cx - BAR_W / 2}
        y={BOX_Y + 22}
        width={BAR_W * hpPct}
        height={16}
        rx={4}
        fill={hpPct <= 0.3 ? "#e74c3c" : "#1a8a4a"}
      />
      {/* HP label */}
      <text
        x={cx}
        y={BOX_Y + 34}
        textAnchor="middle"
        fontSize={12}
        fill="white"
        fontWeight="700"
      >
        {Math.ceil(player.hp)}/{player.maxHp}
      </text>
      {/* Combat power shield */}
      {(() => {
        const shieldCx = BOX_X + BOX_W + 30;
        const shieldCy = BOX_Y + 30;
        const sw = 36;
        const sh = 44;
        const cpStr = String(cp);
        const fs =
          cpStr.length <= 2
            ? 18
            : cpStr.length <= 3
              ? 15
              : cpStr.length <= 4
                ? 12
                : 10;
        return (
          <>
            <path
              d={`M${shieldCx},${shieldCy - sh / 2}
                  l${sw / 2},0 l${sw * 0.08},${sh * 0.15}
                  l0,${sh * 0.45} l-${sw / 2 + sw * 0.08},${sh * 0.4}
                  l-${sw / 2 + sw * 0.08},-${sh * 0.4}
                  l0,-${sh * 0.45} l${sw * 0.08},-${sh * 0.15} z`}
              fill="#3a3a3a"
              stroke="black"
              strokeWidth={2}
            />
            <text
              x={shieldCx}
              y={shieldCy + fs * 0.2}
              textAnchor="middle"
              fontSize={fs}
              fontWeight="800"
              fill="#f0c040"
            >
              {cp}
            </text>
          </>
        );
      })()}
      {/* Population */}
      <text
        x={cx}
        y={BOX_Y + 52}
        textAnchor="middle"
        fontSize={13}
        fill="white"
      >
        {`👥 ${Math.floor(player.population)}`}
      </text>
      {/* Culture progress */}
      {hasCulture && (
        <>
          <rect
            x={BOX_X + 6}
            y={BOX_Y + 60}
            width={BOX_W - 12}
            height={6}
            rx={3}
            fill="#2a1a3e"
          />
          <rect
            x={BOX_X + 6}
            y={BOX_Y + 60}
            width={
              (BOX_W - 12) *
              Math.min(1, player.culture / CULTURE_WIN_THRESHOLD)
            }
            height={6}
            rx={3}
            fill="#9b59b6"
          />
          <text
            x={cx}
            y={BOX_Y + 80}
            textAnchor="middle"
            fontSize={11}
            fill="#c88de8"
          >
            {`🏛️ ${player.upgradesCompleted.culture} · ${Math.floor(player.culture)}/${CULTURE_WIN_THRESHOLD}`}
          </text>
        </>
      )}
    </g>
  );
}

function PromisedLandNode({
  ownerColor,
  isContested,
  holdTurns,
}: {
  ownerColor: string | null;
  isContested: boolean;
  holdTurns: number;
}) {
  const cx = PROMISED_LAND_X * 1000;
  const cy = PROMISED_LAND_Y * 1000;

  return (
    <g>
      {/* Pulsing glow when held */}
      {ownerColor && !isContested && (
        <circle
          cx={cx}
          cy={cy}
          r={65}
          fill="none"
          stroke={ownerColor}
          strokeWidth={4}
          opacity={0.5}
        >
          <animate
            attributeName="r"
            values="60;70;60"
            dur="2s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            values="0.3;0.7;0.3"
            dur="2s"
            repeatCount="indefinite"
          />
        </circle>
      )}
      {/* Contested ring */}
      {isContested && (
        <circle
          cx={cx}
          cy={cy}
          r={65}
          fill="none"
          stroke="#e74c3c"
          strokeWidth={3}
          strokeDasharray="8 6"
          opacity={0.7}
        >
          <animate
            attributeName="stroke-dashoffset"
            from="0"
            to="20"
            dur="1s"
            repeatCount="indefinite"
          />
        </circle>
      )}
      {/* Radial gradient glow */}
      <defs>
        <radialGradient id="promised-land-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fffbe6" stopOpacity={0.9} />
          <stop offset="70%" stopColor="#f4d03f" stopOpacity={0.4} />
          <stop offset="100%" stopColor="#f39c12" stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={50} fill="url(#promised-land-glow)" />
      {/* Inner circle */}
      <circle
        cx={cx}
        cy={cy}
        r={35}
        fill="#1a1a2e"
        stroke="#f4d03f"
        strokeWidth={3}
      />
      {/* Crown icon */}
      <text x={cx} y={cy + 10} textAnchor="middle" fontSize={32}>
        👑
      </text>
      {/* Info box background */}
      <rect
        x={cx - 75}
        y={cy + 44}
        width={150}
        height={ownerColor && !isContested && holdTurns > 0 ? 52 : 36}
        rx={5}
        fill="#3a3a3a"
        stroke="black"
        strokeWidth={2}
      />
      {/* Label */}
      <text
        x={cx}
        y={cy + 58}
        textAnchor="middle"
        fontSize={12}
        fontWeight="700"
        fill="#f4d03f"
      >
        The Promised Land
      </text>
      {/* Status text */}
      <text
        x={cx}
        y={cy + 73}
        textAnchor="middle"
        fontSize={11}
        fill={isContested ? "#e74c3c" : ownerColor ? ownerColor : "#888"}
      >
        {isContested
          ? "Contested!"
          : ownerColor
            ? `Held ${holdTurns}/${PROMISED_LAND_HOLD_TURNS} turns`
            : "Unclaimed"}
      </text>
      {/* Progress pips */}
      {ownerColor && !isContested && holdTurns > 0 && (
        <g>
          {Array.from({ length: PROMISED_LAND_HOLD_TURNS }).map((_, i) => (
            <circle
              key={i}
              cx={cx - ((PROMISED_LAND_HOLD_TURNS - 1) * 12) / 2 + i * 12}
              cy={cy + 85}
              r={5}
              fill={i < holdTurns ? ownerColor : "#333"}
              stroke={i < holdTurns ? ownerColor : "#666"}
              strokeWidth={1}
            />
          ))}
        </g>
      )}
    </g>
  );
}

/** Calculate troop position based on turn-based progress */
function getTroopProgress(troop: TroopGroup): number {
  if (troop.totalTurns <= 0) return 1;
  return (troop.totalTurns - troop.turnsRemaining) / troop.totalTurns;
}

export default function BattleMap({
  players,
  troopsInTransit,
  occupyingTroops,
  animate,
  subPhase,
  promisedLandOwnerId,
  promisedLandHoldTurns = 0,
}: BattleMapProps) {
  const playerMap = useMemo(
    () => new Map(players.map((p) => [p.playerId, p])),
    [players],
  );

  const playerColorFilters = useMemo(() => {
    const seen = new Set<string>();
    return players
      .filter((p) => {
        if (seen.has(p.color)) return false;
        seen.add(p.color);
        return true;
      })
      .map((p) => ({
        color: p.color,
        filterId: `recolor-${p.color.replace("#", "")}`,
        hueRotation: hueRotationForColor(p.color),
      }))
      .filter((f) => Math.abs(f.hueRotation) > 1);
  }, [players]);

  const castleColorFilters = useMemo(() => {
    const seen = new Set<string>();
    return players
      .filter((p) => {
        if (seen.has(p.color)) return false;
        seen.add(p.color);
        return true;
      })
      .map((p) => {
        const { r, g, b } = pureHueRgb(p.color);
        return {
          filterId: `castle-${p.color.replace("#", "")}`,
          r,
          g,
          b,
        };
      });
  }, [players]);

  const [troopPositions, setTroopPositions] = useState<
    Map<
      string,
      {
        x: number;
        y: number;
        facingLeft: boolean;
        isAttacking: boolean;
        isIdle: boolean;
        opacity: number;
        displayUnits: number;
      }
    >
  >(new Map());
  const [frameIndex, setFrameIndex] = useState(0);
  const [animTime, setAnimTime] = useState(0);
  const rafRef = useRef<number | null>(null);

  // Track previous positions for resolving animation
  const prevPositionsRef = useRef<Map<string, { x: number; y: number }>>(
    new Map(),
  );
  const resolvingStartRef = useRef<number | null>(null);
  const prevSubPhaseRef = useRef<PlayingSubPhase | null | undefined>(null);

  // Detect transition to resolving phase
  useEffect(() => {
    if (subPhase === "resolving" && prevSubPhaseRef.current !== "resolving") {
      // Capture current positions as "before" for animation
      const prev = new Map<string, { x: number; y: number }>();
      for (const [id, pos] of troopPositions) {
        prev.set(id, { x: pos.x, y: pos.y });
      }
      prevPositionsRef.current = prev;
      resolvingStartRef.current = Date.now();
    }
    prevSubPhaseRef.current = subPhase;
  }, [subPhase, troopPositions]);

  // Lingering troops (arrived at target, attack animation)
  const lingeringRef = useRef<
    Map<
      string,
      {
        troop: TroopGroup;
        pos: { x: number; y: number };
        facingLeft: boolean;
        startMs: number;
      }
    >
  >(new Map());
  const [attackingTroops, setAttackingTroops] = useState<
    Map<
      string,
      { troop: TroopGroup; pos: { x: number; y: number }; facingLeft: boolean }
    >
  >(new Map());

  useEffect(() => {
    if (!animate) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      setTroopPositions(new Map());
      setAttackingTroops(new Map());
      lingeringRef.current.clear();
      return;
    }

    const tick = () => {
      const now = Date.now();
      const positions = new Map<
        string,
        {
          x: number;
          y: number;
          facingLeft: boolean;
          isAttacking: boolean;
          isIdle: boolean;
          opacity: number;
          displayUnits: number;
        }
      >();

      // Pre-compute mine contest state for animation decisions
      const mineOccupierPlayerIds = new Set(
        occupyingTroops
          .filter(
            (occ) => occ.targetPlayerId === PROMISED_LAND_ID && occ.units > 0,
          )
          .map((occ) => occ.attackerPlayerId),
      );

      // During resolving, animate troops from old to new positions
      const isResolving =
        subPhase === "resolving" && resolvingStartRef.current != null;
      const animProgress = isResolving
        ? Math.min(
            1,
            (now - resolvingStartRef.current!) / RESOLVING_PHASE_DURATION_MS,
          )
        : 1;

      for (const troop of troopsInTransit) {
        const attacker = playerMap.get(troop.attackerPlayerId);
        const targetPos = resolveTargetPos(troop.targetPlayerId, playerMap);
        if (!attacker || !targetPos) continue;

        const originX = troop.startX ?? attacker.x;
        const originY = troop.startY ?? attacker.y;
        const dx = targetPos.x - originX;
        const dy = targetPos.y - originY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const facingLeft = dx < 0;

        // Field combat: 3-phase animation (walk → fight → advance/fade)
        if (
          isResolving &&
          troop.fieldCombatX != null &&
          troop.fieldCombatY != null
        ) {
          const midX = troop.fieldCombatX;
          const midY = troop.fieldCombatY;
          const prevPos = prevPositionsRef.current.get(troop.id);
          const fromX = prevPos?.x ?? midX;
          const fromY = prevPos?.y ?? midY;
          const isWinner = troop.units > 0;
          const advanceX = troop.startX ?? midX;
          const advanceY = troop.startY ?? midY;
          // Face toward combat midpoint based on where troop is coming from
          const combatFacingLeft = fromX !== midX ? midX < fromX : facingLeft;

          const walkEnd = FIELD_COMBAT_WALK_FRAC;
          const fightEnd = FIELD_COMBAT_WALK_FRAC + FIELD_COMBAT_FIGHT_FRAC;

          let posX: number, posY: number;
          let attacking = false;
          let idle = false;
          let opacity = 1;
          let displayUnits = troop.fieldCombatUnits ?? troop.units;

          if (animProgress < walkEnd) {
            // Phase 1: Walk from previous position to midpoint
            const t = animProgress / walkEnd;
            posX = fromX + (midX - fromX) * t;
            posY = fromY + (midY - fromY) * t;
          } else if (animProgress < fightEnd) {
            // Phase 2: Fight at midpoint
            posX = midX;
            posY = midY;
            attacking = true;
          } else {
            // Phase 3: Winner advances to destination step; loser fades out
            const t = Math.min(
              1,
              (animProgress - fightEnd) / FIELD_COMBAT_ADVANCE_FRAC,
            );
            if (isWinner) {
              const advanceDist =
                Math.abs(advanceX - midX) + Math.abs(advanceY - midY);
              if (advanceDist < 0.001) {
                // No distance to advance (e.g. mine combat) — settle idle
                posX = midX;
                posY = midY;
                idle = true;
              } else {
                posX = midX + (advanceX - midX) * t;
                posY = midY + (advanceY - midY) * t;
              }
              displayUnits = troop.units;
            } else {
              posX = midX;
              posY = midY;
              opacity = 1 - t;
            }
          }

          positions.set(troop.id, {
            x: posX,
            y: posY,
            facingLeft: combatFacingLeft,
            isAttacking: attacking,
            isIdle: idle,
            opacity,
            displayUnits,
          });
          continue;
        }

        // Calculate current turn-based position
        const progress = getTroopProgress(troop);
        const isMineTarget = troop.targetPlayerId === PROMISED_LAND_ID;
        const isReturningHome = troop.targetPlayerId === troop.attackerPlayerId;
        const isDonation = troop.isDonation;
        const standoffFrac = dist > 0 ? ATTACK_STANDOFF / dist : 0;
        // Returning troops and donations walk all the way to the city; attackers stop at standoff distance
        const clampedProgress =
          isMineTarget || isReturningHome || isDonation
            ? progress
            : Math.min(progress, 1 - standoffFrac);

        let displayX = originX + dx * clampedProgress;
        let displayY = originY + dy * clampedProgress;

        // During resolving animation, lerp from previous position to new position
        if (isResolving && animProgress < 1) {
          const prevPos = prevPositionsRef.current.get(troop.id);
          if (prevPos) {
            displayX = prevPos.x + (displayX - prevPos.x) * animProgress;
            displayY = prevPos.y + (displayY - prevPos.y) * animProgress;
          }
        }

        // Returning troops and donations walk into their city — no lingering/attack animation
        if ((isReturningHome || isDonation) && progress >= 1 && !isResolving) {
          positions.set(troop.id, {
            x: targetPos.x,
            y: targetPos.y,
            facingLeft,
            isAttacking: false,
            isIdle: true,
            opacity: 1,
            displayUnits: troop.units,
          });
          // Check if troop has arrived (progress >= 1 - standoffFrac)
          // Mine arrivals skip lingering — they become occupying troops on the server
        } else if (
          !isMineTarget &&
          !isReturningHome &&
          !isDonation &&
          progress >= 1 - standoffFrac &&
          !isResolving
        ) {
          if (!lingeringRef.current.has(troop.id)) {
            const nx = dist > 0 ? dx / dist : 0;
            const ny = dist > 0 ? dy / dist : 0;
            lingeringRef.current.set(troop.id, {
              troop,
              pos: {
                x: targetPos.x - nx * ATTACK_STANDOFF,
                y: targetPos.y - ny * ATTACK_STANDOFF,
              },
              facingLeft,
              startMs: now,
            });
          }
        } else {
          // Mine arrivals only attack-animate when enemies are present
          const isMineArrivalContested =
            isMineTarget &&
            mineOccupierPlayerIds.size > 0 &&
            Array.from(mineOccupierPlayerIds).some(
              (id) => id !== troop.attackerPlayerId,
            );
          const inArrivalCombat =
            isResolving &&
            troop.turnsRemaining === 0 &&
            (!isMineTarget || isMineArrivalContested);
          positions.set(troop.id, {
            x: displayX,
            y: displayY,
            facingLeft,
            isAttacking: inArrivalCombat,
            isIdle:
              troop.paused ||
              !isResolving ||
              (isMineTarget &&
                troop.turnsRemaining === 0 &&
                !isMineArrivalContested &&
                animProgress >= 1),
            opacity: 1,
            displayUnits: troop.units,
          });
        }
      }

      // Clean up lingering troops
      for (const [id, lingering] of lingeringRef.current) {
        if (now >= lingering.startMs + ATTACK_LINGER_MS) {
          lingeringRef.current.delete(id);
        }
      }

      setTroopPositions(positions);
      setAttackingTroops(
        new Map(
          Array.from(lingeringRef.current.entries()).map(([id, l]) => [
            id,
            { troop: l.troop, pos: l.pos, facingLeft: l.facingLeft },
          ]),
        ),
      );
      setFrameIndex(Math.floor((now % 1600) / 100));
      setAnimTime(now);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [animate, troopsInTransit, occupyingTroops, playerMap, subPhase]);

  return (
    <svg
      className="battle-map-svg"
      viewBox="0 0 1000 1000"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        {playerColorFilters.map(({ filterId, hueRotation }) => (
          <filter key={filterId} id={filterId} colorInterpolationFilters="sRGB">
            <feColorMatrix type="hueRotate" values={String(hueRotation)} />
          </filter>
        ))}
        {castleColorFilters.map(({ filterId, r, g, b }) => (
          <filter key={filterId} id={filterId} colorInterpolationFilters="sRGB">
            <feColorMatrix type="saturate" values="0" />
            <feColorMatrix
              type="matrix"
              values={`${r * 1.3} 0 0 0 0 0 ${g * 1.3} 0 0 0 0 0 ${b * 1.3} 0 0 0 0 0 1 0`}
            />
          </filter>
        ))}
      </defs>

      <image
        href="/map-background.png"
        x="0"
        y="0"
        width="1000"
        height="1000"
      />

      {/* The Promised Land — rendered before troops so troops paint on top */}
      {(() => {
        const landPlayerIds = new Set(
          occupyingTroops
            .filter(
              (occ) => occ.targetPlayerId === PROMISED_LAND_ID && occ.units > 0,
            )
            .map((occ) => occ.attackerPlayerId),
        );
        const isContested = landPlayerIds.size > 1;
        const ownerColor = promisedLandOwnerId
          ? (playerMap.get(promisedLandOwnerId)?.color ?? null)
          : null;
        return (
          <PromisedLandNode
            ownerColor={ownerColor}
            isContested={isContested}
            holdTurns={promisedLandHoldTurns}
          />
        );
      })()}

      {/* Walking troops — sorted by Y for depth (lower on screen = closer to camera = rendered on top) */}
      {troopsInTransit
        .map((troop) => ({ troop, posData: troopPositions.get(troop.id) }))
        .filter(
          (
            entry,
          ): entry is {
            troop: TroopGroup;
            posData: NonNullable<typeof entry.posData>;
          } => entry.posData != null,
        )
        .sort((a, b) => a.posData.y - b.posData.y)
        .map(({ troop, posData }) => {
          const sIcon = troop.paused
            ? "zzz"
            : troop.targetPlayerId === troop.attackerPlayerId
              ? "🏠"
              : troop.isDonation
                ? "🎁"
                : troop.targetPlayerId === PROMISED_LAND_ID
                  ? "👑"
                  : "⚔";
          const sColor = troop.paused
            ? "#aaa"
            : troop.targetPlayerId === troop.attackerPlayerId
              ? "white"
              : troop.isDonation
                ? "#2ecc71"
                : troop.targetPlayerId === PROMISED_LAND_ID
                  ? "#f1c40f"
                  : (playerMap.get(troop.targetPlayerId)?.color ?? "white");
          return (
            <TroopSprite
              key={troop.id}
              pos={posData}
              units={posData.displayUnits}
              frameIndex={frameIndex}
              animTime={animTime}
              isAttacking={posData.isAttacking}
              isIdle={posData.isIdle}
              facingLeft={posData.facingLeft}
              troopType={troop.troopType}
              opacity={posData.opacity}
              playerColor={playerMap.get(troop.attackerPlayerId)?.color}
              statusIcon={sIcon}
              statusColor={sColor}
            />
          );
        })}

      {/* Attacking troops (linger at castle) — sorted by Y for depth */}
      {Array.from(attackingTroops.values())
        .sort((a, b) => a.pos.y - b.pos.y)
        .map((lingering) => (
          <TroopSprite
            key={`attack-${lingering.troop.id}`}
            pos={lingering.pos}
            units={lingering.troop.units}
            frameIndex={frameIndex}
            animTime={animTime}
            isAttacking={true}
            isIdle={false}
            facingLeft={lingering.facingLeft}
            troopType={lingering.troop.troopType}
            playerColor={playerMap.get(lingering.troop.attackerPlayerId)?.color}
            statusIcon="⚔"
            statusColor={
              playerMap.get(lingering.troop.targetPlayerId)?.color ?? "white"
            }
          />
        ))}

      {/* Occupying siege troops — idle at standoff distance from target city, or on mine center */}
      {/* Filter out occupiers whose ID is still in troopsInTransit (they're animating arrival) */}
      {occupyingTroops
        .filter((occ) => !troopsInTransit.some((tg) => tg.id === occ.id))
        .map((occ) => {
          const attacker = playerMap.get(occ.attackerPlayerId);
          const targetPos = resolveTargetPos(occ.targetPlayerId, playerMap);
          if (!attacker || !targetPos) return null;
          const dx = targetPos.x - attacker.x;
          const dy = targetPos.y - attacker.y;
          // Mine troops sit directly on the mine; city troops use standoff
          let pos: { x: number; y: number };
          if (occ.targetPlayerId === PROMISED_LAND_ID) {
            pos = { x: PROMISED_LAND_X, y: PROMISED_LAND_Y };
          } else {
            const dist = Math.sqrt(dx * dx + dy * dy);
            const nx = dist > 0 ? dx / dist : 0;
            const ny = dist > 0 ? dy / dist : 0;
            pos = {
              x: targetPos.x - nx * ATTACK_STANDOFF,
              y: targetPos.y - ny * ATTACK_STANDOFF,
            };
          }
          return {
            occ,
            pos,
            facingLeft: dx < 0,
            playerColor: attacker.color,
          };
        })
        .filter((e): e is NonNullable<typeof e> => e != null)
        .sort((a, b) => a.pos.y - b.pos.y)
        .map((entry) => {
          // Mine occupiers: only attack-animate when contested (multiple players at mine)
          const isMineOccupier = entry.occ.targetPlayerId === PROMISED_LAND_ID;
          const minePlayerIds = new Set(
            occupyingTroops
              .filter(
                (occ) =>
                  occ.targetPlayerId === PROMISED_LAND_ID && occ.units > 0,
              )
              .map((occ) => occ.attackerPlayerId),
          );
          const isMineContested = minePlayerIds.size > 1;
          const isAttacking = isMineOccupier
            ? subPhase === "resolving" && isMineContested
            : subPhase === "resolving";
          const sIcon = isMineOccupier ? "👑" : "⚔";
          const sColor = isMineOccupier
            ? "#f1c40f"
            : (playerMap.get(entry.occ.targetPlayerId)?.color ?? "white");
          return (
            <TroopSprite
              key={`siege-${entry.occ.id}`}
              pos={entry.pos}
              units={entry.occ.units}
              frameIndex={frameIndex}
              animTime={animTime}
              isAttacking={isAttacking}
              isIdle={!isAttacking}
              facingLeft={entry.facingLeft}
              troopType={entry.occ.troopType}
              playerColor={entry.playerColor}
              statusIcon={sIcon}
              statusColor={sColor}
            />
          );
        })}

      {/* City images — rendered before troops so troops paint on top */}
      {players.map((player) => {
        const isUnderSiege = occupyingTroops.some(
          (occ) => occ.targetPlayerId === player.playerId,
        );
        return (
          <CityImageNode
            key={player.playerId}
            player={player}
            isUnderSiege={isUnderSiege}
          />
        );
      })}

      {/* Defending troops — rendered after city images but before info boxes */}
      {players.map((player) => {
        const defendingTypes = TROOP_TYPES.filter(
          (t) => player.militaryDefending[t] > 0,
        );
        if (defendingTypes.length === 0 || !player.alive) return null;
        return defendingTypes.map((type, i) => {
          const spread = defendingTypes.length > 1
            ? (i - (defendingTypes.length - 1) / 2) * 0.03
            : 0;
          const pos = {
            x: player.x + spread,
            y: player.y + 0.04,
          };
          return (
            <TroopSprite
              key={`defend-${player.playerId}-${type}`}
              pos={pos}
              units={player.militaryDefending[type]}
              frameIndex={frameIndex}
              animTime={animTime}
              isAttacking={false}
              isIdle={true}
              facingLeft={player.x > PROMISED_LAND_X}
              troopType={type}
              playerColor={player.color}
              statusIcon="🛡"
              statusColor={player.color}
            />
          );
        });
      })}

      {/* City info boxes — rendered last so they appear on top of troops */}
      {players.map((player) => (
        <CityInfoNode key={player.playerId} player={player} />
      ))}
    </svg>
  );
}
