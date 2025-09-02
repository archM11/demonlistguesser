const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

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
    console.log(`🔌 Player connected: ${socket.id}`);

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
                red: { name: 'Red Team', color: '#ff4444', members: [] },
                blue: { name: 'Blue Team', color: '#4444ff', members: [] }
            }
        };

        parties.set(code, party);
        userParties.set(socket.id, code);
        
        console.log(`🎉 Party created: ${code} by ${username}`);
        socket.emit('partyCreated', { party, code });
    });

    // Join party
    socket.on('joinParty', (data) => {
        const { code, username } = data;
        const party = parties.get(code);
        
        if (!party) {
            socket.emit('joinError', { message: 'Party not found' });
            console.log(`❌ Party not found: ${code}`);
            return;
        }

        // Check if user already in party
        const existingMember = party.members.find(m => m.id === socket.id);
        if (!existingMember) {
            const newMember = {
                id: socket.id,
                name: username,
                avatar: username.charAt(0).toUpperCase() || 'P'
            };
            party.members.push(newMember);

            // For duels, automatically initialize health when second player joins
            if (party.gameType === 'duels' && party.members.length === 2) {
                party.duelHealth = {
                    [party.members[0].id]: 100,
                    [party.members[1].id]: 100
                };
                console.log(`⚔️ Duel health initialized for party: ${code}`);
            }
        }

        userParties.set(socket.id, code);
        
        console.log(`👥 ${username} joined party: ${code} (${party.members.length}/8 players)`);
        socket.emit('joinSuccess', party);
        
        // Add small delay then notify all party members of update (including the joiner)
        setTimeout(() => {
            console.log(`🔄 Sending partyUpdated to all ${party.members.length} members in party ${code}`);
            party.members.forEach((member, index) => {
                console.log(`🔄 Notifying member ${index + 1}: ${member.name} (${member.id})`);
                io.to(member.id).emit('partyUpdated', party);
                // Also send explicit memberJoined event to force visual update
                if (member.id !== socket.id) { // Don't send to the joiner themselves
                    const newMember = party.members.find(m => m.id === socket.id);
                    io.to(member.id).emit('memberJoined', {
                        newMember: newMember,
                        party: party,
                        message: `${username} joined the party`
                    });
                }
            });
            
            // SOLUTION 1: Send direct visual update command to ALL members
            console.log(`🎯 [SOLUTION 1] Sending forceFFAUpdate to all ${party.members.length} members`);
            party.members.forEach((member, index) => {
                console.log(`🎯 [SOLUTION 1] Sending forceFFAUpdate to: ${member.name} (${member.id})`);
                io.to(member.id).emit('forceFFAUpdate', {
                    members: party.members,
                    gameType: party.gameType,
                    host: party.host,
                    partyCode: code
                });
            });
        }, 100);
    });

    // Update game type (FFA, Teams, Duels)
    socket.on('updateGameType', (data) => {
        const partyCode = userParties.get(socket.id);
        const party = parties.get(partyCode);
        
        if (!party || party.host !== socket.id) {
            socket.emit('error', { message: 'Only host can change game type' });
            return;
        }

        party.gameType = data.gameType;
        
        // Initialize duel health if switching to duels
        if (data.gameType === 'duels' && party.members.length >= 2) {
            party.duelHealth = {};
            for (let i = 0; i < Math.min(party.members.length, 2); i++) {
                party.duelHealth[party.members[i].id] = 100;
            }
            console.log(`⚔️ Duel health initialized: ${JSON.stringify(party.duelHealth)}`);
        }

        console.log(`🎮 Game type changed to: ${data.gameType} in party: ${partyCode}`);
        
        // Notify all party members about the gameType change
        console.log(`📡 Broadcasting gameType change (${data.gameType}) to ${party.members.length} members`);
        party.members.forEach((member, index) => {
            console.log(`📡 Sending partyUpdated to member ${index + 1}: ${member.name} (${member.id})`);
            io.to(member.id).emit('partyUpdated', party);
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

        // Initialize comprehensive game state
        party.gameState.gameData = gameData;
        party.gameState.currentRound = 1;
        party.gameState.scores = {};
        party.gameState.guesses = {};
        party.gameState.roundScores = {};
        party.gameState.totalScores = {};
        party.gameState.submittedPlayers = new Set(); // Track submitted players to prevent duplicates
        
        // Initialize total scores for all members
        party.members.forEach(member => {
            party.gameState.totalScores[member.id] = 0;
        });
        
        // Initialize duel-specific state
        if (party.gameType === 'duels') {
            party.duelState.clashReady = false;
            party.duelState.roundScores = {};
            party.duelState.pendingResults = {};
            party.duelState.hasServerHealth = false;
            party.duelState.roundMultiplier = 1.0;
            
            // Ensure duel health is initialized for exactly 2 players
            if (party.members.length >= 2) {
                party.duelHealth = {
                    [party.members[0].id]: 100,
                    [party.members[1].id]: 100
                };
            }
        }

        console.log(`🚀 Game started in party: ${partyCode} with ${party.members.length} players`);
        console.log(`📊 Game type: ${party.gameType}, Mode: ${gameData.mode}`);
        
        // Notify all party members with comprehensive game start data
        party.members.forEach(member => {
            console.log(`🎮 [SERVER] Emitting gameStarted to member: ${member.id} (${member.name})`);
            io.to(member.id).emit('gameStarted', {
                party,
                gameData,
                seed: gameData.seed
            });
        });
        console.log(`🎮 [SERVER] gameStarted events sent to all ${party.members.length} members`);
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
        
        console.log(`📋 SERVER: Raw data received:`, {
            socketId: socket.id,
            score: score,
            guess: guess,
            round: round,
            totalScore: totalScore,
            gameType: party.gameType
        });
        
        // CRITICAL FIX: Check for duplicate submissions to prevent double damage
        if (!party.gameState.submittedPlayers) {
            party.gameState.submittedPlayers = new Set();
        }
        
        if (party.gameState.submittedPlayers.has(socket.id)) {
            console.log(`🚫 [DEDUP] Player ${socket.id} already submitted for current round - ignoring duplicate`);
            return;
        }
        
        // Mark player as submitted for this round
        party.gameState.submittedPlayers.add(socket.id);
        console.log(`✅ [DEDUP] Player ${socket.id} submission accepted for round ${round}`);
        
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
            console.log(`🏆 [FFA] Updated total score for ${socket.id}: ${totalScore}`);
        }
        
        // For duels, also store in duel-specific tracking
        if (party.gameType === 'duels') {
            party.duelState.roundScores[socket.id] = score;
            
            console.log(`🎯 DUEL: Score submission - Round ${round}:`);
            console.log(`🎯 Player ${socket.id}: Score=${score}, Guess=${guess}`);
            console.log(`🎯 Current duel scores:`, party.duelState.roundScores);
        }
        
        console.log(`📊 Score submitted: ${socket.id} scored ${score} (guess: ${guess}) in round ${round}`);
        
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

        // Check if all active players have submitted scores
        const activePlayerIds = party.members.map(m => m.id);
        const submittedPlayers = party.gameState.submittedPlayers || new Set();
        const expectedCount = party.gameType === 'duels' ? Math.min(activePlayerIds.length, 2) : activePlayerIds.length;
        
        console.log(`📊 [SUBMISSION-CHECK] Checking if round complete:`, {
            submittedPlayers: Array.from(submittedPlayers),
            activePlayers: activePlayerIds,
            submittedCount: submittedPlayers.size,
            expectedCount,
            gameType: party.gameType
        });
        
        // Check if all active players have submitted
        const allActiveSubmitted = activePlayerIds.every(id => submittedPlayers.has(id));
        
        if (allActiveSubmitted && expectedCount > 0) {
            console.log(`🏁 All ${expectedCount} active players submitted. Processing round completion...`);
            handleRoundComplete(party);
        } else {
            const remainingPlayers = activePlayerIds.filter(id => !submittedPlayers.has(id));
            console.log(`⏳ Waiting for submissions from: ${remainingPlayers.join(', ')} (${submittedPlayers.size}/${expectedCount} submitted)`);
        }
    });

    // Next round - host advances the game
    socket.on('nextRound', (data) => {
        console.log('🔄 [SERVER] nextRound event received from client:', socket.id);
        console.log('🔄 [SERVER] nextRound data:', data);
        
        const partyCode = userParties.get(socket.id);
        const party = parties.get(partyCode);
        
        console.log('🔄 [SERVER] Party lookup:', {
            partyCode,
            partyExists: !!party,
            hostId: party?.host,
            requesterId: socket.id,
            isHost: party?.host === socket.id
        });
        
        if (!party || party.host !== socket.id) {
            console.error('❌ [SERVER] nextRound rejected - not host or no party');
            socket.emit('error', { message: 'Only host can advance rounds' });
            return;
        }

        // Advance round and clear round-specific data
        const previousRound = party.gameState.currentRound;
        party.gameState.currentRound++;
        party.gameState.scores = {};
        party.gameState.guesses = {};
        party.gameState.submittedPlayers = new Set(); // Clear submitted players for new round
        
        console.log('🔄 [SERVER] Round advanced:', previousRound, '->', party.gameState.currentRound);
        
        // Clear duel-specific round data
        if (party.gameType === 'duels') {
            party.duelState.clashReady = false;
            party.duelState.roundScores = {};
            party.duelState.hasServerHealth = false;
            
            // Increase multiplier for next round (but not after the first round)
            if (party.gameState.currentRound > 1) {
                party.duelState.roundMultiplier += 0.2;
                console.log(`🔄 [SERVER] Increased damage multiplier to ${party.duelState.roundMultiplier.toFixed(1)}x for round ${party.gameState.currentRound}`);
            } else {
                console.log(`🔄 [SERVER] Round ${party.gameState.currentRound} - multiplier remains at ${party.duelState.roundMultiplier.toFixed(1)}x`);
            }
            
            console.log('🔄 [SERVER] Cleared duel state for new round');
        }
        
        // CRITICAL FIX: Check if game should end instead of starting new round
        const totalRounds = party.gameType === 'duels' ? 999 : 5; // Duels continue until someone reaches 0 HP
        
        if (party.gameType !== 'duels' && party.gameState.currentRound > totalRounds) {
            console.log(`🏁 [SERVER] Game ended - round ${party.gameState.currentRound} > total rounds ${totalRounds}`);
            console.log('🔄 [SERVER] Sending gameFinished to all party members');
            
            // Send game finished event to all players
            party.members.forEach((member, index) => {
                console.log(`🔄 [SERVER] Emitting gameFinished to member ${index + 1}:`, member.id);
                io.to(member.id).emit('gameFinished', {
                    party,
                    finalScores: party.gameState.totalScores,
                    gameType: party.gameType
                });
            });
            
            console.log('🔄 [SERVER] gameFinished events sent to all members');
        } else {
            console.log(`🏁 [SERVER] Round ${party.gameState.currentRound} started in party: ${partyCode}`);
            console.log('🔄 [SERVER] Notifying', party.members.length, 'party members');
            
            // Notify all party members
            party.members.forEach((member, index) => {
                console.log(`🔄 [SERVER] Emitting nextRoundStarted to member ${index + 1}:`, member.id);
                console.log(`🔄 [SERVER] Current health values being sent:`, party.duelHealth);
                io.to(member.id).emit('nextRoundStarted', {
                    round: party.gameState.currentRound,
                    party,
                    multiplier: party.duelState?.roundMultiplier || 1.0
                });
            });
            
            console.log('🔄 [SERVER] nextRoundStarted events sent to all members');
        }
    });

    // Show Final Results - broadcast to all players when View Results button is clicked
    socket.on('showFinalResults', (data) => {
        console.log('🎯 [SERVER] showFinalResults event received from client:', socket.id);
        console.log('🎯 [SERVER] Data:', data);
        
        const partyCode = data.partyCode || userParties.get(socket.id);
        const party = parties.get(partyCode);
        
        console.log('🎯 [SERVER] Party lookup for showFinalResults:', {
            partyCode,
            partyExists: !!party,
            hostId: party?.host,
            requesterId: socket.id,
            isHost: party?.host === socket.id
        });
        
        if (!party) {
            console.log('❌ [SERVER] Party not found for showFinalResults');
            return;
        }
        
        if (party.host !== socket.id) {
            console.log('❌ [SERVER] Only host can trigger showFinalResults');
            return;
        }
        
        console.log('🎯 [SERVER] Broadcasting forceToResults to all players');
        
        // Send forceToResults to all party members
        party.members.forEach((member, index) => {
            console.log(`🎯 [SERVER] Sending forceToResults to member ${index + 1}:`, member.id);
            
            const memberSocket = io.sockets.sockets.get(member.id);
            const socketStatus = {
                exists: !!memberSocket,
                connected: memberSocket?.connected || false,
                rooms: memberSocket ? [...memberSocket.rooms] : []
            };
            console.log(`🎯 [SERVER] Socket status for ${member.id}:`, socketStatus);
            
            io.to(member.id).emit('forceToResults', {
                party: party,
                finalScores: party.gameState?.totalScores || {},
                gameType: party.gameType
            });
            console.log(`🎯 [SERVER] forceToResults event sent to ${member.id}`);
        });
        
        console.log('🎯 [SERVER] forceToResults events sent to all members');
    });

    // End FFA Game - dedicated handler to avoid race conditions with nextRound
    socket.on('endFFAGame', () => {
        console.log('🏁 [SERVER] endFFAGame event received from client:', socket.id);
        
        const partyCode = userParties.get(socket.id);
        const party = parties.get(partyCode);
        
        console.log('🏁 [SERVER] Party lookup for FFA end:', {
            partyCode,
            partyExists: !!party,
            hostId: party?.host,
            requesterId: socket.id,
            isHost: party?.host === socket.id,
            gameType: party?.gameType
        });
        
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
        
        console.log('🏁 [SERVER] Ending FFA game - sending gameFinished to all players');
        
        // Send game finished event to all players
        party.members.forEach((member, index) => {
            console.log(`🏁 [SERVER] Emitting gameFinished to member ${index + 1}:`, member.id);
            
            // Check if socket exists and is connected
            const socket = io.sockets.sockets.get(member.id);
            console.log(`🏁 [SERVER] Socket status for ${member.id}:`, {
                exists: !!socket,
                connected: socket?.connected,
                rooms: socket?.rooms ? Array.from(socket.rooms) : 'none'
            });
            
            io.to(member.id).emit('gameFinished', {
                party,
                finalScores: party.gameState.totalScores,
                gameType: party.gameType
            });
            
            console.log(`🏁 [SERVER] gameFinished event sent to ${member.id}`);
        });
        
        console.log('🏁 [SERVER] FFA gameFinished events sent to all members');
    });

    // Leave party
    socket.on('leaveParty', () => {
        console.log(`🚪 Player ${socket.id} leaving party`);
        handlePlayerLeave(socket.id);
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log(`🔌 Player disconnected: ${socket.id}`);
        handlePlayerLeave(socket.id);
    });
});

// Handle round completion with complex duel logic
function handleRoundComplete(party) {
    const scores = party.gameState.scores;
    const guesses = party.gameState.guesses;
    
    console.log(`🏁 Processing round completion for party: ${party.code}`);
    console.log(`📊 Final scores:`, scores);
    console.log(`🎯 Final guesses:`, guesses);
    
    let damageResult = null;
    
    // Handle duel-specific damage calculation
    if (party.gameType === 'duels' && party.members.length >= 2) {
        const playerIds = Object.keys(scores);
        if (playerIds.length >= 2) {
            const player1Id = playerIds[0];
            const player2Id = playerIds[1];
            const player1Score = scores[player1Id] || 0;
            const player2Score = scores[player2Id] || 0;
            
            console.log(`⚔️ DUEL CALCULATION:`);
            console.log(`🏥 Player 1 (${player1Id}): Score=${player1Score}`);
            console.log(`🏥 Player 2 (${player2Id}): Score=${player2Score}`);
            
            // Calculate damage with multiplier and determine winner
            const scoreDifference = Math.abs(player1Score - player2Score);
            const baseMultiplier = party.duelState.roundMultiplier || 1.0;
            let damageAmount = Math.floor(scoreDifference * baseMultiplier);
            
            console.log(`⚔️ DAMAGE CALCULATION: ${scoreDifference} × ${baseMultiplier.toFixed(1)} = ${damageAmount} damage`);
            
            // Apply damage to the lower scorer
            let winner, loser;
            if (player1Score > player2Score) {
                winner = player1Id;
                loser = player2Id;
                console.log(`💥 SERVER: Player 1 wins round - damaged Player 2 for ${damageAmount} HP`);
            } else if (player2Score > player1Score) {
                winner = player2Id;
                loser = player1Id;
                console.log(`💥 SERVER: Player 2 wins round - damaged Player 1 for ${damageAmount} HP`);
            } else {
                // Tie - no damage
                damageAmount = 0;
                console.log(`🤝 SERVER: Tie round - no damage dealt`);
            }
            
            // Apply damage if there's a winner
            if (winner && loser) {
                const currentHealth = party.duelHealth[loser] || 100;
                const newHealth = Math.max(0, currentHealth - damageAmount);
                party.duelHealth[loser] = newHealth;
                
                console.log(`🏥 SERVER: Health update for ${loser}: ${currentHealth} -> ${newHealth}`);
            }
            
            // Set server health flag to indicate authoritative update
            party.duelState.hasServerHealth = true;
            
            console.log(`🏥 SERVER: Updated health:`, party.duelHealth);
            
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
    
    if (party.gameState.gameData && party.gameState.gameData.demons && party.gameState.gameData.demons[currentRoundIndex]) {
        currentDemon = {
            demon: party.gameState.gameData.demons[currentRoundIndex],
            actual: party.gameState.gameData.demons[currentRoundIndex].position
        };
        console.log(`📝 [SERVER] Sending demon data for round ${party.gameState.currentRound}:`, currentDemon.demon.name, 'at position', currentDemon.actual);
    } else {
        console.log(`⚠️  [SERVER] No demon data found for round ${party.gameState.currentRound}`);
    }
    
    // Notify all party members of round completion
    party.members.forEach(member => {
        io.to(member.id).emit('roundComplete', {
            scores,
            guesses,
            round: party.gameState.currentRound,
            damageResult,
            totalScores: party.gameState.totalScores,
            currentDemon: currentDemon  // Add demon data for non-host players
        });
    });
    
    console.log(`🏁 Round ${party.gameState.currentRound} complete in party: ${party.code}`);
    console.log(`📊 [SERVER] Sending total scores:`, party.gameState.totalScores);
    
    // Check for duel victory condition (only when someone hits exactly 0 HP)
    if (party.gameType === 'duels' && damageResult) {
        const healthValues = Object.values(party.duelHealth);
        const hasDeadPlayer = healthValues.some(health => health === 0);
        
        if (hasDeadPlayer) {
            console.log(`💀 Duel victory condition met in party: ${party.code}`);
            console.log(`🏥 Final health values:`, party.duelHealth);
            const winner = Object.keys(party.duelHealth).find(id => party.duelHealth[id] > 0);
            const loser = Object.keys(party.duelHealth).find(id => party.duelHealth[id] === 0);
            
            // Delay victory emission to allow damage animation to play
            console.log(`⏱️ Delaying victory announcement for animation...`);
            setTimeout(() => {
                console.log(`🏆 Sending duel victory after animation delay`);
                // Emit duel victory
                party.members.forEach(member => {
                    io.to(member.id).emit('duelVictory', {
                        winner,
                        loser,
                        finalHealth: { ...party.duelHealth }
                    });
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
    
    console.log(`🚪 Processing leave for ${socketId} from party ${partyCode}`);
    
    // Get member info before removal for notification
    const leftMember = party.members.find(m => m.id === socketId);
    const memberName = leftMember ? leftMember.name : 'Unknown Player';
    
    // Remove player from party
    party.members = party.members.filter(m => m.id !== socketId);
    userParties.delete(socketId);
    
    // Clean up player-specific data
    delete party.gameState.scores[socketId];
    delete party.gameState.guesses[socketId];
    delete party.gameState.totalScores[socketId];
    delete party.duelState.roundScores[socketId];
    delete party.duelHealth[socketId];
    
    // Remove from submitted players set if it exists
    if (party.gameState.submittedPlayers) {
        party.gameState.submittedPlayers.delete(socketId);
        console.log(`🧽 [CLEANUP] Removed ${socketId} from submittedPlayers set`);
    }
    
    if (party.members.length === 0) {
        // Delete empty party
        parties.delete(partyCode);
        console.log(`🗑️ Empty party deleted: ${partyCode}`);
    } else {
        // Transfer host if needed
        if (party.host === socketId && party.members.length > 0) {
            const newHost = party.members[0];
            party.host = newHost.id;
            console.log(`👑 Host transferred to: ${newHost.name} in party: ${partyCode}`);
        }
        
        // Notify remaining members with both partyUpdated and memberLeft events
        party.members.forEach(member => {
            io.to(member.id).emit('partyUpdated', party);
            io.to(member.id).emit('memberLeft', {
                playerId: socketId,
                playerName: memberName,
                message: `${memberName} left the party`,
                remainingMembers: party.members.length
            });
        });
        
        // Check if round should complete now that someone left
        if (party.gameState && party.gameState.inProgress) {
            // Get IDs of remaining active players
            const activePlayerIds = party.members.map(m => m.id);
            const submittedPlayers = party.gameState.submittedPlayers || new Set();
            const expectedCount = party.gameType === 'duels' ? 
                Math.min(activePlayerIds.length, 2) : activePlayerIds.length;
            
            // Check how many active players have submitted
            const activeSubmittedCount = activePlayerIds.filter(id => 
                submittedPlayers.has(id)
            ).length;
            
            console.log(`🔍 [LEAVE-CHECK] After ${memberName} left:`, {
                activePlayerIds,
                submittedPlayers: Array.from(submittedPlayers),
                activeSubmittedCount,
                expectedCount,
                shouldComplete: activeSubmittedCount >= expectedCount && expectedCount > 0
            });
            
            // Complete round if all remaining active players have submitted
            if (activeSubmittedCount >= expectedCount && expectedCount > 0) {
                console.log(`🏁 [INSTANT-FINISH] All ${expectedCount} remaining active players have submitted. Completing round immediately...`);
                handleRoundComplete(party);
            } else if (expectedCount > 0) {
                const waitingFor = activePlayerIds.filter(id => !submittedPlayers.has(id));
                console.log(`⏳ [LEAVE-CHECK] Still waiting for submissions from: ${waitingFor.join(', ')}`);
            }
        }
    }
}

const PORT = process.env.PORT || 3002;
const HTTP_PORT = PORT;
server.listen(PORT, () => {
    console.log(`🚀 Multiplayer server running on port ${PORT}`);
    console.log(`🎮 Features: FFA, Teams, Duels with health system`);
    console.log(`📊 Debug: Server-side logging enabled`);
});