import { useState, useEffect } from 'react';

interface JoinFormProps {
  onJoin: (roomId: string, name: string) => void;
  error: string | null;
}

export default function JoinForm({ onJoin, error }: JoinFormProps) {
  const [roomId, setRoomId] = useState('');
  const [name, setName] = useState('');

  // Pre-fill room code from URL query param (from QR scan)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) {
      setRoomId(room.toUpperCase());
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedRoom = roomId.trim().toUpperCase();
    const trimmedName = name.trim();
    if (trimmedRoom && trimmedName) {
      onJoin(trimmedRoom, trimmedName);
    }
  };

  return (
    <div className="join-form-wrapper">
      <h1 className="player-title">Party Game</h1>
      <form className="join-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="roomId">Room Code</label>
          <input
            id="roomId"
            type="text"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value.toUpperCase())}
            placeholder="ABCD"
            maxLength={6}
            autoFocus
            autoCapitalize="characters"
            autoComplete="off"
          />
        </div>
        <div className="form-group">
          <label htmlFor="name">Your Name</label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your name"
            maxLength={20}
            autoComplete="off"
          />
        </div>
        {error && <p className="form-error">{error}</p>}
        <button
          type="submit"
          className="btn btn-primary btn-large"
          disabled={!roomId.trim() || !name.trim()}
        >
          Join Game
        </button>
      </form>
    </div>
  );
}
