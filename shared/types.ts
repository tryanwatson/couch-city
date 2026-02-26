// Game phases
export type Phase = 'lobby' | 'question' | 'results';

// Option keys
export type OptionKey = 'A' | 'B' | 'C' | 'D';

// A question option
export interface QuestionOption {
  key: OptionKey;
  text: string;
}

// A question
export interface Question {
  id: string;
  text: string;
  options: QuestionOption[];
  correctKey: OptionKey;
}

// A player (sanitized, sent to clients)
export interface PlayerInfo {
  playerId: string;
  name: string;
  connected: boolean;
}

// An answer record
export interface AnswerRecord {
  playerId: string;
  optionKey: OptionKey;
  submittedAtMs: number;
}

// Sanitized room state broadcast to all clients
export interface RoomStatePayload {
  roomId: string;
  phase: Phase;
  players: PlayerInfo[];
  question: {
    id: string;
    text: string;
    options: QuestionOption[];
  } | null;
  // Only included during results phase
  correctKey: OptionKey | null;
  answers: AnswerRecord[] | null;
  questionStartAtMs: number | null;
  answerCount: number;
  playerCount: number;
}

// --- Server-side room (not exported to client) ---

export interface ServerPlayer {
  playerId: string;
  name: string;
  socketId: string | null;
  connected: boolean;
  lastSeen: number;
}

export interface ServerRoom {
  roomId: string;
  hostSocketId: string | null;
  phase: Phase;
  players: Map<string, ServerPlayer>;
  question: Question | null;
  answers: Map<string, AnswerRecord>;
  questionStartAtMs: number | null;
}
