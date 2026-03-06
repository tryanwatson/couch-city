import type { Server, Socket } from 'socket.io';
import type { UpgradeCategory, GameSettings } from '../../shared/types';
import {
  createRoom,
  getRoom,
  attachHost,
  addPlayer,
  chooseColor,
  disconnectSocket,
  startGame,
  allocateWorkers,
  setGrowthMultiplier,
  unlockUpgrade,
  spendMilitary,
  sendAttack,
  sendDonation,
  sendDefend,
  recallDefenders,
  endTurn,
  resetRoom,
  sanitizeState,
  setBroadcastFn,
  recallTroops,
  pauseTroops,
  resumeTroops,
  redirectTroops,
  recallOccupyingTroops,
  redirectOccupyingTroops,
  setDefendOnArrival,
} from './roomManager';
import { generateCityName, ALL_UPGRADE_CATEGORIES } from '../../shared/constants';

function broadcastRoom(io: Server, roomId: string): void {
  const room = getRoom(roomId);
  if (!room) return;
  io.to(roomId).emit('room:state', sanitizeState(room));
}

/** Send state to only the acting player's socket (not the whole room). */
function unicastPlayer(socket: Socket, roomId: string): void {
  const room = getRoom(roomId);
  if (!room) return;
  socket.emit('room:state', sanitizeState(room));
}

/** During planning, unicast to the acting player only; otherwise broadcast to all. */
function emitStateAfterAction(io: Server, socket: Socket, roomId: string): void {
  const room = getRoom(roomId);
  const isPlanning = room?.phase === 'playing' && room?.subPhase === 'planning';
  if (isPlanning) {
    unicastPlayer(socket, roomId);
  } else {
    broadcastRoom(io, roomId);
  }
}

export function registerSocketHandlers(io: Server, socket: Socket): void {
  // Inject broadcast function into roomManager so the update phase can broadcast
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
    const settings: GameSettings | undefined = data.settings
      ? {
          initialGold: Number(data.settings.initialGold),
          initialMaterials: Number(data.settings.initialMaterials),
          initialFood: Number(data.settings.initialFood),
        }
      : undefined;
    const result = startGame(data.roomId, settings);
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
    const rawName = data.name.trim().substring(0, 12);

    if (!rawName) {
      callback({ ok: false, error: 'Name cannot be empty' });
      return;
    }

    // Reconnecting players keep their existing city name; new players get one generated
    const room = getRoom(data.roomId);
    const existingPlayer = room?.players.get(playerId);
    let cityName: string;
    if (existingPlayer) {
      cityName = existingPlayer.name;
    } else {
      const existingNames = room
        ? Array.from(room.players.values()).map(p => p.name)
        : [];
      cityName = generateCityName(rawName, existingNames);
    }

    const result = addPlayer(data.roomId, playerId, cityName, socket.id);
    if (result.error) {
      callback({ ok: false, error: result.error });
      return;
    }

    socket.join(data.roomId);
    console.log(`Player "${cityName}" (${playerId}) joined room ${data.roomId}`);
    callback({ ok: true, playerId, cityName });
    emitStateAfterAction(io, socket, data.roomId);
  });

  socket.on('player:choose_color', (data) => {
    if (!data?.roomId || !data?.playerId || !data?.color) {
      socket.emit('room:error', { message: 'Missing required fields' });
      return;
    }
    const result = chooseColor(data.roomId, data.playerId, data.color);
    if (result.error) { socket.emit('room:error', { message: result.error }); return; }
    broadcastRoom(io, data.roomId);
  });

  socket.on('player:allocate_workers', (data) => {
    if (!data?.roomId || !data?.playerId || data?.farmers == null || data?.miners == null || data?.merchants == null || !data?.builders || typeof data.builders !== 'object') {
      socket.emit('room:error', { message: 'Missing required fields' });
      return;
    }
    const result = allocateWorkers(data.roomId, data.playerId, data.farmers, data.miners, data.merchants, data.builders);
    if (result.error) { socket.emit('room:error', { message: result.error }); return; }
    emitStateAfterAction(io, socket, data.roomId);
  });

  socket.on('player:set_growth_multiplier', (data) => {
    if (!data?.roomId || !data?.playerId || data?.multiplier == null) {
      socket.emit('room:error', { message: 'Missing required fields' });
      return;
    }
    const result = setGrowthMultiplier(data.roomId, data.playerId, data.multiplier);
    if (result.error) { socket.emit('room:error', { message: result.error }); return; }
    emitStateAfterAction(io, socket, data.roomId);
  });

  socket.on('player:unlock_upgrade', (data) => {
    if (!data?.roomId || !data?.playerId || !data?.category) {
      socket.emit('room:error', { message: 'Missing required fields' });
      return;
    }
    if (!ALL_UPGRADE_CATEGORIES.includes(data.category as UpgradeCategory)) {
      socket.emit('room:error', { message: 'Invalid upgrade category' });
      return;
    }
    const result = unlockUpgrade(data.roomId, data.playerId, data.category);
    if (result.error) { socket.emit('room:error', { message: result.error }); return; }
    emitStateAfterAction(io, socket, data.roomId);
  });

  socket.on('player:spend_military', (data) => {
    if (!data?.roomId || !data?.playerId || !data?.troopType) {
      socket.emit('room:error', { message: 'Missing required fields' });
      return;
    }
    const result = spendMilitary(data.roomId, data.playerId, data.troopType);
    if (result.error) { socket.emit('room:error', { message: result.error }); return; }
    emitStateAfterAction(io, socket, data.roomId);
  });

  socket.on('player:send_attack', (data) => {
    if (!data?.roomId || !data?.playerId || !data?.targetPlayerId || data?.units == null || !data?.troopType) {
      socket.emit('room:error', { message: 'Missing required fields' });
      return;
    }
    const result = sendAttack(data.roomId, data.playerId, data.targetPlayerId, data.units, data.troopType, data.fromDefending);
    if (result.error) { socket.emit('room:error', { message: result.error }); return; }
    console.log(`Player ${data.playerId} sent ${data.units} ${data.troopType} to ${data.targetPlayerId} in room ${data.roomId}`);
    emitStateAfterAction(io, socket, data.roomId);
  });

  socket.on('player:send_donation', (data) => {
    if (!data?.roomId || !data?.playerId || !data?.targetPlayerId || data?.units == null || !data?.troopType) {
      socket.emit('room:error', { message: 'Missing required fields' });
      return;
    }
    const result = sendDonation(data.roomId, data.playerId, data.targetPlayerId, data.units, data.troopType);
    if (result.error) { socket.emit('room:error', { message: result.error }); return; }
    console.log(`Player ${data.playerId} donated ${data.units} ${data.troopType} to ${data.targetPlayerId} in room ${data.roomId}`);
    emitStateAfterAction(io, socket, data.roomId);
  });

  socket.on('player:send_defend', (data) => {
    if (!data?.roomId || !data?.playerId || data?.units == null || !data?.troopType) {
      socket.emit('room:error', { message: 'Missing required fields' });
      return;
    }
    const result = sendDefend(data.roomId, data.playerId, data.units, data.troopType);
    if (result.error) { socket.emit('room:error', { message: result.error }); return; }
    emitStateAfterAction(io, socket, data.roomId);
  });

  socket.on('player:recall_defenders', (data) => {
    if (!data?.roomId || !data?.playerId || data?.units == null || !data?.troopType) {
      socket.emit('room:error', { message: 'Missing required fields' });
      return;
    }
    const result = recallDefenders(data.roomId, data.playerId, data.units, data.troopType);
    if (result.error) { socket.emit('room:error', { message: result.error }); return; }
    emitStateAfterAction(io, socket, data.roomId);
  });

  socket.on('player:recall_troops', (data) => {
    if (!data?.roomId || !data?.playerId || !data?.troopGroupId) {
      socket.emit('room:error', { message: 'Missing required fields' });
      return;
    }
    const result = recallTroops(data.roomId, data.playerId, data.troopGroupId, data.defendOnArrival);
    if (result.error) { socket.emit('room:error', { message: result.error }); return; }
    emitStateAfterAction(io, socket, data.roomId);
  });

  socket.on('player:set_defend_on_arrival', (data) => {
    if (!data?.roomId || !data?.playerId || !data?.troopGroupId || data?.defendOnArrival == null) {
      socket.emit('room:error', { message: 'Missing required fields' });
      return;
    }
    const result = setDefendOnArrival(data.roomId, data.playerId, data.troopGroupId, data.defendOnArrival);
    if (result.error) { socket.emit('room:error', { message: result.error }); return; }
    emitStateAfterAction(io, socket, data.roomId);
  });

  socket.on('player:pause_troops', (data) => {
    if (!data?.roomId || !data?.playerId || !data?.troopGroupId) {
      socket.emit('room:error', { message: 'Missing required fields' });
      return;
    }
    const result = pauseTroops(data.roomId, data.playerId, data.troopGroupId);
    if (result.error) { socket.emit('room:error', { message: result.error }); return; }
    emitStateAfterAction(io, socket, data.roomId);
  });

  socket.on('player:resume_troops', (data) => {
    if (!data?.roomId || !data?.playerId || !data?.troopGroupId) {
      socket.emit('room:error', { message: 'Missing required fields' });
      return;
    }
    const result = resumeTroops(data.roomId, data.playerId, data.troopGroupId);
    if (result.error) { socket.emit('room:error', { message: result.error }); return; }
    emitStateAfterAction(io, socket, data.roomId);
  });

  socket.on('player:redirect_troops', (data) => {
    if (!data?.roomId || !data?.playerId || !data?.troopGroupId || !data?.newTargetPlayerId) {
      socket.emit('room:error', { message: 'Missing required fields' });
      return;
    }
    const result = redirectTroops(data.roomId, data.playerId, data.troopGroupId, data.newTargetPlayerId);
    if (result.error) { socket.emit('room:error', { message: result.error }); return; }
    emitStateAfterAction(io, socket, data.roomId);
  });

  socket.on('player:recall_occupying_troops', (data) => {
    if (!data?.roomId || !data?.playerId || !data?.troopGroupId) {
      socket.emit('room:error', { message: 'Missing required fields' });
      return;
    }
    const result = recallOccupyingTroops(data.roomId, data.playerId, data.troopGroupId, data.defendOnArrival);
    if (result.error) { socket.emit('room:error', { message: result.error }); return; }
    emitStateAfterAction(io, socket, data.roomId);
  });

  socket.on('player:redirect_occupying_troops', (data) => {
    if (!data?.roomId || !data?.playerId || !data?.troopGroupId || !data?.newTargetPlayerId) {
      socket.emit('room:error', { message: 'Missing required fields' });
      return;
    }
    const result = redirectOccupyingTroops(data.roomId, data.playerId, data.troopGroupId, data.newTargetPlayerId);
    if (result.error) { socket.emit('room:error', { message: result.error }); return; }
    emitStateAfterAction(io, socket, data.roomId);
  });

  socket.on('player:end_turn', (data) => {
    if (!data?.roomId || !data?.playerId) {
      socket.emit('room:error', { message: 'Missing required fields' });
      return;
    }
    const result = endTurn(data.roomId, data.playerId);
    if (result.error) { socket.emit('room:error', { message: result.error }); return; }
    // If all players ended, runUpdatePhase() already broadcast via broadcastFn.
    // Otherwise, unicast so only this player sees their endedTurn status,
    // and notify the room (host) that this player ended their turn.
    const room = getRoom(data.roomId);
    if (room && room.subPhase === 'planning') {
      unicastPlayer(socket, data.roomId);
      io.to(data.roomId).emit('room:turn_ended', { playerId: data.playerId });
    }
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
