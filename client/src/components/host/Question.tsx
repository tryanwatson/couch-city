import type { RoomStatePayload } from '../../../../shared/types';

interface QuestionProps {
  roomState: RoomStatePayload;
}

export default function Question({ roomState }: QuestionProps) {
  if (!roomState.question) return null;

  return (
    <div className="host-question">
      <h2 className="question-text">{roomState.question.text}</h2>

      <div className="options-grid">
        {roomState.question.options.map((opt) => (
          <div key={opt.key} className={`option-card option-${opt.key.toLowerCase()}`}>
            <span className="option-key">{opt.key}</span>
            <span className="option-text">{opt.text}</span>
          </div>
        ))}
      </div>

      <div className="answer-progress">
        <p className="answer-count">
          {roomState.answerCount} of {roomState.playerCount} answered
        </p>
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{
              width:
                roomState.playerCount > 0
                  ? `${(roomState.answerCount / roomState.playerCount) * 100}%`
                  : '0%',
            }}
          />
        </div>
        <p className="waiting-text">Waiting for answers...</p>
      </div>
    </div>
  );
}
