import type { RoomStatePayload } from '../../../../shared/types';

interface WaitingRoomProps {
  roomState: RoomStatePayload;
  playerName: string;
}

export default function WaitingRoom({ roomState, playerName }: WaitingRoomProps) {
  return (
    <div className="waiting-room">
      <h1 className="player-title">You're in!</h1>
      <p className="player-name-display">{playerName}</p>
      <p className="waiting-text">Waiting for the host to start the game...</p>
      <div className="player-count">
        <span className="count-number">{roomState.players.length}</span>
        <span className="count-label">
          {roomState.players.length === 1 ? 'player' : 'players'} in room
        </span>
      </div>
    </div>
  );
}
