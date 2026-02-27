import { useEffect, useRef, useState, useMemo } from 'react';
import type { CityPlayerInfo, TroopGroup, TroopType } from '../../../../shared/types';
import { CULTURE_WIN_THRESHOLD, COMBAT_POWER, TROOP_TYPES, troopGroupRadius } from '../../../../shared/constants';

interface SpriteSheetConfig {
  image: string;
  startFrame: number;   // first usable frame index (skip blank frames)
  walkFrames: number;
  attackFrames: number;
  frameWidth: number;
  sheetWidth: number;
  sheetHeight: number;
}

const SPRITE_SHEETS: Record<TroopType, SpriteSheetConfig> = {
  warrior: {
    image: '/blue-warrior-ss.png',
    startFrame: 0,
    walkFrames: 8,
    attackFrames: 8,
    frameWidth: 32,
    sheetWidth: 512,
    sheetHeight: 32,
  },
  cavalry: {
    image: '/blue-horse-ss.png',
    startFrame: 0,
    walkFrames: 6,
    attackFrames: 10,
    frameWidth: 32,
    sheetWidth: 512,
    sheetHeight: 32,
  },
  rifleman: {
    image: '/blue-soldier-rifle.png',
    startFrame: 1,       // frame 0 is blank
    walkFrames: 8,
    attackFrames: 8,
    frameWidth: 32,
    sheetWidth: 544,
    sheetHeight: 32,
  },
  truck: {
    image: '/blue-truck.png',
    startFrame: 0,
    walkFrames: 5,
    attackFrames: 11,
    frameWidth: 32,
    sheetWidth: 512,
    sheetHeight: 32,
  },
};

const TROOP_DISPLAY_SIZE = 64;
const ATTACK_STANDOFF = 0.09; // normalized coords (~90 SVG units from target center)
const ATTACK_LINGER_MS = 5000;

interface LingeringTroop {
  troop: TroopGroup;
  pos: { x: number; y: number };
  facingLeft: boolean;
}

interface BattleMapProps {
  players: CityPlayerInfo[];
  troopsInTransit: TroopGroup[];
  animate: boolean;
}

function AttackLine({
  troop,
  playerMap,
}: {
  troop: TroopGroup;
  playerMap: Map<string, CityPlayerInfo>;
}) {
  const attacker = playerMap.get(troop.attackerPlayerId);
  const target = playerMap.get(troop.targetPlayerId);
  if (!attacker || !target) return null;
  return (
    <line
      x1={attacker.x * 1000}
      y1={attacker.y * 1000}
      x2={target.x * 1000}
      y2={target.y * 1000}
      stroke={attacker.color}
      strokeWidth={1.5}
      strokeOpacity={0.3}
      strokeDasharray="8 6"
    />
  );
}

const GOLDEN_ANGLE = 2.399963; // radians

function TroopSprite({
  pos,
  units,
  frameIndex,
  isAttacking,
  facingLeft,
  troopType,
}: {
  pos: { x: number; y: number };
  units: number;
  frameIndex: number;
  isAttacking: boolean;
  facingLeft: boolean;
  troopType: TroopType;
}) {
  const sheet = SPRITE_SHEETS[troopType];
  const cx = pos.x * 1000;
  const cy = pos.y * 1000;
  const scale = TROOP_DISPLAY_SIZE / sheet.frameWidth;
  const clusterRadius = units <= 1 ? 0 : 15 + Math.sqrt(units) * 8;

  const sprites = [];
  for (let i = 0; i < units; i++) {
    // Golden angle spiral for even distribution
    const angle = i * GOLDEN_ANGLE;
    const r = units <= 1 ? 0 : Math.sqrt((i + 0.5) / units) * clusterRadius;
    const sx = cx + r * Math.cos(angle);
    const sy = cy + r * Math.sin(angle);

    // Stagger frames slightly per unit for visual variety
    let fi: number;
    if (isAttacking) {
      fi = sheet.startFrame + sheet.walkFrames + ((frameIndex + i) % sheet.attackFrames);
    } else {
      fi = sheet.startFrame + ((frameIndex + i) % sheet.walkFrames);
    }
    const frameX = fi * sheet.frameWidth;
    const flipTransform = facingLeft ? `translate(${2 * sx}, 0) scale(-1, 1)` : undefined;

    sprites.push(
      <g key={i} transform={flipTransform}>
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
      </g>,
    );
  }

  return (
    <g>
      {sprites}
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
    </g>
  );
}

const CASTLE_IMAGES = ['/red_castle_1.png', '/blue_castle_1.png', '/green_castle_1.png'];

function CityNode({ player, playerIndex }: { player: CityPlayerInfo; playerIndex: number }) {
  const cx = player.x * 1000;
  const cy = player.y * 1000;
  const hpPct = player.maxHp > 0 ? player.hp / player.maxHp : 0;
  const isDead = !player.alive;
  const BAR_W = 120;
  const HALF = 28;

  return (
    <g opacity={isDead ? 0.35 : 1}>
      {/* HP bar track */}
      <rect
        x={cx - BAR_W / 2}
        y={cy - 75}
        width={BAR_W}
        height={16}
        rx={4}
        fill="#1f2e50"
        stroke="black"
        strokeWidth={2}
      />
      {/* HP bar fill */}
      <rect
        x={cx - BAR_W / 2}
        y={cy - 75}
        width={BAR_W * hpPct}
        height={16}
        rx={4}
        fill={hpPct <= 0.3 ? '#e74c3c' : '#1a8a4a'}
      />
      {/* HP label */}
      <text
        x={cx}
        y={cy - 63}
        textAnchor="middle"
        fontSize={13}
        fill="white"
        fontWeight="700"
      >
        {Math.ceil(player.hp)}/{player.maxHp}
      </text>

      {/* Combat power shield */}
      {(() => {
        const shieldCx = cx + BAR_W / 2 + 30;
        const shieldCy = cy - 67;
        const sw = 36;
        const sh = 44;
        const cp = TROOP_TYPES.reduce((s, t) => s + player.militaryAtHome[t] * COMBAT_POWER[t], 0);
        const cpStr = String(cp);
        const fs = cpStr.length <= 2 ? 18 : cpStr.length <= 3 ? 15 : cpStr.length <= 4 ? 12 : 10;
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

      {/* City — castle image for first 3 players, colored square for rest */}
      {playerIndex < CASTLE_IMAGES.length ? (
        <image
          href={CASTLE_IMAGES[playerIndex]}
          x={cx - 64}
          y={cy - 64}
          width={128}
          height={128}
          opacity={isDead ? 0.3 : 1}
        />
      ) : (
        <rect
          x={cx - HALF}
          y={cy - HALF}
          width={HALF * 2}
          height={HALF * 2}
          rx={6}
          fill={player.color}
          fillOpacity={isDead ? 0.3 : 0.85}
          stroke={player.color}
          strokeWidth={3}
        />
      )}

      {/* Stats box */}
      {(() => {
        const hasCulture = player.culture > 0;
        const BOX_W = 150;
        const BOX_H = hasCulture ? 72 : 42;
        const BOX_X = cx - BOX_W / 2;
        const BOX_Y = cy + 66;
        return (
          <>
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
              y={BOX_Y + 18}
              textAnchor="middle"
              fontSize={16}
              fontWeight="700"
              fill={player.color}
            >
              {player.name}
            </text>
            {/* Population */}
            <text
              x={cx}
              y={BOX_Y + 34}
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
                  y={BOX_Y + 42}
                  width={BOX_W - 12}
                  height={6}
                  rx={3}
                  fill="#2a1a3e"
                />
                <rect
                  x={BOX_X + 6}
                  y={BOX_Y + 42}
                  width={(BOX_W - 12) * Math.min(1, player.culture / CULTURE_WIN_THRESHOLD)}
                  height={6}
                  rx={3}
                  fill="#9b59b6"
                />
                <text
                  x={cx}
                  y={BOX_Y + 62}
                  textAnchor="middle"
                  fontSize={11}
                  fill="#c88de8"
                >
                  {`🏛️ ${player.monuments} · ${Math.floor(player.culture)}/${CULTURE_WIN_THRESHOLD}`}
                </text>
              </>
            )}
          </>
        );
      })()}
    </g>
  );
}

export default function BattleMap({ players, troopsInTransit, animate }: BattleMapProps) {
  const playerMap = useMemo(
    () => new Map(players.map((p) => [p.playerId, p])),
    [players],
  );

  const [troopPositions, setTroopPositions] = useState<Map<string, { x: number; y: number; facingLeft: boolean; isFieldCombat: boolean }>>(
    new Map(),
  );
  const [frameIndex, setFrameIndex] = useState(0);
  const [attackingTroops, setAttackingTroops] = useState<Map<string, LingeringTroop>>(new Map());
  const lingeringRef = useRef<Map<string, LingeringTroop>>(new Map());
  const rafRef = useRef<number | null>(null);

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
      const positions = new Map<string, { x: number; y: number; facingLeft: boolean; isFieldCombat: boolean }>();

      for (const troop of troopsInTransit) {
        const attacker = playerMap.get(troop.attackerPlayerId);
        const target = playerMap.get(troop.targetPlayerId);
        if (!attacker || !target) continue;

        const dx = target.x - attacker.x;
        const dy = target.y - attacker.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const nx = dist > 0 ? dx / dist : 0;
        const ny = dist > 0 ? dy / dist : 0;
        const facingLeft = dx < 0;

        // Field combat: offset from contact point by visual radius toward origin
        if (troop.fieldCombatX != null && troop.fieldCombatEndMs != null) {
          const combatFacingLeft = (target.x - troop.fieldCombatX) < 0;
          // Offset toward this troop's origin (attacker) so fronts barely touch
          const backNx = dist > 0 ? (attacker.x - target.x) / dist : 0;
          const backNy = dist > 0 ? (attacker.y - target.y) / dist : 0;
          const r = troopGroupRadius(troop.units) * 0.5;
          const renderX = troop.fieldCombatX + backNx * r;
          const renderY = troop.fieldCombatY! + backNy * r;
          if (now < troop.fieldCombatEndMs) {
            // In combat — attack animation
            positions.set(troop.id, {
              x: renderX,
              y: renderY,
              facingLeft: combatFacingLeft,
              isFieldCombat: true,
            });
          } else {
            // Combat ended, waiting for server to clear — keep attack animation
            positions.set(troop.id, {
              x: renderX,
              y: renderY,
              facingLeft: combatFacingLeft,
              isFieldCombat: true,
            });
          }
        } else if (now >= troop.arrivalAtMs) {
          if (!lingeringRef.current.has(troop.id)) {
            lingeringRef.current.set(troop.id, {
              troop,
              pos: {
                x: target.x - nx * ATTACK_STANDOFF,
                y: target.y - ny * ATTACK_STANDOFF,
              },
              facingLeft,
            });
          }
        } else {
          // Clamp t so troops stop at standoff distance from target (city edge)
          const standoffFrac = dist > 0 ? ATTACK_STANDOFF / dist : 0;
          const tRaw = (now - troop.departedAtMs) / (troop.arrivalAtMs - troop.departedAtMs);
          const t = Math.max(0, Math.min(tRaw, 1 - standoffFrac));
          positions.set(troop.id, {
            x: attacker.x + dx * t,
            y: attacker.y + dy * t,
            facingLeft,
            isFieldCombat: false,
          });
        }
      }


      for (const [id, lingering] of lingeringRef.current) {
        if (now >= lingering.troop.arrivalAtMs + ATTACK_LINGER_MS) {
          lingeringRef.current.delete(id);
        }
      }

      setTroopPositions(positions);
      setAttackingTroops(new Map(lingeringRef.current));
      setFrameIndex(Math.floor((now % 1600) / 100));
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [animate, troopsInTransit, playerMap]);

  return (
    <svg
      className="battle-map-svg"
      viewBox="0 0 1000 1000"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid meet"
    >
      <image href="/map-background.png" x="0" y="0" width="1000" height="1000" />

      {/* Attack trail lines */}
      {troopsInTransit.map((troop) => (
        <AttackLine key={troop.id} troop={troop} playerMap={playerMap} />
      ))}

      {/* Walking / field-combat troops */}
      {troopsInTransit.map((troop) => {
        const posData = troopPositions.get(troop.id);
        if (!posData) return null;
        return (
          <TroopSprite
            key={troop.id}
            pos={posData}
            units={troop.units}
            frameIndex={frameIndex}
            isAttacking={posData.isFieldCombat}
            facingLeft={posData.facingLeft}
            troopType={troop.troopType}
          />
        );
      })}

      {/* Attacking troops (linger at castle for 5s) */}
      {Array.from(attackingTroops.values()).map((lingering) => (
        <TroopSprite
          key={`attack-${lingering.troop.id}`}
          pos={lingering.pos}
          units={lingering.troop.units}
          frameIndex={frameIndex}
          isAttacking={true}
          facingLeft={lingering.facingLeft}
          troopType={lingering.troop.troopType}
        />
      ))}

      {/* Cities — rendered last so they paint over troop lines */}
      {players.map((player, index) => (
        <CityNode key={player.playerId} player={player} playerIndex={index} />
      ))}
    </svg>
  );
}
