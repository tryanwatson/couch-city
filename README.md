# CityWars

A Jackbox-style party strategy game — turn-based city building meets tactical combat, played on phones around a shared TV screen.

**Goal:** 2-8 players join via their phones, manage a population-driven economy, unlock upgrades across six categories, train four tiers of troops, compete for the Promised Land, and win by eliminating all rival cities, building a cultural empire, or holding the Promised Land.

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
- Allocate workers (farmers, miners, merchants) to produce food, materials, and gold
- Assign builders to upgrade categories to construct improvements
- Set a growth multiplier (1x/2x/3x) to control population expansion speed
- Train troops (warriors, cavalry, riflemen, trucks)
- Send attacks to rival cities or the Promised Land
- Donate troops to allied cities
- Deploy troops for active defense outside your city walls
- Manage troops in transit (pause, recall, redirect)
- Unlock and build upgrades (culture, military, farming, mining, trade, defense)
- Click **End Turn** when done

**Resolving** — once all players end their turn, the server processes the update:
- Economy produces resources, population grows or starves
- Builders advance upgrade construction progress
- Troops advance, field collisions resolve, sieges deal damage
- Win conditions are checked
- A 5-second animation plays on the host map, then the next planning phase begins

### Win Conditions

- **Military Domination** — last surviving city wins (all others eliminated)
- **Cultural Victory** — first player to accumulate 300 culture points wins
- **Promised Land Victory** — hold the Promised Land uncontested for 3 consecutive turns

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

| Resource   | Worker Type | Yield per Worker per Turn |
| ---------- | ----------- | ------------------------- |
| Food       | Farmer      | 3                         |
| Materials  | Miner       | 2                         |
| Gold       | Merchant    | 2                         |

Players start with 40 of each resource and a population of 10. Workers can only be assigned from available civilians (population minus troops at home, defending troops, and builders).

Farming, mining, and trade upgrades increase their respective yields by +1x per completed upgrade level.

### Population & Growth

- Each citizen consumes `1 food × growth multiplier` per turn
- **Fed** — population grows by `20% × growth multiplier`
- **Starving** — food zeroed, population shrinks by 20% (minimum 1)
- The growth multiplier (1x/2x/3x) is a strategic dial: higher = faster growth but more food consumed

### Military

Four troop types with escalating combat power:

| Troop    | Combat Power | Training Cost | Units Trained |
| -------- | ------------ | ------------- | ------------- |
| Warrior  | 1            | 20 gold       | 10            |
| Cavalry  | 5            | 50 gold       | 5             |
| Rifleman | 25           | 125 gold      | 3             |
| Truck    | 100          | 300 gold      | 1             |

Training converts civilians into soldiers, removing them from the worker pool. Attacks can be sent in batches of 1, 5, or 25 units. Troops travel 4 turns to reach an enemy city (2 turns to the Promised Land).

### Combat

**Field combat** — when opposing troop groups (A→B and B→A) pass each other mid-map, they collide. Total combat power (CP) determines the winner; the loser is wiped and the winner loses units proportional to the enemy's CP.

**City assault** — troops arriving at an enemy city fight the garrison (troops at home + defending troops). If the attacker's total CP exceeds the defender's, the remaining attackers become **occupying troops**.

**Siege** — occupying troops deal `units × combat_power × 1` HP damage to the city each turn. The garrison fights occupiers each resolving phase; new defenders can whittle down a siege over time.

**City HP** — cities start at 100 HP, regenerate 3% of max HP per turn (rounded up), and are eliminated at 0 HP. Defense upgrades increase max HP (see Upgrades below).

### Troop Management

During the planning phase, players can manage troops:
- **Pause/Resume** — freeze or unfreeze troop movement in transit
- **Recall** — send troops in transit back home
- **Redirect** — retarget troops to a different city or the Promised Land
- **Recall occupying troops** — pull siege forces back home
- **Redirect occupying troops** — retarget siege forces to a new destination
- **Donate** — send troops peacefully to an allied city (they join the target's garrison on arrival)
- **Deploy defense** — station troops outside your city walls for active defense
- **Recall defenders** — pull defending troops back into your garrison

### Upgrades

Six upgrade categories with multi-tier progression. Each upgrade must be **unlocked** (costs gold) and then **built** (assign builders who contribute progress each turn).

| Category | Levels | Effect |
| -------- | ------ | ------ |
| Culture  | 5      | Each completed level generates 10 culture per turn |
| Military | 3      | Military technology improvements |
| Farming  | 2      | +1x food yield multiplier per level |
| Mining   | 2      | +1x materials yield multiplier per level |
| Trade    | 2      | +1x gold yield multiplier per level |
| Defense  | 3      | +50 / +75 / +100 max HP per level |

Builders are assigned from available civilians (like workers). Each builder contributes 1 progress point per turn. Higher upgrade tiers require more progress to complete.

### The Promised Land

A contested objective at the center of the map:
- Send troops to occupy it (2-turn travel)
- If one player uncontestedly holds it for **3 consecutive turns**, they win
- If multiple players have troops there, it's contested and the hold counter resets

### Culture

An alternative path to victory:
- Build culture upgrades (5 levels available)
- Each completed culture upgrade generates **10 culture per turn**
- First player to reach **300 culture** wins

## Architecture

```
couch-city/
├── shared/              # Shared TypeScript types + constants
│   ├── types.ts         # CityPlayerInfo, TroopGroup, RoomStatePayload, ServerRoom
│   └── constants.ts     # Game balance values, troop configs, upgrade schedules, city names
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
        │   │   └── BattleMap.tsx  # Animated SVG battle map
        │   └── player/
        │       ├── JoinForm.tsx          # Room code + name entry
        │       ├── WaitingRoom.tsx       # Lobby waiting screen
        │       ├── GameControls.tsx      # Player action panel
        │       ├── TargetModal.tsx       # Attack/defend/donate target selection
        │       ├── BuildProgressBlock.tsx # Upgrade progress display
        │       └── GameOver.tsx          # Final standings
        ├── hooks/
        │   ├── useSocket.ts       # Singleton socket hook
        │   ├── useRoomState.ts    # room:state listener
        │   └── useHoldToRepeat.ts # Hold-to-repeat button behavior
        └── socket.ts              # Socket.io client instance
```

- **Server owns all state.** Clients are renderers + action senders.
- **Single `room:state` broadcast** after every mutation keeps all clients in sync.
- **No database.** All state is in-memory. Server restart clears all rooms.

## Event Contract

### Client → Server

| Event                              | Payload                                                          | Description                              |
| ---------------------------------- | ---------------------------------------------------------------- | ---------------------------------------- |
| `host:create_room`                 | _(callback returns `roomId`)_                                    | Host creates a new room                  |
| `host:attach_room`                 | `{ roomId }`                                                     | Host reconnects to an existing room      |
| `host:start_game`                  | `{ roomId }`                                                     | Host starts the game                     |
| `host:reset_room`                  | `{ roomId }`                                                     | Host resets room back to lobby           |
| `player:join_room`                 | `{ roomId, playerId?, name }`                                    | Player joins or reconnects               |
| `player:allocate_workers`          | `{ roomId, playerId, farmers, miners, merchants, builders }`     | Set worker and builder assignments       |
| `player:set_growth_multiplier`     | `{ roomId, playerId, multiplier }`                               | Set growth multiplier (1, 2, or 3)       |
| `player:unlock_upgrade`            | `{ roomId, playerId, category }`                                 | Unlock next tier of an upgrade category  |
| `player:spend_military`            | `{ roomId, playerId, troopType }`                                | Train troops of a given type             |
| `player:send_attack`               | `{ roomId, playerId, targetPlayerId, units, troopType }`         | Launch an attack                         |
| `player:send_donation`             | `{ roomId, playerId, targetPlayerId, units, troopType }`         | Send troops peacefully to an ally        |
| `player:send_defend`               | `{ roomId, playerId, units, troopType }`                         | Deploy troops for active defense         |
| `player:recall_defenders`          | `{ roomId, playerId, units, troopType }`                         | Recall defending troops to garrison      |
| `player:recall_troops`             | `{ roomId, playerId, troopGroupId }`                             | Recall troops in transit                 |
| `player:pause_troops`              | `{ roomId, playerId, troopGroupId }`                             | Pause troop movement                     |
| `player:resume_troops`             | `{ roomId, playerId, troopGroupId }`                             | Resume paused troops                     |
| `player:redirect_troops`           | `{ roomId, playerId, troopGroupId, newTargetPlayerId }`          | Retarget troops to new destination       |
| `player:recall_occupying_troops`   | `{ roomId, playerId, troopGroupId }`                             | Pull siege troops back home              |
| `player:redirect_occupying_troops` | `{ roomId, playerId, troopGroupId, newTargetPlayerId }`          | Retarget siege troops to new destination |
| `player:end_turn`                  | `{ roomId, playerId }`                                           | End the current planning phase           |

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
  promisedLandOwnerId: string | null   // uncontested holder, or null
  promisedLandHoldTurns: number        // consecutive turns held
}

ServerCityPlayer {
  playerId, name, color, socketId, connected, lastSeen, alive
  // Economy
  food, materials, gold, goldIncome
  farmers, miners, merchants
  growthMultiplier                     // 1, 2, or 3
  population
  // Military
  militaryAtHome: Record<TroopType, number>      // { warrior, cavalry, rifleman, truck }
  militaryDefending: Record<TroopType, number>    // troops deployed for active defense
  // Upgrades
  upgradeLevel: Record<UpgradeCategory, number>       // unlocked tiers per category
  builders: Record<UpgradeCategory, number>            // workers building per category
  upgradesCompleted: Record<UpgradeCategory, number>   // finished upgrades per category
  upgradeProgress: Record<UpgradeCategory, number>     // current build progress per category
  // Culture
  culture: number                    // passive score from completed culture upgrades
  // City
  hp, maxHp                          // maxHp scales with defense upgrades
  x, y                               // 0–1 normalized map position
  endedTurn: boolean
}

TroopGroup {
  id, attackerPlayerId, targetPlayerId
  troopType: 'warrior' | 'cavalry' | 'rifleman' | 'truck'
  units, turnsRemaining, totalTurns
  startX?, startY?                     // custom origin after field combat
  fieldCombatX?, fieldCombatY?         // collision point coordinates
  inFieldCombat?, fieldCombatUnits?    // animation state
  paused?                              // troop movement frozen
  isDonation?                          // peaceful transfer to ally
}
```

## Reconnection

- **Player refresh:** `playerId`, `roomId`, and name are stored in `localStorage`. On page load, the client re-emits `player:join_room` with the stored ID. The server recognizes the returning player and updates their socket.
- **Host refresh:** `roomId` is stored in `localStorage`. On page load, the host emits `host:attach_room`. The server updates the host socket binding.
- **Disconnected players:** automatically end their turn during the planning phase so the game doesn't stall.
- **Server restart:** Reconnection fails gracefully (room not found). Clients clear stored data and show the create/join screen.
