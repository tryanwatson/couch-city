import type { Server, Socket } from 'socket.io';
import {
  createRoom,
  getRoom,
  attachHost,
  addPlayer,
  disconnectSocket,
  startGame,
  investIncome,
  upgradeCulture,
  buildMonument,
  spendMilitary,
  sendAttack,
  resetRoom,
  sanitizeState,
  setBroadcastFn,
} from './roomManager';
import type { IncomeType, InvestAmount } from './roomManager';

function broadcastRoom(io: Server, roomId: string): void {
  const room = getRoom(roomId);
  if (!room) return;
  io.to(roomId).emit('room:state', sanitizeState(room));
}

export function registerSocketHandlers(io: Server, socket: Socket): void {
  // Inject broadcast function into roomManager so the game tick can broadcast
  setBroadcastFn((roomId: string) => broadcastRoom(io, roomId));

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
    if (!data?.roomId) { socket.emit('room:error', { message: 'Missing roomId' }); return; }
    const room = getRoom(data.roomId);
    if (!room) { socket.emit('room:error', { message: 'Room not found' }); return; }
    if (room.hostSocketId !== socket.id) { socket.emit('room:error', { message: 'Not the host' }); return; }
    const result = startGame(data.roomId);
    if (result.error) { socket.emit('room:error', { message: result.error }); return; }
    console.log(`Game started in room: ${data.roomId}`);
    broadcastRoom(io, data.roomId);
  });

  socket.on('host:reset_room', (data) => {
    if (!data?.roomId) { socket.emit('room:error', { message: 'Missing roomId' }); return; }
    const room = getRoom(data.roomId);
    if (!room) { socket.emit('room:error', { message: 'Room not found' }); return; }
    if (room.hostSocketId !== socket.id) { socket.emit('room:error', { message: 'Not the host' }); return; }
    const result = resetRoom(data.roomId);
    if (result.error) { socket.emit('room:error', { message: result.error }); return; }
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

  socket.on('player:invest_income', (data) => {
    if (!data?.roomId || !data?.playerId || !data?.income || data?.amount == null) {
      socket.emit('room:error', { message: 'Missing required fields' });
      return;
    }
    const result = investIncome(data.roomId, data.playerId, data.income as IncomeType, data.amount as InvestAmount);
    if (result.error) { socket.emit('room:error', { message: result.error }); return; }
    broadcastRoom(io, data.roomId);
  });

  socket.on('player:upgrade_culture', (data) => {
    if (!data?.roomId || !data?.playerId) {
      socket.emit('room:error', { message: 'Missing required fields' });
      return;
    }
    const result = upgradeCulture(data.roomId, data.playerId);
    if (result.error) { socket.emit('room:error', { message: result.error }); return; }
    broadcastRoom(io, data.roomId);
  });

  socket.on('player:build_monument', (data) => {
    if (!data?.roomId || !data?.playerId) {
      socket.emit('room:error', { message: 'Missing required fields' });
      return;
    }
    const result = buildMonument(data.roomId, data.playerId);
    if (result.error) { socket.emit('room:error', { message: result.error }); return; }
    broadcastRoom(io, data.roomId);
  });

  socket.on('player:spend_military', (data) => {
    if (!data?.roomId || !data?.playerId || !data?.troopType) {
      socket.emit('room:error', { message: 'Missing required fields' });
      return;
    }
    const result = spendMilitary(data.roomId, data.playerId, data.troopType);
    if (result.error) { socket.emit('room:error', { message: result.error }); return; }
    broadcastRoom(io, data.roomId);
  });

  socket.on('player:send_attack', (data) => {
    if (!data?.roomId || !data?.playerId || !data?.targetPlayerId || data?.units == null || !data?.troopType) {
      socket.emit('room:error', { message: 'Missing required fields' });
      return;
    }
    const result = sendAttack(data.roomId, data.playerId, data.targetPlayerId, data.units, data.troopType);
    if (result.error) { socket.emit('room:error', { message: result.error }); return; }
    console.log(`Player ${data.playerId} sent ${data.units} ${data.troopType} to ${data.targetPlayerId} in room ${data.roomId}`);
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
