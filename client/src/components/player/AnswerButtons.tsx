import type { RoomStatePayload, OptionKey } from '../../../../shared/types';

interface AnswerButtonsProps {
  roomState: RoomStatePayload;
  onAnswer: (optionKey: OptionKey) => void;
}

export default function AnswerButtons({ roomState, onAnswer }: AnswerButtonsProps) {
  if (!roomState.question) return null;

  return (
    <div className="answer-screen">
      <p className="answer-prompt">{roomState.question.text}</p>
      <div className="answer-grid">
        {roomState.question.options.map((opt) => (
          <button
            key={opt.key}
            className={`answer-btn answer-btn-${opt.key.toLowerCase()}`}
            onClick={() => onAnswer(opt.key)}
          >
            <span className="answer-key">{opt.key}</span>
            <span className="answer-text">{opt.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
