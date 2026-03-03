import { useEffect, useRef, useState } from 'react';
import { useRoomState } from '../hooks/useRoomState';
import Lobby from '../components/host/Lobby';
import BattleMap from '../components/host/BattleMap';
import '../styles/host.css';

const STORAGE_KEY = 'party_game_host_room';

export default function HostPage() {
  const { roomState, error, socket } = useRoomState();
  const [creating, setCreating] = useState(false);
  const didInit = useRef(false);

  useEffect(() => {
    if (!didInit.current) {
      didInit.current = true;

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
    }

    // Handle attach failure: if we get an error about room not found, create a new one
    // Registered outside the guard so it survives StrictMode cleanup/remount
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
        <div className="battle-screen">
          <div className="battle-header">
            <h2 className="host-title battle-title">CityWars</h2>
            <span className="battle-turn-info">
              Turn {roomState.turnNumber} &middot; {roomState.subPhase === 'resolving' ? 'Resolving' : 'Planning'}
            </span>
            <span className="battle-alive-count">
              {roomState.players.filter((p) => p.alive).length} cities remaining
            </span>
          </div>
          <div className="battle-map-container">
            <BattleMap
              players={roomState.players}
              troopsInTransit={roomState.troopsInTransit}
              occupyingTroops={roomState.occupyingTroops ?? []}
              animate={true}
              subPhase={roomState.subPhase}
              turnNumber={roomState.turnNumber}
              promisedLandOwnerId={roomState.promisedLandOwnerId}
              promisedLandHoldTurns={roomState.promisedLandHoldTurns ?? 0}
            />
            {roomState.subPhase === 'resolving' && (
              <div className="resolving-overlay">
                <span className="resolving-text">Resolving Turn {roomState.turnNumber}...</span>
              </div>
            )}
          </div>
        </div>
      )}

      {roomState.phase === 'gameover' && (() => {
        const winner = roomState.winnerPlayerId
          ? roomState.players.find((p) => p.playerId === roomState.winnerPlayerId) ?? null
          : null;
        return (
          <div className="battle-screen">
            <div className="battle-map-container">
              <BattleMap
                players={roomState.players}
                troopsInTransit={[]}
                occupyingTroops={[]}
                animate={false}
              />
              <div className="gameover-overlay">
                <h2 className="host-title">Game Over</h2>
                {winner && (
                  <p className="gameover-winner-text">
                    Winner: <strong style={{ color: winner.color }}>{winner.name}</strong>
                  </p>
                )}
                <button className="btn btn-primary btn-large" onClick={handlePlayAgain}>
                  Play Again
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
