import type { OptionKey } from '../../../../shared/types';

interface SubmittedProps {
  chosenKey: OptionKey;
}

export default function Submitted({ chosenKey }: SubmittedProps) {
  return (
    <div className="submitted-screen">
      <div className="submitted-icon">&#10003;</div>
      <h2 className="submitted-title">Answer Locked In!</h2>
      <p className="submitted-choice">
        You chose: <strong>{chosenKey}</strong>
      </p>
      <p className="waiting-text">Waiting for other players...</p>
    </div>
  );
}
