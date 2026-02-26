import type { Question } from '../../shared/types';

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to avoid confusion

export function generateRoomCode(existingCodes: Set<string>): string {
  const len = 4;
  let code: string;
  let attempts = 0;
  do {
    code = '';
    for (let i = 0; i < len; i++) {
      code += CHARS[Math.floor(Math.random() * CHARS.length)];
    }
    attempts++;
    if (attempts > 1000) {
      throw new Error('Failed to generate unique room code');
    }
  } while (existingCodes.has(code));
  return code;
}

export function generatePlayerId(): string {
  return 'p_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

export const questionBank: Question[] = [
  {
    id: 'q1',
    text: 'What planet is known as the Red Planet?',
    options: [
      { key: 'A', text: 'Venus' },
      { key: 'B', text: 'Mars' },
      { key: 'C', text: 'Jupiter' },
      { key: 'D', text: 'Saturn' },
    ],
    correctKey: 'B',
  },
  {
    id: 'q2',
    text: 'What is the largest ocean on Earth?',
    options: [
      { key: 'A', text: 'Atlantic Ocean' },
      { key: 'B', text: 'Indian Ocean' },
      { key: 'C', text: 'Pacific Ocean' },
      { key: 'D', text: 'Arctic Ocean' },
    ],
    correctKey: 'C',
  },
  {
    id: 'q3',
    text: 'Which element has the chemical symbol "O"?',
    options: [
      { key: 'A', text: 'Gold' },
      { key: 'B', text: 'Osmium' },
      { key: 'C', text: 'Oxygen' },
      { key: 'D', text: 'Oganesson' },
    ],
    correctKey: 'C',
  },
  {
    id: 'q4',
    text: 'In what year did the Titanic sink?',
    options: [
      { key: 'A', text: '1905' },
      { key: 'B', text: '1912' },
      { key: 'C', text: '1918' },
      { key: 'D', text: '1923' },
    ],
    correctKey: 'B',
  },
  {
    id: 'q5',
    text: 'How many legs does a spider have?',
    options: [
      { key: 'A', text: '6' },
      { key: 'B', text: '8' },
      { key: 'C', text: '10' },
      { key: 'D', text: '12' },
    ],
    correctKey: 'B',
  },
  {
    id: 'q6',
    text: 'What is the capital of Japan?',
    options: [
      { key: 'A', text: 'Seoul' },
      { key: 'B', text: 'Beijing' },
      { key: 'C', text: 'Tokyo' },
      { key: 'D', text: 'Osaka' },
    ],
    correctKey: 'C',
  },
  {
    id: 'q7',
    text: 'Which gas do plants absorb from the atmosphere?',
    options: [
      { key: 'A', text: 'Oxygen' },
      { key: 'B', text: 'Nitrogen' },
      { key: 'C', text: 'Carbon Dioxide' },
      { key: 'D', text: 'Helium' },
    ],
    correctKey: 'C',
  },
  {
    id: 'q8',
    text: 'What is the hardest natural substance on Earth?',
    options: [
      { key: 'A', text: 'Gold' },
      { key: 'B', text: 'Iron' },
      { key: 'C', text: 'Diamond' },
      { key: 'D', text: 'Platinum' },
    ],
    correctKey: 'C',
  },
];
