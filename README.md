# CityWars

A Jackbox-style party strategy game — cookie-clicker economy meets Civ combat, played on phones around a shared TV screen.

**Goal:** 2–8 players join via their phones, passively earn resources, buy economy/military upgrades, send troop attacks, watch troop movement on the host screen, and eliminate cities until one winner remains.

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

npm run build -w client
npm run dev -w server

## How to Play

1. Open `http://localhost:5173/host` on a computer/TV — the shared map screen
2. A room code and QR code appear
3. On phones, either:
   - Scan the QR code, or
   - Open `http://<your-local-ip>:5173/join` and enter the room code + a display name
4. When all players have joined, the host clicks **Start Game**
5. Each player is assigned a city on the map with starting resources and troops
6. Cities passively generate resources A and B every second
7. On your phone, spend resources to:
   - **Upgrade economy** — increase your income rate
   - **Upgrade military** — add troops to your city
8. Send a troop attack: pick a target player and a quantity; troops leave immediately and travel to the target (visible on the host map as moving dots)
9. When troops arrive, they trade against the defender's troops at home; any survivors deal HP damage to the city
10. Cities slowly regenerate HP over time; a city at 0 HP is eliminated
11. Last city standing wins

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

## Game Design

### Economy Tick (server authoritative)

- Every second the server adds `incomeRateA` and `incomeRateB` to each alive city's resource totals.
- Initial income rates and upgrade costs are tuned constants defined server-side.

### Upgrade Actions

| Action          | Cost           | Effect                                    |
| --------------- | -------------- | ----------------------------------------- |
| `spendEconomy`  | Resource A + B | Increases `incomeRateA` and `incomeRateB` |
| `spendMilitary` | Resource A + B | Increases `militaryAtHome`                |

### Combat

1. Player chooses a `targetPlayerId` and `units` to send.
2. `units` are immediately deducted from `militaryAtHome` (commitment — no recall).
3. Troops travel for a fixed ETA (e.g. 5 seconds); a `TroopGroup` is stored and visualized on the host map.
4. On arrival, combat resolves server-side:

```
traded = min(attackerUnits, defenderMilitaryAtHome)
attackerUnits          -= traded
defenderMilitaryAtHome -= traded
defenderHp             -= attackerUnits * DAMAGE_PER_UNIT
```

5. HP regenerates passively over time (`HP_REGEN_PER_SECOND`).
6. A city with `hp <= 0` is eliminated; its player can still watch but cannot act.

### Win Condition (MVP)

- **Domination**: last surviving city wins.
- _(Enlightenment / pacifist win condition is a post-MVP phase — not required for MVP.)_

## Architecture

```
couch-city/
├── shared/          # Shared TypeScript types (server + client)
│   └── types.ts
├── server/          # Express + Socket.io server
│   └── src/
│       ├── index.ts
│       ├── roomManager.ts    # Room state, economy ticks, combat resolution
│       ├── socketHandlers.ts # Socket event routing
│       └── utils.ts          # Room code generation, game constants
└── client/          # Vite + React client
    └── src/
        ├── pages/
        │   ├── HostPage.tsx  # TV map view: cities, troop movement, stats panel
        │   └── JoinPage.tsx  # Phone UI: resources, upgrades, attack controls
        ├── components/
        │   ├── host/         # Map, TroopDot, CityMarker, StatsPanel, Lobby
        │   └── player/       # JoinForm, WaitingRoom, GameControls, Eliminated
        ├── hooks/
        ├── styles/
        └── socket.ts
```

- **Server owns all state.** Clients are dumb renderers + action senders.
- **Single `room:state` broadcast** after every mutation keeps all clients in sync.
- **No database.** All state is in-memory. Server restart clears all rooms.

## Event Contract

### Client → Server

| Event                   | Payload                                       | Description                                                         |
| ----------------------- | --------------------------------------------- | ------------------------------------------------------------------- |
| `host:create_room`      | _(callback returns `roomId`)_                 | Host creates a new room                                             |
| `host:attach_room`      | `{ roomId }`                                  | Host reconnects to an existing room                                 |
| `host:start_game`       | `{ roomId }`                                  | Host starts the game (assigns cities, begins economy ticks)         |
| `host:reset_room`       | `{ roomId }`                                  | Host resets room back to lobby                                      |
| `player:join_room`      | `{ roomId, playerId?, name }`                 | Player joins (or reconnects). Callback: `{ ok, playerId?, error? }` |
| `player:spend_economy`  | `{ roomId, playerId }`                        | Player spends resources to increase income rate                     |
| `player:spend_military` | `{ roomId, playerId }`                        | Player spends resources to increase troops at home                  |
| `player:send_attack`    | `{ roomId, playerId, targetPlayerId, units }` | Player sends troops to attack a target city                         |

### Server → Client

| Event        | Payload            | Description                                                 |
| ------------ | ------------------ | ----------------------------------------------------------- |
| `room:state` | `RoomStatePayload` | Broadcast to all clients in the room after any state change |
| `room:error` | `{ message }`      | Error sent to the requesting socket only                    |

## Server Data Model

```typescript
Room {
  roomId: string                    // 4-char uppercase code
  hostSocketId: string | null       // current host socket
  phase: 'lobby' | 'playing' | 'gameover'
  players: Map<playerId, CityPlayer>
  troopsInTransit: TroopGroup[]     // traveling attack groups
  tickIntervalId: NodeJS.Timer | null
}

CityPlayer {
  playerId: string
  name: string
  socketId: string | null
  connected: boolean
  lastSeen: number
  // Economy
  resourceA: number
  resourceB: number
  incomeRateA: number               // units per second
  incomeRateB: number               // units per second
  // Military
  militaryAtHome: number
  hp: number
  maxHp: number
  // Map position (for host screen)
  x: number                         // 0–1 normalized
  y: number                         // 0–1 normalized
  color: string
  alive: boolean
}

TroopGroup {
  id: string
  attackerPlayerId: string
  targetPlayerId: string
  units: number
  departedAtMs: number
  arrivalAtMs: number
}
```

The broadcast `room:state` payload is sanitized: no socket IDs, only alive players' full stats are included.

## Reconnection

- **Player refresh:** `playerId` and `roomId` are stored in `localStorage`. On page load, the client re-emits `player:join_room` with the stored ID. The server recognizes the returning player and updates their socket.
- **Host refresh:** `roomId` is stored in `localStorage`. On page load, the host emits `host:attach_room`. The server updates the host socket binding.
- **Server restart:** Reconnection fails gracefully (room not found). Clients clear stored data and show the create/join screen.
