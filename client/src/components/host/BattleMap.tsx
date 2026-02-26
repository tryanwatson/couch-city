import { useEffect, useRef, useState, useMemo } from 'react';
import type { CityPlayerInfo, TroopGroup } from '../../../../shared/types';

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

function TroopCircle({
  pos,
  color,
  units,
}: {
  pos: { x: number; y: number };
  color: string;
  units: number;
}) {
  return (
    <g>
      <circle
        cx={pos.x * 1000}
        cy={pos.y * 1000}
        r={16}
        fill={color}
        fillOpacity={0.9}
        stroke="white"
        strokeWidth={2}
      />
      <text
        x={pos.x * 1000}
        y={pos.y * 1000 + 5}
        textAnchor="middle"
        fontSize={14}
        fontWeight="700"
        fill="white"
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
        {`W:${Math.floor(player.wood)} F:${Math.floor(player.food)} S:${Math.floor(player.stone)} M:${Math.floor(player.metal)}`}
      </text>

      {/* Income rates */}
      <text
        x={cx}
        y={cy + 74}
        textAnchor="middle"
        fontSize={11}
        fill="#2ecc71"
      >
        {`+${player.woodIncome} +${player.foodIncome} +${player.stoneIncome} +${player.metalIncome}/s`}
      </text>

      {/* Culture progress */}
      {player.culture > 0 && (
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
            width={BAR_W * Math.min(1, player.culture / 1000)}
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
            {`🏛️ ${player.culture}/1000`}
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

  const [troopPositions, setTroopPositions] = useState<Map<string, { x: number; y: number }>>(
    new Map(),
  );
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!animate) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      setTroopPositions(new Map());
      return;
    }

    const tick = () => {
      const now = Date.now();
      const positions = new Map<string, { x: number; y: number }>();

      for (const troop of troopsInTransit) {
        const attacker = playerMap.get(troop.attackerPlayerId);
        const target = playerMap.get(troop.targetPlayerId);
        if (!attacker || !target) continue;

        const t = Math.min(
          1,
          Math.max(0, (now - troop.departedAtMs) / (troop.arrivalAtMs - troop.departedAtMs)),
        );
        positions.set(troop.id, {
          x: attacker.x + (target.x - attacker.x) * t,
          y: attacker.y + (target.y - attacker.y) * t,
        });
      }

      setTroopPositions(positions);
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
      <defs>
        <pattern id="grass" x="0" y="0" width="64" height="64" patternUnits="userSpaceOnUse">
          <image href="/grass-tile.png" x="0" y="0" width="64" height="64" />
        </pattern>
      </defs>
      <rect width="1000" height="1000" fill="url(#grass)" />

      {/* Attack trail lines */}
      {troopsInTransit.map((troop) => (
        <AttackLine key={troop.id} troop={troop} playerMap={playerMap} />
      ))}

      {/* Animated troop circles */}
      {troopsInTransit.map((troop) => {
        const pos = troopPositions.get(troop.id);
        if (!pos) return null;
        const attacker = playerMap.get(troop.attackerPlayerId);
        return (
          <TroopCircle
            key={troop.id}
            pos={pos}
            color={attacker?.color ?? '#ffffff'}
            units={troop.units}
          />
        );
      })}

      {/* Cities — rendered last so they paint over troop lines */}
      {players.map((player, index) => (
        <CityNode key={player.playerId} player={player} playerIndex={index} />
      ))}
    </svg>
  );
}
