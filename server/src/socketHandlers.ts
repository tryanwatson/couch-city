import type { Server, Socket } from 'socket.io';
import type { OptionKey } from '../../shared/types';
import {
  createRoom,
  getRoom,
  attachHost,
  addPlayer,
  disconnectSocket,
  startGame,
  submitAnswer,
  resetRoom,
  sanitizeState,
} from './roomManager';

function broadcastRoom(io: Server, roomId: string): void {
  const room = getRoom(roomId);
  if (!room) return;
  io.to(roomId).emit('room:state', sanitizeState(room));
}

export function registerSocketHandlers(io: Server, socket: Socket): void {
  // --- Host events ---

  socket.on('host:create_room', (callback) => {
    if (typeof callback !== 'function') return;
    const room = createRoom(socket.id);
    socket.join(room.roomId);
    console.log(`Room created: ${room.roomId} by ${socket.id}`);
    callback(room.roomId);
    broadcastRoom(io, room.roomId);
  });

  socket.on('host:attach_room', (data) => {
    if (!data?.roomId) {
      socket.emit('room:error', { message: 'Missing roomId' });
      return;
    }
    const room = attachHost(data.roomId, socket.id);
    if (!room) {
      socket.emit('room:error', { message: 'Room not found' });
      return;
    }
    socket.join(room.roomId);
    console.log(`Host reattached to room: ${room.roomId}`);
    broadcastRoom(io, room.roomId);
  });

  socket.on('host:start_game', (data) => {
    if (!data?.roomId) {
      socket.emit('room:error', { message: 'Missing roomId' });
      return;
    }
    const room = getRoom(data.roomId);
    if (!room) {
      socket.emit('room:error', { message: 'Room not found' });
      return;
    }
    if (room.hostSocketId !== socket.id) {
      socket.emit('room:error', { message: 'Not the host' });
      return;
    }
    const result = startGame(data.roomId);
    if (result.error) {
      socket.emit('room:error', { message: result.error });
      return;
    }
    console.log(`Game started in room: ${data.roomId}`);
    broadcastRoom(io, data.roomId);
  });

  socket.on('host:reset_room', (data) => {
    if (!data?.roomId) {
      socket.emit('room:error', { message: 'Missing roomId' });
      return;
    }
    const room = getRoom(data.roomId);
    if (!room) {
      socket.emit('room:error', { message: 'Room not found' });
      return;
    }
    if (room.hostSocketId !== socket.id) {
      socket.emit('room:error', { message: 'Not the host' });
      return;
    }
    const result = resetRoom(data.roomId);
    if (result.error) {
      socket.emit('room:error', { message: result.error });
      return;
    }
    console.log(`Room reset: ${data.roomId}`);
    broadcastRoom(io, data.roomId);
  });

  // --- Player events ---

  socket.on('player:join_room', (data, callback) => {
    if (typeof callback !== 'function') return;
    if (!data?.roomId || !data?.name) {
      callback({ ok: false, error: 'Missing roomId or name' });
      return;
    }

    const playerId = data.playerId || ('p_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36));
    const name = data.name.trim().substring(0, 20);

    if (!name) {
      callback({ ok: false, error: 'Name cannot be empty' });
      return;
    }

    const result = addPlayer(data.roomId, playerId, name, socket.id);
    if (result.error) {
      callback({ ok: false, error: result.error });
      return;
    }

    socket.join(data.roomId);
    console.log(`Player "${name}" (${playerId}) joined room ${data.roomId}`);
    callback({ ok: true, playerId });
    broadcastRoom(io, data.roomId);
  });

  socket.on('player:submit_answer', (data) => {
    if (!data?.roomId || !data?.playerId || !data?.optionKey) {
      socket.emit('room:error', { message: 'Missing required fields' });
      return;
    }

    const result = submitAnswer(data.roomId, data.playerId, data.optionKey as OptionKey);
    if (result.error) {
      socket.emit('room:error', { message: result.error });
      return;
    }

    console.log(`Player ${data.playerId} answered ${data.optionKey} in room ${data.roomId}`);
    broadcastRoom(io, data.roomId);
  });

  // --- Disconnect ---

  socket.on('disconnect', () => {
    const info = disconnectSocket(socket.id);
    if (info) {
      console.log(`Socket ${socket.id} disconnected from room ${info.roomId} (was host: ${info.wasHost})`);
      broadcastRoom(io, info.roomId);
    }
  });
}
