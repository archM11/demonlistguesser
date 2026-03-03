# DemonList Guessr - Status

## What This Program Is

DemonList Guessr is a web-based multiplayer Geometry Dash game where players watch demon gameplay videos and guess the demon's position on the official Demon List. The closer your guess to the actual position, the more points you earn.

**Tech Stack:** Vanilla JavaScript frontend, Node.js + Express + Socket.io backend, JSON data files (no database).

### Core Files

| File | Purpose |
|------|---------|
| `game.js` | Main game engine — all client-side game logic, UI, scoring, duel mechanics |
| `server.js` | Multiplayer backend — party management, authoritative game state, damage calculation |
| `multiplayer.js` | Socket.io client wrapper — bridges game.js to server.js via real-time events |
| `index.html` | Single-page app HTML structure |
| `styles.css` | All styling including duel health bars, clash animations, lobby UI |
| `data/demons_consolidated.json` | 621 demons with positions, video URLs, metadata (from Pointercrate + AreDL APIs) |

### Game Modes

- **Solo/Classic** — Single player, 5 rounds, score accumulation
- **Duels** — 1v1 health-based combat, 100 HP each, rounds until someone hits 0 HP
- **FFA (Free-For-All)** — 3+ players, individual scoring over 5 rounds
- **Teams** — Team-based scoring (partially implemented)

---

## How Duels Work (The Main Focus)

### Game Flow

1. **Lobby** — Host creates a party (generates a code), other player joins. Host selects "Duels" mode and starts the game.

2. **Each Round:**
   - Both players see the same demon's video/thumbnail
   - Both guess the demon's position (e.g. #42)
   - Scores calculated using a bell-curve formula (closer guess = more points)
   - Server calculates damage: `|player1Score - player2Score|` scaled by a round multiplier
   - The player with fewer points takes the damage

3. **Clash Animation (client-side):**
   - 200ms sync delay after both submit
   - `triggerDuelClash()` shows a 3.6s clash screen with score reveals and damage
   - `showDetailedDuelResults()` shows round summary with health bars
   - Host sees "Next Round" or "View Summary" button
   - Non-host sees "Waiting for host..."

4. **Victory:**
   - When a player reaches 0 HP, server emits `duelVictory` (after 3.8s delay for animation sync)
   - Host clicks "View Summary" which emits `duelViewSummary` to the server
   - Server broadcasts `duelViewSummary` to all other players
   - Both players transition to the game statistics screen showing final health, scores, and round performance

5. **After Game:**
   - Players can click "Back to Lobby" to return to the party setup screen
   - Players can click "Home" to leave the party (triggers a full page refresh)

### Key Architecture Details

- **Server-authoritative:** All damage, health, and scores are calculated on the server. Clients display what the server sends.
- **Separate party references:** `game.js` and `multiplayer.js` each maintain their own `this.currentParty` reference. After `nextRoundStarted`, `multiplayer.js` replaces its reference, but `game.js` keeps the old one. This caused stale health data bugs (now fixed via `pendingHealthUpdate`).
- **Socket events flow:** `submitScore` → `playerScoreSubmitted` → `roundComplete` → `nextRoundStarted` / `duelVictory`
- **Round multiplier:** Starts at 1.0x, increases by 0.2x each round (server-managed).

### Important Socket Events

| Event | Direction | Purpose |
|-------|-----------|---------|
| `submitScore` | Client → Server | Player submits their guess and score |
| `playerScoreSubmitted` | Server → Other clients | Notifies that a player submitted |
| `roundComplete` | Server → All clients | Round results with damage and health |
| `nextRound` | Client (host) → Server | Host advances to next round |
| `nextRoundStarted` | Server → All clients | New round begins |
| `duelVictory` | Server → All clients | Someone reached 0 HP |
| `duelViewSummary` | Client (host) → Server → Others | Host triggers game statistics screen |
| `showFinalResults` | Client → Server | FFA player requests final results |
| `partyEnded` | Server → Remaining clients | Host left, party disbanded |

---

## What We Fixed This Session

### Bug 1: Timer Not Stopping for First Guesser
**Problem:** When both players submitted guesses, the duel countdown kept running for the first guesser. The countdown would eventually overwrite the opponent's real score with 0.
**Root Cause:** `handlePlayerScoreSubmitted` in game.js had no branch for when the current user had already submitted and the opponent just submitted.
**Fix:** Added a branch that cancels the countdown and triggers the clash when both players have submitted.

### Bug 2: Health Bars Not Updating (30s Delay)
**Problem:** Health bars only updated after a 30-second timeout instead of immediately after both players submitted.
**Root Cause:** Server waited for a 30-second round timer before calling `handleRoundComplete()` for duels, even when both players had already submitted.
**Fix:** Changed server to auto-complete duel rounds immediately when all duel players (tracked via `duelHealth` keys) have submitted.

### Bug 3: Health Stale After Round 3+
**Problem:** Health bars showed correct values for rounds 1-2 but stale values from round 3 onward.
**Root Cause:** `game.js` and `multiplayer.js` maintain separate `currentParty` references that diverge after `nextRoundStarted`. `updateHealthAtGameSummary()` checked stale `currentParty.duelHealth` before checking `pendingHealthUpdate`.
**Fix:** Swapped priority — check `pendingHealthUpdate` first, fall back to `currentParty.duelHealth`.

### Bug 4: Health Not Reflecting on Winning Round
**Problem:** The final round's health update was consumed (set to null) during the clash screen before the UI could render it. The second render call fell through to stale data.
**Root Cause:** `pendingHealthUpdate` was nullified on the first call to `updateHealthAtGameSummary()` during `showClashScreen`, but `updateDuelDisplay()` bailed because the clash screen was blocking. On the second call during `showDetailedDuelResults`, the data was gone.
**Fix:** Stopped nullifying `pendingHealthUpdate` in `updateHealthAtGameSummary()`. Instead, clear it in `startNewRound()`.

### Bug 5: Game-End Failures (3 issues)
**Problems:**
- P1 (host) showed wrong HP and "Battle continues..." on victory screen
- P2 (non-host) stuck on "Waiting for host..." screen
- Phantom extra round with undefined points

**Root Causes & Fixes:**
- Server's `nextRound` handler silently returned when dead player detected → Changed to re-emit `duelVictory` to all players
- `handleDuelVictory` used potentially stale `pendingHealthUpdate` instead of server's authoritative `data.finalHealth` → Always use `data.finalHealth`
- `submitGuess()` had no guard against being called after game end → Added `isFinished`/`duelWinner` guard
- Button click handler registered twice (`onclick` + `addEventListener`) → Removed duplicate

### Bug 6: Non-Host Not Transitioning to Game Statistics
**Problem:** When the host clicked "View Summary" after a duel ended, the non-host stayed on the detailed results screen instead of going to game statistics.
**Root Cause:** The host was calling `nextRound()` which went through the `nextRound` handler → re-emitted `duelVictory`. This indirect path had timing issues and also collided with the existing `showFinalResults` FFA handler.
**Fix:** Created a dedicated `duelViewSummary` socket event. Host emits it, server broadcasts to other players, non-host transitions to game statistics. Removed the premature auto-transition from `handleDuelVictory` that was sending the non-host to game stats before the host clicked the button.

### Bug 7: Server Crash After Game Summary
**Problem:** Both players disconnected after a few seconds on the summary screen.
**Root Cause:** The new `showFinalResults` event name collided with an existing FFA handler (server.js line 729) that expected `data.partyCode`. The host emitted `showFinalResults` with no data, causing `TypeError: Cannot read properties of undefined (reading 'partyCode')` which crashed the server.
**Fix:** Renamed the event to `duelViewSummary` across all three files.

### Improvement: Page Refresh on Leave
**Change:** When any player clicks "Home" from a party context, the browser now does a full page refresh instead of just navigating to the home screen. This ensures clean state and prevents the host from seeing a "Host left the party" notification about themselves.

---

## What We Want to Achieve

### Immediate Goals
- Stable, bug-free duel experience from start to finish (lobby → game → results → lobby)
- Both players see correct health, damage, scores, and round data at all times
- Clean transitions between all screens for both host and non-host
- No server crashes during normal gameplay flow

### Known Remaining Issues
- FFA mode has various bugs (not yet investigated this session)
- Teams mode is partially implemented
- `PROJECT_STATUS.md` is outdated and describes bugs that have been fixed
- Extensive debug logging still present in code (can be cleaned up once stable)
- The 3.8s `duelVictory` delay in `handleRoundComplete` (line 1057 server.js) creates a tight race with the 3.6s + 200ms client-side clash animation — could cause issues if network latency varies

### Future Goals
- Clean up debug logging throughout codebase
- Stabilize FFA and Teams modes
- Production deployment (Railway.app support exists)
- Expanded demon list / data sources
- Better error handling and resilience (server should not crash on malformed events)
- Potential database integration for persistent stats/leaderboards
