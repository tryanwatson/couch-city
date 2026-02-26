import { useRef } from 'react';
import { getSocket } from '../socket';
import type { Socket } from 'socket.io-client';

export function useSocket(): Socket {
  const socketRef = useRef<Socket>(getSocket());
  return socketRef.current;
}
