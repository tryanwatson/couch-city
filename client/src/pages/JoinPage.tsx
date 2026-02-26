import { useEffect, useState } from 'react';
import { useRoomState } from '../hooks/useRoomState';
import JoinForm from '../components/player/JoinForm';
import WaitingRoom from '../components/player/WaitingRoom';
import AnswerButtons from '../components/player/AnswerButtons';
import Submitted from '../components/player/Submitted';
import PlayerResults from '../components/player/PlayerResults';
import type { OptionKey } from '../../../shared/types';
import '../styles/player.css';

const PLAYER_ID_KEY = 'party_game_player_id';
const ROOM_ID_KEY = 'party_game_player_room';
const NAME_KEY = 'party_game_player_name';

function getOrCreatePlayerId(): string {
  let id = localStorage.getItem(PLAYER_ID_KEY);
  if (!id) {
    id = 'p_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    localStorage.setItem(PLAYER_ID_KEY, id);
  }
  return id;
}

export default function JoinPage() {
  const { roomState, error, clearError, socket } = useRoomState();
  const [playerId] = useState(getOrCreatePlayerId);
  const [joined, setJoined] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [submittedKey, setSubmittedKey] = useState<OptionKey | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Attempt reconnection on mount
  useEffect(() => {
    const savedRoom = localStorage.getItem(ROOM_ID_KEY);
    const savedName = localStorage.getItem(NAME_KEY);
    if (savedRoom && savedName) {
      socket.emit(
        'player:join_room',
        { roomId: savedRoom, playerId, name: savedName },
        (result: { ok: boolean; playerId?: string; error?: string }) => {
          if (result.ok) {
            setJoined(true);
            setPlayerName(savedName);
          } else {
            // Room gone, clear saved data
            localStorage.removeItem(ROOM_ID_KEY);
            localStorage.removeItem(NAME_KEY);
          }
        }
      );
    }
  }, [socket, playerId]);

  // Reset submitted answer when phase changes back to question (new round)
  useEffect(() => {
    if (roomState?.phase === 'question') {
      // Check if we already answered this question
      // (handles page refresh during question phase)
    }
    if (roomState?.phase === 'lobby') {
      setSubmittedKey(null);
    }
  }, [roomState?.phase]);

  const handleJoin = (roomId: string, name: string) => {
    setJoinError(null);
    clearError();
    socket.emit(
      'player:join_room',
      { roomId, playerId, name },
      (result: { ok: boolean; playerId?: string; error?: string }) => {
        if (result.ok) {
          setJoined(true);
          setPlayerName(name);
          localStorage.setItem(ROOM_ID_KEY, roomId);
          localStorage.setItem(NAME_KEY, name);
        } else {
          setJoinError(result.error || 'Failed to join');
        }
      }
    );
  };

  const handleAnswer = (optionKey: OptionKey) => {
    if (!roomState || submittedKey) return;
    setSubmittedKey(optionKey);
    socket.emit('player:submit_answer', {
      roomId: roomState.roomId,
      playerId,
      optionKey,
    });
  };

  // Not joined yet - show join form
  if (!joined) {
    return (
      <div className="player-container">
        <JoinForm onJoin={handleJoin} error={joinError || error} />
      </div>
    );
  }

  // Joined but no room state yet (waiting for first broadcast)
  if (!roomState) {
    return (
      <div className="player-container">
        <div className="loading">
          <p>Connecting...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="player-container">
      {error && <div className="error-banner">{error}</div>}

      {roomState.phase === 'lobby' && (
        <WaitingRoom roomState={roomState} playerName={playerName} />
      )}

      {roomState.phase === 'question' && !submittedKey && (
        <AnswerButtons roomState={roomState} onAnswer={handleAnswer} />
      )}

      {roomState.phase === 'question' && submittedKey && (
        <Submitted chosenKey={submittedKey} />
      )}

      {roomState.phase === 'results' && <PlayerResults />}
    </div>
  );
}
