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
| `updateDemons.js` | Auto-update module — fetches demon data from AREDL + Pointercrate APIs on startup and every 24h |
| `index.html` | Single-page app HTML structure |
| `styles.css` | All styling including duel health bars, clash animations, lobby UI |
| `data/demons_consolidated.json` | 1,430 demons with positions, video URLs, metadata (auto-updated from AREDL + Pointercrate APIs) |

### Game Modes

- **Solo/Classic** — Single player, 5 rounds, score accumulation
- **Duels** — 1v1 health-based combat, configurable starting HP (1-10000, default 100), rounds until someone hits 0 HP
- **FFA (Free-For-All)** — 3+ players, individual scoring over 5 rounds
- **Teams** — Team-based scoring (partially implemented)

---

## How Duels Work (The Main Focus)

### Game Flow

1. **Lobby** — Host creates a party (generates a code), other player joins. Host selects "Duels" mode, configures starting HP (default 100), and starts the game.

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

5. **Player Leaves:**
   - If either player leaves a 1v1 duel (lobby or mid-game), the party is disbanded immediately
   - The remaining player receives a "player left the duel" notification and returns to home

6. **After Game:**
   - Players can click "Back to Lobby" to return to the party setup screen
   - Players can click "Home" to leave the party (triggers a full page refresh)

### Key Architecture Details

- **Server-authoritative:** All damage, health, and scores are calculated on the server. Clients display what the server sends.
- **Separate party references:** `game.js` and `multiplayer.js` each maintain their own `this.currentParty` reference. After `nextRoundStarted`, `multiplayer.js` replaces its reference, but `game.js` keeps the old one. This caused stale health data bugs (now fixed via `pendingHealthUpdate`).
- **Socket events flow:** `submitScore` -> `playerScoreSubmitted` -> `roundComplete` -> `nextRoundStarted` / `duelVictory`
- **Round multiplier:** Starts at 1.0x, increases by 0.2x each round (server-managed).
- **Health lookups use `duelHealth` keys:** Opponent ID is resolved from `Object.keys(duelHealth)` rather than `party.members` to survive disconnects.

### Important Socket Events

| Event | Direction | Purpose |
|-------|-----------|---------|
| `submitScore` | Client -> Server | Player submits their guess and score |
| `playerScoreSubmitted` | Server -> Other clients | Notifies that a player submitted |
| `roundComplete` | Server -> All clients | Round results with damage and health |
| `nextRound` | Client (host) -> Server | Host advances to next round |
| `nextRoundStarted` | Server -> All clients | New round begins |
| `duelVictory` | Server -> All clients | Someone reached 0 HP |
| `duelViewSummary` | Client (host) -> Server -> Others | Host triggers game statistics screen |
| `showFinalResults` | Client -> Server | FFA player requests final results |
| `partyEnded` | Server -> Remaining clients | Player left duel, or host left party |

---

## What We Fixed (Session 1)

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
**Fix:** Swapped priority -- check `pendingHealthUpdate` first, fall back to `currentParty.duelHealth`.

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
- Server's `nextRound` handler silently returned when dead player detected -> Changed to re-emit `duelVictory` to all players
- `handleDuelVictory` used potentially stale `pendingHealthUpdate` instead of server's authoritative `data.finalHealth` -> Always use `data.finalHealth`
- `submitGuess()` had no guard against being called after game end -> Added `isFinished`/`duelWinner` guard
- Button click handler registered twice (`onclick` + `addEventListener`) -> Removed duplicate

### Bug 6: Non-Host Not Transitioning to Game Statistics
**Problem:** When the host clicked "View Summary" after a duel ended, the non-host stayed on the detailed results screen instead of going to game statistics.
**Root Cause:** The host was calling `nextRound()` which went through the `nextRound` handler -> re-emitted `duelVictory`. This indirect path had timing issues and also collided with the existing `showFinalResults` FFA handler.
**Fix:** Created a dedicated `duelViewSummary` socket event. Host emits it, server broadcasts to other players, non-host transitions to game statistics. Removed the premature auto-transition from `handleDuelVictory` that was sending the non-host to game stats before the host clicked the button.

### Bug 7: Server Crash After Game Summary
**Problem:** Both players disconnected after a few seconds on the summary screen.
**Root Cause:** The new `showFinalResults` event name collided with an existing FFA handler (server.js line 729) that expected `data.partyCode`. The host emitted `showFinalResults` with no data, causing `TypeError: Cannot read properties of undefined (reading 'partyCode')` which crashed the server.
**Fix:** Renamed the event to `duelViewSummary` across all three files.

### Improvement: Page Refresh on Leave
**Change:** When any player clicks "Home" from a party context, the browser now does a full page refresh instead of just navigating to the home screen. This ensures clean state and prevents the host from seeing a "Host left the party" notification about themselves.

---

## What We Fixed (Session 2 -- 2026-03-03)

### Feature: Adjustable HP Setting for 1v1 Duels
**Change:** Duel health is no longer hardcoded to 100. Host can now configure starting HP (1-10000) in the duel lobby via a number input that appears when "Duels" mode is selected.
**Files:** `index.html` (new `duelHpSection`), `game.js` (show/hide logic, read value, pass in `gameData`, all health bar displays use `duelHpMax` for percentage/text), `server.js` (accept `duelHp`, store as `party.duelHpSetting`, use for all health initialization).
**Key detail:** `updateGameType` no longer pre-initializes `duelHealth` with values -- it just clears it. `startGame` is the sole place health is initialized from the configured HP, ensuring the host's chosen value is always used.

### Bug Fix: URL Not Cleaned When Host Leaves
**Problem:** When the host left a party, the non-host was kicked back to the home screen but the `?party=XXXX` parameter remained in the browser URL.
**Root Cause:** There were two `handlePartyEnded()` methods in `game.js` (lines 1727 and 1850). The second one (which overrides the first) was missing `window.history.replaceState()` to clean the URL.
**Fix:** Added URL cleanup to the active `handlePartyEnded` method.

### Bug Fix: Socket Reconnection Desync (Guesses Not Communicated)
**Problem:** After ~2 minutes of idle time during a duel round, the host's guess was never received by the non-host, and vice versa. Both players' submissions went into the void.
**Root Cause:** Socket.IO connections can silently disconnect and reconnect during idle periods. On reconnect, the client gets a **new socket ID** but never rejoined the party on the server. The server still mapped the old (dead) socket ID to the party member, so all events (`playerScoreSubmitted`, `roundComplete`) were sent to the dead socket.
**Fixes (5 changes across 3 files):**

1. **Client auto-rejoin** (`multiplayer.js` `connect` handler): On socket reconnect, if we have a `currentParty`, automatically emit `rejoinParty` to re-associate the new socket ID with the party.

2. **Server grace period** (`server.js` disconnect handler): ALL in-party disconnects now get a 10-second grace period before `handlePlayerLeave` fires. Previously only post-game disconnects had this. Gives time for the socket to reconnect and rejoin without auto-submitting 0 or removing the player.

3. **Server rejoin state migration** (`server.js` `rejoinParty` handler): When a player rejoins, all game state references (`scores`, `guesses`, `totalScores`, `submittedPlayers`, `duelHealth`, `roundScores`) are migrated from the old socket ID to the new one. Also cleans up old `userParties` mapping.

4. **Client disconnect resilience** (`multiplayer.js` disconnect handler): No longer immediately sets `hasLeftGame = true` and triggers aggressive cleanup on transient disconnects. Waits 12 seconds -- only if still disconnected then treats it as permanent.

5. **Countdown safety** (`game.js` `startDuelCountdown`): The 15-second countdown no longer calls `triggerDuelClash()` client-side when it expires. It only auto-submits a score of 0 to the server if the current player is the one who didn't guess. The server's `roundComplete` event is the sole trigger for advancing the round, preventing client-server desync.

---

## What We Fixed (Session 3 -- 2026-05-04)

### Feature: Auto-Updating Demon List
**Change:** The demon list is no longer manually maintained. `updateDemons.js` fetches all demons from the AREDL API (1,430 active demons, public, no auth) and video URLs from the Pointercrate API (673 demons). The server runs this on startup and every 24 hours.
**Result:** Demon count went from 1,391 (stale since March) to 1,430 with 567 video URLs (up from 180).
**Files:** New `updateDemons.js`, integrated into `server.js` startup.

### Feature: Shared Avatar Pictures in Multiplayer
**Change:** Custom avatar pictures (uploaded via profile) are now visible to other players in party lobbies and during games. Previously only the uploading player could see their own avatar; others saw just the first letter of the username.
**Implementation:** Client sends `customAvatar` (base64, 100x100 JPEG) when creating/joining/rejoining a party. Server stores it on the member object and includes it in `getSafePartyObject()`. All avatar rendering code (FFA member list, duels visual, teams, multiplayer player list) checks `member.customAvatar`.

### Feature: 1v1 Duel Auto-Disband on Leave
**Change:** When either player leaves a 1v1 duel (in lobby or mid-game), the party is immediately disbanded. The remaining player gets a notification and returns to the home screen with all game UI cleaned up.
**Previous behavior:** The game tried to continue with one player, leading to broken state.

### Bug Fix: FFA Timer Disappearing
**Problem:** If at least one player didn't guess in a given FFA round, the timer disappeared for all players on the next round.
**Root Cause:** `showFFAWaitingState()` hid the `.game-header` (which contains the timer display), but `startNewRound()` never restored it.
**Fix:** Added `gameHeader.style.display = ''` in `startNewRound()`. Also fixed server round timer to use the host's configured FFA timer setting instead of a hardcoded 30 seconds.

### Bug Fix: Notifications Staying Forever
**Problem:** Popup notifications (like "Party code copied") never disappeared.
**Root Cause:** `showNotification()` had a `return` statement before the auto-hide `setTimeout` code, making the timeout unreachable.
**Fix:** Moved the `return` after the timeout setup.

### Bug Fix: Health Showing 0 When Opponent Disconnects
**Problem:** When an opponent left mid-duel, the health bar showed 0/HP instead of the actual remaining HP.
**Root Cause:** Health lookups used `this.currentParty.members` to find the opponent ID. When the opponent left, they were removed from `members`, so `opponentId` was `undefined` and health defaulted to 0.
**Fix:** Changed all health-related lookups to use `Object.keys(this.currentGame.duelHealth)` to find the opponent, which persists after disconnect.

### Bug Fix: Party Code URL Not Resetting on Refresh
**Problem:** Refreshing the page kept `?party=XXXX` in the URL and tried to auto-join a stale party.
**Fix:** Distinguish invite links (new tab, no `sessionStorage`) from page refreshes (existing session). On refresh, clean the URL and go to home. Invite links from new tabs still work.

### Bug Fix: Game Overlays Persisting After Party Ends
**Problem:** When a party ended (e.g., opponent left duel), the "GUESS SUBMITTED / Waiting for opponent" overlay remained on screen over the home page.
**Fix:** Added `cleanupGameUI()` and `stopCurrentVideo()` calls to `handlePartyEnded()`.

### UI Improvements
- Removed "Demon List Status" banner from home screen
- Removed "Copy Invite Link" button (kept "Copy Code")
- Removed "Back to Lobby" button from daily challenge results
- Removed up/down spinner arrows from guess input and HP input
- Guess input placeholder simplified to "Enter placement"
- Added "Leave" button to all full-screen game overlays (FFA waiting, FFA reveal, duel waiting, team waiting)
- Party code input always starts blank (no autofill from previous session)
- Player names shown instead of "You" in party lobby member list
- Player management/member list now visible for duels mode (was FFA-only)

---

## What We Fixed (Session 4 -- 2026-05-06)

### Feature: Full Spectator System
**Change:** Players can now spectate party games. The host can toggle any player (including themselves in FFA/Teams) between Participating and Spectating via the Party Members list.
**Behavior:**
- Spectators stay on the party lobby during games with a "Live Game" panel showing real-time scores (FFA) or health bars (duels/teams)
- Spectators are blocked from all game UI (game screen, results screen, FFA reveal, duel clash, etc.) via `wasSpectator` flag that persists for the entire game
- Spectators are removed from team rosters and can't join teams
- For duels with 3+ players: host always plays, one random opponent is auto-selected, rest spectate. Host can swap who plays. Only 1 non-host can be active.
- Spectators get "Game has ended" notification when the game finishes. Their spectator status persists between games (host decides who plays next)
- Mid-game joiners auto-spectate

### Feature: Improved Scoring System
**Change:** Rebalanced the bell-curve scoring:
- Main list (1-75): stricter, 50 pts at 8 off (was 15)
- Extended list (76-150): stricter, 50 pts at 15 off (was 30)
- Legacy list (151+): much more lenient, 50 pts at 150 off (was 50)
- Timeout guess changed from 999 to 10000, displayed as "No guess"

### Feature: Profile Stats
**Change:** Profile now shows: Games Played, Best Score, Total Score, Perfect Guesses, Duel/Team Win Rate, FFA Win Rate. Win detection is real (checks health/scores, not random).

### Feature: Leaderboard Tabs
**Change:** Leaderboard now has Daily, FFA Wins, and Duel/Team Wins tabs. Wins are submitted to the server and aggregated per player.

### Feature: Individual "View Final Results" Button
**Change:** In duels/teams, when a player dies (game over), ALL players get their own "View Final Results" button instead of non-hosts seeing "Waiting for host..."

### Bug Fix: FFA Double Submission
**Problem:** When the FFA timer expired after a player already submitted, `submitGuess(true)` fired again and overwrote the real guess with 10000/0 pts.
**Fix:** Added `hasSubmittedThisRound` flag to prevent double submission in FFA.

### Bug Fix: Timer Showing -1
**Problem:** Timer display showed -1s briefly before auto-submitting.
**Fix:** Timer now shows 0s and submits immediately when reaching 0.

### Bug Fix: Multiplier Increment
**Change:** Damage multiplier now increases by 0.5x every 3 rounds (was 0.2x every round). Stays at 1.0x for rounds 1-3.

### Bug Fix: Host Not Shown in Party Members
**Problem:** When the host was alone in a party, the Party Members list was empty.
**Fix:** Added `updatePartyDisplay()` call to `handlePartyCreated`.

### UI Improvements
- Replaced all browser `alert()` popups with in-game notifications
- Video stops playing at round summary (not on guess submit)
- Social links (Discord, YouTube) added to home screen bottom-right
- Host can set themselves as spectator in FFA/Teams (not duels)
- Party Members list visible for all game types (was hidden for teams)

---

## What We Fixed (Session 5 -- 2026-05-09)

### Bug Fix: Preserved Health Between Games
**Problem:** Starting a new duel game preserved health from the previous game — a player who lost (0 HP) would start the next game at 0 HP and instantly lose.
**Fix:** Always initialize fresh health for every new game, removed preservation logic.

### Bug Fix: Double Submission Overwriting Guesses (All Modes)
**Problem:** Timer fired `submitGuess(true)` after player already submitted, overwriting real guess with 10000. Only guarded for FFA, not duels/teams/solo.
**Fix:** `hasSubmittedThisRound` guard now applies to ALL game types. Flag reset in `startNewRound()` for both solo and multiplayer.

### Bug Fix: View Final Results Forcing All Players
**Problem:** Host clicking "View Final Results" broadcast `duelViewSummary` to all players, forcing everyone to the results screen.
**Fix:** `showFinalResults` server handler now always sends only to the requesting player. Removed legacy broadcast code. All players use individual `viewFinalResults()`.

### Bug Fix: View Final Results Button Not Working
**Problem:** The `addEventListener` handler removed the overlay before the `onclick` handler could fire, leaving the host on a blank game screen.
**Fix:** Call `viewFinalResults()` directly in the event handler instead of returning.

### Bug Fix: Teams Win/Loss Inconsistency
**Problem:** Players on the same team saw different Victory/Defeat results. `myTeam` defaulted to 'team1' when null, and winner comparison used socket ID instead of team ID.
**Fix:** Re-derive `myTeam` from party data at results time. Compare `winnerId` against team ID only.

### Bug Fix: Auto-Assign Spectators with Host Spectating
**Problem:** When host set themselves to spectate in duels, only 1 active player remained instead of 2.
**Fix:** `autoAssignDuelSpectators` now checks total active count (not just non-host) and ensures exactly 2 active players.

### Bug Fix: Thumbnail Mode Missing for All Game Types
**Problem:** Thumbnail mode included demons without videos, causing blank screens in teams/duels/FFA.
**Fix:** All modes now require demons to have a video URL.

### Improvements
- Enter key joins party from code input
- Host can spectate in duels (with exactly 2 other active players)
- Teamless players auto-spectate when teams game starts
- Start button hidden during active game for spectating host
- Server blocks starting new game while one is in progress
- Removed browser `confirm()` dialogs for quit and kick actions
- Leave button added to detailed duel/team results overlay
- Video stops in team detailed results (was only stopping for duels)
- Individual "View Final Results" for all players (host no longer forces others)

---

## What We Want to Achieve

### Immediate Goals
- Stable, bug-free experience across all game modes
- Clean transitions between all screens for all player types

### Known Remaining Issues
- Duplicate method definitions in `game.js` (two `handlePartyEnded`, two `showJoinParty`, etc.) -- second overrides first
- Debug logging throughout codebase needs cleanup
- Untracked utility scripts in repo root (fetch_*.py, merge_*.py, etc.)

### Future Goals
- Clean up debug logging throughout codebase
- Remove dead code (duplicate methods, unused branches)
- Production deployment (Railway.app support exists)
- Better error handling and resilience (server should not crash on malformed events)
- Potential database integration for persistent stats/leaderboards
