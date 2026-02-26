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

    socket.on('room:state', handleState);
    socket.on('room:error', handleError);

    return () => {
      socket.off('room:state', handleState);
      socket.off('room:error', handleError);
    };
  }, [socket]);

  const clearError = useCallback(() => setError(null), []);

  return { roomState, error, clearError, socket };
}
