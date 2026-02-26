import { useEffect, useState } from 'react';
import { useRoomState } from '../hooks/useRoomState';
import Lobby from '../components/host/Lobby';
import '../styles/host.css';

const STORAGE_KEY = 'party_game_host_room';

export default function HostPage() {
  const { roomState, error, socket } = useRoomState();
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    // Try to reattach to an existing room
    const savedRoomId = localStorage.getItem(STORAGE_KEY);
    if (savedRoomId) {
      socket.emit('host:attach_room', { roomId: savedRoomId });
    } else {
      // Create a new room
      setCreating(true);
      socket.emit('host:create_room', (roomId: string) => {
        localStorage.setItem(STORAGE_KEY, roomId);
        setCreating(false);
      });
    }

    // Handle attach failure: if we get an error about room not found, create a new one
    const handleError = (data: { message: string }) => {
      if (data.message === 'Room not found') {
        localStorage.removeItem(STORAGE_KEY);
        setCreating(true);
        socket.emit('host:create_room', (roomId: string) => {
          localStorage.setItem(STORAGE_KEY, roomId);
          setCreating(false);
        });
      }
    };

    socket.on('room:error', handleError);
    return () => {
      socket.off('room:error', handleError);
    };
  }, [socket]);

  // Save roomId whenever we get state
  useEffect(() => {
    if (roomState?.roomId) {
      localStorage.setItem(STORAGE_KEY, roomState.roomId);
    }
  }, [roomState?.roomId]);

  const handleStart = () => {
    if (!roomState) return;
    socket.emit('host:start_game', { roomId: roomState.roomId });
  };

  const handlePlayAgain = () => {
    if (!roomState) return;
    socket.emit('host:reset_room', { roomId: roomState.roomId });
  };

  if (creating || !roomState) {
    return (
      <div className="host-container">
        <div className="loading">
          <h1 className="host-title">CityWars</h1>
          <p>Creating room...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="host-container">
      {error && <div className="error-banner">{error}</div>}

      {roomState.phase === 'lobby' && (
        <Lobby roomState={roomState} onStart={handleStart} />
      )}

      {roomState.phase === 'playing' && (
        <div className="loading">
          <h2 className="host-title">Battle in Progress</h2>
          <p>{roomState.players.filter((p) => p.alive).length} cities remaining</p>
        </div>
      )}

      {roomState.phase === 'gameover' && (
        <div className="loading">
          <h2 className="host-title">Game Over</h2>
          {roomState.winnerPlayerId && (
            <p>
              Winner:{' '}
              <strong style={{ color: roomState.players.find((p) => p.playerId === roomState.winnerPlayerId)?.color }}>
                {roomState.players.find((p) => p.playerId === roomState.winnerPlayerId)?.name}
              </strong>
            </p>
          )}
          <button className="btn btn-primary" style={{ marginTop: '24px' }} onClick={handlePlayAgain}>
            Play Again
          </button>
        </div>
      )}
    </div>
  );
}
