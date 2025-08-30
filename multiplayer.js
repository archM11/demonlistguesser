class MultiplayerManager {
    constructor() {
        this.socket = null;
        this.connected = false;
        this.currentParty = null;
        this.isHost = false;
        
        // Event callbacks - will be assigned by main game class
        this.onConnected = null;
        this.onPartyCreated = null;
        this.onJoinSuccess = null;
        this.onJoinError = null;
        this.onPartyUpdated = null;
        this.onGameStarted = null;
        this.onPlayerScoreSubmitted = null;
        this.onRoundComplete = null;
        this.onNextRoundStarted = null;
        this.onDuelVictory = null;
        this.onMemberLeft = null;
        this.onMemberJoined = null;
        this.onError = null;
        
        // Cross-tab synchronization (for multiple browser tabs)
        this.syncKey = 'demonlist_guessr_multiplayer_sync';
        this.setupCrossTabSync();
    }

    // Connect to multiplayer server with fallback detection
    connect() {
        // Auto-detect server URL - localhost for development, deployed URL for production
        let serverUrl;
        const hostname = window.location.hostname;
        
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            serverUrl = 'http://localhost:3002';
        } else if (hostname.includes('ngrok')) {
            // For ngrok, use the multiplayer tunnel URL
            serverUrl = 'https://41f5d762fb46.ngrok-free.app';
        } else if (hostname.includes('railway.app')) {
            // For Railway deployment, use same domain
            serverUrl = window.location.origin;
        } else {
            // Update this with your deployed server URL
            serverUrl = 'https://your-deployed-server.herokuapp.com';
        }
        
        console.log('[MULTIPLAYER] Connecting to:', serverUrl);
        this.socket = io(serverUrl, {
            transports: ['websocket', 'polling'], // Try WebSocket first, fallback to polling
            timeout: 5000,
            forceNew: true
        });

        // Connection events
        this.socket.on('connect', () => {
            console.log('[MULTIPLAYER] Connected to server with ID:', this.socket.id);
            this.connected = true;
            if (this.onConnected) this.onConnected();
            this.syncToLocalStorage();
        });

        this.socket.on('connect_error', (error) => {
            console.error('[MULTIPLAYER] Connection failed:', error.message);
            this.connected = false;
        });

        this.socket.on('disconnect', (reason) => {
            console.log('[MULTIPLAYER] Disconnected from server:', reason);
            this.connected = false;
            
            // Auto-reconnect after delay unless it was intentional
            if (reason !== 'io client disconnect') {
                setTimeout(() => {
                    console.log('[MULTIPLAYER] Attempting to reconnect...');
                    this.socket.connect();
                }, 2000);
            }
        });

        // Party management events
        this.socket.on('partyCreated', (data) => {
            console.log('[MULTIPLAYER] Party created:', data);
            this.currentParty = data.party;
            this.isHost = true;
            this.syncToLocalStorage();
            if (this.onPartyCreated) this.onPartyCreated(data);
        });

        this.socket.on('joinSuccess', (party) => {
            console.log('[MULTIPLAYER] Successfully joined party:', party);
            this.currentParty = party;
            this.isHost = party.host === this.socket.id;
            this.syncToLocalStorage();
            if (this.onJoinSuccess) this.onJoinSuccess(party);
            
            // Force visual update for join success too
            console.log('🚀 [MULTIPLAYER] Force updating visuals after join success');
            if (window.game) {
                try {
                    window.game.currentParty = party;
                    window.game.isHost = party.host === this.socket.id;
                    
                    // Update game type selector
                    const gameTypeSelect = document.getElementById('partyGameType');
                    if (gameTypeSelect) {
                        gameTypeSelect.value = party.gameType;
                    }
                    
                    // Update game type visual sections
                    if (window.game.updatePartyGameTypeVisuals) {
                        window.game.updatePartyGameTypeVisuals();
                    }
                    
                    if (party.gameType === 'ffa') {
                        window.game.updateFFAVisual();
                    } else if (party.gameType === 'teams') {
                        window.game.updateTeamsVisual();
                    } else if (party.gameType === 'duels') {
                        window.game.updateDuelsVisual();
                    }
                    
                    if (window.game.applyHostRestrictions) {
                        window.game.applyHostRestrictions();
                    }
                } catch (error) {
                    console.error('❌ [MULTIPLAYER] Error in join success visual update:', error);
                }
            }
        });

        this.socket.on('joinError', (error) => {
            console.error('[MULTIPLAYER] Failed to join party:', error);
            if (this.onJoinError) this.onJoinError(error);
        });

        this.socket.on('partyUpdated', (party) => {
            console.log('[MULTIPLAYER] Party updated:', party);
            console.log('🔄 [MULTIPLAYER] onPartyUpdated callback available:', !!this.onPartyUpdated);
            this.currentParty = party;
            this.isHost = party.host === this.socket.id;
            this.syncToLocalStorage();
            if (this.onPartyUpdated) {
                console.log('🔄 [MULTIPLAYER] Calling onPartyUpdated callback');
                this.onPartyUpdated(party);
            } else {
                console.log('⏳ [MULTIPLAYER] onPartyUpdated callback not yet initialized, using persistent retry');
                // More aggressive retry with multiple attempts
                let attempts = 0;
                const maxAttempts = 20; // Try for 2 seconds
                const retryInterval = setInterval(() => {
                    attempts++;
                    if (this.onPartyUpdated) {
                        console.log(`✅ [MULTIPLAYER] Callback found on attempt ${attempts}, executing queued update`);
                        this.onPartyUpdated(party);
                        clearInterval(retryInterval);
                    } else if (attempts >= maxAttempts) {
                        console.error(`❌ [MULTIPLAYER] Failed to find callback after ${maxAttempts} attempts`);
                        clearInterval(retryInterval);
                    } else {
                        console.log(`⏳ [MULTIPLAYER] Retry attempt ${attempts}/${maxAttempts}`);
                    }
                }, 100);
            }
        });
        
        this.socket.on('memberLeft', (data) => {
            console.log('[MULTIPLAYER] Member left party:', data);
            if (this.onMemberLeft) {
                this.onMemberLeft(data);
            } else {
                console.log('No onMemberLeft callback set');
            }
            
            // OPTION 1: Force visual update directly
            console.log('🚀 [MULTIPLAYER] Force updating visuals directly');
            if (window.game) {
                console.log('🚀 [MULTIPLAYER] Found window.game, forcing visual updates');
                try {
                    // Update the party data directly
                    window.game.currentParty = party;
                    window.game.isHost = party.host === this.socket.id;
                    
                    // Force game type selector update
                    const gameTypeSelect = document.getElementById('partyGameType');
                    if (gameTypeSelect && gameTypeSelect.value !== party.gameType) {
                        console.log('🚀 [MULTIPLAYER] Updating game type selector:', party.gameType);
                        gameTypeSelect.value = party.gameType;
                    }
                    
                    // Force game type visual section updates
                    if (window.game.updatePartyGameTypeVisuals) {
                        console.log('🚀 [MULTIPLAYER] Forcing game type visual sections update');
                        window.game.updatePartyGameTypeVisuals();
                    }
                    
                    // Force visual updates based on game type
                    if (party.gameType === 'ffa') {
                        console.log('🚀 [MULTIPLAYER] Forcing FFA visual update');
                        window.game.updateFFAVisual();
                    } else if (party.gameType === 'teams') {
                        console.log('🚀 [MULTIPLAYER] Forcing Teams visual update');
                        window.game.updateTeamsVisual();
                    } else if (party.gameType === 'duels') {
                        console.log('🚀 [MULTIPLAYER] Forcing Duels visual update');
                        window.game.updateDuelsVisual();
                    }
                    
                    // Force host restrictions update
                    if (window.game.applyHostRestrictions) {
                        console.log('🚀 [MULTIPLAYER] Forcing host restrictions update');
                        window.game.applyHostRestrictions();
                    }
                    
                    console.log('🚀 [MULTIPLAYER] Direct visual update complete');
                } catch (error) {
                    console.error('❌ [MULTIPLAYER] Error in direct visual update:', error);
                }
            } else {
                console.error('❌ [MULTIPLAYER] window.game not found for direct update');
            }
        });
        
        this.socket.on('memberJoined', (data) => {
            console.log('[MULTIPLAYER] Member joined party:', data);
            if (this.onMemberJoined) {
                this.onMemberJoined(data);
            } else {
                console.log('No onMemberJoined callback set');
            }
            
            // Force visual update for member join
            console.log('🎉 [MULTIPLAYER] Force updating visuals for member join');
            if (window.game && data.party) {
                console.log('🎉 [MULTIPLAYER] Updating party data and forcing FFA visual');
                try {
                    window.game.currentParty = data.party;
                    window.game.isHost = data.party.host === this.socket.id;
                    
                    // Force FFA visual update multiple times
                    if (data.party.gameType === 'ffa' && window.game.updateFFAVisual) {
                        console.log('🎉 [MULTIPLAYER] Forcing FFA visual update for member join');
                        setTimeout(() => window.game.updateFFAVisual(), 0);
                        setTimeout(() => window.game.updateFFAVisual(), 50);
                        setTimeout(() => window.game.updateFFAVisual(), 100);
                        setTimeout(() => window.game.updateFFAVisual(), 200);
                    }
                } catch (error) {
                    console.error('❌ [MULTIPLAYER] Error in member join visual update:', error);
                }
            }
        });
        
        // SOLUTION 1: Direct FFA visual update
        this.socket.on('forceFFAUpdate', (data) => {
            console.log('🎯 [SOLUTION 1] Received forceFFAUpdate:', data);
            
            // Direct DOM manipulation - bypass all other systems
            const ffaPlayersContainer = document.querySelector('.ffa-players');
            if (ffaPlayersContainer && data.gameType === 'ffa') {
                console.log('🎯 [SOLUTION 1] Direct DOM rebuild of FFA players');
                
                // Clear existing content
                ffaPlayersContainer.innerHTML = '';
                
                // Get current user info
                const currentSocketId = this.socket.id;
                const customAvatar = localStorage.getItem('customAvatar');
                
                // Rebuild each player
                data.members.forEach((member, index) => {
                    const playerDiv = document.createElement('div');
                    playerDiv.className = 'player-avatar';
                    
                    const isCurrentUser = member.id === currentSocketId;
                    const isHost = member.id === data.host;
                    const displayName = member.name || 'Player';
                    
                    // Create avatar content
                    let avatarContent;
                    if (isCurrentUser && customAvatar) {
                        avatarContent = `<img src="${customAvatar}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover;">`;
                    } else {
                        const letter = displayName.charAt(0).toUpperCase() || 'P';
                        avatarContent = `<div style="width: 40px; height: 40px; border-radius: 50%; background: #8b5cf6; color: white; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 18px;">${letter}</div>`;
                    }
                    
                    playerDiv.innerHTML = `
                        <div class="avatar">${avatarContent}</div>
                        <span class="player-name">${displayName}${isHost ? ' 👑' : ''}</span>
                    `;
                    
                    ffaPlayersContainer.appendChild(playerDiv);
                    console.log(`🎯 [SOLUTION 1] Added player: ${displayName} (host: ${isHost})`);
                });
                
                console.log(`🎯 [SOLUTION 1] FFA visual rebuild complete - ${data.members.length} players shown`);
            } else {
                console.log('🎯 [SOLUTION 1] FFA container not found or not FFA game type');
            }
        });

        // Game events
        this.socket.on('gameStarted', (data) => {
            console.log('🎮 [MULTIPLAYER] gameStarted event received from server:', data);
            console.log('🎮 [MULTIPLAYER] onGameStarted callback available:', !!this.onGameStarted);
            this.currentParty = data.party; // Update party with game state
            this.syncToLocalStorage();
            if (this.onGameStarted) {
                console.log('🎮 [MULTIPLAYER] Calling onGameStarted callback');
                this.onGameStarted(data);
            } else {
                console.error('❌ [MULTIPLAYER] onGameStarted callback not set!');
            }
        });

        this.socket.on('playerScoreSubmitted', (data) => {
            console.log('[MULTIPLAYER] Player score submitted:', data);
            if (this.onPlayerScoreSubmitted) this.onPlayerScoreSubmitted(data);
        });

        this.socket.on('roundComplete', (data) => {
            console.log('🎯 [MULTIPLAYER] roundComplete event received from server:', data);
            
            // Check if user has quit - ignore if they have
            if (window.game && window.game.userHasQuit) {
                console.log('🚪 [QUIT] Ignoring roundComplete event because user has quit');
                return;
            }
            
            console.log('🎯 [MULTIPLAYER] onRoundComplete callback available:', !!this.onRoundComplete);
            
            // Update party health if included (for duels)
            if (data.damageResult && data.damageResult.health) {
                console.log('🏥 [MULTIPLAYER] Updating duel health:', data.damageResult.health);
                if (this.currentParty) {
                    this.currentParty.duelHealth = data.damageResult.health;
                    this.syncToLocalStorage();
                }
            }
            
            if (this.onRoundComplete) {
                console.log('🎯 [MULTIPLAYER] Calling onRoundComplete callback');
                this.onRoundComplete(data);
            } else {
                console.error('❌ [MULTIPLAYER] onRoundComplete callback not set!');
            }
        });

        this.socket.on('nextRoundStarted', (data) => {
            console.log('🔄 [MULTIPLAYER] nextRoundStarted event received from server:', data);
            
            // Check if user has quit - ignore if they have
            if (window.game && window.game.userHasQuit) {
                console.log('🚪 [QUIT] Ignoring nextRoundStarted event because user has quit');
                return;
            }
            
            console.log('🔄 [MULTIPLAYER] onNextRoundStarted callback available:', !!this.onNextRoundStarted);
            this.currentParty = data.party; // Update party state
            this.syncToLocalStorage();
            if (this.onNextRoundStarted) {
                console.log('🔄 [MULTIPLAYER] Calling onNextRoundStarted callback');
                this.onNextRoundStarted(data);
            } else {
                console.error('❌ [MULTIPLAYER] onNextRoundStarted callback not set!');
            }
        });

        this.socket.on('duelVictory', (data) => {
            console.log('🏆 [MULTIPLAYER] duelVictory event received from server:', data);
            console.log('🏆 [MULTIPLAYER] onDuelVictory callback available:', !!this.onDuelVictory);
            if (this.currentParty) {
                this.currentParty.duelHealth = data.finalHealth;
                this.syncToLocalStorage();
            }
            if (this.onDuelVictory) {
                console.log('🏆 [MULTIPLAYER] Calling onDuelVictory callback');
                this.onDuelVictory(data);
            } else {
                console.error('❌ [MULTIPLAYER] onDuelVictory callback not set!');
            }
        });

        this.socket.on('gameFinished', (data) => {
            console.log('🏁 [MULTIPLAYER] ========== GAME FINISHED EVENT RECEIVED ==========');
            console.log('🏁 [MULTIPLAYER] gameFinished event received from server:', data);
            
            // Check if user has quit - ignore if they have
            if (window.game && window.game.userHasQuit) {
                console.log('🚪 [QUIT] Ignoring gameFinished event because user has quit');
                return;
            }
            
            console.log('🏁 [MULTIPLAYER] Socket ID:', this.socket?.id);
            console.log('🏁 [MULTIPLAYER] Socket connected:', this.socket?.connected);
            console.log('🏁 [MULTIPLAYER] Is Host:', this.isHost);
            console.log('🏁 [MULTIPLAYER] Connection state:', this.connected);
            console.log('🏁 [MULTIPLAYER] onGameFinished callback available:', !!this.onGameFinished);
            console.log('🏁 [MULTIPLAYER] onGameFinished callback type:', typeof this.onGameFinished);
            
            // ROBUST SOLUTION WITH TIMEOUT SAFETY NET
            let handled = false;
            const startTime = Date.now();
            
            // METHOD 1: Try callback first
            if (this.onGameFinished) {
                console.log('🏁 [MULTIPLAYER] ✅ METHOD 1: Calling onGameFinished callback');
                try {
                    this.onGameFinished(data);
                    handled = true;
                    console.log('🏁 [MULTIPLAYER] ✅ METHOD 1: Callback completed successfully');
                } catch (error) {
                    console.error('❌ [MULTIPLAYER] METHOD 1: onGameFinished callback failed:', error);
                }
            } else {
                console.log('🏁 [MULTIPLAYER] ⚠️  METHOD 1: No callback available, skipping to fallback');
            }
            
            // METHOD 2: Direct fallback if callback failed
            if (!handled) {
                console.log('🏁 [MULTIPLAYER] 🚨 METHOD 2: DIRECT FALLBACK - calling game.endGame()');
                
                if (window.game) {
                    console.log('🏁 [MULTIPLAYER] 🚨 METHOD 2: Updating final scores');
                    if (data.finalScores && window.game.currentGame) {
                        window.game.currentGame.totalScores = data.finalScores;
                    }
                    
                    console.log('🏁 [MULTIPLAYER] 🚨 METHOD 2: Calling window.game.endGame()');
                    try {
                        window.game.endGame();
                        handled = true;
                        console.log('🏁 [MULTIPLAYER] ✅ METHOD 2: Direct fallback completed successfully');
                    } catch (error) {
                        console.error('❌ [MULTIPLAYER] METHOD 2: Direct fallback failed:', error);
                    }
                } else {
                    console.error('❌ [MULTIPLAYER] METHOD 2: window.game not available');
                }
            }
            
            // METHOD 3: TIMEOUT SAFETY NET (Ultimate fallback after 3 seconds)
            const timeoutMs = 3000;
            setTimeout(() => {
                const currentScreen = document.querySelector('.screen.active')?.id;
                const elapsed = Date.now() - startTime;
                
                console.log(`🏁 [MULTIPLAYER] 🛡️  METHOD 3: TIMEOUT SAFETY NET (${elapsed}ms elapsed)`);
                console.log(`🏁 [MULTIPLAYER] 🛡️  Current screen: ${currentScreen}, Is host: ${this.isHost}`);
                
                // Only trigger safety net for non-hosts who aren't on results screen
                if (!this.isHost && currentScreen !== 'resultsScreen') {
                    console.log('🏁 [MULTIPLAYER] 🛡️  METHOD 3: NON-HOST NOT ON RESULTS - FORCING TRANSITION');
                    
                    if (window.game) {
                        // Force update scores and transition to results
                        if (data.finalScores && window.game.currentGame) {
                            window.game.currentGame.totalScores = data.finalScores;
                        }
                        
                        try {
                            window.game.showScreen('resultsScreen');
                            console.log('🏁 [MULTIPLAYER] ✅ METHOD 3: Safety net forced transition to results');
                        } catch (error) {
                            console.error('❌ [MULTIPLAYER] METHOD 3: Safety net failed:', error);
                        }
                    }
                } else {
                    console.log('🏁 [MULTIPLAYER] 🛡️  METHOD 3: Safety net not needed - player already on results or is host');
                }
            }, timeoutMs);
            
            if (!handled) {
                console.error('❌ [MULTIPLAYER] 🚨 CRITICAL: Primary methods failed, relying on timeout safety net');
            }
            
            console.log('🏁 [MULTIPLAYER] ========== END GAME FINISHED EVENT ==========');
        });
        
        this.socket.on('forceToResults', (data) => {
            console.log('🎯 [MULTIPLAYER] ========== FORCE TO RESULTS EVENT RECEIVED ==========');
            console.log('🎯 [MULTIPLAYER] forceToResults event received from server:', data);
            
            // Check if user has quit - ignore if they have
            if (window.game && window.game.userHasQuit) {
                console.log('🚪 [QUIT] Ignoring forceToResults event because user has quit');
                return;
            }
            
            console.log('🎯 [MULTIPLAYER] Socket ID:', this.socket?.id);
            console.log('🎯 [MULTIPLAYER] Is Host:', this.isHost);
            
            console.log('🎯 [MULTIPLAYER] 🚀 FORCE TO RESULTS - Using endGame()');
            
            // Force both host and non-host directly to results screen
            if (window.game) {
                try {
                    // Update final scores if provided
                    if (data.finalScores && window.game.currentGame) {
                        console.log('🎯 [MULTIPLAYER] Updating final scores:', data.finalScores);
                        window.game.currentGame.totalScores = data.finalScores;
                    }
                    
                    // Remove any FFA reveal screens
                    const ffaRevealScreen = document.getElementById('ffaRevealScreen');
                    if (ffaRevealScreen) {
                        console.log('🎯 [MULTIPLAYER] Removing FFA reveal screen');
                        ffaRevealScreen.remove();
                    }
                    
                    // Call endGame() - the proper way to show multiplayer results
                    console.log('🎯 [MULTIPLAYER] Calling window.game.endGame()');
                    window.game.endGame();
                    console.log('🎯 [MULTIPLAYER] ✅ Force to results completed');
                    
                } catch (error) {
                    console.error('🎯 [MULTIPLAYER] ❌ Force to results failed:', error);
                }
            } else {
                console.error('🎯 [MULTIPLAYER] ❌ window.game not available for force to results');
            }
            
            console.log('🎯 [MULTIPLAYER] ========== FORCE TO RESULTS COMPLETE ==========');
        });

        // Debug: Listen for any events containing "game" or "finish"
        const originalEmit = this.socket.emit;
        const originalOn = this.socket.on;
        
        // Log all events received
        this.socket.onAny((eventName, ...args) => {
            if (eventName.toLowerCase().includes('game') || eventName.toLowerCase().includes('finish')) {
                console.log('🔍 [MULTIPLAYER] Event received:', eventName, args);
            }
        });

        // Error handling
        this.socket.on('error', (error) => {
            console.error('[MULTIPLAYER] Server error:', error);
            if (this.onError) this.onError(error);
        });
    }

    // Create party with comprehensive options
    createParty(username) {
        if (!this.connected) {
            console.error('[MULTIPLAYER] Cannot create party - not connected to server');
            return false;
        }
        
        console.log('[MULTIPLAYER] Creating party for:', username);
        this.socket.emit('createParty', { username });
        return true;
    }

    // Join existing party
    joinParty(code, username) {
        if (!this.connected) {
            console.error('[MULTIPLAYER] Cannot join party - not connected to server');
            return false;
        }
        
        console.log('[MULTIPLAYER] Joining party:', code, 'as:', username);
        this.socket.emit('joinParty', { code: code.toUpperCase(), username });
        return true;
    }

    // Update game type (FFA, Teams, Duels)
    updateGameType(gameType) {
        if (!this.connected || !this.isHost) {
            console.error('[MULTIPLAYER] Cannot update game type - not connected or not host');
            return false;
        }
        
        console.log('[MULTIPLAYER] Updating game type to:', gameType);
        this.socket.emit('updateGameType', { gameType });
        return true;
    }

    // Start game with comprehensive game data
    startGame(gameData) {
        if (!this.connected || !this.isHost) {
            console.error('[MULTIPLAYER] Cannot start game - not connected or not host');
            return false;
        }
        
        console.log('[MULTIPLAYER] Starting game with data:', gameData);
        this.socket.emit('startGame', gameData);
        return true;
    }

    // Submit score - supports both old format (just score) and new format (score + guess)
    submitScore(data) {
        if (!this.connected) {
            console.error('[MULTIPLAYER] Cannot submit score - not connected to server');
            return false;
        }
        
        // Handle both old format and new format for backward compatibility
        let scoreData;
        if (typeof data === 'number') {
            // Old format - just a score number
            scoreData = {
                score: data,
                guess: null,
                round: this.currentParty?.gameState?.currentRound || 1
            };
        } else {
            // New format - object with score, guess, and round
            scoreData = {
                score: data.score || 0,
                guess: data.guess || null,
                round: data.round || this.currentParty?.gameState?.currentRound || 1
            };
        }
        
        console.log('📤 CLIENT: Submitting score data:', scoreData);
        this.socket.emit('submitScore', scoreData);
        return true;
    }

    // Advance to next round (host only)
    nextRound(round = null) {
        console.log('🔄 [MULTIPLAYER] nextRound() called with round:', round);
        console.log('🔄 [MULTIPLAYER] Connection state:', {
            connected: this.connected,
            isHost: this.isHost,
            socketId: this.socket?.id,
            currentParty: !!this.currentParty
        });
        
        if (!this.connected || !this.isHost) {
            console.error('❌ [MULTIPLAYER] Cannot advance round - not connected or not host:', {
                connected: this.connected,
                isHost: this.isHost
            });
            return false;
        }
        
        console.log('✅ [MULTIPLAYER] Advancing to next round:', round);
        console.log('✅ [MULTIPLAYER] Emitting nextRound event to server');
        this.socket.emit('nextRound', { round });
        console.log('✅ [MULTIPLAYER] nextRound event emitted successfully');
        return true;
    }

    endFFAGame() {
        console.log('🏁 [MULTIPLAYER] endFFAGame() called');
        console.log('🏁 [MULTIPLAYER] Connection state:', {
            connected: this.connected,
            isHost: this.isHost,
            socketId: this.socket?.id,
            currentParty: !!this.currentParty
        });
        
        if (!this.connected || !this.isHost) {
            console.error('❌ [MULTIPLAYER] Cannot end FFA game - not connected or not host:', {
                connected: this.connected,
                isHost: this.isHost
            });
            return false;
        }
        
        console.log('✅ [MULTIPLAYER] Ending FFA game');
        console.log('✅ [MULTIPLAYER] Emitting endFFAGame event to server');
        this.socket.emit('endFFAGame');
        console.log('✅ [MULTIPLAYER] endFFAGame event emitted successfully');
        return true;
    }

    // Leave current party
    leaveParty() {
        if (!this.connected) {
            console.error('[MULTIPLAYER] Cannot leave party - not connected to server');
            // Clear local state even if not connected
            this.currentParty = null;
            this.isHost = false;
            this.clearLocalStorage();
            return false;
        }
        
        console.log('[MULTIPLAYER] Leaving party');
        this.socket.emit('leaveParty');
        
        // Clear party-related callbacks to prevent unwanted reactions to events
        this.clearPartyCallbacks();
        
        // Clear local state
        this.currentParty = null;
        this.isHost = false;
        this.clearLocalStorage();
        return true;
    }
    
    // Clear party-related callbacks to prevent unwanted reactions after leaving
    clearPartyCallbacks() {
        console.log('🧹 [MULTIPLAYER] Clearing party-related callbacks');
        
        // Clear all callback functions so events don't trigger unwanted actions
        this.onPartyCreated = null;
        this.onJoinSuccess = null;
        this.onJoinError = null;
        this.onPartyUpdated = null;
        this.onMemberJoined = null;
        this.onMemberLeft = null;
        this.onGameStarted = null;
        this.onPlayerScoreSubmitted = null;
        this.onRoundComplete = null;
        this.onNextRoundStarted = null;
        this.onGameFinished = null;
        this.onDuelClash = null;
        this.onDuelVictory = null;
        this.onError = null;
        
        console.log('🧹 [MULTIPLAYER] All party callbacks cleared - events will be ignored');
    }

    // Get current party information
    getParty() {
        return this.currentParty;
    }

    // Check if user is host of current party
    isPartyHost() {
        return this.isHost && this.currentParty && this.currentParty.host === this.socket?.id;
    }

    // Get connection status
    isConnected() {
        return this.connected && this.socket && this.socket.connected;
    }

    // Get current socket ID
    getSocketId() {
        return this.socket?.id || null;
    }

    // Cross-tab synchronization methods
    setupCrossTabSync() {
        // Listen for storage changes from other tabs
        window.addEventListener('storage', (e) => {
            if (e.key === this.syncKey && e.newValue) {
                try {
                    const syncData = JSON.parse(e.newValue);
                    this.handleCrossTabUpdate(syncData);
                } catch (error) {
                    console.warn('[MULTIPLAYER] Cross-tab sync parse error:', error);
                }
            }
        });

        // Clean up on page unload
        window.addEventListener('beforeunload', () => {
            // Send leave party signal if in a party
            if (this.currentParty && this.connected) {
                // Use navigator.sendBeacon for reliable cleanup on page unload
                try {
                    this.socket.emit('leaveParty');
                } catch (error) {
                    console.warn('[MULTIPLAYER] Error during page unload cleanup:', error);
                }
            }
            this.clearLocalStorage();
        });
        
        // Also handle visibility change (tab switch, minimize, etc.)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden' && this.currentParty && this.connected) {
                console.log('[MULTIPLAYER] Page hidden - sending heartbeat');
                // Don't leave on visibility change, just log for debugging
            }
        });
    }

    // Handle updates from other browser tabs
    handleCrossTabUpdate(syncData) {
        if (syncData.currentParty && !this.currentParty) {
            console.log('[MULTIPLAYER] Cross-tab: Syncing party data from other tab');
            this.currentParty = syncData.currentParty;
            this.isHost = syncData.isHost;
            
            // Trigger party update callback if available
            if (this.onPartyUpdated) {
                this.onPartyUpdated(this.currentParty);
            }
        }
    }

    // Sync current state to localStorage for cross-tab communication
    syncToLocalStorage() {
        try {
            const syncData = {
                timestamp: Date.now(),
                currentParty: this.currentParty,
                isHost: this.isHost,
                connected: this.connected,
                socketId: this.socket?.id
            };
            localStorage.setItem(this.syncKey, JSON.stringify(syncData));
        } catch (error) {
            console.warn('[MULTIPLAYER] LocalStorage sync failed:', error);
        }
    }

    // Clear cross-tab sync data
    clearLocalStorage() {
        try {
            localStorage.removeItem(this.syncKey);
        } catch (error) {
            console.warn('[MULTIPLAYER] LocalStorage clear failed:', error);
        }
    }

    // Get party member information
    getPartyMember(socketId) {
        if (!this.currentParty) return null;
        return this.currentParty.members.find(m => m.id === socketId);
    }

    // Get opponent information (for duels)
    getOpponent() {
        if (!this.currentParty || this.currentParty.gameType !== 'duels') return null;
        return this.currentParty.members.find(m => m.id !== this.socket?.id);
    }

    // Check if party is ready for duels (exactly 2 players)
    isDuelReady() {
        return this.currentParty && 
               this.currentParty.gameType === 'duels' && 
               this.currentParty.members.length === 2;
    }

    // Get current duel health status
    getDuelHealth(socketId = null) {
        if (!this.currentParty || !this.currentParty.duelHealth) return null;
        
        const targetId = socketId || this.socket?.id;
        return this.currentParty.duelHealth[targetId] || null;
    }

    // Reconnection management
    forceReconnect() {
        if (this.socket) {
            console.log('[MULTIPLAYER] Force reconnecting...');
            this.socket.disconnect();
            setTimeout(() => {
                this.socket.connect();
            }, 1000);
        }
    }

    // Debug method to get full state
    getDebugInfo() {
        return {
            connected: this.connected,
            socketId: this.socket?.id,
            isHost: this.isHost,
            currentParty: this.currentParty ? {
                code: this.currentParty.code,
                memberCount: this.currentParty.members?.length,
                gameType: this.currentParty.gameType,
                gameState: this.currentParty.gameState
            } : null,
            duelHealth: this.currentParty?.duelHealth || null
        };
    }
}

// Initialize global multiplayer manager
window.multiplayerManager = new MultiplayerManager();

// Export for module systems if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MultiplayerManager;
}