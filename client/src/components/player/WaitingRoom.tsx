import type { Socket } from 'socket.io-client';
import type { RoomStatePayload } from '../../../../shared/types';
import { PLAYER_COLORS } from '../../../../shared/constants';

interface WaitingRoomProps {
  roomState: RoomStatePayload;
  playerName: string;
  playerId: string;
  socket: Socket;
}

export default function WaitingRoom({ roomState, playerName, playerId, socket }: WaitingRoomProps) {
  const myPlayer = roomState.players.find(p => p.playerId === playerId);
  const myColor = myPlayer?.color || '';

  const takenColors = new Set(
    roomState.players
      .filter(p => p.playerId !== playerId && p.color)
      .map(p => p.color)
  );

  const handleColorClick = (color: string) => {
    if (takenColors.has(color) || color === myColor) return;
    socket.emit('player:choose_color', {
      roomId: roomState.roomId,
      playerId,
      color,
    });
  };

  return (
    <div className="waiting-room">
      <h1 className="player-title">You're in!</h1>
      <p className="player-name-display" style={myColor ? { color: myColor } : undefined}>
        {playerName}
      </p>

      <p className="color-picker-label">Choose your color</p>
      <div className="color-picker-grid">
        {PLAYER_COLORS.map(color => {
          const isTaken = takenColors.has(color);
          const isSelected = color === myColor;
          return (
            <button
              key={color}
              className={
                'color-circle' +
                (isSelected ? ' color-circle-selected' : '') +
                (isTaken ? ' color-circle-taken' : '')
              }
              style={{ backgroundColor: color }}
              onClick={() => handleColorClick(color)}
              disabled={isTaken}
            />
          );
        })}
      </div>

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
