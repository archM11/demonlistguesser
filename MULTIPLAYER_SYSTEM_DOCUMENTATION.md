# DemonList Guessr Multiplayer Party System - Complete Documentation

## Overview
The DemonList Guessr multiplayer system is a real-time party-based game system built on Node.js + Socket.io backend with JavaScript frontend. Players create or join parties using 6-character codes and play various game modes together.

## Architecture

### Backend (server.js)
- **Node.js server** running on port 3002
- **Socket.io** for real-time communication
- **In-memory storage** using Maps for parties and game state
- **No database** - all data is ephemeral

### Frontend (game.js + multiplayer.js)
- **MultiplayerManager class** handles Socket.io communication
- **DemonListGuessr class** contains main game logic
- **Real-time synchronization** between all party members
- **Host-based game control** (only host can start games, advance rounds)

## Party System

### Party Structure
```javascript
const party = {
    code: "ABC123",           // 6-character uppercase code
    host: "socketId",         // Socket ID of party creator
    members: [                // Array of party members
        {
            id: "socketId",   // Socket ID
            name: "username", // Player display name
            avatar: "👤"      // Player emoji avatar
        }
    ],
    gameType: "duels",        // "duels", "teams", "ffa", "classic"
    gameState: {              // Current game state
        gameData: {...},      // Game configuration
        scores: {},           // Player scores by socket ID
        guesses: {},          // Player guesses by socket ID
    },
    duelHealth: {             // For duel mode only
        "socketId1": 100,     // Player 1 health (100 max)
        "socketId2": 100      // Player 2 health (100 max)
    }
}
```

### Party Creation Process
1. Player clicks "Create Party"
2. Client calls `multiplayerManager.createParty(username)`
3. Server generates 6-character code (uppercase letters/numbers)
4. Server creates party object with host as creator
5. Server emits `partyCreated` event with party data
6. Client receives event and updates UI to show party lobby

### Party Joining Process
1. Player enters 6-character party code
2. Client calls `multiplayerManager.joinParty(code, username)`
3. Server validates code exists
4. Server adds player to party members array
5. Server emits `partyUpdated` to all members
6. All clients receive update and refresh party display

### Party Code Generation
```javascript
function generatePartyCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
```

## Game Types

### 1. Duels Mode
- **2 players maximum**
- **Health-based combat**: Each player starts with 100 HP
- **Damage calculation**: `damage = Math.abs(player1Score - player2Score)`
- **Win condition**: First player to reach 0 HP loses
- **Server-authoritative**: All damage calculated on server
- **Real-time synchronization** of health values

#### Duel Game Flow:
1. Both players guess demon position
2. Scores calculated using bell curve formula
3. Server calculates damage: `Math.abs(score1 - score2)`
4. Lower scorer takes damage
5. Server broadcasts updated health to all players
6. Continue until one player reaches 0 HP

### 2. Classic Mode
- **Any number of players**
- **Score-based**: Players accumulate points
- **No elimination**: All players play all rounds
- **Winner**: Highest total score at end

### 3. Teams Mode (Not fully implemented)
- **Team-based gameplay**
- **Combined team scores**

### 4. Free-For-All (FFA) (Not fully implemented)
- **Every player for themselves**
- **Elimination-based**

## Real-Time Communication

### Socket Events

#### Client → Server Events:
- `createParty`: Create new party
- `joinParty`: Join existing party by code
- `startGame`: Host starts game for party
- `submitScore`: Submit round score/guess
- `nextRound`: Host advances to next round
- `leaveParty`: Player leaves party

#### Server → Client Events:
- `partyCreated`: Party successfully created
- `joinSuccess`: Successfully joined party
- `joinError`: Failed to join party
- `partyUpdated`: Party member list changed
- `gameStarted`: Game started by host
- `playerScoreSubmitted`: Player submitted score
- `roundComplete`: All players submitted scores
- `nextRoundStarted`: Host advanced round

### Event Data Structures

#### gameStarted Event:
```javascript
{
    party: partyObject,
    gameData: {
        mode: "classic",
        difficulty: "nmpz",
        hints: { showDate: false, showCreator: false, ... },
        lists: { mainList: true, extendedList: false, legacyList: false },
        gameType: "duels",
        seed: "timestamp_random_partyCode",
        totalRounds: 999
    },
    seed: gameData.seed
}
```

#### roundComplete Event:
```javascript
{
    scores: { "socketId1": 95, "socketId2": 42 },
    guesses: { "socketId1": 50, "socketId2": 75 },
    round: roundNumber,
    damageResult: {           // For duels only
        player1Score: 95,
        player2Score: 42,
        damage: 53,
        health: { "socketId1": 100, "socketId2": 47 }
    }
}
```

## Scoring System

### Bell Curve Formula
The game uses a sophisticated bell curve scoring system where closer guesses get exponentially higher scores:

```javascript
function calculateScore(guess, actual) {
    const difference = Math.abs(guess - actual);
    const maxScore = 100;
    const curve = 2; // Steepness of the bell curve
    
    if (difference === 0) return maxScore; // Perfect guess
    
    const score = maxScore * Math.exp(-Math.pow(difference / 50, curve));
    return Math.max(1, Math.floor(score)); // Minimum 1 point
}
```

### List-Specific Parameters
Different demon lists have different scoring parameters:
- **Main List (1-75)**: Standard bell curve
- **Extended List (76-150)**: Slightly more forgiving
- **Legacy List (151+)**: Most forgiving due to less precise rankings

## Host System

### Host Privileges
- **Start games**: Only host can initiate gameplay
- **Advance rounds**: Only host can move to next round
- **Game control**: Host controls game flow and timing

### Host Transfer
- If host leaves, **first remaining member becomes new host**
- If party becomes empty, **party is deleted from server**

### Host UI Differences
- Host sees "Start Game" button
- Host sees "Next Round" button during gameplay
- Non-hosts see "Waiting for host to advance" messages

## Synchronization Strategy

### State Management
- **Server is authoritative** for all game state
- **Clients mirror server state** locally
- **Real-time updates** via Socket.io events

### Conflict Resolution
- **Server always wins** on score/health disputes
- **Client predictions** for responsiveness, corrected by server
- **Sequence numbers** prevent out-of-order updates

### Cross-Tab Synchronization (Removed)
- Originally had localStorage-based cross-tab sync
- **Removed due to conflicts** with Socket.io synchronization
- Now relies purely on Socket.io for all sync

## Error Handling

### Connection Issues
- **Automatic reconnection** attempts
- **Queue events** during disconnection
- **State recovery** on reconnection

### Invalid Operations
- **Server validation** of all operations
- **Error events** sent back to clients
- **Graceful fallbacks** for edge cases

### Party Management
- **Auto-cleanup** of empty parties
- **Duplicate code prevention**
- **Member limit enforcement**

## User Interface

### Party Lobby Screen
- **Party code display** (large, prominent)
- **Member list** with avatars and names
- **Game type selector** (host only)
- **Start button** (host only)
- **Leave party button**
- **Real-time member updates**

### Game Screens
- **Synchronized demon videos**
- **Real-time score updates**
- **Health bars** (duel mode)
- **Waiting states** for other players
- **Round progression controls** (host only)

### Visual Feedback
- **Loading states** during network operations
- **Error messages** for failed operations
- **Success confirmations** for actions
- **Real-time status indicators**

## Technical Implementation Details

### Socket.io Configuration
```javascript
const io = require('socket.io')(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
```

### Client-Side Manager
```javascript
class MultiplayerManager {
    constructor() {
        this.socket = null;
        this.connected = false;
        this.currentParty = null;
        this.isHost = false;
    }
    
    // Event handlers assigned by main game class
    onPartyCreated = null;
    onJoinSuccess = null;
    onGameStarted = null;
    onRoundComplete = null;
    // ... more callbacks
}
```

### Server-Side Storage
```javascript
const parties = new Map(); // partyCode -> party object
const userParties = new Map(); // socketId -> partyCode
```

## Security Considerations

### Input Validation
- **Party codes** validated (6 chars, alphanumeric)
- **Usernames** sanitized and length-limited
- **Scores** validated as numbers within expected ranges

### Rate Limiting
- **Implicit rate limiting** through game mechanics
- **No explicit rate limiting** implemented

### Data Sanitization
- **Basic input cleaning**
- **No persistent storage** reduces attack surface

## Performance Optimization

### Memory Management
- **Automatic party cleanup** when empty
- **Limited party history** storage
- **Efficient Socket.io broadcasting**

### Network Optimization
- **Minimal data payloads**
- **Event batching** where possible
- **Efficient JSON serialization**

## Debugging Features

### Server Logging
- **Detailed console logs** with emojis for visibility
- **Game state tracking** at each step
- **Error logging** with context

### Client Debug Mode
```javascript
localStorage.setItem('debug', 'true'); // Enable detailed logging
```

### Debug Log Categories
- `[DEBUG]`: Basic debug information
- `[STATE]`: Game state snapshots
- `[ERROR]`: Error information with context
- Server logs use emojis: 🏥 📊 ⚔️ 🏁 etc.

## Known Issues & Limitations

### Current Problems
- **Health synchronization**: Non-host players sometimes show incorrect health
- **ID mapping conflicts**: Server socket IDs vs client member IDs
- **Race conditions**: Rapid round advancement can cause sync issues

### Browser Compatibility
- **Modern browsers only** (ES6+ features)
- **WebSocket support required**
- **No IE support**

### Scalability Limitations
- **In-memory storage only**
- **Single server instance**
- **No load balancing**

## Deployment Configuration

### Development Setup
- **HTTP Server**: Python server on port 3001 (with no-cache headers)
- **Multiplayer Server**: Node.js on port 3002
- **Local development**: Both servers on localhost

### Production Considerations
- **HTTPS required** for Socket.io in production
- **CORS configuration** for cross-origin requests
- **Environment variables** for server URLs

## Code Architecture Patterns

### Event-Driven Architecture
- **Loose coupling** between components
- **Event handlers** for all interactions
- **Callback-based communication**

### Client-Server Model
- **Thin client**: Minimal game logic on client
- **Authoritative server**: All game state on server
- **Real-time synchronization**: Immediate state updates

### Object-Oriented Design
- **Class-based structure** for main components
- **Encapsulated state** within classes
- **Clear separation** of concerns

## Testing Strategy

### Manual Testing
- **Cross-browser testing**
- **Multiple concurrent sessions**
- **Network interruption handling**

### Debug Tools
- **Extensive console logging**
- **Real-time state inspection**
- **Server-client state comparison**

This documentation represents the complete multiplayer party system as implemented, including all the complexity, debugging features, and stylistic choices that have evolved through development. The system prioritizes real-time synchronization and server authority while maintaining a responsive user experience.