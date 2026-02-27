import { useEffect, useRef, useState, useMemo } from 'react';
import type { CityPlayerInfo, TroopGroup } from '../../../../shared/types';
import { MONUMENT_WIN_COUNT } from '../../../../shared/constants';
// 16-frame horizontal strip: frames 0-7 walk, 8-15 attack, each 32×32px at 100ms
const TROOP_FRAMES = Array.from({ length: 16 }, (_, i) => ({ x: i * 32, y: 0, w: 32, h: 32 }));
const TROOP_SHEET = { w: 512, h: 32 };
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

function TroopSprite({
  pos,
  units,
  frameIndex,
  isAttacking,
  facingLeft,
}: {
  pos: { x: number; y: number };
  units: number;
  frameIndex: number;
  isAttacking: boolean;
  facingLeft: boolean;
}) {
  const cx = pos.x * 1000;
  const cy = pos.y * 1000;
  const fi = isAttacking ? (8 + (frameIndex % 8)) : (frameIndex % 8);
  const frame = TROOP_FRAMES[fi];
  const scale = TROOP_DISPLAY_SIZE / frame.w;
  const flipTransform = facingLeft ? `translate(${2 * cx}, 0) scale(-1, 1)` : undefined;

  return (
    <g>
      <g transform={flipTransform}>
        <svg
          x={cx - TROOP_DISPLAY_SIZE / 2}
          y={cy - TROOP_DISPLAY_SIZE / 2}
          width={TROOP_DISPLAY_SIZE}
          height={TROOP_DISPLAY_SIZE}
          overflow="hidden"
        >
          <image
            href="/blue-warrior-ss.png"
            x={-frame.x * scale}
            y={0}
            width={TROOP_SHEET.w * scale}
            height={TROOP_SHEET.h * scale}
          />
        </svg>
      </g>
      <text
        x={cx}
        y={cy + TROOP_DISPLAY_SIZE / 2 + 14}
        textAnchor="middle"
        fontSize={14}
        fontWeight="700"
        fill="white"
        stroke="black"
        strokeWidth={3}
        paintOrder="stroke"
      >
        {units}
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
      {/* Player name */}
      <text
        x={cx}
        y={cy - 54}
        textAnchor="middle"
        fontSize={22}
        fontWeight="700"
        fill={player.color}
      >
        {player.name}
      </text>

      {/* HP bar track */}
      <rect
        x={cx - BAR_W / 2}
        y={cy - 43}
        width={BAR_W}
        height={10}
        rx={4}
        fill="#1f2e50"
      />
      {/* HP bar fill */}
      <rect
        x={cx - BAR_W / 2}
        y={cy - 43}
        width={BAR_W * hpPct}
        height={10}
        rx={4}
        fill={hpPct <= 0.3 ? '#e74c3c' : '#2ecc71'}
      />
      {/* HP label */}
      <text
        x={cx}
        y={cy - 36}
        textAnchor="middle"
        fontSize={9}
        fill="white"
        fontWeight="600"
      >
        {Math.ceil(player.hp)}/{player.maxHp}
      </text>

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

      {/* Troops at home */}
      <text
        x={cx}
        y={cy + 9}
        textAnchor="middle"
        fontSize={24}
        fontWeight="800"
        fill="white"
      >
        {player.militaryAtHome}
      </text>

      {/* Population */}
      <text
        x={cx}
        y={cy + 46}
        textAnchor="middle"
        fontSize={13}
        fill="#8899b0"
      >
        {`👥 ${Math.floor(player.population)}  ⚔️ ${player.militaryAtHome}`}
      </text>

      {/* Resources */}
      <text
        x={cx}
        y={cy + 60}
        textAnchor="middle"
        fontSize={12}
        fill="#8899b0"
      >
        {`R:${Math.floor(player.resources)} F:${Math.floor(player.food)} G:${Math.floor(player.gold)}`}
      </text>

      {/* Income rates */}
      <text
        x={cx}
        y={cy + 74}
        textAnchor="middle"
        fontSize={11}
        fill="#2ecc71"
      >
        {`+${player.resourcesIncome} +${player.foodIncome} +${player.goldIncome.toFixed(1)}/s`}
      </text>

      {/* Monument progress */}
      {player.monuments > 0 && (
        <>
          <rect
            x={cx - BAR_W / 2}
            y={cy + 80}
            width={BAR_W}
            height={6}
            rx={3}
            fill="#2a1a3e"
          />
          <rect
            x={cx - BAR_W / 2}
            y={cy + 80}
            width={BAR_W * Math.min(1, player.monuments / MONUMENT_WIN_COUNT)}
            height={6}
            rx={3}
            fill="#9b59b6"
          />
          <text
            x={cx}
            y={cy + 96}
            textAnchor="middle"
            fontSize={11}
            fill="#9b59b6"
          >
            {`🏛️ ${player.monuments}/${MONUMENT_WIN_COUNT} monuments`}
          </text>
        </>
      )}
    </g>
  );
}

export default function BattleMap({ players, troopsInTransit, animate }: BattleMapProps) {
  const playerMap = useMemo(
    () => new Map(players.map((p) => [p.playerId, p])),
    [players],
  );

  const [troopPositions, setTroopPositions] = useState<Map<string, { x: number; y: number; facingLeft: boolean }>>(
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
      const positions = new Map<string, { x: number; y: number; facingLeft: boolean }>();

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

        if (now >= troop.arrivalAtMs) {
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
          const t = Math.max(0, (now - troop.departedAtMs) / (troop.arrivalAtMs - troop.departedAtMs));
          positions.set(troop.id, {
            x: attacker.x + dx * t,
            y: attacker.y + dy * t,
            facingLeft,
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
      setFrameIndex(Math.floor((now % (TROOP_FRAMES.length * 100)) / 100));
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

      {/* Walking troops */}
      {troopsInTransit.map((troop) => {
        const posData = troopPositions.get(troop.id);
        if (!posData) return null;
        return (
          <TroopSprite
            key={troop.id}
            pos={posData}
            units={troop.units}
            frameIndex={frameIndex}
            isAttacking={false}
            facingLeft={posData.facingLeft}
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
        />
      ))}

      {/* Cities — rendered last so they paint over troop lines */}
      {players.map((player, index) => (
        <CityNode key={player.playerId} player={player} playerIndex={index} />
      ))}
    </svg>
  );
}
