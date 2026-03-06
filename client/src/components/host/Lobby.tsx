import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { RoomStatePayload, GameSettings } from '../../../../shared/types';
import { INITIAL_FOOD, INITIAL_MATERIALS, INITIAL_GOLD } from '../../../../shared/constants';

interface LobbyProps {
  roomState: RoomStatePayload;
  onStart: (settings: GameSettings) => void;
}

export default function Lobby({ roomState, onStart }: LobbyProps) {
  const joinUrl = `${window.location.origin}/join?room=${roomState.roomId}`;
  const hasPlayers = roomState.players.length > 0;

  const [initialGold, setInitialGold] = useState(INITIAL_GOLD);
  const [initialMaterials, setInitialMaterials] = useState(INITIAL_MATERIALS);
  const [initialFood, setInitialFood] = useState(INITIAL_FOOD);

  const handleStart = () => {
    onStart({ initialGold, initialMaterials, initialFood });
  };

  return (
    <div className="host-lobby">
      <h1 className="host-title">CityWars</h1>

      <div className="room-code-section">
        <p className="room-code-label">Room Code</p>
        <p className="room-code">{roomState.roomId}</p>
      </div>

      <div className="qr-wrapper">
        <QRCodeSVG
          value={joinUrl}
          size={180}
          bgColor="#16213e"
          fgColor="#ffffff"
          level="M"
        />
        <p className="qr-hint">Scan to join</p>
      </div>

      <div className="player-list-section">
        <h2 className="player-list-title">
          Players ({roomState.players.length})
        </h2>
        {roomState.players.length === 0 ? (
          <p className="waiting-text">Waiting for players to join...</p>
        ) : (
          <div className="player-chips">
            {roomState.players.map((p) => (
              <span
                key={p.playerId}
                className={`player-chip ${p.connected ? '' : 'disconnected'}`}
              >
                {p.name}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="game-settings-section">
        <h2 className="game-settings-title">Game Settings</h2>
        <div className="settings-row">
          <label className="setting-item">
            <span className="setting-label">Gold</span>
            <input
              type="number"
              className="setting-input"
              min={0}
              max={999}
              value={initialGold}
              onChange={(e) => setInitialGold(Math.min(999, Math.max(0, Number(e.target.value) || 0)))}
            />
          </label>
          <label className="setting-item">
            <span className="setting-label">Materials</span>
            <input
              type="number"
              className="setting-input"
              min={0}
              max={999}
              value={initialMaterials}
              onChange={(e) => setInitialMaterials(Math.min(999, Math.max(0, Number(e.target.value) || 0)))}
            />
          </label>
          <label className="setting-item">
            <span className="setting-label">Food</span>
            <input
              type="number"
              className="setting-input"
              min={0}
              max={999}
              value={initialFood}
              onChange={(e) => setInitialFood(Math.min(999, Math.max(0, Number(e.target.value) || 0)))}
            />
          </label>
        </div>
      </div>

      <button
        className="btn btn-primary btn-large"
        onClick={handleStart}
        disabled={!hasPlayers}
      >
        {hasPlayers ? 'Start Game' : 'Need at least 1 player'}
      </button>
    </div>
  );
}
