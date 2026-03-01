# CityWars

A Jackbox-style party strategy game — turn-based city building meets tactical combat, played on phones around a shared TV screen.

**Goal:** 2-8 players join via their phones, manage a population-driven economy, train four tiers of troops, compete for a central Gold Mine, and win by either eliminating all rival cities or building a cultural empire.

## Prerequisites

- **Node.js** >= 18
- **npm** >= 9

## Setup

```bash
# Install all dependencies (server + client)
npm install

# Start both server and client in dev mode
npm run dev
```

The dev server runs on `http://localhost:3001`. In production, `npm run build` compiles both workspaces and the Express server serves the React client as static files.

## How to Play

1. Open `http://localhost:3001/host` on a computer/TV — the shared battle map
2. A room code and QR code appear
3. On phones, either scan the QR code or open `http://<your-local-ip>:3001/join` and enter the room code + a display name
4. When all players have joined, the host clicks **Start Game**
5. Each player is assigned a city on the map with starting resources and population

### Turn Loop

Each turn has two phases:

**Planning** — all players act simultaneously on their phones:
- Allocate workers (farmers, miners, merchants) to produce food, resources, and gold
- Set a growth multiplier (1x/2x/3x) to control population expansion speed
- Train troops (warriors, cavalry, riflemen, trucks)
- Send attacks to rival cities or the Gold Mine
- Manage troops in transit (pause, recall, redirect)
- Upgrade culture and build monuments
- Click **End Turn** when done

**Resolving** — once all players end their turn, the server processes the update:
- Economy produces resources, population grows or starves
- Troops advance, field collisions resolve, sieges deal damage
- Win conditions are checked
- A 5-second animation plays on the host map, then the next planning phase begins

### Win Conditions

- **Military Domination** — last surviving city wins (all others eliminated)
- **Cultural Victory** — first player to accumulate 1,000 culture points wins

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

### Economy

Three resources produced by assigning civilian workers:

| Resource  | Worker Type | Yield per Worker per Turn |
| --------- | ----------- | ------------------------- |
| Food      | Farmer      | 3                         |
| Resources | Miner       | 1                         |
| Gold      | Merchant    | 1                         |

Players start with 100 of each resource and a population of 10. Workers can only be assigned from available civilians (population minus troops at home).

### Population & Growth

- Each citizen consumes `1 food × growth multiplier` per turn
- **Fed** — population grows by `20% × growth multiplier`
- **Starving** — food zeroed, population shrinks by 20% (minimum 1)
- The growth multiplier (1x/2x/3x) is a strategic dial: higher = faster growth but more food consumed

### Military

Four troop types with escalating combat power:

| Troop    | Combat Power | Training Cost         | Units Trained |
| -------- | ------------ | --------------------- | ------------- |
| Warrior  | 1            | 20 food + 20 gold     | 10            |
| Cavalry  | 5            | 50 food + 50 gold     | 5             |
| Rifleman | 25           | 100 food + 150 gold   | 3             |
| Truck    | 100          | 200 food + 400 gold   | 1             |

Training converts civilians into soldiers, removing them from the worker pool. Attacks can be sent in batches of 5, 10, or 25 units. Troops travel 4 turns to reach an enemy city (2 turns to the Gold Mine).

### Combat

**Field combat** — when opposing troop groups (A→B and B→A) pass each other mid-map, they collide. Total combat power (CP) determines the winner; the loser is wiped and the winner loses units proportional to the enemy's CP.

**City assault** — troops arriving at an enemy city fight the garrison. If the attacker's total CP exceeds the defender's, the remaining attackers become **occupying troops**.

**Siege** — occupying troops deal `units × combat_power × 1` HP damage to the city each turn. The garrison fights occupiers each resolving phase; new defenders can whittle down a siege over time.

**City HP** — cities start at 100 HP, regenerate 2 HP per turn, and are eliminated at 0 HP.

### Troop Management

During the planning phase, players can manage troops already in transit:
- **Pause/Resume** — freeze or unfreeze troop movement
- **Recall** — send troops back home
- **Redirect** — retarget troops to a different city or the Gold Mine
- **Recall occupying troops** — pull siege forces back home

### Gold Mine

A contested objective at the center of the map:
- Send troops to occupy it (2-turn travel)
- If one player uncontestedly holds it, they earn **100 gold per turn**
- If multiple players have troops there, it's contested and generates no income

### Culture & Monuments

An alternative path to victory:
- **Upgrade Culture** (30 food + 50 gold) — increments your culture level, unlocking a monument slot (max 5)
- **Build Monument** (100 gold × multiplier + 150 resources × multiplier) — cost multipliers escalate: 1×, 5×, 25×, 100×, 200×
- Each monument generates **5 culture per turn**
- First player to reach **1,000 culture** wins

## Architecture

```
couch-city/
├── shared/              # Shared TypeScript types + constants
│   ├── types.ts         # CityPlayerInfo, TroopGroup, RoomStatePayload, ServerRoom
│   └── constants.ts     # Game balance values, troop configs, city name generation
├── server/              # Express + Socket.io server
│   └── src/
│       ├── index.ts          # Server setup, static file serving
│       ├── roomManager.ts    # Room state, turn resolution, combat logic
│       ├── socketHandlers.ts # Socket event routing
│       └── utils.ts          # Room code + player ID generation
└── client/              # Vite + React client
    └── src/
        ├── pages/
        │   ├── HostPage.tsx       # TV/shared-screen view
        │   └── JoinPage.tsx       # Phone player view
        ├── components/
        │   ├── host/
        │   │   ├── Lobby.tsx      # QR code, room code, player list
        │   │   └── BattleMap.tsx   # Animated SVG battle map
        │   └── player/
        │       ├── JoinForm.tsx    # Room code + name entry
        │       ├── WaitingRoom.tsx # Lobby waiting screen
        │       ├── GameControls.tsx # Player action panel
        │       └── GameOver.tsx    # Final standings
        ├── hooks/
        │   ├── useSocket.ts       # Singleton socket hook
        │   └── useRoomState.ts    # room:state listener
        └── socket.ts              # Socket.io client instance
```

- **Server owns all state.** Clients are renderers + action senders.
- **Single `room:state` broadcast** after every mutation keeps all clients in sync.
- **No database.** All state is in-memory. Server restart clears all rooms.

## Event Contract

### Client → Server

| Event                          | Payload                                                   | Description                              |
| ------------------------------ | --------------------------------------------------------- | ---------------------------------------- |
| `host:create_room`             | _(callback returns `roomId`)_                             | Host creates a new room                  |
| `host:attach_room`             | `{ roomId }`                                              | Host reconnects to an existing room      |
| `host:start_game`              | `{ roomId }`                                              | Host starts the game                     |
| `host:reset_room`              | `{ roomId }`                                              | Host resets room back to lobby           |
| `player:join_room`             | `{ roomId, playerId?, name }`                             | Player joins or reconnects               |
| `player:allocate_workers`      | `{ roomId, playerId, farmers, miners, merchants }`        | Set worker assignments                   |
| `player:set_growth_multiplier` | `{ roomId, playerId, multiplier }`                        | Set growth multiplier (1, 2, or 3)       |
| `player:upgrade_culture`       | `{ roomId, playerId }`                                    | Buy a culture level                      |
| `player:build_monument`        | `{ roomId, playerId }`                                    | Build a monument                         |
| `player:spend_military`        | `{ roomId, playerId, troopType }`                         | Train troops of a given type             |
| `player:send_attack`           | `{ roomId, playerId, targetPlayerId, units, troopType }`  | Launch an attack                         |
| `player:recall_troops`         | `{ roomId, playerId, troopGroupId }`                      | Recall troops in transit                 |
| `player:pause_troops`          | `{ roomId, playerId, troopGroupId }`                      | Pause troop movement                     |
| `player:resume_troops`         | `{ roomId, playerId, troopGroupId }`                      | Resume paused troops                     |
| `player:redirect_troops`       | `{ roomId, playerId, troopGroupId, newTargetPlayerId }`   | Retarget troops to new destination       |
| `player:recall_occupying_troops` | `{ roomId, playerId, troopGroupId }`                    | Pull siege troops back home              |
| `player:end_turn`              | `{ roomId, playerId }`                                    | End the current planning phase           |

### Server → Client

| Event        | Payload            | Description                                                 |
| ------------ | ------------------ | ----------------------------------------------------------- |
| `room:state` | `RoomStatePayload` | Broadcast to all clients in the room after any state change |
| `room:error` | `{ message }`      | Error sent to the requesting socket only                    |

## Server Data Model

```typescript
ServerRoom {
  roomId: string                       // 4-char uppercase code
  hostSocketId: string | null
  phase: 'lobby' | 'playing' | 'gameover'
  subPhase: 'planning' | 'resolving' | null
  turnNumber: number
  players: Map<playerId, ServerCityPlayer>
  troopsInTransit: TroopGroup[]
  occupyingTroops: TroopGroup[]
  combatHitPlayerIds: string[]         // flash animation targets
  winnerPlayerId: string | null
  goldMineOwnerId: string | null
}

ServerCityPlayer {
  playerId, name, color, socketId, connected, lastSeen, alive
  // Economy
  food, resources, gold, goldIncome
  farmers, miners, merchants
  growthMultiplier                     // 1, 2, or 3
  population
  // Military
  militaryAtHome: Record<TroopType, number>  // { warrior, cavalry, rifleman, truck }
  // Culture
  culture, cultureLevel, monuments
  // City
  hp, maxHp
  x, y                                // 0–1 normalized map position
  endedTurn: boolean
}

TroopGroup {
  id, attackerPlayerId, targetPlayerId
  troopType: 'warrior' | 'cavalry' | 'rifleman' | 'truck'
  units, turnsRemaining, totalTurns
  startX?, startY?                     // custom origin after field combat
  fieldCombatX?, fieldCombatY?         // collision point coordinates
  inFieldCombat?, fieldCombatUnits?    // animation state
  paused?
}
```

## Reconnection

- **Player refresh:** `playerId`, `roomId`, and name are stored in `localStorage`. On page load, the client re-emits `player:join_room` with the stored ID. The server recognizes the returning player and updates their socket.
- **Host refresh:** `roomId` is stored in `localStorage`. On page load, the host emits `host:attach_room`. The server updates the host socket binding.
- **Disconnected players:** automatically end their turn during the planning phase so the game doesn't stall.
- **Server restart:** Reconnection fails gracefully (room not found). Clients clear stored data and show the create/join screen.
