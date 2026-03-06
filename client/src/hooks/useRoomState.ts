import { useState, useEffect, useCallback } from 'react';
import { useSocket } from './useSocket';
import type { RoomStatePayload } from '../../../shared/types';

export function useRoomState() {
  const socket = useSocket();
  const [roomState, setRoomState] = useState<RoomStatePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleState = (state: RoomStatePayload) => {
      setRoomState(state);
      setError(null);
    };

    const handleError = (data: { message: string }) => {
      setError(data.message);
    };

    const handleTurnEnded = ({ playerId }: { playerId: string }) => {
      setRoomState(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          players: prev.players.map(p =>
            p.playerId === playerId ? { ...p, endedTurn: true } : p
          ),
        };
      });
    };

    socket.on('room:state', handleState);
    socket.on('room:error', handleError);
    socket.on('room:turn_ended', handleTurnEnded);

    return () => {
      socket.off('room:state', handleState);
      socket.off('room:error', handleError);
      socket.off('room:turn_ended', handleTurnEnded);
    };
  }, [socket]);

  const clearError = useCallback(() => setError(null), []);

  return { roomState, error, clearError, socket };
}
