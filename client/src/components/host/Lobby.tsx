import { QRCodeSVG } from 'qrcode.react';
import type { RoomStatePayload } from '../../../../shared/types';

interface LobbyProps {
  roomState: RoomStatePayload;
  onStart: () => void;
}

export default function Lobby({ roomState, onStart }: LobbyProps) {
  const joinUrl = `${window.location.origin}/join?room=${roomState.roomId}`;
  const hasPlayers = roomState.players.length > 0;

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

      <button
        className="btn btn-primary btn-large"
        onClick={onStart}
        disabled={!hasPlayers}
      >
        {hasPlayers ? 'Start Game' : 'Need at least 1 player'}
      </button>
    </div>
  );
}
