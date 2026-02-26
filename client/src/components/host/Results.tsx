import type { RoomStatePayload } from '../../../../shared/types';

interface ResultsProps {
  roomState: RoomStatePayload;
  onPlayAgain: () => void;
}

export default function Results({ roomState, onPlayAgain }: ResultsProps) {
  if (!roomState.question || !roomState.answers) return null;

  const questionStartAtMs = roomState.questionStartAtMs || 0;

  // Build results: each player's answer, correctness, elapsed time
  const results = roomState.answers.map((answer, index) => {
    const player = roomState.players.find((p) => p.playerId === answer.playerId);
    const isCorrect = answer.optionKey === roomState.correctKey;
    const elapsedMs = answer.submittedAtMs - questionStartAtMs;
    return {
      rank: index + 1,
      name: player?.name || 'Unknown',
      optionKey: answer.optionKey,
      isCorrect,
      elapsedMs,
    };
  });

  // Players who didn't answer
  const answeredIds = new Set(roomState.answers.map((a) => a.playerId));
  const noAnswer = roomState.players.filter((p) => !answeredIds.has(p.playerId));

  const correctOption = roomState.question.options.find(
    (o) => o.key === roomState.correctKey
  );

  return (
    <div className="host-results">
      <h2 className="question-text">{roomState.question.text}</h2>
      <p className="correct-answer">
        Correct: <strong>{roomState.correctKey}</strong> &mdash;{' '}
        {correctOption?.text}
      </p>

      <div className="results-table-wrapper">
        <table className="results-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Player</th>
              <th>Answer</th>
              <th>Time</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.rank} className={r.isCorrect ? 'correct' : 'wrong'}>
                <td className="rank">#{r.rank}</td>
                <td>{r.name}</td>
                <td>{r.optionKey}</td>
                <td>{(r.elapsedMs / 1000).toFixed(2)}s</td>
                <td>{r.isCorrect ? 'Correct' : 'Wrong'}</td>
              </tr>
            ))}
            {noAnswer.map((p) => (
              <tr key={p.playerId} className="no-answer">
                <td>&mdash;</td>
                <td>{p.name}</td>
                <td>&mdash;</td>
                <td>&mdash;</td>
                <td>No answer</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button className="btn btn-primary btn-large" onClick={onPlayAgain}>
        Play Again
      </button>
    </div>
  );
}
