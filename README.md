# Party Game - Fastest Finger

A minimalist Jackbox-style party game. One host screen displays questions on a TV/monitor, players join from their phones and tap answers as fast as they can.

## Prerequisites

- **Node.js** >= 18
- **npm** >= 9

## Setup

```bash
# Install all dependencies (server + client)
npm install

# Start both server and client
npm run dev
```

The server runs on `http://localhost:3001` and the client on `http://localhost:5173`.

## How to Play

1. Open `http://localhost:5173/host` on a computer/TV (the host screen)
2. A room code and QR code appear
3. On phones, either:
   - Scan the QR code, or
   - Open `http://<your-local-ip>:5173/join` and enter the room code + a display name
4. When all players have joined, the host clicks **Start Game**
5. A trivia question appears on the host screen; phones show A/B/C/D buttons
6. Players tap their answer as fast as possible
7. Once everyone answers (or time runs out), the host screen shows results ranked by speed
8. Click **Play Again** to return to the lobby with the same room

### Finding your local IP

For phones on the same Wi-Fi network, replace `localhost` with your computer's local IP:

```bash
# macOS
ipconfig getifaddr en0

# Linux
hostname -I

# Windows
ipconfig
```

## Architecture

```
party-game-test/
├── shared/          # Shared TypeScript types
│   └── types.ts
├── server/          # Express + Socket.io server
│   └── src/
│       ├── index.ts
│       ├── roomManager.ts
│       ├── socketHandlers.ts
│       └── utils.ts
└── client/          # Vite + React client
    └── src/
        ├── pages/
        │   ├── HostPage.tsx
        │   └── JoinPage.tsx
        ├── components/
        │   ├── host/
        │   └── player/
        ├── hooks/
        ├── styles/
        └── socket.ts
```

- **Server owns all state.** Clients are dumb renderers.
- **Single `room:state` broadcast** after every mutation keeps all clients in sync.
- **No database.** All state is in-memory. Server restart clears all rooms.

## Event Contract

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `host:create_room` | _(callback returns `roomId`)_ | Host creates a new room |
| `host:attach_room` | `{ roomId }` | Host reconnects to an existing room |
| `host:start_game` | `{ roomId }` | Host starts the game (picks a question) |
| `host:reset_room` | `{ roomId }` | Host resets room back to lobby phase |
| `player:join_room` | `{ roomId, playerId?, name }` | Player joins (or reconnects to) a room. Callback: `{ ok, playerId?, error? }` |
| `player:submit_answer` | `{ roomId, playerId, optionKey }` | Player submits answer (A/B/C/D) |

### Server → Client

| Event | Payload | Description |
|---|---|---|
| `room:state` | `RoomStatePayload` | Broadcast to all clients in the room after any state change |
| `room:error` | `{ message }` | Error sent to the requesting socket only |

## Server Data Model

```typescript
Room {
  roomId: string               // 4-char uppercase code
  hostSocketId: string | null  // current host socket
  phase: 'lobby' | 'question' | 'results'
  players: Map<playerId, {
    playerId: string
    name: string
    socketId: string | null
    connected: boolean
    lastSeen: number
  }>
  question: Question | null
  answers: Map<playerId, {
    playerId: string
    optionKey: 'A' | 'B' | 'C' | 'D'
    submittedAtMs: number      // server Date.now()
  }>
  questionStartAtMs: number | null
}
```

The broadcast `room:state` payload is sanitized: no socket IDs, correct answer hidden during question phase, answers only included during results phase.

## Reconnection

- **Player refresh:** `playerId` and `roomId` are stored in `localStorage`. On page load, the client re-emits `player:join_room` with the stored ID. The server recognizes the returning player and updates their socket.
- **Host refresh:** `roomId` is stored in `localStorage`. On page load, the host emits `host:attach_room`. The server updates the host socket binding.
- **Server restart:** Reconnection fails gracefully (room not found). Clients clear stored data and show the create/join screen.
