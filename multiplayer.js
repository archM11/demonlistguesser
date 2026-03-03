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
        this.onPlayersUpdate = null;
        this.onForceResultsScreen = null;
        this.onDuelViewSummary = null;
        this.onError = null;
        
        // Cross-tab synchronization (for multiple browser tabs)
        this.syncKey = 'demonlist_guessr_multiplayer_sync';
        this.setupCrossTabSync();
        
        // Party restoration disabled - causes unwanted screen transitions
        // this.restorePartyState();
    }

    // Connect to multiplayer server with fallback detection
    connect() {
        // CRITICAL FIX: Disconnect old socket if it exists to prevent accumulation
        if (this.socket) {
            console.log('[SOCKET-CLEANUP] Disconnecting old socket:', this.socket.id);
            this.socket.disconnect();
            this.socket.removeAllListeners();
            this.socket = null;
        }

        // Auto-detect server URL - localhost for development, deployed URL for production
        let serverUrl;
        const hostname = window.location.hostname;

        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            serverUrl = 'http://localhost:3002';
        } else {
            // For any deployed environment (Render, Railway, ngrok, etc.), use same origin
            serverUrl = window.location.origin;
        }

        console.log('[MULTIPLAYER] Connecting to:', serverUrl);
        this.socket = io(serverUrl, {
            transports: ['websocket', 'polling'], // Try WebSocket first, fallback to polling
            timeout: 10000, // Increased timeout to 10 seconds
            forceNew: true,
            reconnection: true, // Enable automatic reconnection
            reconnectionAttempts: 5, // Try 5 times
            reconnectionDelay: 1000, // Wait 1 second between attempts
            reconnectionDelayMax: 3000 // Max 3 seconds between attempts
        });

        // Connection events
        this.socket.on('connect', () => {
            console.log('[MULTIPLAYER] Connected to server with ID:', this.socket.id);
            this.connected = true;
            
            // Clear hasLeftGame flag when reconnecting
            if (window.game && window.game.hasLeftGame) {
                window.game.hasLeftGame = false;
                
                // Re-setup multiplayer callbacks after reconnect
                window.game.setupMultiplayerCallbacks();
            }
            
            // Check if we need to restore party state after refresh
            if (this.pendingPartyRestore) {
                console.log('[RESTORE] Attempting to restore party state after connection');
                const party = this.pendingPartyRestore;
                const wasHost = this.pendingIsHost;
                
                // Clear pending restore
                this.pendingPartyRestore = null;
                this.pendingIsHost = null;
                
                // Rejoin the party
                if (party.code) {
                    console.log('[RESTORE] Rejoining party:', party.code);
                    const username = localStorage.getItem('username') || 'Player';
                    this.socket.emit('rejoinParty', {
                        partyCode: party.code,
                        username: username,
                        wasHost: wasHost,
                        gameState: party.gameState
                    });
                }
            }
            
            if (this.onConnected) this.onConnected();
            this.syncToLocalStorage();
        });

        this.socket.on('connect_error', (error) => {
            console.error('[MULTIPLAYER] Connection failed:', error.message);
            this.connected = false;
            
            // Show user-friendly error message
            console.warn('[MULTIPLAYER] Connection issue - this might be temporary');
        });

        this.socket.on('reconnect_attempt', (attempt) => {
            console.log(`[MULTIPLAYER] Reconnection attempt ${attempt}/5`);
        });

        this.socket.on('reconnect_failed', () => {
            console.error('[MULTIPLAYER] Failed to reconnect after 5 attempts');
            this.connected = false;
        });

        this.socket.on('reconnect', (attempt) => {
            console.log(`[MULTIPLAYER] Reconnected successfully after ${attempt} attempts`);
            this.connected = true;
            if (this.onConnected) this.onConnected();
        });

        this.socket.on('disconnect', (reason) => {
            console.log('[MULTIPLAYER] Disconnected from server:', reason);
            this.connected = false;
            
            // HEURISTIC FIX: Graceful disconnect handling
            if (this.currentParty && window.game) {
                console.warn('[HEURISTIC] Disconnect detected while in party - triggering graceful recovery');
                window.game.hasLeftGame = true;
                
                // Check if we're on the guess submitted screen - if so, auto-advance
                const currentScreen = document.querySelector('.screen.active')?.id;
                if (currentScreen === 'gameScreen') {
                    console.log('[HEURISTIC] On game screen during disconnect - attempting graceful recovery');
                    
                    // If we have a pending guess, auto-complete the round
                    if (window.game.currentGame?.pendingResults) {
                        console.log('[HEURISTIC] Auto-completing round with pending results');
                        setTimeout(() => {
                            if (!this.connected && window.game) {
                                window.game.autoCompleteRoundOnDisconnect();
                            }
                        }, 2000); // Give 2 seconds for potential reconnection
                    } else {
                        // Force cleanup after longer delay 
                        setTimeout(() => {
                            if (!this.connected && window.game) {
                                console.warn('[HEURISTIC] Still disconnected after timeout - forcing cleanup');
                                window.game.handleConnectionFailure();
                            }
                        }, 5000);
                    }
                } else {
                    // Force cleanup after short delay to allow for reconnection
                    setTimeout(() => {
                        if (!this.connected && window.game) {
                            console.warn('[HEURISTIC] Still disconnected after timeout - forcing cleanup');
                            window.game.handleConnectionFailure();
                        }
                    }, 5000);
                }
            }
            
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
            console.log('🟣 [PARTY-CREATED-EVENT] ========== PARTY CREATED EVENT RECEIVED ==========');
            console.log('🟣 [PARTY-CREATED-EVENT] Data received:', data);
            console.log('🟣 [PARTY-CREATED-EVENT] Party code:', data.party?.code);
            console.log('🟣 [PARTY-CREATED-EVENT] Party host:', data.party?.host);
            console.log('🟣 [PARTY-CREATED-EVENT] My socket ID:', this.socket.id);
            console.log('🟣 [PARTY-CREATED-EVENT] Callback exists:', typeof this.onPartyCreated === 'function');

            this.currentParty = data.party;
            this.isHost = true;
            console.log('🟣 [PARTY-CREATED-EVENT] Set isHost = true');
            this.syncToLocalStorage();

            if (this.onPartyCreated) {
                console.log('🟣 [PARTY-CREATED-EVENT] Calling onPartyCreated callback...');
                this.onPartyCreated(data);
                console.log('🟣 [PARTY-CREATED-EVENT] Callback completed');
            } else {
                console.error('🟣 [PARTY-CREATED-EVENT] ❌ NO CALLBACK SET! onPartyCreated is null/undefined');
            }
        });

        this.socket.on('joinSuccess', (party) => {
            console.log('🟠 [MULTIPLAYER-DEBUG] joinSuccess event received:', {
                'party.code': party?.code,
                'party.host': party?.host,
                'mySocketId': this.socket.id,
                'currentIsHost': this.isHost
            });
            
            // Clear the hasLeftGame flag when successfully joining a new party
            if (window.game) {
                window.game.hasLeftGame = false;
            }
            this.currentParty = party;
            // CRITICAL FIX: Don't override host status if we're already marked as host (from partyCreated)
            const wasAlreadyHost = this.isHost;
            this.isHost = wasAlreadyHost || (party.host === this.socket.id);
            
            console.log('🟠 [MULTIPLAYER-DEBUG] Host status after joinSuccess:', {
                'wasAlreadyHost': wasAlreadyHost,
                'party.host === socket.id': party.host === this.socket.id,
                'finalIsHost': this.isHost
            });
            
            if (wasAlreadyHost && this.isHost) {
                console.log('[MULTIPLAYER] Preserved host status from partyCreated event');
            }
            this.syncToLocalStorage();
            if (this.onJoinSuccess) {
                this.onJoinSuccess(party);
            } else {
            }
            
            // Force visual update for join success too
            if (window.game) {
                try {
                    // Preserve window.game.isHost if already set to true (from handlePartyCreated)
                    const gameWasAlreadyHost = window.game.isHost;
                    
                    console.log('🟡 [MULTIPLAYER-DEBUG] Before direct game update:', {
                        'gameWasAlreadyHost': gameWasAlreadyHost,
                        'this.isHost': this.isHost,
                        'willSetTo': this.isHost
                    });
                    
                    window.game.currentParty = party;
                    // CRITICAL FIX: Sync host status with multiplayerManager, preserving if already host
                    window.game.isHost = this.isHost;
                    
                    console.log('🟡 [MULTIPLAYER-DEBUG] After direct game update:', {
                        'window.game.isHost': window.game.isHost,
                        'this.isHost': this.isHost
                    });
                    
                    if (gameWasAlreadyHost && !window.game.isHost) {
                        console.warn('[MULTIPLAYER] Warning: game.isHost was true but being overridden to false');
                    }
                    
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
                        console.log('🔴 [MULTIPLAYER-DEBUG] About to call applyHostRestrictions:', {
                            'window.game.isHost': window.game.isHost,
                            'this.isHost': this.isHost
                        });
                        window.game.applyHostRestrictions();
                    }
                } catch (error) {
                    console.error('[MULTIPLAYER] Error in join success visual update:', error);
                }
            }
        });

        this.socket.on('joinError', (error) => {
            console.error('[MULTIPLAYER] Failed to join party:', error);
            if (this.onJoinError) this.onJoinError(error);
        });

        this.socket.on('partyUpdated', (party) => {
            console.log('[MULTIPLAYER] Party updated:', party);

            // CRITICAL FIX: Add detailed logging for host status tracking
            const previousIsHost = this.isHost;
            const newIsHost = party.host === this.socket.id;

            console.log('[HOST-TRACKING] partyUpdated host check:', {
                'party.host': party.host,
                'socket.id': this.socket.id,
                'previousIsHost': previousIsHost,
                'newIsHost': newIsHost,
                'matching': party.host === this.socket.id
            });

            this.currentParty = party;
            this.isHost = newIsHost;

            // Alert if host status changed unexpectedly
            if (previousIsHost && !newIsHost) {
                console.warn('[HOST-TRACKING] ⚠️ Lost host status! Socket ID may have changed.');
                console.warn('[HOST-TRACKING] Old socket ID was host, new socket ID:', this.socket.id);
                console.warn('[HOST-TRACKING] Server thinks host is:', party.host);
            }

            this.syncToLocalStorage();
            if (this.onPartyUpdated) {
                this.onPartyUpdated(party);
            } else {
                // More aggressive retry with multiple attempts
                let attempts = 0;
                const maxAttempts = 20; // Try for 2 seconds
                const retryInterval = setInterval(() => {
                    attempts++;
                    if (this.onPartyUpdated) {
                        this.onPartyUpdated(party);
                        clearInterval(retryInterval);
                    } else if (attempts >= maxAttempts) {
                        clearInterval(retryInterval);
                    } else {
                    }
                }, 100);
            }
        });

        // SOLUTION 1: Handle forced party refresh
        this.socket.on('forcePartyRefresh', (data) => {
            console.log('[MULTIPLAYER] Force party refresh received:', data.reason);
            this.currentParty = data.party;
            this.isHost = data.party.host === this.socket.id;
            this.syncToLocalStorage();
            if (this.onForcePartyRefresh) {
                this.onForcePartyRefresh(data);
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
            if (window.game) {
                try {
                    // Update the party data directly
                    window.game.currentParty = party;
                    // 🔧 FIX: Don't override isHost - let game.js manage it
                    // window.game.isHost = party.host === this.socket.id;
                    
                    // Force game type selector update
                    const gameTypeSelect = document.getElementById('partyGameType');
                    if (gameTypeSelect && gameTypeSelect.value !== party.gameType) {
                        gameTypeSelect.value = party.gameType;
                    }
                    
                    // Force game type visual section updates
                    if (window.game.updatePartyGameTypeVisuals) {
                        window.game.updatePartyGameTypeVisuals();
                    }
                    
                    // Force visual updates based on game type
                    if (party.gameType === 'ffa') {
                        window.game.updateFFAVisual();
                    } else if (party.gameType === 'teams') {
                        window.game.updateTeamsVisual();
                    } else if (party.gameType === 'duels') {
                        window.game.updateDuelsVisual();
                    }
                    
                    // Force host restrictions update
                    if (window.game.applyHostRestrictions) {
                        console.log('🔴 [MULTIPLAYER-DEBUG] About to call applyHostRestrictions:', {
                            'window.game.isHost': window.game.isHost,
                            'this.isHost': this.isHost
                        });
                        window.game.applyHostRestrictions();
                    }
                    
                } catch (error) {
                    console.error('[MULTIPLAYER] Error in direct visual update:', error);
                }
            } else {
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
            if (window.game && data.party) {
                try {
                    window.game.currentParty = data.party;
                    // 🔧 FIX: Don't override isHost - let game.js manage it
                    // window.game.isHost = data.party.host === this.socket.id;
                    
                    // Force FFA visual update multiple times
                    if (data.party.gameType === 'ffa' && window.game.updateFFAVisual) {
                        setTimeout(() => window.game.updateFFAVisual(), 0);
                        setTimeout(() => window.game.updateFFAVisual(), 50);
                        setTimeout(() => window.game.updateFFAVisual(), 100);
                        setTimeout(() => window.game.updateFFAVisual(), 200);
                    }
                } catch (error) {
                    console.error('[MULTIPLAYER] Error in member join visual update:', error);
                }
            }
        });
        
        // Handle real-time player count updates during games
        this.socket.on('playersUpdate', (data) => {
            // Block if user has left the game
            if (window.game && window.game.hasLeftGame) {
                return;
            }
            console.log('[MULTIPLAYER] Players update received:', data);
            if (this.onPlayersUpdate) {
                this.onPlayersUpdate(data);
            } else {
                console.log('No onPlayersUpdate callback set');
            }
        });
        
        // SOLUTION 1: Handle force screen transition when round completes due to player leaving
        this.socket.on('forceResultsScreen', (data) => {
            // Block if user has left the game
            if (window.game && window.game.hasLeftGame) {
                return;
            }
            if (this.onForceResultsScreen) {
                this.onForceResultsScreen(data);
            } else {
                // Direct fallback - force transition to results screen
                if (window.game && window.game.showScreen) {
                    window.game.showScreen('resultsScreen');
                    // Show notification about why this happened
                    if (window.game.showNotification && data.message) {
                        window.game.showNotification(data.message, 'warning');
                    }
                }
            }
        });
        
        // SOLUTION 1: Direct FFA visual update
        this.socket.on('forceFFAUpdate', (data) => {
            
            // Direct DOM manipulation - bypass all other systems
            const ffaPlayersContainer = document.querySelector('.ffa-players');
            if (ffaPlayersContainer && data.gameType === 'ffa') {
                
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
                });
                
            } else {
            }
        });

        // Game events
        this.socket.on('gameStarted', (data) => {
            this.currentParty = data.party; // Update party with game state
            this.syncToLocalStorage();
            if (this.onGameStarted) {
                this.onGameStarted(data);
            } else {
            }
        });

        this.socket.on('playerScoreSubmitted', (data) => {
            console.log('[MULTIPLAYER] Player score submitted:', data);
            if (this.onPlayerScoreSubmitted) this.onPlayerScoreSubmitted(data);
        });

        this.socket.on('roundComplete', (data) => {
            
            // Check if user has quit or left the game - ignore if they have
            if (window.game && (window.game.userHasQuit || window.game.hasLeftGame)) {
                return;
            }
            
            
            // Update party health if included (for duels)
            if (data.damageResult && data.damageResult.health) {
                if (this.currentParty) {
                    this.currentParty.duelHealth = data.damageResult.health;
                    this.syncToLocalStorage();
                }
            }
            
            if (this.onRoundComplete) {
                this.onRoundComplete(data);
            } else {
            }
        });

        this.socket.on('nextRoundStarted', (data) => {
            console.log('🔔 [CLIENT] nextRoundStarted event received from server:', {
                round: data.round,
                multiplier: data.multiplier,
                partyCode: data.party?.partyCode,
                duelHealth: data.party?.duelHealth
            });

            // Block if user has left the game
            if (window.game && window.game.hasLeftGame) {
                console.warn('⚠️ [CLIENT] Ignoring nextRoundStarted - user has left game');
                return;
            }

            // Check if user has quit - ignore if they have
            if (window.game && window.game.userHasQuit) {
                console.warn('⚠️ [CLIENT] Ignoring nextRoundStarted - user has quit');
                return;
            }

            console.log('✅ [CLIENT] Processing nextRoundStarted event');
            this.currentParty = data.party; // Update party state
            this.syncToLocalStorage();
            if (this.onNextRoundStarted) {
                console.log('✅ [CLIENT] Calling onNextRoundStarted callback');
                this.onNextRoundStarted(data);
            } else {
                console.error('❌ [CLIENT] onNextRoundStarted callback not set!');
            }
        });

        this.socket.on('duelVictory', (data) => {
            // Block if user has left the game
            if (window.game && window.game.hasLeftGame) {
                return;
            }
            if (this.currentParty) {
                this.currentParty.duelHealth = data.finalHealth;
                this.syncToLocalStorage();
            }
            if (this.onDuelVictory) {
                this.onDuelVictory(data);
            } else {
            }
        });

        this.socket.on('duelViewSummary', (data) => {
            if (window.game && window.game.hasLeftGame) {
                return;
            }
            if (this.onDuelViewSummary) {
                this.onDuelViewSummary(data);
            }
        });

        this.socket.on('gameFinished', (data) => {
            // Block if user has left the game
            if (window.game && window.game.hasLeftGame) {
                return;
            }
            
            // Check if user has quit - ignore if they have
            if (window.game && window.game.userHasQuit) {
                return;
            }
            
            
            // ROBUST SOLUTION WITH TIMEOUT SAFETY NET
            let handled = false;
            const startTime = Date.now();
            
            // METHOD 1: Try callback first
            if (this.onGameFinished) {
                try {
                    this.onGameFinished(data);
                    handled = true;
                } catch (error) {
                    console.error('[MULTIPLAYER] METHOD 1: onGameFinished callback failed:', error);
                }
            } else {
            }
            
            // METHOD 2: Direct fallback if callback failed
            if (!handled) {
                
                if (window.game) {
                    if (data.finalScores && window.game.currentGame) {
                        window.game.currentGame.totalScores = data.finalScores;
                    }
                    
                    try {
                        window.game.endGame();
                        handled = true;
                    } catch (error) {
                        console.error('[MULTIPLAYER] METHOD 2: Direct fallback failed:', error);
                    }
                } else {
                }
            }
            
            // METHOD 3: TIMEOUT SAFETY NET (Ultimate fallback after 3 seconds)
            const timeoutMs = 3000;
            setTimeout(() => {
                const currentScreen = document.querySelector('.screen.active')?.id;
                const elapsed = Date.now() - startTime;
                
                
                // Only trigger safety net for non-hosts who aren't on results screen
                if (!this.isHost && currentScreen !== 'resultsScreen') {
                    
                    if (window.game) {
                        // Force update scores and transition to results
                        if (data.finalScores && window.game.currentGame) {
                            window.game.currentGame.totalScores = data.finalScores;
                        }
                        
                        try {
                            window.game.showScreen('resultsScreen');
                        } catch (error) {
                            console.error('[MULTIPLAYER] METHOD 3: Safety net failed:', error);
                        }
                    }
                } else {
                }
            }, timeoutMs);
            
            if (!handled) {
            }
            
        });
        
        this.socket.on('forceToResults', (data) => {
            
            // Check if user has quit - ignore if they have
            if (window.game && window.game.userHasQuit) {
                return;
            }
            
            
            
            // Force both host and non-host directly to results screen
            if (window.game) {
                try {
                    // Update final scores if provided
                    if (data.finalScores && window.game.currentGame) {
                            window.game.currentGame.totalScores = data.finalScores;
                    }
                    
                    // Remove any FFA reveal screens
                    const ffaRevealScreen = document.getElementById('ffaRevealScreen');
                    if (ffaRevealScreen) {
                        ffaRevealScreen.remove();
                    }
                    
                    // Call endGame() - the proper way to show multiplayer results
                    window.game.endGame();
                    
                } catch (error) {
                    console.error('[MULTIPLAYER] Force to results failed:', error);
                }
            } else {
            }
            
        });

        // Debug: Listen for any events containing "game" or "finish"
        const originalEmit = this.socket.emit;
        const originalOn = this.socket.on;
        
        // Log all events received
        this.socket.onAny((eventName, ...args) => {
        });

        // Handle party ending (e.g., when host leaves)
        this.socket.on('partyEnded', (data) => {
            console.log('🔚 [MULTIPLAYER] Party ended:', data);
            
            // Clear local party state
            this.currentParty = null;
            this.isHost = false;
            this.clearLocalStorage();
            
            // Notify the game
            if (window.game) {
                window.game.handlePartyEnded(data);
            }
        });
        
        // Handle being kicked from party
        this.socket.on('kickedFromParty', (data) => {
            console.log('👢 [MULTIPLAYER] Kicked from party:', data);
            
            // Clear local party state
            this.currentParty = null;
            this.isHost = false;
            this.clearLocalStorage();
            
            // Notify user
            alert(`${data.reason}\n\nYou will be returned to the main menu.`);
            
            // Return to main menu
            if (window.game) {
                window.game.currentParty = null;
                window.game.isHost = false;
                window.game.showScreen('homeScreen');
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
        console.log('🔵 [CREATE-PARTY] ========== CREATE PARTY CALLED ==========');
        console.log('🔵 [CREATE-PARTY] Username:', username);
        console.log('🔵 [CREATE-PARTY] Connected:', this.connected);
        console.log('🔵 [CREATE-PARTY] Socket ID:', this.socket?.id);
        console.log('🔵 [CREATE-PARTY] Callback exists:', typeof this.onPartyCreated === 'function');

        // If not connected (e.g., after leaving a party), reconnect first
        if (!this.connected) {
            console.log('[MULTIPLAYER] Not connected - reconnecting to server...');
            this.socket.connect();
            // Wait a bit for connection then try again
            setTimeout(() => {
                if (this.connected) {
                    console.log('[MULTIPLAYER] Reconnected! Creating party for:', username);
                    this.socket.emit('createParty', { username });
                } else {
                    console.error('[MULTIPLAYER] Failed to reconnect to server');
                    alert('Failed to connect to server. Please refresh and try again.');
                }
            }, 500);
            return true;
        }

        console.log('🔵 [CREATE-PARTY] Emitting createParty event to server...');
        this.socket.emit('createParty', { username });
        console.log('🔵 [CREATE-PARTY] Event emitted successfully');
        return true;
    }

    // Join existing party
    joinParty(code, username) {
        // If not connected (e.g., after leaving a party), reconnect first
        if (!this.connected) {
            console.log('[MULTIPLAYER] Not connected - reconnecting to server...');
            this.socket.connect();
            // Wait a bit for connection then try again
            setTimeout(() => {
                if (this.connected) {
                    console.log('[MULTIPLAYER] Reconnected! Joining party:', code);
                    this.socket.emit('joinParty', { code: code.toUpperCase(), username });
                } else {
                    console.error('[MULTIPLAYER] Failed to reconnect to server');
                    alert('Failed to connect to server. Please refresh and try again.');
                }
            }, 500);
            return true;
        }
        
        console.log('[MULTIPLAYER] Joining party:', code, 'as:', username);
        this.socket.emit('joinParty', { code: code.toUpperCase(), username });
        return true;
    }

    // Update game type (FFA, Teams, Duels)
    updateGameType(gameType) {
        console.log('[MULTIPLAYER] updateGameType called with:', gameType);
        console.log('[MULTIPLAYER] this.connected:', this.connected);
        console.log('[MULTIPLAYER] this.isHost:', this.isHost);
        
        if (!this.connected || !this.isHost) {
            console.error('[MULTIPLAYER] Cannot update game type - not connected or not host');
            console.error('[MULTIPLAYER] connected:', this.connected, 'isHost:', this.isHost);
            return false;
        }
        
        console.log('[MULTIPLAYER] Emitting updateGameType to server:', gameType);
        this.socket.emit('updateGameType', { gameType });
        console.log('[MULTIPLAYER] updateGameType emitted successfully');
        return true;
    }

    // Start game with comprehensive game data
    startGame(gameData) {
        // CRITICAL FIX: Enhanced logging and validation
        console.log('[START-GAME] startGame() called with:', {
            connected: this.connected,
            isHost: this.isHost,
            socketId: this.socket?.id,
            partyCode: this.currentParty?.code,
            partyHost: this.currentParty?.host
        });

        if (!this.connected) {
            console.error('[START-GAME] ❌ Cannot start game - not connected to server');
            console.error('[START-GAME] Socket state:', {
                socket: !!this.socket,
                socketId: this.socket?.id,
                connected: this.connected
            });
            return false;
        }

        if (!this.isHost) {
            console.error('[START-GAME] ❌ Cannot start game - not host');
            console.error('[START-GAME] Host check failed:', {
                isHost: this.isHost,
                socketId: this.socket.id,
                partyHost: this.currentParty?.host,
                matches: this.socket.id === this.currentParty?.host
            });
            return false;
        }

        console.log('[START-GAME] ✅ All checks passed - emitting startGame event');
        console.log('[START-GAME] Game data:', gameData);
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
        // DIAGNOSTIC: Log the call stack to see where this is being called from
        console.log('🔄 [MULTIPLAYER] ========== nextRound() CALLED ==========');
        console.log('🔄 [MULTIPLAYER] Call stack:', new Error().stack);
        console.log('🔄 [MULTIPLAYER] Called with round:', round);
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

    // Host tells all players to show duel final results
    duelViewSummary() {
        if (!this.connected || !this.isHost) {
            return;
        }
        this.socket.emit('duelViewSummary');
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
        console.log('[MULTIPLAYER] Current party:', this.currentParty?.code);
        console.log('[MULTIPLAYER] Socket connected:', this.socket?.connected);
        
        console.log('[MULTIPLAYER] Emitting leaveParty event to server');
        this.socket.emit('leaveParty');
        console.log('[MULTIPLAYER] ✅ leaveParty event emitted successfully');

        // DON'T clear callbacks - they should persist across party sessions
        // The callbacks are set once in game.js constructor and should always be available

        // Clear local state
        this.currentParty = null;
        this.isHost = false;
        this.clearLocalStorage();
        return true;
    }
    
    // Clear party-related callbacks to prevent unwanted reactions after leaving
    clearPartyCallbacks() {
        
        // Clear all callback functions so events don't trigger unwanted actions
        this.onPartyCreated = null;
        this.onJoinSuccess = null;
        this.onJoinError = null;
        this.onPartyUpdated = null;
        this.onMemberJoined = null;
        this.onMemberLeft = null;
        this.onPlayersUpdate = null;
        this.onForceResultsScreen = null;
        this.onGameStarted = null;
        this.onPlayerScoreSubmitted = null;
        this.onRoundComplete = null;
        this.onNextRoundStarted = null;
        this.onGameFinished = null;
        this.onDuelClash = null;
        this.onDuelVictory = null;
        this.onError = null;
        
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
            // CRITICAL FIX: Properly disconnect socket on page unload
            console.log('[SOCKET-CLEANUP] Page unloading - disconnecting socket');

            // Send leave party signal if in a party
            if (this.currentParty && this.connected) {
                try {
                    this.socket.emit('leaveParty');
                } catch (error) {
                    console.warn('[MULTIPLAYER] Error during page unload cleanup:', error);
                }
            }

            // Disconnect socket to prevent accumulation
            if (this.socket) {
                try {
                    this.socket.disconnect();
                    this.socket.removeAllListeners();
                } catch (error) {
                    console.warn('[SOCKET-CLEANUP] Error disconnecting socket:', error);
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

    // Restore party state from localStorage on page refresh
    restorePartyState() {
        try {
            const syncData = localStorage.getItem(this.syncKey);
            if (syncData) {
                const data = JSON.parse(syncData);
                // Only restore if data is less than 5 minutes old
                if (Date.now() - data.timestamp < 5 * 60 * 1000) {
                    if (data.currentParty && data.currentParty.gameState?.inProgress) {
                        // Game was in progress - store for later restoration
                        this.pendingPartyRestore = data.currentParty;
                        this.pendingIsHost = data.isHost;
                        console.log('[RESTORE] Found in-progress game, will restore after connection');
                    }
                }
            }
        } catch (error) {
            console.error('[RESTORE] Error restoring party state:', error);
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

// Auto-connect when page loads (with a small delay to ensure DOM is ready)
setTimeout(() => {
    console.log('[MULTIPLAYER] Auto-connecting to server on page load...');
    window.multiplayerManager.connect();
}, 500);

// Export for module systems if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MultiplayerManager;
}