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
