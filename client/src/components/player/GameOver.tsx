import type { RoomStatePayload } from '../../../../shared/types';

interface GameOverProps {
  roomState: RoomStatePayload;
  playerId: string;
}

export default function GameOver({ roomState, playerId }: GameOverProps) {
  const winner = roomState.players.find((p) => p.playerId === roomState.winnerPlayerId);
  const isWinner = roomState.winnerPlayerId === playerId;

  return (
    <div className="gameover-screen">
      {isWinner ? (
        <>
          <div className="gameover-icon winner-icon">&#9733;</div>
          <h1 className="gameover-title">Victory!</h1>
          <p className="gameover-subtitle">Your city conquered all others</p>
        </>
      ) : (
        <>
          <div className="gameover-icon loser-icon">&#10007;</div>
          <h1 className="gameover-title">Defeated</h1>
          {winner ? (
            <p className="gameover-subtitle">
              <span style={{ color: winner.color }}>{winner.name}</span> wins
            </p>
          ) : (
            <p className="gameover-subtitle">The battle is over</p>
          )}
        </>
      )}

      <p className="waiting-text">Waiting for host to start a new game...</p>

      <div className="final-standings">
        <h3 className="section-title">Final Standings</h3>
        {roomState.players.map((p) => (
          <div
            key={p.playerId}
            className={`standing-row ${p.alive ? 'standing-winner' : 'standing-eliminated'}`}
            style={{ borderLeftColor: p.color }}
          >
            <span className="standing-name">{p.name}</span>
            <span className="standing-status">{p.alive ? 'Winner' : 'Eliminated'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
