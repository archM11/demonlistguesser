const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Middleware for parsing JSON
app.use(express.json());
app.use(express.text());

// REFRESH FIX: Handle leave party via HTTP (for sendBeacon)
// Uses same grace period as socket disconnect to allow page refreshes
app.post('/api/leave-party', (req, res) => {
    try {
        const data = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { socketId, partyCode } = data;

        if (socketId && partyCode) {
            const party = parties.get(partyCode);
            if (party) {
                const member = party.members.find(m => m.id === socketId);
                if (member) {
                    // Use grace period instead of instant removal — player may be refreshing
                    if (!member._graceTimer) {
                        const context = party.gameState?.inProgress ? 'active game' : 'lobby/post-game';
                        console.log(`[GRACE-HTTP] Player ${member.name} left via beacon during ${context} — waiting 10s for rejoin`);
                        member._disconnectedAt = Date.now();
                        member._graceTimer = setTimeout(() => {
                            if (member._disconnectedAt) {
                                console.log(`[GRACE-HTTP] Player ${member.name} did not rejoin — removing`);
                                delete member._disconnectedAt;
                                delete member._graceTimer;
                                handlePlayerLeave(socketId);
                            }
                        }, 10000);
                    }
                }
            }
        }

        res.status(200).send('OK');
    } catch (err) {
        console.error('[HTTP] Error handling leave-party:', err);
        res.status(500).send('Error');
    }
});

// --- Leaderboard persistence ---
const LEADERBOARD_PATH = path.join(__dirname, 'data', 'leaderboard.json');
let leaderboardScores = [];

// Load existing scores from disk
try {
    if (fs.existsSync(LEADERBOARD_PATH)) {
        const raw = fs.readFileSync(LEADERBOARD_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        leaderboardScores = Array.isArray(parsed.scores) ? parsed.scores : [];
        console.log(`Loaded ${leaderboardScores.length} leaderboard scores from disk`);
    }
} catch (err) {
    console.warn('Could not load leaderboard.json, starting fresh:', err.message);
}

function saveLeaderboard() {
    fs.writeFile(LEADERBOARD_PATH, JSON.stringify({ scores: leaderboardScores }, null, 2), (err) => {
        if (err) console.error('Failed to save leaderboard:', err.message);
    });
}

app.post('/api/leaderboard/submit', (req, res) => {
    const { name, score } = req.body;
    if (!name || typeof score !== 'number') {
        return res.status(400).json({ error: 'name (string) and score (number) required' });
    }
    const entry = {
        name: String(name).slice(0, 30),
        score: Math.round(score),
        date: new Date().toDateString(),
        time: Date.now()
    };
    leaderboardScores.push(entry);
    saveLeaderboard();
    res.json({ success: true });
});

app.get('/api/leaderboard', (req, res) => {
    const type = req.query.type || 'daily';
    const today = new Date();
    let results = [];

    if (type === 'daily') {
        const todayStr = today.toDateString();
        results = leaderboardScores
            .filter(s => s.date === todayStr)
            .sort((a, b) => b.score - a.score)
            .slice(0, 50);
    } else if (type === 'weekly') {
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        const weekScores = leaderboardScores.filter(s => new Date(s.date) >= weekAgo);
        // Best score per player per day, then sort
        const bestByPlayer = new Map();
        for (const s of weekScores) {
            const existing = bestByPlayer.get(s.name);
            if (!existing || s.score > existing.score) {
                bestByPlayer.set(s.name, s);
            }
        }
        results = [...bestByPlayer.values()]
            .sort((a, b) => b.score - a.score)
            .slice(0, 50);
    } else {
        // alltime — best score per player ever
        const bestByPlayer = new Map();
        for (const s of leaderboardScores) {
            const existing = bestByPlayer.get(s.name);
            if (!existing || s.score > existing.score) {
                bestByPlayer.set(s.name, s);
            }
        }
        results = [...bestByPlayer.values()]
            .sort((a, b) => b.score - a.score)
            .slice(0, 50);
    }

    res.json(results);
});

// Serve static files with no-cache headers
app.use(express.static('.', {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js') || filePath.endsWith('.html') || filePath.endsWith('.css')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

// Serve index.html with cache-busting
app.get('/', (req, res) => {
    const filePath = path.join(__dirname, 'index.html');
    const timestamp = Date.now();
    
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            res.status(404).send('File not found');
            return;
        }
        
        // Inject cache-busting timestamp
        const modifiedHtml = data.replace(
            '<script src="game.js"></script>',
            `<script src="game.js?v=${timestamp}"></script>`
        );
        
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.send(modifiedHtml);
    });
});
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// In-memory storage with Maps for parties and game state
const parties = new Map(); // partyCode -> party object
const userParties = new Map(); // socketId -> partyCode

// Helper function to create a safe party object for sending via Socket.io
// Prevents circular references that can cause "Maximum call stack size exceeded" errors
function getSafePartyObject(party) {
    if (!party) return null;

    return {
        code: party.code,
        host: party.host,  // CRITICAL FIX: Was "hostId" but server stores "host"
        members: party.members.map(m => ({
            id: m.id,
            name: m.name,
            socketId: m.socketId,
            spectator: m.spectator || false
        })),
        gameType: party.gameType,
        settings: party.settings,
        duelHealth: party.duelHealth,
        teams: party.teams,
        gameState: party.gameState ? {
            inProgress: party.gameState.inProgress,
            currentRound: party.gameState.currentRound,
            totalRounds: party.gameState.totalRounds,
            isComplete: party.gameState.isComplete
        } : null,
        duelState: party.duelState ? {
            roundMultiplier: party.duelState.roundMultiplier
        } : null
    };
}

// Generate 6-character uppercase party code
function generatePartyCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Ensure unique party code
function generateUniquePartyCode() {
    let code;
    do {
        code = generatePartyCode();
    } while (parties.has(code));
    return code;
}

io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    // Create party
    socket.on('createParty', (data) => {
        const { username } = data;
        const code = generateUniquePartyCode();
        
        const party = {
            code: code,
            host: socket.id,
            members: [{
                id: socket.id,
                name: username,
                avatar: username.charAt(0).toUpperCase() || 'H'
            }],
            gameType: "ffa", // Default to FFA, can be changed to teams/duels
            gameState: {
                gameData: null,
                scores: {},
                guesses: {},
                currentRound: 0,
                roundScores: {}, // Track scores per round per player
                totalScores: {},  // Track total scores across all rounds
                submittedPlayers: new Set() // Track which players have submitted this round
            },
            duelHealth: {}, // For duel mode - maps player IDs to health values
            duelState: {
                clashReady: false,
                roundScores: {},
                pendingResults: {},
                hasServerHealth: false,
                roundMultiplier: 1.0 // Starts at 1x, increases each round
            },
            teams: {
                team1: { name: 'Team 1', members: [] },
                team2: { name: 'Team 2', members: [] }
            }
        };

        parties.set(code, party);
        userParties.set(socket.id, code);
        
        console.log(`Party created: ${code} by ${username}`);
        socket.emit('partyCreated', { party: getSafePartyObject(party), code });
    });

    // Join party
    socket.on('joinParty', (data) => {
        const { code, username } = data;
        const party = parties.get(code);
        
        if (!party) {
            socket.emit('joinError', { message: 'Party not found' });
            console.log(`Party not found: ${code}`);
            return;
        }

        // Check if user already in party
        const existingMember = party.members.find(m => m.id === socket.id);
        if (!existingMember) {
            const newMember = {
                id: socket.id,
                name: username,
                avatar: username.charAt(0).toUpperCase() || 'P',
                spectator: !!party.gameState?.inProgress
            };
            party.members.push(newMember);

            // SOLUTION 1: Don't auto-switch to duels or initialize health
            // Keep the party's existing gameType (default is 'ffa')
            // Health will be initialized when game actually starts
        }

        userParties.set(socket.id, code);
        
        console.log(`${username} joined party: ${code} (${party.members.length}/8 players)`);
        socket.emit('joinSuccess', getSafePartyObject(party));
        
        // SOLUTION 1: Force complete party refresh when party size changes (member joins)
        setTimeout(() => {
            party.members.forEach(member => {
                io.to(member.id).emit('forcePartyRefresh', {
                    party: getSafePartyObject(party),
                    forceUpdate: true,
                    reason: 'memberJoined'
                });
            });
        }, 100);
    });

    // Update game type (FFA, Teams, Duels)
    // Handle rejoining a party after page refresh
    socket.on('rejoinParty', (data) => {
        const { partyCode, username, wasHost, gameState, oldSocketId } = data;
        const party = parties.get(partyCode);

        if (!party) {
            socket.emit('joinError', { message: 'Party expired or not found' });
            return;
        }

        // Prefer matching by old socket ID (exact match), fall back to username
        let existingMember = null;
        if (oldSocketId) {
            existingMember = party.members.find(m => m.id === oldSocketId);
        }
        if (!existingMember) {
            existingMember = party.members.find(m => m.name === username);
        }
        
        if (existingMember) {
            // Cancel grace-period removal timer if pending
            if (existingMember._graceTimer) {
                clearTimeout(existingMember._graceTimer);
                delete existingMember._graceTimer;
                delete existingMember._disconnectedAt;
                console.log(`[GRACE] Cancelled removal timer for ${username}`);
            }

            // Update socket ID for existing member
            const oldId = existingMember.id;
            existingMember.id = socket.id;
            existingMember.disconnected = false;

            // Update duelHealth keys if needed
            if (party.duelHealth && party.duelHealth[oldId] !== undefined) {
                party.duelHealth[socket.id] = party.duelHealth[oldId];
                delete party.duelHealth[oldId];
            }

            // Update host if needed
            if (party.host === oldId) {
                party.host = socket.id;
            }

            // Migrate team membership from old socket ID to new
            if (party.teams) {
                for (const tid of ['team1', 'team2']) {
                    if (party.teams[tid]?.members) {
                        const idx = party.teams[tid].members.indexOf(oldId);
                        if (idx !== -1) {
                            party.teams[tid].members[idx] = socket.id;
                        }
                    }
                }
            }

            // Migrate active game state references from old socket ID to new
            if (party.gameState) {
                if (party.gameState.scores?.[oldId] !== undefined) {
                    party.gameState.scores[socket.id] = party.gameState.scores[oldId];
                    delete party.gameState.scores[oldId];
                }
                if (party.gameState.guesses?.[oldId] !== undefined) {
                    party.gameState.guesses[socket.id] = party.gameState.guesses[oldId];
                    delete party.gameState.guesses[oldId];
                }
                if (party.gameState.totalScores?.[oldId] !== undefined) {
                    party.gameState.totalScores[socket.id] = party.gameState.totalScores[oldId];
                    delete party.gameState.totalScores[oldId];
                }
                if (party.gameState.submittedPlayers?.has(oldId)) {
                    party.gameState.submittedPlayers.delete(oldId);
                    party.gameState.submittedPlayers.add(socket.id);
                }
            }
            if (party.duelState?.roundScores?.[oldId] !== undefined) {
                party.duelState.roundScores[socket.id] = party.duelState.roundScores[oldId];
                delete party.duelState.roundScores[oldId];
            }

            // Clean old mapping
            userParties.delete(oldId);

            console.log(`Player ${username} rejoined party ${partyCode} (${oldId} -> ${socket.id})`);
        } else {
            // Add as new member if not found
            const newMember = {
                id: socket.id,
                name: username,
                avatar: username.charAt(0).toUpperCase() || 'P',
                spectator: !!party.gameState?.inProgress
            };
            party.members.push(newMember);
            
            // Initialize health for duels if needed
            if (party.gameType === 'duels' && !party.duelHealth[socket.id]) {
                party.duelHealth[socket.id] = party.duelHpSetting || 100;
            }
        }
        
        userParties.set(socket.id, partyCode);
        socket.join(partyCode);

        // If a finished game exists, reset to clean lobby state so players
        // land back in the party setup screen instead of a stale game.
        if (party.gameState?.isComplete && !party.gameState?.inProgress) {
            console.log(`[REJOIN] Game finished — resetting state for party ${partyCode}`);
            party.gameState = {
                gameData: null,
                scores: {},
                guesses: {},
                currentRound: 0,
                roundScores: {},
                totalScores: {},
                submittedPlayers: new Set()
            };
            party.duelHealth = {};
            party.duelState = {
                clashReady: false,
                roundScores: {},
                pendingResults: {},
                hasServerHealth: false,
                roundMultiplier: 1.0
            };
        }

        // Send success with current party state
        socket.emit('joinSuccess', getSafePartyObject(party));

        // If game is in progress, send game state to rejoining player
        if (party.gameState?.inProgress) {
            socket.emit('gameStarted', {
                party,
                gameState: party.gameState,
                round: party.gameState.currentRound
            });
        }

        // Notify other members
        socket.to(partyCode).emit('partyUpdated', getSafePartyObject(party));
    });
    
    // Join a team (for Teams mode)
    socket.on('joinTeam', (data) => {
        const partyCode = userParties.get(socket.id);
        const party = parties.get(partyCode);

        if (!party) return;

        const { teamId } = data;
        if (teamId !== 'team1' && teamId !== 'team2') return;

        // Remove from old team
        for (const tid of ['team1', 'team2']) {
            if (party.teams[tid]) {
                party.teams[tid].members = party.teams[tid].members.filter(id => id !== socket.id);
            }
        }

        // Add to new team (max 10)
        if (party.teams[teamId].members.length < 10) {
            party.teams[teamId].members.push(socket.id);
        }

        console.log(`Player ${socket.id} joined ${teamId} in party ${partyCode}`);

        // Broadcast updated party to all members
        party.members.forEach(member => {
            io.to(member.id).emit('forcePartyRefresh', {
                party: getSafePartyObject(party),
                forceUpdate: true,
                reason: 'teamJoined'
            });
        });
    });

    socket.on('movePlayerToTeam', (data) => {
        const partyCode = userParties.get(socket.id);
        const party = parties.get(partyCode);

        if (!party) return;
        if (party.host !== socket.id) return;

        const { playerId, teamId } = data;
        if (teamId !== 'team1' && teamId !== 'team2') return;
        if (!party.members.find(m => m.id === playerId)) return;

        // Remove from old team
        for (const tid of ['team1', 'team2']) {
            if (party.teams[tid]) {
                party.teams[tid].members = party.teams[tid].members.filter(id => id !== playerId);
            }
        }

        // Add to new team (max 10)
        if (party.teams[teamId].members.length < 10) {
            party.teams[teamId].members.push(playerId);
        }

        console.log(`Host ${socket.id} moved player ${playerId} to ${teamId} in party ${partyCode}`);

        // Broadcast updated party to all members
        party.members.forEach(member => {
            io.to(member.id).emit('forcePartyRefresh', {
                party: getSafePartyObject(party),
                forceUpdate: true,
                reason: 'playerMoved'
            });
        });
    });

    socket.on('updateGameType', (data) => {
        const partyCode = userParties.get(socket.id);
        const party = parties.get(partyCode);
        
        if (!party || party.host !== socket.id) {
            socket.emit('error', { message: 'Only host can change game type' });
            return;
        }

        party.gameType = data.gameType;

        // Store duel HP setting if provided
        if (data.duelHp) {
            party.duelHpSetting = Math.max(1, Math.min(10000, parseInt(data.duelHp) || 100));
        }

        // Clear stale duel health when switching to duels or teams
        // Actual health initialization happens in startGame with the configured HP
        if (data.gameType === 'duels' || data.gameType === 'teams') {
            party.duelHealth = {};
        }

        // Reset team rosters when switching to teams
        if (data.gameType === 'teams') {
            party.teams = {
                team1: { name: 'Team 1', members: [] },
                team2: { name: 'Team 2', members: [] }
            };
        }

        console.log(`Game type changed to: ${data.gameType} in party: ${partyCode}`);
        
        // SOLUTION 1: Force complete party refresh for ALL members
        party.members.forEach(member => {
            io.to(member.id).emit('forcePartyRefresh', {
                party: getSafePartyObject(party),
                forceUpdate: true,
                reason: 'gameTypeChanged'
            });
        });
    });

    // Start game
    socket.on('startGame', (gameData) => {
        const partyCode = userParties.get(socket.id);
        const party = parties.get(partyCode);
        
        if (!party || party.host !== socket.id) {
            socket.emit('error', { message: 'Only host can start game' });
            return;
        }

        // CRITICAL FIX: Ensure gameState exists before setting properties
        if (!party.gameState) {
            party.gameState = {};
        }

        // Persist game settings on the party so they survive between games
        party.settings = {
            lists: gameData.lists,
            mode: gameData.mode,
            difficulty: gameData.difficulty,
            hints: gameData.hints,
            ffaTimer: gameData.ffaTimer,
            duelHp: gameData.duelHp
        };

        // Initialize comprehensive game state - clear all previous game data
        party.gameState.gameData = gameData;
        party.gameState.currentRound = 1;
        party.gameState.scores = {};
        party.gameState.guesses = {};
        party.gameState.roundScores = {};
        party.gameState.totalScores = {};
        party.gameState.submittedPlayers = new Set(); // Track submitted players to prevent duplicates
        party.gameState.inProgress = true; // Mark game as active
        party.gameState.isComplete = false; // Clear any previous completion flag

        // Clear spectator status so all members participate in the new game
        party.members.forEach(m => { m.spectator = false; });

        // Initialize total scores for all members
        party.members.forEach(member => {
            party.gameState.totalScores[member.id] = 0;
        });
        
        // Clear any leftover duel-specific state first, BUT PRESERVE HEALTH
        const preservedHealth = party.duelHealth ? { ...party.duelHealth } : null; // Create a COPY to avoid circular reference
        if (party.duelState) {
            delete party.duelState;
        }
        
        // Initialize team duel state if this is a teams game
        if (party.gameType === 'teams') {
            if (gameData.duelHp) {
                party.duelHpSetting = Math.max(1, Math.min(10000, parseInt(gameData.duelHp) || 100));
            }
            const teamHp = party.duelHpSetting || 100;

            party.duelState = {
                clashReady: false,
                roundScores: {},
                pendingResults: {},
                hasServerHealth: false,
                roundMultiplier: 1.0
            };

            // Health keyed by team ID, not player ID
            party.duelHealth = {
                'team1': teamHp,
                'team2': teamHp
            };

            console.log(`Initialized team duel health: team1=${teamHp}, team2=${teamHp}`);
        }

        // Initialize duel-specific state only if this is a duel game
        if (party.gameType === 'duels') {
            // Read and store duel HP setting from gameData
            if (gameData.duelHp) {
                party.duelHpSetting = Math.max(1, Math.min(10000, parseInt(gameData.duelHp) || 100));
            }
            const duelHp = party.duelHpSetting || 100;

            party.duelState = {
                clashReady: false,
                roundScores: {},
                pendingResults: {},
                hasServerHealth: false,
                roundMultiplier: 1.0
            };

            // Initialize duel health ONLY if it doesn't exist or this is the very first game
            if (!preservedHealth || Object.keys(preservedHealth).length === 0) {
                console.log(`Initializing fresh duel health with ${duelHp} HP`);
                party.duelHealth = {
                    [party.members[0].id]: duelHp,
                    [party.members[1].id]: duelHp
                };
            } else {
                console.log('Preserving existing duel health:', preservedHealth);
                party.duelHealth = { ...preservedHealth }; // Create a new object from preserved values
            }
        }

        console.log(`Game started in party: ${partyCode} with ${party.members.length} players`);
        console.log(`Game type: ${party.gameType}, Mode: ${gameData.mode}`);
        
        // Notify all party members with comprehensive game start data
        party.members.forEach(member => {
            io.to(member.id).emit('gameStarted', {
                party,
                gameData,
                seed: gameData.seed
            });
        });
        
        // Start round timer for FFA only — duels and teams have no time limit
        if (party.gameType !== 'duels' && party.gameType !== 'teams') {
        const ROUND_TIMEOUT = 30000; // 30 seconds

        party.roundTimer = setTimeout(() => {
            console.log(`Round timer expired for party: ${partyCode}. Force completing round...`);

            // Check if party and game still exist
            const currentParty = parties.get(partyCode);
            if (currentParty && currentParty.gameState && currentParty.gameState.inProgress) {
                const submittedCount = currentParty.gameState.submittedPlayers?.size || 0;
                const totalMembers = currentParty.members.filter(m => !m.spectator).length;
                const playersWhoLeft = currentParty.gameState.playersWhoLeft?.length || 0;

                console.log(`Timer forcing completion - Submitted: ${submittedCount}, Active: ${totalMembers}, Left: ${playersWhoLeft}`);

                // Add default scores for players who didn't submit
                if (currentParty.gameType === 'duels' && currentParty.duelHealth) {
                    console.log('🎮 [TIMER] Auto-submitting for players in duelHealth who haven\'t submitted');
                    Object.keys(currentParty.duelHealth).forEach(playerId => {
                        if (!currentParty.gameState.submittedPlayers.has(playerId)) {
                            console.log(`🎮 [TIMER] Adding default score 0 for non-submitting player: ${playerId}`);
                            currentParty.gameState.scores[playerId] = 0;
                            currentParty.gameState.guesses[playerId] = 999;
                            currentParty.gameState.submittedPlayers.add(playerId);
                        }
                    });
                }
                
                // Send update to all members
                currentParty.members.forEach(member => {
                    io.to(member.id).emit('playersUpdate', {
                        activePlayers: totalMembers,
                        submittedCount: submittedCount,
                        waitingFor: 0,
                        message: 'Time is up! Completing round with current submissions.'
                    });
                });
                
                handleRoundComplete(currentParty);
            } else {
                console.log(`Party no longer active or game not in progress`);
            }
        }, ROUND_TIMEOUT);
        } // end if not duels
    });

    // Submit score - handles both regular scores and duel-specific data
    socket.on('submitScore', (data) => {
        const partyCode = userParties.get(socket.id);
        const party = parties.get(partyCode);
        
        if (!party) {
            console.log(`❌ No party found for socket: ${socket.id}`);
            return;
        }

        const { score, guess, round, totalScore } = data;
        
        
        // CRITICAL FIX: Check for duplicate submissions to prevent double damage
        if (!party.gameState.submittedPlayers) {
            party.gameState.submittedPlayers = new Set();
        }
        
        if (party.gameState.submittedPlayers.has(socket.id)) {
            console.log(`Player ${socket.id} already submitted for current round - ignoring duplicate`);
            return;
        }
        
        // Mark player as submitted for this round
        party.gameState.submittedPlayers.add(socket.id);
        
        // Store both score and guess
        party.gameState.scores[socket.id] = score;
        party.gameState.guesses[socket.id] = guess;
        
        // Track this player as having submitted (initialize if needed)
        if (!party.gameState.submittedPlayers) {
            party.gameState.submittedPlayers = new Set();
        }
        party.gameState.submittedPlayers.add(socket.id);
        
        // For FFA, update total score if provided
        if (party.gameType === 'ffa' && totalScore !== undefined) {
            party.gameState.totalScores[socket.id] = totalScore;
        }
        
        // For duels or teams, also store in duel-specific tracking
        if (party.gameType === 'duels' || party.gameType === 'teams') {
            party.duelState.roundScores[socket.id] = score;
        }
        
        console.log(`Score submitted: ${socket.id} scored ${score} (guess: ${guess}) in round ${round}`);
        
        // Notify all party members that a player submitted
        party.members.forEach(member => {
            io.to(member.id).emit('playerScoreSubmitted', {
                playerId: socket.id,
                round: round,
                score: score,
                guess: guess,
                totalScore: party.gameState.totalScores[socket.id] || 0,
                hasSubmitted: true
            });
        });

        // Removed complex leave handling - keeping it simple

        // Check if all active players have submitted scores
        const activePlayerIds = party.members.map(m => m.id);
        const submittedPlayers = party.gameState.submittedPlayers || new Set();
        
        // Check how many players are actually connected
        const connectedPlayerCount = party.members.filter(m => {
            const memberSocket = io.sockets.sockets.get(m.id);
            return memberSocket && memberSocket.connected;
        }).length;

        // NEW LOGIC: Only wait for CONNECTED players to submit
        // Disconnected players will get auto-submitted score of 0 when timer expires

        // Get list of connected non-spectator players only
        const connectedPlayerIds = party.members.filter(m => {
            const memberSocket = io.sockets.sockets.get(m.id);
            return memberSocket && memberSocket.connected && !m.spectator;
        }).map(m => m.id);

        console.log(`Connected players: ${connectedPlayerIds.length}/${party.members.length} - IDs: ${connectedPlayerIds.join(', ')}`);

        // Check if all CONNECTED players have submitted
        const allConnectedSubmitted = connectedPlayerIds.every(id => submittedPlayers.has(id));

        if (party.gameType === 'teams') {
            // Teams: wait for ALL party members (both teams) to submit
            const allTeamPlayers = [
                ...party.teams.team1.members,
                ...party.teams.team2.members
            ];
            const allTeamPlayersSubmitted = allTeamPlayers.every(id => submittedPlayers.has(id));

            if (allTeamPlayersSubmitted && allTeamPlayers.length >= 2) {
                console.log(`🎮 [TEAMS] All ${allTeamPlayers.length} team players submitted. Completing round.`);
                handleRoundComplete(party);
            } else if (allConnectedSubmitted && connectedPlayerIds.length > 0) {
                // Auto-submit 0 for disconnected players
                allTeamPlayers.forEach(playerId => {
                    if (!submittedPlayers.has(playerId)) {
                        console.log(`🎮 [TEAMS] Auto-submitting score 0 for non-submitting player: ${playerId}`);
                        party.gameState.scores[playerId] = 0;
                        party.gameState.guesses[playerId] = 999;
                        party.gameState.submittedPlayers.add(playerId);
                    }
                });
                handleRoundComplete(party);
            } else {
                const remainingPlayers = connectedPlayerIds.filter(id => !submittedPlayers.has(id));
                console.log(`[TEAMS] Waiting for: ${remainingPlayers.join(', ')} (${submittedPlayers.size}/${allTeamPlayers.length} submitted)`);
            }
        } else if (party.gameType === 'duels') {
            // Check if ALL players in duelHealth have submitted (connected or not)
            const allDuelPlayers = Object.keys(party.duelHealth || {});
            const allDuelPlayersSubmitted = allDuelPlayers.every(id => submittedPlayers.has(id));

            if (allDuelPlayersSubmitted && allDuelPlayers.length >= 2) {
                console.log(`🎮 [DUEL] All ${allDuelPlayers.length} duel players submitted. Completing round immediately.`);
                handleRoundComplete(party);
            } else if (allConnectedSubmitted && connectedPlayerIds.length > 0) {
                // All connected players submitted but disconnected player(s) haven't
                // Auto-submit 0 for disconnected players and complete
                allDuelPlayers.forEach(playerId => {
                    if (!submittedPlayers.has(playerId)) {
                        console.log(`🎮 [DUEL] Auto-submitting score 0 for non-submitting player: ${playerId}`);
                        party.gameState.scores[playerId] = 0;
                        party.gameState.guesses[playerId] = 999;
                        party.gameState.submittedPlayers.add(playerId);
                    }
                });
                handleRoundComplete(party);
            } else {
                const remainingPlayers = connectedPlayerIds.filter(id => !submittedPlayers.has(id));
                console.log(`Waiting for connected players: ${remainingPlayers.join(', ')} (${submittedPlayers.size}/${connectedPlayerIds.length} submitted)`);
            }
        } else {
            // For non-duels: Complete immediately when all connected players submit
            if (allConnectedSubmitted && connectedPlayerIds.length > 0) {
                console.log(`All ${connectedPlayerIds.length} connected players submitted. Auto-submitting 0 for disconnected players and completing round...`);

                // Auto-submit for current members who are disconnected (skip spectators)
                party.members.forEach(member => {
                    if (!member.spectator && !connectedPlayerIds.includes(member.id) && !submittedPlayers.has(member.id)) {
                        console.log(`Auto-submitting score 0 for disconnected player: ${member.name} (${member.id})`);
                        party.gameState.scores[member.id] = 0;
                        party.gameState.guesses[member.id] = 999; // No guess
                        party.gameState.submittedPlayers.add(member.id);
                    }
                });

                handleRoundComplete(party);
            } else {
                const remainingPlayers = connectedPlayerIds.filter(id => !submittedPlayers.has(id));
                console.log(`Waiting for connected players: ${remainingPlayers.join(', ')} (${submittedPlayers.size}/${connectedPlayerIds.length} submitted)`);
            }
        }
    });

    // Host requests all players transition to duel final results screen
    socket.on('duelViewSummary', () => {
        const partyCode = userParties.get(socket.id);
        const party = parties.get(partyCode);

        if (!party || party.host !== socket.id) {
            return;
        }

        // Broadcast to all other connected members
        party.members.forEach(member => {
            if (member.id !== socket.id) {
                const memberSocket = io.sockets.sockets.get(member.id);
                if (memberSocket && memberSocket.connected) {
                    io.to(member.id).emit('duelViewSummary', {
                        finalHealth: party.duelHealth ? { ...party.duelHealth } : {}
                    });
                }
            }
        });
    });

    // Next round - host advances the game
    socket.on('nextRound', (data) => {
        
        const partyCode = userParties.get(socket.id);
        const party = parties.get(partyCode);
        
        
        if (!party || party.host !== socket.id) {
            console.error('nextRound rejected - not host or no party');
            socket.emit('error', { message: 'Only host can advance rounds' });
            return;
        }

        // REMOVED: This fix was causing double damage calculation
        // The timer already calculates damage when it expires
        // We don't need to recalculate when Next Round is clicked
        
        // VICTORY CHECK: Don't advance round if someone won
        if ((party.gameType === 'duels' || party.gameType === 'teams') && party.duelHealth) {
            // CRITICAL FIX: Check health values directly, not by members array order
            // (disconnected players may have been removed from members but health still tracked)
            const healthValues = Object.values(party.duelHealth);
            const hasDeadPlayer = healthValues.some(health => health <= 0);

            console.log('🔍 [VICTORY CHECK] Checking if game should be over:', {
                healthValues,
                hasDeadPlayer,
                allHealthValues: party.duelHealth
            });

            if (hasDeadPlayer) {
                console.log('❌ [VICTORY CHECK] Someone has 0 HP - notifying all players of victory');
                console.log('❌ [VICTORY CHECK] Health values:', party.duelHealth);

                // Re-emit duelVictory to all players so non-host advances to results
                const winner = Object.keys(party.duelHealth).find(id => party.duelHealth[id] > 0);
                const loser = Object.keys(party.duelHealth).find(id => party.duelHealth[id] <= 0);
                party.members.forEach(member => {
                    const memberSocket = io.sockets.sockets.get(member.id);
                    if (memberSocket && memberSocket.connected) {
                        io.to(member.id).emit('duelVictory', {
                            winner,
                            loser,
                            finalHealth: { ...party.duelHealth }
                        });
                    }
                });
                return;
            } else {
                console.log('✅ [VICTORY CHECK] All players have HP > 0, safe to advance round');
            }
        }
        
        // Advance round and clear round-specific data
        const previousRound = party.gameState.currentRound;
        party.gameState.currentRound++;
        party.gameState.scores = {};
        party.gameState.guesses = {};
        party.gameState.submittedPlayers = new Set(); // Clear submitted players for new round
        
        
        // Clear duel-specific round data
        if (party.gameType === 'duels' || party.gameType === 'teams') {
            party.duelState.clashReady = false;
            party.duelState.roundScores = {};
            party.duelState.hasServerHealth = false;
            
            // Increase multiplier for next round (but not after the first round)
            if (party.gameState.currentRound > 1) {
                party.duelState.roundMultiplier = Math.round((party.duelState.roundMultiplier + 0.2) * 10) / 10;
                console.log(`Increased damage multiplier to ${party.duelState.roundMultiplier.toFixed(1)}x for round ${party.gameState.currentRound}`);
            } else {
                console.log(`Round ${party.gameState.currentRound} - multiplier remains at ${party.duelState.roundMultiplier.toFixed(1)}x`);
            }
            
        }
        
        // CRITICAL FIX: Check if game should end instead of starting new round
        const isDuelLike = party.gameType === 'duels' || party.gameType === 'teams';
        const totalRounds = isDuelLike ? 999 : 5;

        if (!isDuelLike && party.gameState.currentRound > totalRounds) {
            console.log(`Game ended - round ${party.gameState.currentRound} > total rounds ${totalRounds}`);
            party.gameState.inProgress = false;

            // Send game finished event to all players
            party.members.forEach((member, index) => {
                io.to(member.id).emit('gameFinished', {
                    party,
                    finalScores: party.gameState.totalScores,
                    gameType: party.gameType
                });
            });
            
        } else {
            console.log(`Round ${party.gameState.currentRound} started in party: ${partyCode}`);

            // Notify all party members
            console.log(`🔔 [SERVER] Emitting nextRoundStarted to ${party.members.length} players`);
            party.members.forEach((member, index) => {
                console.log(`🔔 [SERVER] Emitting to player ${member.name} (${member.id}):`, {
                    round: party.gameState.currentRound,
                    multiplier: party.duelState?.roundMultiplier || 1.0,
                    duelHealth: party.duelHealth
                });
                io.to(member.id).emit('nextRoundStarted', {
                    round: party.gameState.currentRound,
                    party: getSafePartyObject(party),
                    multiplier: party.duelState?.roundMultiplier || 1.0
                });
            });
            console.log(`✅ [SERVER] nextRoundStarted event emitted to all ${party.members.length} players`);

            // Set a round timer for FFA only — duels and teams have no time limit
            if (party.gameType !== 'duels' && party.gameType !== 'teams') {
            const ROUND_TIMEOUT = 30000;
            party.roundTimer = setTimeout(() => {
                console.log(`⏰ [ROUND TIMER] Round timer expired for party: ${partyCode}. Force completing round...`);
                const currentParty = parties.get(partyCode);
                if (currentParty && currentParty.gameState && currentParty.gameState.inProgress) {
                    currentParty.members.forEach(member => {
                        if (!currentParty.gameState.submittedPlayers.has(member.id)) {
                            console.log(`⏰ [ROUND TIMER] Adding default score 0 for non-submitting player: ${member.name}`);
                            currentParty.gameState.scores[member.id] = 0;
                            currentParty.gameState.guesses[member.id] = 999;
                            currentParty.gameState.submittedPlayers.add(member.id);
                        }
                    });
                    handleRoundComplete(currentParty);
                }
            }, ROUND_TIMEOUT);
            }
        }
    });

    // Show Final Results - individual player requests to view final results
    socket.on('showFinalResults', (data) => {
        
        const partyCode = data.partyCode || userParties.get(socket.id);
        const party = parties.get(partyCode);
        
        
        if (!party) {
            console.log('Party not found for showFinalResults');
            return;
        }
        
        // Allow any player to individually view final results if game is complete
        if (party.gameState?.isComplete) {
            // Send only to the requesting player — never broadcast to others
            socket.emit('duelViewSummary', {
                finalHealth: party.duelHealth ? { ...party.duelHealth } : null
            });
            return;
        }
        
        // Legacy behavior for forcing all players (kept for compatibility)
        if (party.host !== socket.id) {
            console.log('Only host can force all players to results before game completion');
            return;
        }
        
        
        // Send forceToResults to all party members
        party.members.forEach((member, index) => {
            
            const memberSocket = io.sockets.sockets.get(member.id);
            const socketStatus = {
                exists: !!memberSocket,
                connected: memberSocket?.connected || false,
                rooms: memberSocket ? [...memberSocket.rooms] : []
            };
            
            io.to(member.id).emit('forceToResults', {
                party: party,
                finalScores: party.gameState?.totalScores || {},
                gameType: party.gameType
            });
        });
        
    });

    // End FFA Game - dedicated handler to avoid race conditions with nextRound
    socket.on('endFFAGame', () => {
        
        const partyCode = userParties.get(socket.id);
        const party = parties.get(partyCode);
        
        
        if (!party || party.host !== socket.id) {
            console.error('❌ [SERVER] endFFAGame rejected - not host or no party');
            socket.emit('error', { message: 'Only host can end FFA game' });
            return;
        }
        
        if (party.gameType !== 'ffa') {
            console.error('❌ [SERVER] endFFAGame rejected - not an FFA game');
            socket.emit('error', { message: 'Can only end FFA games' });
            return;
        }
        
        party.gameState.inProgress = false;

        // Send game finished event to all players
        party.members.forEach((member, index) => {

            // Check if socket exists and is connected
            const socket = io.sockets.sockets.get(member.id);

            io.to(member.id).emit('gameFinished', {
                party,
                finalScores: party.gameState.totalScores,
                gameType: party.gameType
            });

        });

    });

    // Leave party
    socket.on('leaveParty', () => {
        console.log(`Player ${socket.id} leaving party`);
        handlePlayerLeave(socket.id);
    });

    // Kick player (host only)
    socket.on('kickPlayer', (data) => {
        const partyCode = userParties.get(socket.id);
        const party = parties.get(partyCode);
        
        if (!party) {
            console.error(`❌ [KICK] Party not found for host: ${socket.id}`);
            socket.emit('error', { message: 'Party not found' });
            return;
        }

        if (party.host !== socket.id) {
            console.error(`❌ [KICK] Only host can kick players: ${socket.id}`);
            socket.emit('error', { message: 'Only host can kick players' });
            return;
        }

        const playerToKick = party.members.find(m => m.id === data.playerId);
        if (!playerToKick) {
            console.error(`❌ [KICK] Player not found in party: ${data.playerId}`);
            socket.emit('error', { message: 'Player not found' });
            return;
        }

        if (data.playerId === party.host) {
            console.error(`❌ [KICK] Cannot kick the host: ${data.playerId}`);
            socket.emit('error', { message: 'Cannot kick the host' });
            return;
        }

        console.log(`Host ${socket.id} kicking player ${data.playerName} (${data.playerId}) from party ${partyCode}`);
        
        // Notify the kicked player
        io.to(data.playerId).emit('kickedFromParty', {
            reason: 'You have been kicked from the party by the host',
            hostName: party.members.find(m => m.id === party.host)?.name || 'Host'
        });

        // Remove the player using the existing leave handler
        handlePlayerLeave(data.playerId);
        
        console.log(`Successfully kicked ${data.playerName} from party ${partyCode}`);
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        const partyCode = userParties.get(socket.id);
        const party = partyCode && parties.get(partyCode);

        // Grace period for any in-party disconnect — allow socket reconnection
        // before treating the player as gone. Covers both active games and lobby.
        if (party) {
            const member = party.members.find(m => m.id === socket.id);
            if (member) {
                const context = party.gameState?.inProgress ? 'active game' : 'lobby/post-game';
                console.log(`[GRACE] Player ${member.name} disconnected during ${context} — waiting 10s for rejoin`);
                member._disconnectedAt = Date.now();
                member._graceTimer = setTimeout(() => {
                    if (member._disconnectedAt) {
                        console.log(`[GRACE] Player ${member.name} did not rejoin — removing`);
                        delete member._disconnectedAt;
                        delete member._graceTimer;
                        handlePlayerLeave(socket.id);
                    }
                }, 10000);
                return;
            }
        }

        handlePlayerLeave(socket.id);
    });
});

// Handle round completion with complex duel logic
function handleRoundComplete(party) {
    // Clear the round timer if it exists
    if (party.roundTimer) {
        clearTimeout(party.roundTimer);
        party.roundTimer = null;
    }
    
    // For duels/teams, include ALL submitted scores for damage calculation (even from disconnected players)
    // For other game types, filter to connected players only
    const scores = {};
    const guesses = {};

    if (party.gameType === 'teams') {
        // TEAMS: Include ALL submitted players for damage calculation
        Object.keys(party.gameState.scores).forEach(playerId => {
            scores[playerId] = party.gameState.scores[playerId];
            guesses[playerId] = party.gameState.guesses[playerId];
        });
    } else if (party.gameType === 'duels') {
        // DUELS: Include ALL submitted players for damage calculation
        Object.keys(party.gameState.scores).forEach(playerId => {
            scores[playerId] = party.gameState.scores[playerId];
            guesses[playerId] = party.gameState.guesses[playerId];
            const socket = io.sockets.sockets.get(playerId);
            const connected = socket && socket.connected;
        });
    } else {
        // OTHER GAME TYPES: Only include connected players
        Object.keys(party.gameState.scores).forEach(playerId => {
            const socket = io.sockets.sockets.get(playerId);
            if (socket && socket.connected) {
                scores[playerId] = party.gameState.scores[playerId];
                guesses[playerId] = party.gameState.guesses[playerId];
                console.log(`✅ Including connected player ${playerId} in results`);
            } else {
                console.log(`❌ Excluding disconnected player ${playerId} from results`);
            }
        });
    }
    
    console.log(`Processing round completion for party: ${party.code}`);
    console.log(`Players with scores:`, Object.keys(scores));
    console.log(`Final scores:`, scores);
    console.log(`Final guesses:`, guesses);
    
    let damageResult = null;

    // Handle team duel damage calculation
    if (party.gameType === 'teams') {
        const team1Members = party.teams.team1.members;
        const team2Members = party.teams.team2.members;

        // Find best score per team
        let team1BestScore = 0, team1BestGuesser = null;
        let team2BestScore = 0, team2BestGuesser = null;

        // Collect all per-player scores for results
        const allScores = {};
        const allGuesses = {};

        team1Members.forEach(id => {
            const s = scores[id] || 0;
            allScores[id] = s;
            allGuesses[id] = guesses[id];
            if (s > team1BestScore || team1BestGuesser === null) {
                team1BestScore = s;
                team1BestGuesser = id;
            }
        });

        team2Members.forEach(id => {
            const s = scores[id] || 0;
            allScores[id] = s;
            allGuesses[id] = guesses[id];
            if (s > team2BestScore || team2BestGuesser === null) {
                team2BestScore = s;
                team2BestGuesser = id;
            }
        });

        const scoreDifference = Math.abs(team1BestScore - team2BestScore);
        const baseMultiplier = party.duelState.roundMultiplier || 1.0;
        let damageAmount = Math.floor(scoreDifference * baseMultiplier);

        let winner = null, loser = null;
        if (team1BestScore > team2BestScore) {
            winner = 'team1';
            loser = 'team2';
        } else if (team2BestScore > team1BestScore) {
            winner = 'team2';
            loser = 'team1';
        } else {
            damageAmount = 0;
        }

        if (winner && loser) {
            const currentHealth = party.duelHealth[loser] || 100;
            const newHealth = Math.max(0, currentHealth - damageAmount);
            party.duelHealth[loser] = newHealth;
            console.log(`🎮 [TEAM DAMAGE] ${loser} took ${damageAmount} damage: ${currentHealth} -> ${newHealth}`);
        }

        party.duelState.hasServerHealth = true;

        damageResult = {
            team1Score: team1BestScore,
            team2Score: team2BestScore,
            team1BestGuesser,
            team2BestGuesser,
            allScores,
            allGuesses,
            damage: damageAmount,
            baseDamage: scoreDifference,
            multiplier: baseMultiplier,
            winner,
            loser,
            health: { ...party.duelHealth },
            hasServerHealth: true,
            isTeamDuel: true
        };

        console.log('🎮 [TEAM DAMAGE] Result:', damageResult);
    }

    // Handle duel-specific damage calculation
    if (party.gameType === 'duels') {
        const playerIds = Object.keys(scores);

        // CRITICAL FIX: ALWAYS show clash format for duels, even with 1 player
        if (playerIds.length >= 1) {
            const player1Id = playerIds[0];
            const player2Id = playerIds[1] || playerIds[0]; // Use same player if only 1
            const player1Score = scores[player1Id] || 0;
            const player2Score = scores[player2Id] || 0;

            console.log('🎮 [DUEL DAMAGE] Calculating damage for duel:', {
                player1Id,
                player2Id,
                player1Score,
                player2Score,
                numPlayers: playerIds.length
            });

            // Calculate damage with multiplier and determine winner
            const scoreDifference = Math.abs(player1Score - player2Score);
            const baseMultiplier = party.duelState.roundMultiplier || 1.0;
            let damageAmount = Math.floor(scoreDifference * baseMultiplier);


            // Apply damage to the lower scorer
            let winner, loser;
            if (player1Score > player2Score) {
                winner = player1Id;
                loser = player2Id;
            } else if (player2Score > player1Score) {
                winner = player2Id;
                loser = player1Id;
            } else {
                // Tie - no damage
                damageAmount = 0;
            }

            // Apply damage if there's a winner
            if (winner && loser) {
                const currentHealth = party.duelHealth[loser] || 100;
                const newHealth = Math.max(0, currentHealth - damageAmount);
                party.duelHealth[loser] = newHealth;

                console.log('🎮 [DUEL DAMAGE] Damage applied:', {
                    winner,
                    loser,
                    damageAmount,
                    oldHealth: currentHealth,
                    newHealth
                });
            }
            
            // Set server health flag to indicate authoritative update
            party.duelState.hasServerHealth = true;
            
            
            damageResult = {
                player1Score: player1Score,
                player2Score: player2Score,
                damage: damageAmount,
                baseDamage: scoreDifference,
                multiplier: baseMultiplier,
                winner: winner,
                loser: loser,
                health: { ...party.duelHealth },
                hasServerHealth: true
            };
            
            console.log('[HEALTH-DEBUG] 📤 SERVER SENDING HEALTH:', JSON.stringify(damageResult.health));
            console.log('[HEALTH-DEBUG] 📤 Party members:', party.members.map(m => ({id: m.id, name: m.name})));
        }
    }
    
    // Update total scores for all players
    Object.keys(scores).forEach(playerId => {
        if (!party.gameState.totalScores[playerId]) {
            party.gameState.totalScores[playerId] = 0;
        }
        party.gameState.totalScores[playerId] += scores[playerId];
    });
    
    // Get current demon data for this round
    const currentRoundIndex = party.gameState.currentRound - 1;
    let currentDemon = null;
    
    // For now, send a simple placeholder to avoid blocking the results screen
    // The client will handle demon data display from its own local data
    currentDemon = {
        demon: { name: "Current Demon", position: 1 },
        actual: 1
    };
    console.log(`📝 [SERVER] Sending placeholder demon data to unblock results screen`);
    
    // Notify all party members of round completion (only if connected)
    party.members.forEach(member => {
        // Check if socket still exists and is connected
        const memberSocket = io.sockets.sockets.get(member.id);
        if (memberSocket && memberSocket.connected) {
            io.to(member.id).emit('roundComplete', {
                scores,
                guesses,
                round: party.gameState.currentRound,
                damageResult,
                totalScores: party.gameState.totalScores,
                currentDemon: currentDemon  // Add demon data for non-host players
            });
        } else {
            console.log(`Skipping roundComplete for disconnected player: ${member.name} (${member.id})`);
        }
    });
    
    console.log(`Round ${party.gameState.currentRound} complete in party: ${party.code}`);

    // CLEANUP: Remove disconnected players from party now that round is complete
    const disconnectedPlayers = party.members.filter(m => m.disconnected);
    if (disconnectedPlayers.length > 0) {
        console.log(`🧹 [CLEANUP] Removing ${disconnectedPlayers.length} disconnected player(s) after round completion`);
        party.members = party.members.filter(m => !m.disconnected);
    }

    // CRITICAL FIX: Mark game as completed after round 5, but don't immediately send gameFinished
    // Let players view the round 5 summary first, then individually click "View Final Results"
    if (party.gameType === 'ffa' && party.gameState.currentRound >= 5) {
        
        // Mark game as complete but don't send gameFinished yet
        party.gameState.isComplete = true;
        party.gameState.inProgress = false;
        
        // Don't return early - let the round complete event be sent normally
        // Players will see round 5 summary and can individually click "View Final Results"
    }
    
    // Check for duel/team victory condition (when someone hits 0 HP or below)
    if ((party.gameType === 'duels' || party.gameType === 'teams') && damageResult) {
        const healthValues = Object.values(party.duelHealth);
        const hasDeadPlayer = healthValues.some(health => health <= 0);

        if (hasDeadPlayer) {
            console.log(`Duel victory condition met in party: ${party.code}`);
            console.log(`Final health values:`, party.duelHealth);
            party.gameState.inProgress = false;
            party.gameState.isComplete = true;
            const winner = Object.keys(party.duelHealth).find(id => party.duelHealth[id] > 0);
            const loser = Object.keys(party.duelHealth).find(id => party.duelHealth[id] <= 0);
            
            // Delay victory emission to allow damage animation to play
            setTimeout(() => {
                // Emit duel victory only to connected members
                party.members.forEach(member => {
                    const memberSocket = io.sockets.sockets.get(member.id);
                    if (memberSocket && memberSocket.connected) {
                        io.to(member.id).emit('duelVictory', {
                            winner,
                            loser,
                            finalHealth: { ...party.duelHealth }
                        });
                    }
                });
            }, 3800); // 3.8 second delay for full damage animation (1.6s delay + 2s animation)
        }
    }
}

// Handle player leaving with proper cleanup
function handlePlayerLeave(socketId) {
    const partyCode = userParties.get(socketId);
    if (!partyCode) return;
    
    const party = parties.get(partyCode);
    if (!party) return;
    
    console.log(`Processing leave for ${socketId} from party ${partyCode}`);

    // Get member info before removal for notification
    const leftMember = party.members.find(m => m.id === socketId);
    const memberName = leftMember ? leftMember.name : 'Unknown Player';

    // Remove leaving player from their team roster
    if (party.teams) {
        for (const tid of ['team1', 'team2']) {
            if (party.teams[tid]) {
                party.teams[tid].members = party.teams[tid].members.filter(id => id !== socketId);
            }
        }
    }

    // CRITICAL FIX: For duels/teams during active rounds, DON'T remove player yet
    // Mark them as disconnected and let round complete with their score
    const isDuelInProgress = (party.gameType === 'duels' || party.gameType === 'teams') && party.gameState?.inProgress;

    if (isDuelInProgress) {
        console.log(`🎮 [DUEL LEAVE] Player left during active duel - marking as disconnected, keeping in party for round completion`);

        // Mark player as disconnected but keep them in members for round completion
        if (leftMember) {
            leftMember.disconnected = true;
        }

        // Auto-submit 0 score if they haven't submitted yet
        if (!party.gameState.submittedPlayers.has(socketId)) {
            console.log(`🎮 [DUEL LEAVE] Auto-submitting score 0 for leaving player: ${memberName}`);
            party.gameState.scores[socketId] = 0;
            party.gameState.guesses[socketId] = 999;
            party.gameState.submittedPlayers.add(socketId);

            // Check if all players have now submitted (including the leaving player's auto-submit)
            const connectedPlayerIds = party.members.filter(m => !m.disconnected && !m.spectator).map(m => m.id);
            const allConnectedSubmitted = connectedPlayerIds.every(id => party.gameState.submittedPlayers.has(id));

            if (allConnectedSubmitted && connectedPlayerIds.length > 0) {
                console.log(`🎮 [DUEL LEAVE] All remaining connected players submitted - completing round`);
                handleRoundComplete(party);
            }
        }

        // Don't remove from party.members yet - let round complete first
        // The cleanup will happen after round completion
    } else {
        // Not a duel in progress - remove immediately as before
        party.members = party.members.filter(m => m.id !== socketId);
    }

    userParties.delete(socketId);
    
    // Clean up player-specific data - but preserve scores if game is in progress for damage calculation
    if (party.gameState) {
        // Only clean up scores if game is not in progress or already complete
        if (!party.gameState.inProgress || party.gameState.isComplete) {
            delete party.gameState.scores[socketId];
            delete party.gameState.guesses[socketId];
            delete party.gameState.totalScores[socketId];
            console.log(`Removed ${memberName} from scores (game not active). Remaining scores:`, Object.keys(party.gameState.scores));
        } else {
        }
    }
    
    // Don't clean up duel-specific data if game is in progress - preserve for damage calculation
    if (party.gameState?.inProgress) {
    } else {
        // Clean up duel-specific data only if game is not in progress
        if (party.duelState?.roundScores) {
            delete party.duelState.roundScores[socketId];
        }
        if (party.duelHealth) {
            delete party.duelHealth[socketId];
        }
        console.log(`Cleaned up ${memberName}'s duel data (game not active)`);
    }
    
    // CRITICAL: Check if game is in progress when player leaves
    
    let shouldCheckCompletion = false;
    if (party.gameState && party.gameState.inProgress) {
        shouldCheckCompletion = true;
    }

    // 🚨 NUCLEAR FIX: Check BEFORE removing player - if someone leaves during active game, immediately complete round
    if (party.gameState && party.members.length > 0) {
        // Check if there are any submitted players (INCLUDING the leaving player) - indicates active game
        const hasActiveGame = party.gameState.submittedPlayers && party.gameState.submittedPlayers.size > 0;
        
        if (hasActiveGame) {
            
            // Remove leaving player from submissions and notify others
            party.gameState.submittedPlayers.delete(socketId);
            
            // Notify remaining players
            party.members.forEach(member => {
                io.to(member.id).emit('playersUpdate', {
                    activePlayers: party.members.length,
                    submittedCount: party.gameState.submittedPlayers.size,
                    waitingFor: Math.max(0, party.members.length - party.gameState.submittedPlayers.size),
                    message: `${memberName} left the game.`
                });
            });
        }
    }

    // Submission cleanup already handled above
    
    if (party.members.length === 0) {
        // Clear any active timer before deleting party
        if (party.roundTimer) {
            clearTimeout(party.roundTimer);
            party.roundTimer = null;
        }
        
        // Delete empty party
        parties.delete(partyCode);
        console.log(`Empty party deleted: ${partyCode}`);
    } else {
        // Check if the host is leaving - if so, end the party
        if (party.host === socketId) {
            console.log(`Host left party ${partyCode} - ending party`);
            
            // Notify all remaining members that the party is ending
            party.members.forEach(member => {
                io.to(member.id).emit('partyEnded', {
                    reason: 'Host left the party',
                    partyCode: partyCode
                });
            });
            
            // Delete the party
            parties.delete(partyCode);
            console.log(`Party ${partyCode} deleted because host left`);
            return;
        }
        
        // If non-host leaves, continue normal process
        // Emit memberLeft event to all remaining members
        party.members.forEach(member => {
            io.to(member.id).emit('memberLeft', {
                playerId: socketId,
                playerName: memberName,
                party: getSafePartyObject(party),
                remainingMembers: party.members.length
            });
        });
        
        // SOLUTION 1: Force complete party refresh when party size changes (member leaves)
        party.members.forEach(member => {
            io.to(member.id).emit('forcePartyRefresh', {
                party: getSafePartyObject(party),
                forceUpdate: true,
                reason: 'memberLeft'
            });
        });
        
        // Check if the game is in progress and handle player leave
        if (shouldCheckCompletion) {
            
            // Track that someone left during this round
            if (!party.gameState.playersWhoLeft) {
                party.gameState.playersWhoLeft = [];
            }
            party.gameState.playersWhoLeft.push({
                id: socketId,
                name: memberName,
                leftAt: Date.now()
            });
            
            // Get remaining players and notify them
            const activePlayerIds = party.members.map(m => m.id);
            const submittedPlayers = party.gameState.submittedPlayers || new Set();
            const activeSubmittedCount = activePlayerIds.filter(id => submittedPlayers.has(id)).length;
            const waitingFor = activePlayerIds.filter(id => !submittedPlayers.has(id));
            
            
            // Notify all remaining players about the leave
            activePlayerIds.forEach(playerId => {
                io.to(playerId).emit('playersUpdate', {
                    activePlayers: activePlayerIds.length,
                    submittedCount: activeSubmittedCount,
                    waitingFor: waitingFor.length,
                    message: `${memberName} left the game. Round will complete when timer ends.`
                });
            });
        }
    }
}

const PORT = process.env.PORT || 3002;
const HTTP_PORT = PORT;
server.listen(PORT, () => {
    console.log(`Multiplayer server running on port ${PORT}`);
    console.log(`Features: FFA, Teams, Duels with health system`);
    console.log(`Debug: Server-side logging enabled`);
});