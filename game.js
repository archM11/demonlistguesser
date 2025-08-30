
class DemonListGuessr {
    constructor() {
        console.log('[DEBUG] DemonListGuessr constructor starting');
        this.demons = [];
        this.consolidatedList = [];
        this.apiList = [];
        this.finalList = [];
        this.blacklistedDemons = [];
        this.currentGame = null;
        this.currentParty = null;
        this.isHost = false;
        this.stats = this.loadStats();
        this.debugMode = localStorage.getItem('debug') === 'true';
        this.init().catch(err => console.error('[ERROR] Init failed:', err));
        this.checkDailyStatus();
        console.log('[DEBUG] DemonListGuessr constructor complete');
        this.logGameState('Constructor finished');
    }

    async init() {
        try {
            console.log('[DEBUG] Starting init sequence');
            await this.loadBlacklist();
            await this.loadDemonList();
            this.setupEventListeners();
            this.initYouTubeAPI();
            this.loadUsername();
            this.updateAvatarDisplay();
            this.connectToMultiplayer();
            console.log('[DEBUG] Init sequence complete');
        } catch (error) {
            this.logError('Init sequence failed', error);
            throw error;
        }
    }

    async loadBlacklist() {
        try {
            const response = await fetch('blacklist/blacklisted_demons.json');
            this.blacklistedDemons = await response.json();
            console.log(`Loaded ${this.blacklistedDemons.length} blacklisted demons`);
        } catch (error) {
            console.warn('Could not load blacklist:', error);
            this.blacklistedDemons = [];
        }
    }

    loadUsername() {
        const username = localStorage.getItem('username');
        if (username) {
            document.getElementById('username').value = username;
        }
        
        // Load saved avatar
        const savedAvatar = localStorage.getItem('userAvatar') || '👤';
        document.getElementById('currentAvatar').textContent = savedAvatar;
    }

    showAvatarSelector() {
        document.getElementById('avatarSelector').style.display = 'block';
    }

    hideAvatarSelector() {
        document.getElementById('avatarSelector').style.display = 'none';
    }

    resetToDefaultAvatar() {
        localStorage.removeItem('customAvatar');
        localStorage.removeItem('userAvatar'); // Reset to auto-generated
        this.updateAvatarDisplay();
        this.hideAvatarSelector();
        
        // Update party display if in party setup
        if (this.currentParty) {
            this.updatePartyVisual();
        }
    }
    
    getDefaultAvatar() {
        const username = localStorage.getItem('username') || '';
        return username.charAt(0).toUpperCase() || 'A';
    }
    
    getUserAvatar(username, customAvatar = null) {
        if (customAvatar) {
            return `<img src="${customAvatar}" style="width: 30px; height: 30px; border-radius: 50%; object-fit: cover; margin-right: 8px;">`;
        } else {
            const letter = username.charAt(0).toUpperCase() || 'A';
            return `<div style="width: 30px; height: 30px; border-radius: 50%; background: var(--primary); color: white; display: flex; align-items: center; justify-content: center; margin-right: 8px; font-weight: bold; font-size: 14px;">${letter}</div>`;
        }
    }
    
    handleAvatarUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        // Validate file type
        if (!file.type.startsWith('image/')) {
            alert('Please select an image file.');
            return;
        }
        
        // Validate file size (limit to 2MB)
        if (file.size > 2 * 1024 * 1024) {
            alert('Image size must be less than 2MB.');
            return;
        }
        
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                // Resize and show preview
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                // Set canvas size to 100x100 for avatar
                canvas.width = 100;
                canvas.height = 100;
                
                // Draw image centered and scaled to fill
                const size = Math.min(img.width, img.height);
                const x = (img.width - size) / 2;
                const y = (img.height - size) / 2;
                
                ctx.drawImage(img, x, y, size, size, 0, 0, 100, 100);
                
                // Get resized image as base64
                const resizedImage = canvas.toDataURL('image/jpeg', 0.8);
                
                // Show preview
                document.getElementById('previewImage').src = resizedImage;
                document.getElementById('avatarPreview').style.display = 'block';
                
                // Store temporarily
                this.tempCustomAvatar = resizedImage;
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }
    
    useUploadedAvatar() {
        if (this.tempCustomAvatar) {
            localStorage.setItem('customAvatar', this.tempCustomAvatar);
            this.updateAvatarDisplay();
            this.hideAvatarSelector();
            
            // Hide preview
            document.getElementById('avatarPreview').style.display = 'none';
            this.tempCustomAvatar = null;
            
            // Update party display if in party setup
            if (this.currentParty) {
                this.updatePartyVisual();
            }
        }
    }
    
    updateAvatarDisplay() {
        const customAvatar = localStorage.getItem('customAvatar');
        const avatarElement = document.getElementById('currentAvatar');
        
        if (customAvatar) {
            // Show custom image - make it fill the entire circular avatar area
            avatarElement.innerHTML = `<img src="${customAvatar}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover; position: absolute; top: 0; left: 0;">`;
            avatarElement.style.position = 'relative';
            avatarElement.style.overflow = 'hidden';
        } else {
            // Show default letter avatar
            avatarElement.style.position = '';
            avatarElement.style.overflow = '';
            avatarElement.innerHTML = '';
            avatarElement.textContent = this.getDefaultAvatar();
        }
    }

    async loadDemonList() {
        console.log('🚨 DEBUG: UPDATED VERSION LOADED - Build 2025-08-28-07:05 🚨');
        console.log('[DEBUG] Loading demon list...');
        
        // Make game object available globally for direct multiplayer updates
        window.game = this;
        try {
            // Load consolidated local data first
            console.log('[DEBUG] Fetching consolidated demon data');
            const consolidatedResponse = await fetch('data/demons_consolidated.json');
            this.consolidatedList = await consolidatedResponse.json();
            console.log(`Loaded ${this.consolidatedList.length} demons from local consolidated data`);
            
            // Fetch API data for positions 1-200
            const apiPromises = [];
            
            // Main List (1-75)
            apiPromises.push(
                fetch('https://pointercrate.com/api/v2/demons/listed?limit=75')
                    .then(r => r.json())
                    .catch(e => {
                        console.error('Error fetching main list:', e);
                        return [];
                    })
            );
            
            // Extended List (76-150)
            apiPromises.push(
                fetch('https://pointercrate.com/api/v2/demons/listed?limit=75&after=75')
                    .then(r => r.json())
                    .catch(e => {
                        console.error('Error fetching extended list:', e);
                        return [];
                    })
            );
            
            // First 50 of Legacy List (151-200)
            apiPromises.push(
                fetch('https://pointercrate.com/api/v2/demons/listed?limit=50&after=150')
                    .then(r => r.json())
                    .catch(e => {
                        console.error('Error fetching legacy list API:', e);
                        return [];
                    })
            );
            
            const apiResults = await Promise.all(apiPromises);
            this.apiList = apiResults.flat();
            console.log(`Fetched ${this.apiList.length} demons from API`);
            
            // Merge data
            this.mergeData();
            
        } catch (error) {
            console.error('[ERROR] Failed to load demon list:', error);
            console.error('[ERROR] Error details:', {
                message: error.message,
                stack: error.stack,
                consolidatedListLength: this.consolidatedList?.length || 0,
                apiListLength: this.apiList?.length || 0
            });
            // Use consolidated list as fallback
            this.finalList = this.consolidatedList;
        }
    }
    
    mergeData() {
        const merged = [];
        
        // If we have API data, use it for positions 1-200
        if (this.apiList && this.apiList.length > 0) {
            // Use API data for available positions
            for (const apiDemon of this.apiList) {
                merged.push({
                    position: apiDemon.position,
                    name: apiDemon.name,
                    publisher: apiDemon.publisher,
                    verifier: apiDemon.verifier,
                    video: apiDemon.video,
                    id: apiDemon.id,
                    level_id: apiDemon.level_id
                });
            }
            
            // Add consolidated demons that aren't in API range
            const apiPositions = new Set(this.apiList.map(d => d.position));
            for (const demon of this.consolidatedList) {
                if (!apiPositions.has(demon.position) && demon.position > 200) {
                    merged.push(demon);
                }
            }
        } else {
            // No API data, use consolidated list
            merged.push(...this.consolidatedList);
        }
        
        // Sort by position
        merged.sort((a, b) => a.position - b.position);
        this.finalList = merged;
        this.demons = merged; // Also set demons for backward compatibility
        
        console.log(`Final list contains ${this.finalList.length} demons`);
    }
    
    extractVideoId(url) {
        if (!url) return null;
        const regex = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/;
        const match = url.match(regex);
        return match ? match[1] : null;
    }
    
    generateThumbnailUrl(videoId) {
        if (!videoId) return null;
        // Use YouTube's thumbnail API - maxresdefault gives the highest quality
        return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
    }
    
    loadYouTubeVideo(videoId) {
        // Show video container, hide thumbnail
        const videoContainer = document.querySelector('.video-container');
        videoContainer.style.display = 'block';
        document.getElementById('thumbnailContainer').style.display = 'none';
        
        // Force explicit height for round 1 to fix aspect-ratio issues
        if (this.currentGame.currentRound === 1) {
            videoContainer.style.height = '400px';
            console.log('Applied explicit height to video container for round 1');
        }
        
        if (!videoId || videoId === 'example' || videoId === null) {
            console.error('No valid video ID provided:', videoId);
            const playerDiv = document.getElementById('youtubePlayer');
            playerDiv.innerHTML = '<div style="color: white; text-align: center; line-height: 400px; background: var(--surface);">No video available for this demon</div>';
            return;
        }
        
        console.log('Loading video:', videoId);
        const playerDiv = document.getElementById('youtubePlayer');
        
        if (this.ytPlayer && this.ytPlayer.loadVideoById) {
            console.log('Reusing existing player');
            this.ytPlayer.loadVideoById(videoId);
        } else {
            console.log('Creating new YouTube player');
            playerDiv.innerHTML = '';
            this.ytPlayer = new YT.Player('youtubePlayer', {
                height: '100%',
                width: '100%',
                videoId: videoId,
                playerVars: {
                    'autoplay': 1,
                    'controls': 1,
                    'modestbranding': 1,
                    'showinfo': 0,
                    'rel': 0,
                    'fs': 1
                }
            });
        }
    }
    
    loadThumbnail(videoId) {
        // Hide video container, show thumbnail
        document.querySelector('.video-container').style.display = 'none';
        document.getElementById('thumbnailContainer').style.display = 'block';
        
        if (!videoId || videoId === 'example' || videoId === null) {
            console.error('No valid video ID provided for thumbnail:', videoId);
            return;
        }
        
        console.log('Loading thumbnail for video:', videoId);
        const thumbnailImage = document.getElementById('thumbnailImage');
        const mediumUrl = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
        
        thumbnailImage.onload = () => {
            console.log('Thumbnail loaded successfully');
        };
        
        thumbnailImage.onerror = () => {
            console.warn('Medium thumbnail failed, trying high resolution');
            const highUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
            
            thumbnailImage.onload = () => {
                console.log('High resolution thumbnail loaded successfully');
            };
            
            thumbnailImage.onerror = () => {
                console.warn('High thumbnail failed, trying default');
                const defaultUrl = `https://img.youtube.com/vi/${videoId}/default.jpg`;
                
                thumbnailImage.onload = () => {
                    console.log('Default thumbnail loaded successfully');
                };
                
                thumbnailImage.onerror = () => {
                    console.error('All thumbnails failed');
                };
                
                thumbnailImage.src = defaultUrl;
            };
            
            thumbnailImage.src = highUrl;
        };
        
        // Start with medium resolution
        thumbnailImage.src = mediumUrl;
    }
    
    isDemonBlacklisted(demon, gameMode = null) {
        return this.blacklistedDemons.some(blacklisted => {
            const nameMatch = blacklisted.name === demon.name;
            const publisherMatch = blacklisted.publisher === (demon.publisher?.name || demon.publisher);
            
            if (!nameMatch || !publisherMatch) {
                return false;
            }
            
            // Always blacklist if status is 'blacklisted'
            if (blacklisted.status === 'blacklisted') {
                return true;
            }
            
            // Blacklist for thumbnail mode if status is 'thumbnail_blacklisted'
            if (blacklisted.status === 'thumbnail_blacklisted' && gameMode === 'thumbnail') {
                return true;
            }
            
            return false;
        });
    }

    getEligibleDemons() {
        const { mainList, extendedList, legacyList } = this.currentGame.lists;
        
        const demonsToUse = this.finalList.length > 0 ? this.finalList : this.consolidatedList;
        
        const gameMode = this.currentGame.difficulty;
        
        const filtered = demonsToUse.filter(demon => {
            
            // Check if demon is blacklisted (pass game mode for thumbnail-specific blacklisting)
            if (this.isDemonBlacklisted(demon, gameMode)) {
                return false;
            }
            
            // Check list eligibility
            if (mainList && demon.position <= 75) {  // Main list: positions 1-75
                return true;
            }
            if (extendedList && demon.position > 75 && demon.position <= 150) {
                return true;
            }
            if (legacyList && demon.position > 150) {
                return true;
            }
            
            return false;
        });
        return filtered;
    }

    getFallbackDemons() {
        return [
            { position: 1, name: "Tidal Wave", publisher: "OniLink", verifier: "Zoink", video: "bHOJFJlFKbY", id: 1, level_id: 86329568 },
            { position: 2, name: "Acheron", publisher: "ryamu", verifier: "Zoink", video: "zT9fJPqSEfE", id: 2, level_id: 73667628 },
            { position: 3, name: "Kenos", publisher: "npesta", verifier: "npesta", video: "Bs0GcWjRQHQ", id: 3, level_id: 58417014 },
            // Some legacy demons with real GD videos
            { position: 151, name: "Thinking Space", publisher: "Atomic", verifier: "Atomic", video: "kVw9YCqzO6w", id: 151, level_id: 12345 },
            { position: 152, name: "Blade of Justice", publisher: "LazerBlitz", verifier: "LazerBlitz", video: "YbGXigp5o3U", id: 152, level_id: 12346 },
            { position: 180, name: "Retention", publisher: "Woogi1411", verifier: "Woogi1411", video: "P5-0Cm4u2qQ", id: 180, level_id: 12347 },
            { position: 220, name: "Black Flag", publisher: "Krazyman50", verifier: "Krazyman50", video: "5lVQiQzCqxs", id: 220, level_id: 12348 }
        ];
    }

    initYouTubeAPI() {
        window.onYouTubeIframeAPIReady = () => {
            console.log('YouTube API ready');
        };
    }

    setupEventListeners() {
        console.log('[DEBUG] Setting up event listeners');
        try {
            document.querySelectorAll('input[name="difficulty"]').forEach(radio => {
                radio.addEventListener('change', (e) => {
                    const moveOptions = document.getElementById('moveOptions');
                    moveOptions.style.display = e.target.value === 'move' ? 'block' : 'none';
                });
            });

            // Add Enter key support for guess input and Tab key prevention
            document.addEventListener('keydown', (e) => {
                // Handle Enter key for guess submission
                if (e.key === 'Enter' || e.key === 'Return') {
                    const guessInput = document.getElementById('guessInput');
                    const gameScreen = document.getElementById('gameScreen');
                    const guessSection = document.getElementById('guessSection');
                    
                    // Only submit if we're in game screen, guess section is visible, and input is focused or has value
                    if (gameScreen && gameScreen.classList.contains('active') && 
                        guessSection && guessSection.style.display !== 'none' &&
                        (document.activeElement === guessInput || guessInput.value)) {
                        e.preventDefault();
                        this.submitGuess();
                    }
                }
                
                // Block Tab key unless round is actively in progress
                if (e.key === 'Tab') {
                    const gameScreen = document.getElementById('gameScreen');
                    const guessSection = document.getElementById('guessSection');
                    const guessInput = document.getElementById('guessInput');
                    
                    // Only allow Tab if we're in active gameplay (game screen active, guess section visible, and input exists)
                    const isRoundInProgress = gameScreen && gameScreen.classList.contains('active') && 
                                            guessSection && guessSection.style.display !== 'none' &&
                                            guessInput;
                    
                    if (!isRoundInProgress) {
                        console.log('🚫 [TAB BLOCK] Tab key blocked - round not in progress');
                        e.preventDefault();
                        e.stopPropagation();
                        return false;
                    }
                }
            });
            console.log('[DEBUG] Event listeners setup complete');
        } catch (error) {
            this.logError('Setup event listeners failed', error);
        }
    }

    setupPartyEventListeners() {
        // Party difficulty options
        document.querySelectorAll('input[name="partyDifficulty"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const moveOptions = document.getElementById('partyMoveOptions');
                moveOptions.style.display = e.target.value === 'move' ? 'block' : 'none';
            });
        });

        // Multiplayer callbacks are now registered in setupMultiplayerCallbacks()
        // which is called after connection is established
    }

    handlePlayerScoreSubmitted(data) {
        // Prevent handling player score if user has quit
        if (this.userHasQuit) {
            console.log('🚪 [QUIT] Ignoring handlePlayerScoreSubmitted because user has quit');
            return;
        }
        
        // Handle when any player submits their score 
        const currentUserId = this.getCurrentUserId();
        
        console.log('📨 [SCORE SYNC] Player score submitted:', {
            playerId: data.playerId,
            currentUser: currentUserId,
            score: data.score,
            guess: data.guess,
            gameType: this.currentGame?.gameType
        });
        
        // Handle FFA score synchronization
        if (this.currentGame?.gameType === 'ffa' && data.playerId !== currentUserId) {
            console.log('📨 [FFA SYNC] Updating FFA data for opponent:', data.playerId);
            
            // Initialize ffaRoundData if needed
            if (!this.currentGame.ffaRoundData) {
                this.currentGame.ffaRoundData = {};
            }
            
            // Store opponent's round data
            this.currentGame.ffaRoundData[data.playerId] = {
                guess: data.guess,
                score: data.score,
                totalScore: data.totalScore || 0
            };
            
            console.log('📨 [FFA SYNC] Opponent data stored:', this.currentGame.ffaRoundData[data.playerId]);
            return;
        }
        
        // Handle duel score synchronization  
        if (!this.currentGame.duelState) return;
        
        console.log('📨 HANDLE PLAYER SCORE - Player ID:', data.playerId, 'Current User:', currentUserId);
        console.log('📨 HANDLE PLAYER SCORE - Data:', data);
        
        // Always store opponent's score and guess (regardless of submission order)
        if (data.playerId !== currentUserId) {
            console.log('📨 Storing opponent data - Score:', data.score, 'Guess:', data.guess);
            
            // Store opponent's score and guess
            this.currentGame.duelState.roundScores[data.playerId] = data.score;
            if (data.guess !== undefined) {
                if (!this.currentGame.duelState.roundGuesses) {
                    this.currentGame.duelState.roundGuesses = {};
                }
                this.currentGame.duelState.roundGuesses[data.playerId] = data.guess;
                console.log('📨 Opponent guess stored:', data.guess, 'for player:', data.playerId);
            }
        }
        
        // If this is the opponent's score and we haven't submitted yet, start countdown
        if (data.playerId !== currentUserId && !this.currentGame.duelState.roundScores[currentUserId]) {
            console.log('⏱️ Opponent submitted first - starting countdown for us');
            
            // Show opponent submitted notification (not full overlay)
            this.showOpponentSubmittedNotification();
            
            // Start countdown for us to submit
            this.startDuelCountdown(currentUserId);
        }
    }

    showOpponentSubmittedNotification() {
        // Show a notification that opponent submitted, but don't block input
        const notification = document.createElement('div');
        notification.id = 'opponentSubmittedNotification';
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(135deg, #ff6b6b, #ee5a24);
            color: white;
            padding: 15px 30px;
            border-radius: 25px;
            font-size: 18px;
            font-weight: bold;
            z-index: 1000;
            box-shadow: 0 4px 15px rgba(0,0,0,0.3);
            animation: notificationSlide 0.5s ease-out;
        `;
        
        notification.innerHTML = `
            <style>
                @keyframes notificationSlide {
                    0% { opacity: 0; transform: translateX(-50%) translateY(-20px); }
                    100% { opacity: 1; transform: translateX(-50%) translateY(0); }
                }
            </style>
            ⚡ Opponent submitted! <span id="opponentCountdown">15</span>s remaining
        `;
        
        document.body.appendChild(notification);
        
        console.log('📢 Showing opponent submitted notification');
    }

    handleNextRoundStarted(data) {
        console.log('🔄 [CLIENT] handleNextRoundStarted called with data:', data);
        console.log('🔄 [CLIENT] Current game state:', {
            currentRound: this.currentGame?.currentRound,
            totalRounds: this.currentGame?.totalRounds,
            gameType: this.currentGame?.gameType,
            isHost: this.isHost
        });
        
        // Prevent handling next round if user has quit
        if (this.userHasQuit) {
            console.log('🚪 [QUIT] Ignoring handleNextRoundStarted because user has quit');
            return;
        }
        
        // Close any duel results overlay for non-hosts
        const duelResultsOverlay = document.getElementById('detailedDuelResults');
        if (duelResultsOverlay) {
            duelResultsOverlay.remove();
        }
        
        // CRITICAL FIX: Remove FFA reveal screen for ALL players (host and non-host)
        const ffaRevealScreen = document.getElementById('ffaRevealScreen');
        if (ffaRevealScreen) {
            console.log('🔄 [CLIENT] Removing FFA reveal screen before starting new round');
            ffaRevealScreen.remove();
        }
        
        // Also remove FFA waiting overlay if it exists
        const ffaWaitingOverlay = document.getElementById('ffaWaitingOverlay');
        if (ffaWaitingOverlay) {
            console.log('🔄 [CLIENT] Removing FFA waiting overlay');
            ffaWaitingOverlay.remove();
        }
        
        // Force hide result section to ensure clean transition
        const resultSection = document.getElementById('resultSection');
        if (resultSection && resultSection.style.display !== 'none') {
            console.log('🔄 [CLIENT] Hiding result section before new round');
            resultSection.style.display = 'none';
        }
        
        // Force next round for all players
        this.stopCurrentVideo();
        
        // Synchronize client round counter with server
        if (data.round && this.currentGame) {
            console.log('🔄 [CLIENT] Synchronizing round counter:', {
                clientRound: this.currentGame.currentRound,
                serverRound: data.round,
                totalRounds: this.currentGame.totalRounds
            });
            // Set to server round directly - startNewRound will NOT increment because we're in multiplayer
            this.currentGame.currentRound = data.round;
            console.log('🔄 [CLIENT] After sync - currentRound:', this.currentGame.currentRound);
        }
        
        // CRITICAL: Sync health data from party to game to prevent HP bar movement
        if (data.party && data.party.duelHealth && this.currentGame && this.currentGame.gameType === 'duels') {
            console.log('🔄 [HEALTH SYNC] Synchronizing duel health from party:', data.party.duelHealth);
            console.log('🔄 [HEALTH SYNC] Previous game health:', this.currentGame.duelHealth);
            console.log('🔄 [HEALTH SYNC] Socket ID:', window.multiplayerManager?.socket?.id);
            console.log('🔄 [HEALTH SYNC] My health before sync:', this.currentGame.duelHealth?.[window.multiplayerManager?.socket?.id]);
            console.log('🔄 [HEALTH SYNC] My health from server:', data.party.duelHealth?.[window.multiplayerManager?.socket?.id]);
            this.currentGame.duelHealth = { ...data.party.duelHealth };
            console.log('🔄 [HEALTH SYNC] Updated game health:', this.currentGame.duelHealth);
            console.log('🔄 [HEALTH SYNC] My health after sync:', this.currentGame.duelHealth?.[window.multiplayerManager?.socket?.id]);
            
            // CRITICAL: Check for victory condition IMMEDIATELY after health sync and BEFORE display update
            const memberIds = this.currentParty.members.map(m => m.id);
            const player1Id = memberIds[0];
            const player2Id = memberIds[1];
            
            if (this.currentGame.duelHealth[player1Id] <= 0 || this.currentGame.duelHealth[player2Id] <= 0) {
                console.log('🏆 [HEALTH SYNC] IMMEDIATE victory condition detected - someone at 0 HP');
                
                // Determine winner immediately
                const currentUserId = window.multiplayerManager?.socket?.id;
                if (this.currentGame.duelHealth[currentUserId] > 0) {
                    this.currentGame.duelWinner = currentUserId;
                    console.log('🏆 [HEALTH SYNC] I won! Setting duelWinner to:', currentUserId);
                } else {
                    const opponentId = memberIds.find(id => id !== currentUserId);
                    this.currentGame.duelWinner = opponentId;
                    console.log('🏆 [HEALTH SYNC] Opponent won! Setting duelWinner to:', opponentId);
                }
            }
            
            // CRITICAL FIX: Force update display with correct health values immediately after sync
            console.log('🔄 [HEALTH SYNC] Force updating display with correct server health values');
            this.updateDuelDisplay();
        }
        
        // CRITICAL: Sync multiplier from server to ensure UI displays correct value
        if (data.multiplier !== undefined && this.currentGame && this.currentGame.duelState) {
            console.log('🔄 [MULTIPLIER SYNC] Synchronizing multiplier from server:', data.multiplier);
            console.log('🔄 [MULTIPLIER SYNC] Previous multiplier:', this.currentGame.duelState.roundMultiplier);
            this.currentGame.duelState.roundMultiplier = data.multiplier;
            console.log('🔄 [MULTIPLIER SYNC] Updated multiplier:', this.currentGame.duelState.roundMultiplier);
        }
        
        // Check for duel winner first - show final results instead of generic end game
        if (this.currentGame.duelWinner) {
            console.log('🔄 [CLIENT] Duel winner detected, showing final results');
            this.showDuelFinalResults();
            return;
        }
        
        // For duels, never end based on round count - only end when someone hits 0 HP
        if (this.currentGame.gameType === 'duels') {
            console.log('🔄 [CLIENT] Duel mode - starting new round');
            this.startNewRound();
        } else if (this.currentGame.currentRound > this.currentGame.totalRounds) {
            console.log('🔄 [CLIENT] Game over condition met:', this.currentGame.currentRound, '>', this.currentGame.totalRounds);
            this.endGame();
        } else {
            console.log('🔄 [CLIENT] Starting new round - current:', this.currentGame.currentRound, 'total:', this.currentGame.totalRounds);
            this.startNewRound();
        }
    }

    connectToMultiplayer() {
        console.log('[DEBUG] Attempting to connect to multiplayer');
        // Ensure multiplayer manager is connected
        if (window.multiplayerManager) {
            console.log('[DEBUG] Multiplayer manager found, setting up connection');
            // Set up the connection callback to re-register event handlers
            window.multiplayerManager.onConnected = () => {
                console.log('[DEBUG] Multiplayer connected callback triggered');
                this.setupMultiplayerCallbacks();
            };
            
            console.log('[DEBUG] Initiating multiplayer connection');
            window.multiplayerManager.connect();
            
            // Also register callbacks immediately in case already connected
            if (window.multiplayerManager.connected) {
                console.log('[DEBUG] Multiplayer already connected, setting up callbacks');
                this.setupMultiplayerCallbacks();
            }
        } else {
            console.warn('[DEBUG] Multiplayer manager not found, will retry in 1 second');
            setTimeout(() => this.connectToMultiplayer(), 1000);
        }
    }
    
    setupMultiplayerCallbacks() {
        console.log('🔧 [SETUP-1] setupMultiplayerCallbacks() called at:', new Date().toISOString());
        console.log('🔧 [SETUP-1] Context:', {
            isHost: this.isHost,
            socketId: window.multiplayerManager?.socket?.id,
            connected: window.multiplayerManager?.connected
        });
        
        window.multiplayerManager.onPlayerScoreSubmitted = (data) => {
            this.handlePlayerScoreSubmitted(data);
        };
        
        window.multiplayerManager.onRoundComplete = (data) => {
            console.log('🔥🔥🔥 [MULTIPLAYER] onRoundComplete callback fired!');
            console.log('🔥🔥🔥 [MULTIPLAYER] Data received:', JSON.stringify(data, null, 2));
            this.handleOpponentScore(data);
        };
        
        window.multiplayerManager.onGameStarted = (data) => {
            console.log('🎮 [CLIENT] onGameStarted callback triggered with data:', data);
            this.handleMultiplayerGameStart(data);
        };
        
        window.multiplayerManager.onPartyUpdated = (party) => {
            console.log('🔥 [NUCLEAR] onPartyUpdated callback triggered');
            this.handlePartyUpdate(party);
            
            // Immediate nuclear FFA update if needed
            if (party.gameType === 'ffa' && 
                document.getElementById('partySetupScreen')?.classList.contains('active')) {
                console.log('🔥 [NUCLEAR] Direct FFA update from onPartyUpdated');
                setTimeout(() => this.rebuildFFADisplay(), 0);
                setTimeout(() => this.rebuildFFADisplay(), 100);
            }
        };
        
        window.multiplayerManager.onPartyCreated = (data) => {
            this.handlePartyCreated(data);
        };
        
        window.multiplayerManager.onJoinSuccess = (party) => {
            this.handlePartyJoined(party);
        };
        
        window.multiplayerManager.onJoinError = (error) => {
            console.error('❌ Failed to join party:', error);
            alert(`Failed to join party: ${error}`);
        };
        
        window.multiplayerManager.onNextRoundStarted = (data) => {
            this.handleNextRoundStarted(data);
        };
        
        window.multiplayerManager.onDuelVictory = (data) => {
            console.log('🏆 [CLIENT] Duel victory received from server:', data);
            this.handleDuelVictory(data);
        };
        
        window.multiplayerManager.onMemberLeft = (data) => {
            console.log('🚪 [CLIENT] Member left party:', data);
            this.handleMemberLeft(data);
        };
        
        window.multiplayerManager.onMemberJoined = (data) => {
            console.log('🎉 [CLIENT] Member joined party:', data);
            this.handleMemberJoined(data);
        };
        
        // CRITICAL FIX: Add gameFinished callback to bring all players to results screen
        console.log('🔧 [CALLBACK-1] ========== SETTING CALLBACK ==========');
        console.log('🔧 [CALLBACK-1] Setting onGameFinished callback for:', {
            isHost: this.isHost,
            socketId: window.multiplayerManager?.socket?.id,
            timestamp: new Date().toISOString(),
            existingCallback: typeof window.multiplayerManager?.onGameFinished,
            multiplayerExists: !!window.multiplayerManager
        });
        
        // Store callback with debugging wrapper
        const gameFinishedCallback = (data) => {
            console.log('🏁 [CLIENT-1] ========== CALLBACK-1 FIRED ==========');
            console.log('🏁 [CLIENT-1] Game finished - bringing player to results screen:', data);
            console.log('🏁 [CLIENT-1] This is host?', this.isHost);
            console.log('🏁 [CLIENT-1] Socket ID:', window.multiplayerManager?.socket?.id);
            console.log('🏁 [CLIENT-1] About to call handleGameFinished');
            
            try {
                this.handleGameFinished(data);
                console.log('🏁 [CLIENT-1] ✅ handleGameFinished completed');
            } catch (error) {
                console.error('🏁 [CLIENT-1] ❌ handleGameFinished failed:', error);
            }
            
            console.log('🏁 [CLIENT-1] ========== CALLBACK-1 COMPLETED ==========');
        };
        
        window.multiplayerManager.onGameFinished = gameFinishedCallback;
        
        // Verify callback was set
        console.log('✅ [CALLBACK-1] Callback set. Verification:', {
            callbackExists: typeof window.multiplayerManager.onGameFinished === 'function',
            callbackMatches: window.multiplayerManager.onGameFinished === gameFinishedCallback
        });
        
        // Set up monitoring to detect if callback gets overridden
        setTimeout(() => {
            console.log('🔍 [CALLBACK-1] 1-second check - callback still exists:', 
                typeof window.multiplayerManager?.onGameFinished === 'function',
                'matches original:', window.multiplayerManager?.onGameFinished === gameFinishedCallback
            );
        }, 1000);
        
        setTimeout(() => {
            console.log('🔍 [CALLBACK-1] 5-second check - callback still exists:', 
                typeof window.multiplayerManager?.onGameFinished === 'function',
                'matches original:', window.multiplayerManager?.onGameFinished === gameFinishedCallback
            );
        }, 5000);
    }

    handlePartyCreated(data) {
        console.log('🎉 [CLIENT] Party created successfully:', {
            partyCode: data.code,
            hostId: data.party.host,
            myId: window.multiplayerManager?.getSocketId()
        });
        
        this.currentParty = data.party;
        this.isHost = true;
        
        this.showScreen('partySetupScreen');
        document.getElementById('partyCode').textContent = data.code;
        
        // Apply host/non-host restrictions (host gets full access)
        this.applyHostRestrictions();
        
        // Update visual displays
        this.updatePartyGameTypeVisuals();
        this.updatePartyVisual();
        
        // 🔥 NUCLEAR: Simple immediate update
        console.log('🔥 NUCLEAR: Party created, updating visuals');
        if (this.currentParty.gameType === 'ffa') {
            this.rebuildFFADisplay();
            this.startFFAAutoFix(); // Start auto-fix monitoring
        }
        
        // Initialize teams if not present
        if (!this.currentParty.teams) {
            this.currentParty.teams = {
                red: { name: 'Red Team', color: '#ff4444', members: [] },
                blue: { name: 'Blue Team', color: '#4488ff', members: [] },
                green: { name: 'Green Team', color: '#44ff44', members: [] },
                yellow: { name: 'Yellow Team', color: '#ffff44', members: [] }
            };
        }
    }

    handlePartyJoined(party) {
        console.log('🎉 [CLIENT] Successfully joined party:', {
            partyCode: party.code,
            memberCount: party.members.length,
            gameType: party.gameType,
            hostId: party.host,
            myId: window.multiplayerManager?.getSocketId()
        });
        
        this.currentParty = party;
        this.isHost = party.host === window.multiplayerManager?.getSocketId();
        
        console.log('🎉 [CLIENT] Set isHost to:', this.isHost);
        
        this.showScreen('partySetupScreen');
        document.getElementById('partyCode').textContent = party.code;
        
        // Apply host/non-host restrictions
        this.applyHostRestrictions();
        
        // Update visual displays
        this.updatePartyGameTypeVisuals();
        this.updatePartyVisual();
        
        // Force visual update for joined party with delay to ensure DOM is ready
        console.log('🎨 [CLIENT] Force updating visual for joined party, gameType:', party.gameType);
        setTimeout(() => {
            if (party.gameType === 'ffa') {
                console.log('🎨 [CLIENT] Delayed FFA visual update for party join');
                this.updateFFAVisual();
                // Additional updates for party join
                setTimeout(() => this.updateFFAVisual(), 100);
                setTimeout(() => this.updateFFAVisual(), 300);
            } else if (party.gameType === 'duels') {
                this.updateDuelsVisual();
            }
        }, 100);
    }

    applyHostRestrictions() {
        console.log('🔐 [CLIENT] Applying host restrictions, isHost:', this.isHost);
        
        // Hide party name input for ALL users (host and non-host)
        const partyNameInput = document.getElementById('partyName');
        if (partyNameInput) {
            partyNameInput.style.display = 'none';
        }
        
        // Hide party code regenerate button for ALL users (host and non-host)
        const regenerateBtn = document.querySelector('.regenerate-btn');
        if (regenerateBtn) {
            regenerateBtn.style.display = 'none';
        }
        
        if (this.isHost) {
            // Host: Show all settings
            const allSections = document.querySelectorAll('#partySetupScreen .setup-section');
            allSections.forEach(section => {
                section.style.display = 'block';
                const select = section.querySelector('select');
                if (select) {
                    select.disabled = false;
                    select.style.opacity = '1';
                    // Restore dropdown arrow for host
                    if (select.id === 'partyGameType') {
                        select.style.webkitAppearance = '';
                        select.style.mozAppearance = '';
                        select.style.appearance = '';
                        select.style.backgroundImage = '';
                        select.style.cursor = '';
                    }
                }
            });
            
            // Show start game button
            const startButton = document.getElementById('startPartyGameBtn');
            if (startButton) {
                startButton.style.display = 'block';
            }
            
            // Remove non-host message if it exists
            const existingMessage = document.getElementById('nonHostMessage');
            if (existingMessage) {
                existingMessage.remove();
            }
            
            console.log('🔐 [CLIENT] Host: All settings enabled');
        } else {
            // Non-host: Hide most settings
            console.log('🔐 [CLIENT] Non-host - applying restrictions');
            const allSections = document.querySelectorAll('#partySetupScreen .setup-section');
            console.log('🔐 [CLIENT] Found', allSections.length, 'setup sections');
            
            allSections.forEach((section, index) => {
                const heading = section.querySelector('h3');
                if (heading) {
                    const headingText = heading.textContent.trim();
                    console.log(`🔐 [CLIENT] Section ${index}: "${headingText}"`);
                    
                    if (headingText === 'Game Type' || headingText === 'Party Settings') {
                        // Keep game type and party settings visible but disabled
                        console.log(`🔐 [CLIENT] Keeping "${headingText}" visible but disabled`);
                        section.style.display = 'block';
                        const select = section.querySelector('select');
                        if (select) {
                            select.disabled = true;
                            select.style.opacity = '0.7';
                            // Remove dropdown arrow for non-host
                            if (select.id === 'partyGameType') {
                                select.style.webkitAppearance = 'none';
                                select.style.mozAppearance = 'none';
                                select.style.appearance = 'none';
                                select.style.backgroundImage = 'none';
                                select.style.cursor = 'default';
                            }
                        }
                        const inputs = section.querySelectorAll('input, select');
                        inputs.forEach(input => {
                            input.disabled = true;
                            input.style.opacity = '0.7';
                        });
                    } else if (headingText === 'Guess Timer (FFA)') {
                        // Hide FFA timer section for non-hosts completely
                        console.log(`🔐 [CLIENT] Hiding "${headingText}" section for non-host`);
                        section.style.display = 'none';
                    } else {
                        // Hide other sections (Game Lists, Difficulty, Hints)
                        console.log(`🔐 [CLIENT] Hiding "${headingText}" section`);
                        section.style.display = 'none';
                    }
                } else {
                    console.log(`🔐 [CLIENT] Section ${index}: No heading found`);
                }
            });
            
            // Hide start game button
            const startButton = document.getElementById('startPartyGameBtn');
            if (startButton) {
                startButton.style.display = 'none';
            }
            
            // Add non-host message if not already present
            let messageDiv = document.getElementById('nonHostMessage');
            if (!messageDiv) {
                messageDiv = document.createElement('div');
                messageDiv.id = 'nonHostMessage';
                messageDiv.style.cssText = 'text-align: center; padding: 20px; color: #888; font-style: italic; font-size: 16px; border: 1px solid #444; border-radius: 8px; margin: 20px 0; background: #1a1a1a;';
                messageDiv.innerHTML = '🎮 You are a party member<br>Host is configuring game settings...';
                
                const setupContainer = document.querySelector('#partySetupScreen .container');
                if (setupContainer) {
                    setupContainer.appendChild(messageDiv);
                }
            }
            
            console.log('🔐 [CLIENT] Non-host: Settings restricted');
        }
    }

    handleDuelVictory(data) {
        console.log('🏆 [CLIENT] handleDuelVictory called with data:', data);
        console.log('🏆 [DEBUG] Setting duelWinner from server:', data.winner);
        console.log('🏆 [DEBUG] Stack trace:', new Error().stack);
        
        // Set the winner from server data
        this.currentGame.duelWinner = data.winner;
        console.log('🏆 [DEBUG] duelWinner is now:', this.currentGame.duelWinner);
        
        // Update health with final values from server
        if (data.finalHealth) {
            this.currentGame.duelHealth = { ...data.finalHealth };
        }
        
        console.log('🏆 [CLIENT] Duel ended - Winner:', data.winner);
        console.log('🏆 [CLIENT] Final health:', this.currentGame.duelHealth);
        
        // DON'T end the game immediately - let the round summary show first
        // The button will show "View Results" instead of "Next Round" now
        console.log('🏆 [CLIENT] Duel victory set - waiting for user to click "View Results"');
        
        // Update the button text if it exists - check both possible button IDs
        const nextBtn = document.getElementById('nextRoundBtn');
        const duelNextBtn = document.getElementById('duelNextRoundBtn');
        
        if (nextBtn) {
            nextBtn.textContent = 'View Summary';
            console.log('🏆 [CLIENT] Updated nextRoundBtn text to "View Summary"');
        }
        
        if (duelNextBtn) {
            duelNextBtn.textContent = 'View Summary';
            console.log('🏆 [CLIENT] Updated duelNextRoundBtn text to "View Summary"');
        }
    }

    handleGameFinished(data) {
        console.log('🔴 [DEBUG] ========== handleGameFinished() CALLED ==========');
        console.log('🔴 [DEBUG] Called with data:', data);
        console.log('🔴 [DEBUG] Final scores:', data.finalScores);
        console.log('🔴 [DEBUG] Game type:', data.gameType);
        console.log('🔴 [DEBUG] Current game state:', {
            gameType: this.currentGame?.gameType,
            currentRound: this.currentGame?.currentRound,
            isHost: this.isHost,
            currentScreen: document.querySelector('.screen.active')?.id
        });
        console.log('🔴 [DEBUG] Stack trace:', new Error().stack);
        
        // Update game state with final results
        if (data.finalScores) {
            console.log('🔴 [DEBUG] Updating totalScores from:', this.currentGame?.totalScores, 'to:', data.finalScores);
            this.currentGame.totalScores = data.finalScores;
        } else {
            console.log('🔴 [DEBUG] No finalScores in data to update');
        }
        
        // Bring player to results screen - this calls endGame() which shows the results
        console.log('🔴 [DEBUG] About to call this.endGame()');
        console.log('🔴 [DEBUG] endGame function exists:', typeof this.endGame);
        
        try {
            this.endGame();
            console.log('🔴 [DEBUG] ✅ this.endGame() completed successfully');
        } catch (error) {
            console.error('🔴 [DEBUG] ❌ this.endGame() failed:', error);
            console.error('🔴 [DEBUG] Error stack:', error.stack);
        }
        
        console.log('🔴 [DEBUG] ========== handleGameFinished() COMPLETED ==========');
    }

    handleMemberLeft(data) {
        console.log('🚪 [CLIENT] handleMemberLeft called with data:', data);
        
        // Show different notifications based on game state
        if (this.currentScreen === 'gameScreen' || this.currentScreen === 'ffaRevealScreen') {
            // During active game
            this.showNotification(`${data.playerName} left the game. Adjusting player count...`, 'warning');
            console.log(`🎮 [GAME] Player left during active game. Remaining players: ${data.remainingMembers}`);
        } else {
            // In lobby/setup
            this.showNotification(`${data.playerName} left the party`, 'info');
        }
        
        // Update party visual if we're on the party setup screen
        if (document.getElementById('partySetupScreen').classList.contains('active')) {
            setTimeout(() => {
                if (this.currentParty) {
                    this.updatePartyVisual();
                    if (this.currentParty.gameType === 'ffa') {
                        this.updateFFAVisual();
                        // Extra delay to ensure proper update
                        setTimeout(() => {
                            this.updateFFAVisual();
                        }, 100);
                    } else if (this.currentParty.gameType === 'teams') {
                        this.updateTeamsVisual();
                    } else if (this.currentParty.gameType === 'duels') {
                        this.updateDuelsVisual();
                    }
                }
            }, 100);
        }
    }

    handleMemberJoined(data) {
        console.log('🎉 [CLIENT] handleMemberJoined called with data:', data);
        
        // Show notification to existing players
        this.showNotification(data.message || `${data.newMember?.name || 'Someone'} joined the party`, 'success');
        
        // Update party data and force visual update
        if (data.party) {
            this.currentParty = data.party;
            this.isHost = data.party.host === window.multiplayerManager?.getSocketId();
            
            console.log('🎉 [CLIENT] Updated party data - members:', data.party.members.length);
            
            // Force visual update if on party setup screen
            if (document.getElementById('partySetupScreen').classList.contains('active')) {
                console.log('🎉 [CLIENT] Forcing visual update for member join');
                this.updatePartyVisual();
                this.updatePartyGameTypeVisuals();
                
                // Multiple aggressive FFA updates
                if (data.party.gameType === 'ffa') {
                    console.log('🎉 [CLIENT] Multiple FFA visual updates for member join');
                    this.updateFFAVisual();
                    setTimeout(() => this.updateFFAVisual(), 10);
                    setTimeout(() => this.updateFFAVisual(), 50);
                    setTimeout(() => this.updateFFAVisual(), 100);
                    setTimeout(() => this.updateFFAVisual(), 200);
                }
            }
        }
    }

    showNotification(message, type = 'info') {
        // Create notification element if it doesn't exist
        let notification = document.getElementById('gameNotification');
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'gameNotification';
            notification.className = 'game-notification';
            document.body.appendChild(notification);
        }

        // Set message and type
        notification.textContent = message;
        notification.className = `game-notification ${type} show`;
        
        console.log(`📢 [CLIENT] Showing notification: ${message}`);

        // Auto-hide after 3 seconds
        clearTimeout(this.notificationTimeout);
        this.notificationTimeout = setTimeout(() => {
            notification.classList.remove('show');
        }, 3000);
    }

    showMultiplayerOptions() {
        this.showScreen('multiplayerOptionsScreen');
    }

    showPartySetup() {
        const username = localStorage.getItem('username') || 'Host';
        
        // Connect to multiplayer server and create party
        if (window.multiplayerManager) {
            window.multiplayerManager.createParty(username);
        } else {
            console.error('❌ Multiplayer manager not available');
            alert('Multiplayer server connection failed. Please refresh and try again.');
        }
    }

    showJoinParty() {
        this.showScreen('joinPartyScreen');
        document.getElementById('joinPartyCode').value = '';
    }

    joinParty() {
        const partyCode = document.getElementById('joinPartyCode').value.trim().toUpperCase();
        
        if (!partyCode) {
            alert('Please enter a party code!');
            return;
        }
        
        if (partyCode.length !== 6) {
            alert('Party code must be 6 characters!');
            return;
        }
        
        const username = localStorage.getItem('username') || 'Player';
        
        // Use real multiplayer manager to join party
        if (window.multiplayerManager) {
            console.log('🔌 Joining party via multiplayer manager...');
            window.multiplayerManager.joinParty(partyCode, username);
        } else {
            console.error('❌ Multiplayer manager not available');
            alert('Multiplayer server connection failed. Please refresh and try again.');
        }
    }


    createPartyWithCode(partyCode) {
        // Create a regular party with the specified code
        const username = localStorage.getItem('username') || 'Host';
        
        this.currentParty = {
            code: partyCode,
            host: 'host',
            gameType: 'ffa', // Default to FFA, user can change
            members: [
                { id: 'host', name: username }
            ],
            settings: null
        };

        // Save party so others can join
        this.saveParty();
        
        // Show party setup screen 
        this.showScreen('partySetupScreen');
        document.getElementById('partyCode').textContent = partyCode;
        this.updatePartyVisual();
        
        // Start party refresh
        this.startPartyRefresh();
    }
    
    // Debug function to check current party status
    checkPartyStatus() {
        if (this.currentParty) {
            console.log('Current Party:', this.currentParty);
            console.log('Members:', this.currentParty.members);
            alert(`Party Status:\nCode: ${this.currentParty.code}\nType: ${this.currentParty.gameType}\nMembers: ${this.currentParty.members.length}\nNames: ${this.currentParty.members.map(m => m.name).join(', ')}`);
        } else {
            alert('No active party');
        }
    }

    debugListAllParties() {
        const allKeys = Object.keys(localStorage);
        const partyKeys = allKeys.filter(key => key.startsWith('party_'));
        
        partyKeys.forEach(key => {
            const partyData = localStorage.getItem(key);
            const party = JSON.parse(partyData);
        });
    }


    
    // Simulate joining a party (for testing across different browsers)
    simulatePartyJoin(partyCode) {
        const username = localStorage.getItem('username') || 'Player 2';
        
        // Create a simulated party that matches what the host would have
        this.currentParty = {
            code: partyCode,
            host: 'remote_host',
            gameType: 'duels',
            members: [
                { id: 'remote_host', name: 'Player 1 (Host)' },
                { id: 'player2', name: username }
            ],
            settings: {
                lists: { mainList: true, extendedList: true, legacyList: false },
                mode: 'classic',
                difficulty: 'normal',
                hints: {
                    showDate: false,
                    showCreator: false,
                    showVerifier: false,
                    showName: false
                }
            }
        };
        
        // Save locally
        this.saveParty();
        
        // Show party setup screen as member
        this.showScreen('partySetupScreen');
        document.getElementById('partyCode').textContent = partyCode;
        
        // Set game type to duels
        document.getElementById('partyGameType').value = 'duels';
        this.updatePartyGameType();
        
        // Disable controls since we're not the host
        document.getElementById('partyGameType').disabled = true;
        document.getElementById('partyMainList').disabled = true;
        document.getElementById('partyExtendedList').disabled = true;
        document.getElementById('partyLegacyList').disabled = true;
        document.querySelectorAll('input[name="partyDifficulty"]').forEach(input => {
            input.disabled = true;
        });
        
        alert(`Simulated joining party: ${partyCode}\n\n` +
              `This is for testing only. In real multiplayer, both players must use the same browser.`);
        
    }

    generatePartyCode() {
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        document.getElementById('partyCode').textContent = code;
        
        this.currentParty = {
            code: code,
            name: '',
            host: localStorage.getItem('username') || `Player${Math.floor(Math.random()*1000)}`,
            members: [{ id: 'host', name: 'You (Host)', ready: true, teamId: 1 }],
            gameType: 'ffa',
            teams: {
                1: { name: 'Team 1', members: ['host'] },
                2: { name: 'Team 2', members: [] }
            },
            settings: {
                lists: { mainList: true, extendedList: false, legacyList: false },
                mode: 'classic',
                difficulty: 'nmpz',
                hints: {}
            }
        };
        
        // Initialize visual display
        setTimeout(() => this.updatePartyVisual(), 100);
    }

    copyPartyLink() {
        const link = `${window.location.origin}${window.location.pathname}?party=${this.currentParty.code}`;
        navigator.clipboard.writeText(link).then(() => {
            alert('Party link copied to clipboard!');
        }).catch(() => {
            alert(`Party Code: ${this.currentParty.code}\nShare this code with your friends!`);
        });
    }

    shareParty() {
        const text = `Join my DemonList Guessr party!\nParty Code: ${this.currentParty.code}\nLink: ${window.location.origin}${window.location.pathname}?party=${this.currentParty.code}`;
        
        if (navigator.share) {
            navigator.share({ text: text });
        } else {
            this.copyPartyLink();
        }
    }

    selectPartyGameType(gameType) {
        if (!this.currentParty) return;
        
        this.currentParty.gameType = gameType;
        document.getElementById('partyGameType').value = gameType;
        
        this.updatePartyGameType();
    }

    updatePartyGameType() {
        if (!this.isHost) {
            console.log('⛔ Not host, cannot change game type');
            return;
        }
        
        const gameType = document.getElementById('partyGameType').value;
        if (this.currentParty) {
            this.currentParty.gameType = gameType;
            
            // Sync with server if using real multiplayer
            if (window.multiplayerManager && window.multiplayerManager.connected) {
                window.multiplayerManager.updateGameType(gameType);
                console.log('📡 Updated game type on server:', gameType);
            }
        }
        
        this.updatePartyGameTypeVisuals();
        this.updatePartyVisual();
    }

    // Drag and Drop for Team Management
    dragStart(event) {
        event.dataTransfer.setData('text/plain', event.target.dataset.memberId);
    }

    allowDrop(event) {
        event.preventDefault();
    }

    dropMember(event) {
        event.preventDefault();
        const memberId = event.dataTransfer.getData('text/plain');
        const targetTeam = event.currentTarget.closest('.team');
        const teamId = parseInt(targetTeam.dataset.teamId);
        
        this.movePlayerToTeam(memberId, teamId);
    }

    movePlayerToTeam(memberId, teamId) {
        const member = this.currentParty.members.find(m => m.id === memberId);
        if (!member) return;

        // Remove from old team
        const oldTeamId = member.teamId;
        if (this.currentParty.teams[oldTeamId]) {
            this.currentParty.teams[oldTeamId].members = this.currentParty.teams[oldTeamId].members.filter(id => id !== memberId);
        }

        // Add to new team
        member.teamId = teamId;
        if (!this.currentParty.teams[teamId]) {
            this.currentParty.teams[teamId] = { name: `Team ${teamId}`, members: [] };
        }
        this.currentParty.teams[teamId].members.push(memberId);

        this.updateTeamDisplay();
    }

    addTeam() {
        const teamIds = Object.keys(this.currentParty.teams).map(Number);
        const newTeamId = Math.max(...teamIds) + 1;
        
        this.currentParty.teams[newTeamId] = { name: `Team ${newTeamId}`, members: [] };
        this.createTeamElement(newTeamId);
    }

    createTeamElement(teamId) {
        const teamsContainer = document.querySelector('.teams-container');
        const teamDiv = document.createElement('div');
        teamDiv.className = 'team';
        teamDiv.dataset.teamId = teamId;
        teamDiv.innerHTML = `
            <div class="team-header">
                <h5>Team ${teamId}</h5>
                <span class="team-count">(0)</span>
                <button onclick="game.removeTeam(${teamId})" class="remove-team-btn">×</button>
            </div>
            <div class="team-members" ondrop="game.dropMember(event)" ondragover="game.allowDrop(event)">
            </div>
        `;
        teamsContainer.appendChild(teamDiv);
    }

    removeTeam(teamId) {
        if (Object.keys(this.currentParty.teams).length <= 2) {
            alert('Must have at least 2 teams!');
            return;
        }

        // Move members to team 1
        const members = this.currentParty.teams[teamId].members;
        members.forEach(memberId => this.movePlayerToTeam(memberId, 1));

        delete this.currentParty.teams[teamId];
        document.querySelector(`[data-team-id="${teamId}"]`).remove();
        this.updateTeamDisplay();
    }

    autoBalance() {
        const memberIds = this.currentParty.members.map(m => m.id);
        const teamIds = Object.keys(this.currentParty.teams).map(Number);
        const membersPerTeam = Math.ceil(memberIds.length / teamIds.length);

        // Clear all teams
        teamIds.forEach(teamId => {
            this.currentParty.teams[teamId].members = [];
        });

        // Distribute members evenly
        memberIds.forEach((memberId, index) => {
            const teamIndex = index % teamIds.length;
            const teamId = teamIds[teamIndex];
            this.movePlayerToTeam(memberId, teamId);
        });
    }

    updateTeamDisplay() {
        Object.keys(this.currentParty.teams).forEach(teamId => {
            const teamElement = document.querySelector(`[data-team-id="${teamId}"]`);
            if (!teamElement) return;

            const membersContainer = teamElement.querySelector('.team-members');
            const countElement = teamElement.querySelector('.team-count');
            const members = this.currentParty.teams[teamId].members;

            membersContainer.innerHTML = '';
            countElement.textContent = `(${members.length})`;

            members.forEach(memberId => {
                const member = this.currentParty.members.find(m => m.id === memberId);
                if (!member) return;

                const memberDiv = document.createElement('div');
                memberDiv.className = 'member-item';
                memberDiv.draggable = true;
                memberDiv.dataset.memberId = memberId;
                memberDiv.ondragstart = this.dragStart;
                memberDiv.innerHTML = `
                    <span class="member-name">${member.name}</span>
                    <span class="member-status">${member.ready ? 'Ready' : 'Not Ready'}</span>
                `;
                membersContainer.appendChild(memberDiv);
            });
        });
        this.updatePartyVisual();
    }

    updatePartyVisual() {
        console.log('🎨 [CLIENT] updatePartyVisual called');
        if (!this.currentParty) {
            console.error('❌ [CLIENT] No currentParty in updatePartyVisual');
            return;
        }
        
        const gameType = this.currentParty.gameType;
        const userAvatar = localStorage.getItem('userAvatar') || '👤';
        const username = localStorage.getItem('username') || 'You';
        
        console.log('🎨 [CLIENT] Updating visual for game type:', gameType);
        console.log('🎨 [CLIENT] Party members:', this.currentParty.members?.length || 0);
        
        // Hide/show Start Party Game button based on host status
        const startPartyBtn = document.getElementById('startPartyBtn');
        if (startPartyBtn) {
            startPartyBtn.style.display = this.isHost ? 'block' : 'none';
        }
        
        if (gameType === 'ffa') {
            console.log('🎨 [CLIENT] Game type is FFA, calling updateFFAVisual');
            this.updateFFAVisual();
        } else if (gameType === 'teams') {
            console.log('🎨 [CLIENT] Calling updateTeamsVisual');
            this.updateTeamsVisual();
        } else if (gameType === 'duels') {
            console.log('🎨 [CLIENT] Calling updateDuelsVisual');
            this.updateDuelsVisual();
        }
    }

    // 🔥 NUCLEAR OPTION: Completely rebuilt FFA display system
    rebuildFFADisplay() {
        console.log('🔥 NUCLEAR v2.1: Starting complete FFA display rebuild with !important styling');
        
        // Enhanced debugging
        console.log('🔥 NUCLEAR DEBUG:', {
            currentParty: !!this.currentParty,
            gameType: this.currentParty?.gameType,
            membersCount: this.currentParty?.members?.length || 0,
            members: this.currentParty?.members?.map(m => ({ id: m.id, name: m.name })) || [],
            isHost: this.isHost,
            socketId: window.multiplayerManager?.getSocketId()
        });
        
        // Get the container with multiple fallbacks
        let container = document.querySelector('.ffa-players');
        if (!container) {
            container = document.querySelector('#ffaMembersList .ffa-players');
        }
        if (!container) {
            console.error('🔥 NUCLEAR: Critical - no FFA container found anywhere');
            return;
        }
        
        console.log('🔥 NUCLEAR: Found container:', container.className);
        
        // Get party members with validation
        const members = this.currentParty?.members || [];
        if (members.length === 0) {
            console.log('🔥 NUCLEAR: No members to display');
            container.innerHTML = '<div class="no-players">No players in party</div>';
            return;
        }
        
        console.log('🔥 NUCLEAR: Rebuilding with members:', members.map(m => `${m.name} (${m.id})`));
        
        // Force clear everything with DOM manipulation
        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }
        
        // Get current user info
        const currentSocketId = window.multiplayerManager?.getSocketId();
        const customAvatar = localStorage.getItem('customAvatar');
        
        // Fragment for better performance
        const fragment = document.createDocumentFragment();
        
        // Rebuild each player from scratch with correct classes to match HTML template
        members.forEach((member, index) => {
            const div = document.createElement('div');
            div.className = 'player-avatar'; // FIXED: Use player-avatar to match HTML template
            div.dataset.memberId = member.id; // Add data attribute for debugging
            
            const isCurrentUser = member.id === currentSocketId;
            const isHost = member.id === this.currentParty.host;
            const displayName = isCurrentUser ? 'You' : (member.name || 'Player');
            const letter = (member.name || 'Player').charAt(0).toUpperCase() || 'P';
            
            console.log(`🔥 NUCLEAR: Processing member ${index + 1}:`, {
                name: displayName,
                isCurrentUser,
                isHost,
                id: member.id,
                socketId: currentSocketId
            });
            
            // Create avatar content for CSS styling (no inline styles)
            let avatarContent;
            if (isCurrentUser) {
                const userAvatar = localStorage.getItem('userAvatar');
                if (customAvatar) {
                    avatarContent = `<img src="${customAvatar}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
                } else if (userAvatar) {
                    avatarContent = userAvatar;
                } else {
                    // Just the letter - let CSS handle styling
                    avatarContent = letter;
                }
            } else if (member.avatar) {
                avatarContent = member.avatar;
            } else {
                // Just the letter - let CSS handle styling
                avatarContent = letter;
            }
            
            // Build HTML structure using CSS classes (no inline styles)
            div.innerHTML = `
                <div class="avatar">${avatarContent}</div>
                <span class="player-name">${displayName}${isHost ? ' 👑' : ''}</span>
            `;
            
            // Let CSS handle all the styling - remove inline style overrides
            
            fragment.appendChild(div);
            console.log(`🔥 NUCLEAR: Created element for ${displayName}`);
        });
        
        // Append all at once
        container.appendChild(fragment);
        
        // Verify the result
        const finalCount = container.querySelectorAll('.player-avatar').length;
        console.log(`🔥 NUCLEAR: Rebuild complete - ${finalCount}/${members.length} players displayed`);
        
        // Force style refresh and layout update
        container.style.display = 'none';
        container.offsetHeight; // Force reflow
        container.style.display = 'flex'; // Use flex for proper card layout
        container.style.flexWrap = 'wrap';
        container.style.justifyContent = 'center';
        container.style.gap = '10px';
        
        console.log('🔥 NUCLEAR: Display refresh complete with flex layout');
    }
    
    // Redirect old function to nuclear option
    updateFFAVisual() {
        console.log('🎯 [CLIENT] updateFFAVisual redirecting to nuclear option');
        this.rebuildFFADisplay();
    }
    
    // 🔥 NUCLEAR: Auto-fix safety net - runs every 2 seconds
    startFFAAutoFix() {
        if (this.ffaAutoFixInterval) {
            clearInterval(this.ffaAutoFixInterval);
        }
        
        this.ffaAutoFixInterval = setInterval(() => {
            const screen = document.getElementById('partySetupScreen');
            if (screen && screen.classList.contains('active') && this.currentParty?.gameType === 'ffa') {
                const expectedMembers = this.currentParty?.members?.length || 0;
                const displayedMembers = document.querySelectorAll('.ffa-players .player-avatar').length;
                
                if (expectedMembers !== displayedMembers && expectedMembers > 0) {
                    console.log('🔥 NUCLEAR: Auto-fix detected member count mismatch');
                    console.log(`🔥 NUCLEAR: Expected ${expectedMembers}, displayed ${displayedMembers}`);
                    this.rebuildFFADisplay();
                }
            }
        }, 2000);
    }
    
    stopFFAAutoFix() {
        if (this.ffaAutoFixInterval) {
            clearInterval(this.ffaAutoFixInterval);
            this.ffaAutoFixInterval = null;
        }
    }

    updateTeamsVisual() {
        const teamsDisplay = document.querySelector('.teams-display');
        if (!teamsDisplay) return;
        
        const customAvatar = localStorage.getItem('customAvatar');
        const currentUsername = localStorage.getItem('username') || 'You';
        const currentSocketId = window.multiplayerManager?.getSocketId();
        
        // Clear existing teams
        teamsDisplay.innerHTML = '';
        
        // Create team displays
        const teamIds = Object.keys(this.currentParty.teams);
        const maxTeamsToShow = Math.min(teamIds.length, 4); // Show max 4 teams visually
        
        for (let i = 0; i < maxTeamsToShow; i++) {
            const teamId = teamIds[i];
            const team = this.currentParty.teams[teamId];
            
            const teamDiv = document.createElement('div');
            teamDiv.className = 'team-side';
            teamDiv.dataset.team = teamId;
            
            const avatarsContainer = document.createElement('div');
            avatarsContainer.className = 'team-avatars';
            
            // Add team members
            team.members.forEach(memberId => {
                const member = this.currentParty.members.find(m => m.id === memberId);
                if (member) {
                    const playerDiv = document.createElement('div');
                    playerDiv.className = 'player-avatar';
                    
                    let avatarContent;
                    const isCurrentUser = member.id === currentSocketId;
                    
                    if (isCurrentUser && customAvatar) {
                        avatarContent = `<img src="${customAvatar}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
                    } else {
                        const letter = (isCurrentUser ? currentUsername : member.name).charAt(0).toUpperCase() || 'P';
                        avatarContent = letter;
                    }
                    
                    const displayName = isCurrentUser ? currentUsername : member.name;
                    const isHost = member.id === this.currentParty.host;
                    
                    playerDiv.innerHTML = `
                        <div class="avatar">${avatarContent}</div>
                        <span class="player-name">${displayName}${isHost ? ' 👑' : ''}</span>
                    `;
                    avatarsContainer.appendChild(playerDiv);
                }
            });
            
            teamDiv.innerHTML = `<h4>${team.name}</h4>`;
            teamDiv.appendChild(avatarsContainer);
            teamsDisplay.appendChild(teamDiv);
            
            // Add VS divider between teams (except after last team)
            if (i < maxTeamsToShow - 1) {
                const vsDiv = document.createElement('div');
                vsDiv.className = 'vs-divider';
                vsDiv.textContent = 'VS';
                teamsDisplay.appendChild(vsDiv);
            }
        }
    }

    updateDuelsVisual() {
        const duelDisplay = document.querySelector('.duel-display');
        if (!duelDisplay) return;
        
        const customAvatar = localStorage.getItem('customAvatar');
        const currentUsername = localStorage.getItem('username') || 'You';
        const currentSocketId = window.multiplayerManager?.getSocketId();
        
        // Clear and rebuild
        duelDisplay.innerHTML = '';
        
        // Get current user and opponent from actual party data
        const currentUser = this.currentParty.members.find(m => m.id === currentSocketId);
        const opponent = this.currentParty.members.find(m => m.id !== currentSocketId);
        
        // Player 1 (Current User)
        const player1Div = document.createElement('div');
        player1Div.className = 'duel-player';
        let avatarContent;
        if (customAvatar) {
            avatarContent = `<img src="${customAvatar}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
        } else {
            const letter = currentUsername.charAt(0).toUpperCase() || 'Y';
            avatarContent = letter;
        }
        
        const isHost = currentUser?.id === this.currentParty.host;
        player1Div.innerHTML = `
            <div class="player-avatar">
                <div class="avatar">${avatarContent}</div>
                <span class="player-name">${currentUsername}${isHost ? ' 👑' : ''}</span>
            </div>
        `;
        
        // VS divider
        const vsDiv = document.createElement('div');
        vsDiv.className = 'vs-divider';
        vsDiv.textContent = 'VS';
        
        // Player 2 (Opponent or waiting)
        const player2Div = document.createElement('div');
        player2Div.className = 'duel-player';
        
        if (opponent) {
            // Get opponent's avatar
            const opponentName = opponent.name || 'Opponent';
            const opponentLetter = opponentName.charAt(0).toUpperCase() || 'P';
            const isOpponentHost = opponent.id === this.currentParty.host;
            
            player2Div.innerHTML = `
                <div class="player-avatar">
                    <div class="avatar">${opponentLetter}</div>
                    <span class="player-name">${opponentName}${isOpponentHost ? ' 👑' : ''}</span>
                </div>
            `;
        } else {
            player2Div.innerHTML = `
                <div class="player-avatar waiting">
                    <div class="avatar">❓</div>
                    <span class="player-name">Waiting for opponent...</span>
                </div>
            `;
        }
        
        duelDisplay.appendChild(player1Div);
        duelDisplay.appendChild(vsDiv);
        duelDisplay.appendChild(player2Div);
    }

    startParty() {
        console.log('🚀 [CLIENT] startParty() called');
        console.log('🚀 [CLIENT] Current party:', this.currentParty);
        console.log('🚀 [CLIENT] Is host:', this.isHost);
        console.log('🚀 [CLIENT] Multiplayer manager connected:', window.multiplayerManager?.isConnected());
        
        if (!this.currentParty) {
            console.error('❌ [CLIENT] No party created!');
            alert('No party created!');
            return;
        }

        // Validate team setup for team games
        if (this.currentParty.gameType === 'teams') {
            const teamsWithMembers = Object.values(this.currentParty.teams).filter(team => team.members.length > 0);
            if (teamsWithMembers.length < 2) {
                alert('Need at least 2 teams with members!');
                return;
            }
        }

        if (this.currentParty && this.currentParty.gameType === 'duels' && this.currentParty.members.length < 2) {
            alert('Need at least 2 players for duels!');
            return;
        }

        // Stop party refresh when game starts
        this.stopPartyRefresh();

        // Get party settings
        const mainList = document.getElementById('partyMainList').checked;
        const extendedList = document.getElementById('partyExtendedList').checked;
        const legacyList = document.getElementById('partyLegacyList').checked;
        
        if (!mainList && !extendedList && !legacyList) {
            alert('Please select at least one list!');
            return;
        }
        
        // For FFA games, use 'classic' mode since FFA only needs timer setting
        const gameMode = this.currentParty.gameType === 'ffa' ? 'classic' : document.getElementById('partyGameMode').value;
        const difficulty = document.querySelector('input[name="partyDifficulty"]:checked').value;
        
        const hints = {
            showDate: document.getElementById('partyShowDate')?.checked || false,
            showCreator: document.getElementById('partyShowCreator')?.checked || false,
            showVerifier: document.getElementById('partyShowVerifier')?.checked || false,
            showName: document.getElementById('partyShowName')?.checked || false
        };

        // Get FFA timer setting if FFA mode
        let ffaTimer = 60; // Default 60 seconds
        if (this.currentParty.gameType === 'ffa') {
            const timerRadio = document.querySelector('input[name="ffaTimer"]:checked');
            ffaTimer = timerRadio ? parseInt(timerRadio.value) : 60;
            console.log('🕐 [FFA] Timer setting:', { 
                radioElement: !!timerRadio, 
                radioValue: timerRadio?.value, 
                finalTimer: ffaTimer 
            });
        }

        // Update party settings
        this.currentParty.settings = {
            lists: { mainList, extendedList, legacyList },
            mode: gameMode,
            difficulty: difficulty,
            hints: hints,
            ffaTimer: ffaTimer
        };

        // Generate truly unique seed for consistent gameplay
        // Use timestamp + random + party code to ensure uniqueness
        const timestamp = Date.now();
        const randomPart = Math.floor(Math.random() * 1000000);
        const partyPart = this.currentParty?.code || 'local';
        const gameSeed = `${timestamp}_${randomPart}_${partyPart}`;
        
        console.log('🎲 NEW GAME SEED GENERATED:', gameSeed);
        console.log('🎲 Previous game seed was:', this.currentGame?.seed);

        // Create game data object
        const gameData = {
            mode: gameMode,
            difficulty: difficulty,
            hints: hints,
            lists: { mainList, extendedList, legacyList },
            gameType: this.currentParty.gameType,
            teams: this.currentParty.teams,
            seed: gameSeed,
            totalRounds: (this.currentParty && this.currentParty.gameType === 'ffa') ? 5 : 
                        (this.currentParty && this.currentParty.gameType === 'duels') ? 999 : 
                        (gameMode === 'classic' ? 5 : 10),
            ffaTimer: ffaTimer
        };

        // Send game start to server for all players
        console.log('🚀 [CLIENT] About to call multiplayerManager.startGame with data:', gameData);
        if (window.multiplayerManager) {
            console.log('🚀 [CLIENT] Calling multiplayerManager.startGame()');
            const result = window.multiplayerManager.startGame(gameData);
            console.log('🚀 [CLIENT] multiplayerManager.startGame() returned:', result);
        } else {
            console.error('❌ [CLIENT] No multiplayer manager available, using fallback');
            // Fallback for local testing
            this.handleMultiplayerGameStart({ party: this.currentParty, gameData, seed: gameSeed });
        }
    }

    async handleMultiplayerGameStart(data) {
        console.log('🚀 [CLIENT] handleMultiplayerGameStart called with data:', data);
        console.log('🚀 [CLIENT] Current screen:', document.querySelector('.screen.active')?.id);
        
        // Reset quit flag when starting multiplayer game
        this.userHasQuit = false;
        
        // Ensure demons are loaded before starting
        if (this.finalList.length === 0 && this.consolidatedList.length === 0) {
            console.log('⏳ [CLIENT] Demons not loaded yet, waiting...');
            await this.loadDemonList();
        }
        
        console.log('✅ [CLIENT] Demons loaded, proceeding with game start');
        console.log('✅ [CLIENT] Final list length:', this.finalList.length);
        console.log('✅ [CLIENT] Consolidated list length:', this.consolidatedList.length);
        
        const gameData = data.gameData || data;
        const party = data.party || this.currentParty;
        const seed = data.seed || gameData.seed || (Date.now() + Math.random() * 1000000).toString();
        
        console.log('🎲 RECEIVED GAME START - Using seed:', seed);
        console.log('🎲 Previous game seed was:', this.currentGame?.seed);

        // Initialize game for this player
        console.log('🎮 [DEBUG] Initializing currentGame object');
        console.log('🎮 [DEBUG] duelWinner before init:', this.currentGame?.duelWinner);
        
        this.currentGame = {
            mode: gameData.mode,
            difficulty: gameData.difficulty,
            hints: gameData.hints,
            lists: gameData.lists,
            rounds: [],
            currentRound: 1, // Start at round 1 to match server initialization
            totalRounds: gameData.totalRounds,
            score: 0,
            startTime: Date.now(),
            isParty: true,
            partyCode: party.code,
            gameType: gameData.gameType,
            teams: gameData.teams,
            seed: seed,
            playerScores: {},
            duelWinner: null,  // EXPLICITLY INITIALIZE AS NULL
            // FFA scoring system
            ffaScores: gameData.gameType === 'ffa' ? (() => {
                const scores = {};
                party.members.forEach(member => {
                    scores[member.id] = 0;
                });
                console.log('🏆 [FFA] Initializing FFA scores:', scores);
                return scores;
            })() : null,
            ffaTimer: gameData.ffaTimer ?? 60, // Store FFA timer setting (use ?? to allow 0)
            // Enhanced duel system with countdown
            duelHealth: gameData.gameType === 'duels' ? (() => {
                const health = {
                    [party.members[0].id]: 100, // Player 1: 100 HP
                    [party.members[1].id]: 100  // Player 2: 100 HP  
                };
                console.log('🏥🏥🏥 INITIALIZING DUEL HEALTH:');
                console.log('  Player 1 ID:', party.members[0].id, '-> 100 HP');
                console.log('  Player 2 ID:', party.members[1].id, '-> 100 HP');
                console.log('  Initial Health Object:', JSON.stringify(health));
                return health;
            })() : null,
            duelState: gameData.gameType === 'duels' ? {
                roundScores: {}, // Stores submitted scores for current round
                countdown: null, // Countdown timeout timer
                countdownInterval: null, // Countdown display interval
                clashReady: false, // Whether clash can happen
                roundMultiplier: 1.0 // Starts at 1x, increases each round
            } : null,
            duelWinner: null // Track duel winner - NEVER RESET!
        };

        // Set current party reference
        this.currentParty = party;
        
        console.log('🎮 [DEBUG] After full game init, duelWinner is:', this.currentGame.duelWinner);
        console.log('🎮 [DEBUG] currentGame properties:', {
            gameType: this.currentGame.gameType,
            duelWinner: this.currentGame.duelWinner,
            duelHealth: this.currentGame.duelHealth,
            playerScores: this.currentGame.playerScores
        });
        console.log('💯 [INIT] playerScores initialized as:', JSON.stringify(this.currentGame.playerScores));
        
        console.log('🚀 [CLIENT] About to start game - switching to gameScreen');
        console.log('🚀 [CLIENT] Game object created:', {
            mode: this.currentGame.mode,
            gameType: this.currentGame.gameType,
            totalRounds: this.currentGame.totalRounds,
            seed: this.currentGame.seed,
            partyMembers: this.currentParty.members.length
        });
        
        // Start the game
        this.showScreen('gameScreen');
        console.log('🚀 [CLIENT] Screen switched to gameScreen');
        
        this.startNewRound();
        console.log('🚀 [CLIENT] startNewRound() called - game should be running now');
    }

    handlePartyUpdate(party) {
        console.log('🔄 [CLIENT] Party update received:', {
            partyCode: party.code,
            memberCount: party.members.length,
            gameType: party.gameType,
            hostId: party.host,
            myId: window.multiplayerManager?.getSocketId(),
            isHost: party.host === window.multiplayerManager?.getSocketId(),
            members: party.members.map(m => ({ id: m.id, name: m.name }))
        });
        
        this.currentParty = party;
        this.isHost = party.host === window.multiplayerManager?.getSocketId();
        
        console.log('🔄 [CLIENT] Party data updated:', {
            members: party.members,
            isHost: this.isHost,
            gameType: party.gameType
        });
        
        // Update UI if we're on the party setup screen
        if (document.getElementById('partySetupScreen').classList.contains('active')) {
            console.log('🔄 [CLIENT] Updating party setup screen UI');
            
            // Update game type selector to match server state  
            const gameTypeSelect = document.getElementById('partyGameType');
            console.log('🎮 [GAMEMODE DEBUG] Current selector value:', gameTypeSelect?.value);
            console.log('🎮 [GAMEMODE DEBUG] Server party gameType:', party.gameType);
            console.log('🎮 [GAMEMODE DEBUG] Is host?', this.isHost);
            
            if (gameTypeSelect && gameTypeSelect.value !== party.gameType) {
                gameTypeSelect.value = party.gameType;
                console.log('🔄 [CLIENT] Updated game type selector to:', party.gameType);
                
                // Force trigger change event for non-host UI updates
                if (!this.isHost) {
                    console.log('🎮 [NON-HOST] Forcing complete visual gameType update');
                    
                    // Force update the title display
                    const gameTypeTitle = document.querySelector('#partySetupScreen h2');
                    console.log('🎮 [NON-HOST] Updating title for gameType:', party.gameType);
                    console.log('🎮 [NON-HOST] Found title element:', !!gameTypeTitle);
                    if (gameTypeTitle && party.gameType === 'duels') {
                        gameTypeTitle.textContent = '1v1 Duels';
                        console.log('🎮 [NON-HOST] Title set to: 1v1 Duels');
                    } else if (gameTypeTitle && party.gameType === 'ffa') {
                        gameTypeTitle.textContent = 'Free For All';
                        console.log('🎮 [NON-HOST] Title set to: Free For All');
                    } else if (gameTypeTitle && party.gameType === 'teams') {
                        gameTypeTitle.textContent = 'Teams';
                        console.log('🎮 [NON-HOST] Title set to: Teams');
                    }
                    
                    const changeEvent = new Event('change', { bubbles: true });
                    gameTypeSelect.dispatchEvent(changeEvent);
                }
            }
            
            // Apply host/non-host restrictions
            this.applyHostRestrictions();
            
            // Manually trigger the visual update without server sync
            console.log('🎨 [VISUAL UPDATE] Calling updatePartyGameTypeVisuals for gameType:', party.gameType);
            this.updatePartyGameTypeVisuals();
            console.log('🎨 [VISUAL UPDATE] Calling updatePartyVisual');
            this.updatePartyVisual();
            
            // Force update the specific game type visual
            console.log('🔄 [CLIENT] Force updating game type visual for:', party.gameType);
            if (party.gameType === 'ffa') {
                // Multiple aggressive updates to ensure it works
                this.updateFFAVisual();
                setTimeout(() => {
                    console.log('🔄 [CLIENT] Delayed FFA visual update after party update');
                    this.updateFFAVisual();
                }, 50);
                setTimeout(() => {
                    console.log('🔄 [CLIENT] Second delayed FFA visual update');
                    this.updateFFAVisual();
                }, 200);
                setTimeout(() => {
                    console.log('🔄 [CLIENT] Third delayed FFA visual update');
                    this.updateFFAVisual();
                }, 500);
            } else if (party.gameType === 'teams') {
                this.updateTeamsVisual();
            } else if (party.gameType === 'duels') {
                this.updateDuelsVisual();
            }
            
            console.log('🔄 [CLIENT] Party visual update complete');
        }
    }

    updatePartyGameTypeVisuals() {
        const gameType = this.currentParty?.gameType || 'ffa';
        
        console.log('🎨 [CLIENT] updatePartyGameTypeVisuals called for game type:', gameType);
        console.log('🎨 [DEBUG] Is host?', this.isHost);
        console.log('🎨 [DEBUG] Current party:', this.currentParty);
        
        // Show/hide appropriate management sections
        const ffaMembersList = document.getElementById('ffaMembersList');
        const teamManagement = document.getElementById('teamManagement');
        const duelsManagement = document.getElementById('duelsManagement');
        
        if (ffaMembersList) ffaMembersList.style.display = gameType === 'ffa' ? 'block' : 'none';
        if (teamManagement) teamManagement.style.display = gameType === 'teams' ? 'block' : 'none';
        if (duelsManagement) duelsManagement.style.display = gameType === 'duels' ? 'block' : 'none';
        
        // Show/hide visual displays
        const ffaVisual = document.getElementById('ffaVisual');
        const teamsVisual = document.getElementById('teamsVisual');
        const duelsVisual = document.getElementById('duelsVisual');
        
        console.log('🎨 [VISUAL] Updating visual displays for gameType:', gameType);
        if (ffaVisual) {
            ffaVisual.style.display = gameType === 'ffa' ? 'block' : 'none';
            console.log('🎨 [VISUAL] FFA visual display set to:', ffaVisual.style.display);
        }
        if (teamsVisual) {
            teamsVisual.style.display = gameType === 'teams' ? 'block' : 'none';
            console.log('🎨 [VISUAL] Teams visual display set to:', teamsVisual.style.display);
        }
        if (duelsVisual) {
            duelsVisual.style.display = gameType === 'duels' ? 'block' : 'none';
            console.log('🎨 [VISUAL] Duels visual display set to:', duelsVisual.style.display);
        }
        
        // Show/hide FFA timer settings (only for host when in FFA mode)
        const ffaTimerSection = document.getElementById('ffaTimerSection');
        if (ffaTimerSection) {
            // Only show FFA timer for host players when game type is FFA
            const shouldShowTimer = gameType === 'ffa' && this.isHost;
            ffaTimerSection.style.display = shouldShowTimer ? 'block' : 'none';
        }
        
        // Hide Game Mode section for FFA (since FFA only needs timer settings)
        const partyGameModeSection = document.getElementById('partyGameModeSection');
        if (partyGameModeSection) {
            // Hide Game Mode section when in FFA mode (use dedicated FFA timer instead)
            const shouldShowGameMode = gameType !== 'ffa';
            partyGameModeSection.style.display = shouldShowGameMode ? 'block' : 'none';
        }
        
        console.log('🎨 [CLIENT] Game type visual sections updated - FFA:', gameType === 'ffa', 'Teams:', gameType === 'teams', 'Duels:', gameType === 'duels');
    }

    showScreen(screenId) {
        console.log(`📺 [CLIENT] showScreen called - switching to: ${screenId}`);
        console.log(`📺 [CLIENT] Current active screen:`, document.querySelector('.screen.active')?.id);
        
        // If navigating to home screen and currently in a party, leave the party
        if (screenId === 'homeScreen' && this.currentParty && this.multiplayerManager?.isConnected()) {
            console.log('🚪 [CLIENT] Leaving party because navigating to home screen');
            this.leaveCurrentParty();
        }
        
        this.stopCurrentVideo();
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        
        const targetScreen = document.getElementById(screenId);
        if (targetScreen) {
            targetScreen.classList.add('active');
            console.log(`📺 [CLIENT] Successfully switched to screen: ${screenId}`);
            
            // Force update FFA visual when showing party setup screen
            if (screenId === 'partySetupScreen' && this.currentParty) {
                console.log('🎨 [CLIENT] Force updating party visual on screen show');
                setTimeout(() => {
                    this.updatePartyGameTypeVisuals();
                    this.updatePartyVisual();
                    if (this.currentParty.gameType === 'ffa') {
                        console.log('🎨 [CLIENT] Force updating FFA visual on party setup screen show');
                        this.updateFFAVisual();
                    }
                }, 50);
            }
        } else {
            console.error(`❌ [CLIENT] Target screen not found: ${screenId}`);
        }
        
        console.log(`📺 [CLIENT] New active screen:`, document.querySelector('.screen.active')?.id);
    }

    showGameSetup(mode) {
        this.gameMode = mode;
        this.showScreen('gameSetupScreen');
        const multiplayerOptions = document.getElementById('multiplayerOptions');
        multiplayerOptions.style.display = mode === 'multiplayer' ? 'block' : 'none';
    }

    startGame() {
        console.log('[DEBUG] Starting game...');
        
        // Reset quit flag when starting a new game
        this.userHasQuit = false;
        
        try {
            const mainList = document.getElementById('mainList').checked;
            const extendedList = document.getElementById('extendedList').checked;
            const legacyList = document.getElementById('legacyList').checked;
            
            console.log('[DEBUG] List selection:', { mainList, extendedList, legacyList });
            this.logGameState('Game start attempt');
            
            if (!mainList && !extendedList && !legacyList) {
            alert('Please select at least one list!');
            return;
        }
        
        const gameMode = document.getElementById('gameModeSelect').value;
        const difficulty = document.querySelector('input[name="difficulty"]:checked').value;
        
        const hints = {
            showDate: document.getElementById('showDate')?.checked || false,
            showCreator: document.getElementById('showCreator')?.checked || false,
            showVerifier: document.getElementById('showVerifier')?.checked || false,
            showName: document.getElementById('showName')?.checked || false
        };
        
        // Generate random seed for single player
        const randomSeed = (Date.now() + Math.random() * 1000000).toString();
        
        this.currentGame = {
            mode: gameMode,
            difficulty: difficulty,
            hints: hints,
            lists: { mainList, extendedList, legacyList },
            rounds: [],
            currentRound: 0,
            totalRounds: (this.currentParty && this.currentParty.gameType === 'duels') ? 999 : (gameMode === 'classic' ? 5 : 10),
            score: 0,
            startTime: Date.now(),
            seed: randomSeed
        };
        
        
            this.showScreen('gameScreen');
            this.startNewRound();
        } catch (error) {
            this.logError('Start game failed', error);
        }
    }

    startNewRound() {
        console.log('🔄 Starting new round - clearing server health flag and duel winner');
        
        // If there's a duel winner, don't start new round - the duel is over
        if (this.currentGame.duelWinner) {
            console.log('🔄 [DEBUG] Duel is over, not starting new round. Winner:', this.currentGame.duelWinner);
            return;
        }
        
        // Clear server health flag for new round
        if (this.currentGame.hasServerHealth) {
            this.currentGame.hasServerHealth = false;
            console.log('✅ Cleared hasServerHealth flag for new round');
        }
        
        const eligibleDemons = this.currentGame.mode === 'daily' ? 
            [this.currentGame.dailyDemons[this.currentGame.currentRound]] :
            this.getEligibleDemons();
            
        if (!eligibleDemons || eligibleDemons.length === 0) {
            console.error('❌ NO DEMONS AVAILABLE!');
            console.error('❌ Lists setting:', this.currentGame.lists);
            console.error('❌ Demons data loaded:', !!window.demons, !!window.extendedDemons, !!window.legacyDemons);
            alert('No demons available for selected lists!');
            return;
        }
        
        let randomDemon;
        if (this.currentGame.mode === 'daily') {
            randomDemon = eligibleDemons[0];
        } else {
            // Use seeded random for multiplayer consistency
            // Use the NEXT round number (currentRound + 1) for seed to ensure consistency
            const roundForSeed = this.currentGame.currentRound + 1;
            const seedString = (this.currentGame.seed || 'default') + '_round_' + roundForSeed;
            const rng = this.seededRandom(seedString);
            
            // Prevent repeats by filtering out already used demons
            const usedDemons = this.currentGame.rounds.map(r => r.demon.id);
            const availableDemons = eligibleDemons.filter(d => !usedDemons.includes(d.id));
            
            console.log('🎲 [DEMON SELECTION] Random selection debug:', {
                currentRound: this.currentGame.currentRound,
                roundForSeed: roundForSeed,
                seedString: seedString,
                eligibleCount: eligibleDemons.length,
                usedDemonsCount: usedDemons.length,
                usedDemonIds: usedDemons,
                availableCount: availableDemons.length,
                seed: this.currentGame.seed
            });
            
            if (availableDemons.length === 0) {
                // If all demons used, use all eligible demons again
                const rngValue = rng();
                const index = Math.floor(rngValue * eligibleDemons.length);
                randomDemon = eligibleDemons[index];
                console.log('🎲 [DEMON] All used - recycling from eligible:', { rngValue, index, selected: randomDemon?.name });
            } else {
                const rngValue = rng();
                const arrayLength = availableDemons.length;
                const index = Math.floor(rngValue * arrayLength);
                
                randomDemon = availableDemons[index];
                console.log('🎲 [DEMON] Selected from available:', { rngValue, arrayLength, index, selected: randomDemon?.name });
            }
        }
        
        
        if (!randomDemon || !randomDemon.video) {
            console.error('❌ INVALID DEMON SELECTED:', randomDemon);
            console.error('❌ Available demons count:', availableDemons?.length);
            console.error('❌ Eligible demons count:', eligibleDemons?.length);
            alert('Error: Invalid demon selected. Check console for details.');
            return;
        }
        
        this.currentGame.currentDemon = randomDemon;
        
        // Only increment round for solo games - multiplayer gets round number from server
        if (!this.currentGame.isParty) {
            this.currentGame.currentRound++;
            console.log('🔄 [CLIENT] Solo game - incremented round to:', this.currentGame.currentRound);
        } else {
            console.log('🔄 [CLIENT] Multiplayer game - using server round:', this.currentGame.currentRound);
        }
        
        document.getElementById('currentRound').textContent = this.currentGame.currentRound;
        document.getElementById('currentScore').textContent = this.currentGame.score;
        
        // Update multiplier display for duels only
        if (this.currentGame.gameType === 'duels' && this.currentGame.duelState) {
            const roundCounter = document.querySelector('.round-counter');
            if (roundCounter) {
                const multiplier = this.currentGame.duelState.roundMultiplier || 1.0;
                const multiplierDisplay = document.getElementById('multiplierDisplay') || (() => {
                    const span = document.createElement('span');
                    span.id = 'multiplierDisplay';
                    span.style.cssText = 'color: #ffd93d; margin-left: 15px; font-weight: bold;';
                    roundCounter.appendChild(span);
                    return span;
                })();
                multiplierDisplay.textContent = `(${multiplier.toFixed(1)}x damage)`;
            }
        } else {
            // Hide/remove multiplier display for non-duel games (FFA, teams)
            const multiplierDisplay = document.getElementById('multiplierDisplay');
            if (multiplierDisplay) {
                multiplierDisplay.style.display = 'none';
            }
        }
        
        // Show duel health display for duels and reset state
        if (this.currentGame.gameType === 'duels') {
            // Only update duel display on first round to avoid HP bar movement on subsequent rounds
            if (this.currentGame.currentRound === 1) {
                this.updateDuelDisplay();
                console.log('🔄 [ROUND 1] Updated duel display for first round');
            } else {
                console.log('🔄 [ROUND ' + this.currentGame.currentRound + '] Skipping duel display update to prevent HP bar movement');
            }
        } else {
            // CRITICAL FIX: Hide duel health display for non-duel games (FFA, teams, solo)
            const healthDisplay = document.getElementById('duelHealthDisplay');
            if (healthDisplay) {
                healthDisplay.style.display = 'none';
                console.log('🔄 [NON-DUEL] Hidden health display for', this.currentGame.gameType, 'game');
            }
        }
        
        // Reset duel state for new round - but NEVER reset duelWinner!
        if (this.currentGame.gameType === 'duels' && this.currentGame.duelState && !this.currentGame.duelWinner) {
                this.currentGame.duelState.roundScores = {};
                this.currentGame.duelState.roundGuesses = {};
                this.currentGame.duelState.clashReady = false;
                this.currentGame.hasServerHealth = false; // Reset for new round
                
                // Clear any countdown timers
                if (this.currentGame.duelState.countdown) {
                    clearTimeout(this.currentGame.duelState.countdown);
                    this.currentGame.duelState.countdown = null;
                }
                if (this.currentGame.duelState.countdownInterval) {
                    clearInterval(this.currentGame.duelState.countdownInterval);
                    this.currentGame.duelState.countdownInterval = null;
                }
        } else if (this.currentGame.duelWinner) {
            // Duel is already over, no need to cleanup
        }
        
        // Clear pending results from previous round
        this.currentGame.pendingResults = null;
        
        // Remove any lingering duel UI overlays - FORCE CLEANUP
        
        const waitingOverlay = document.getElementById('duelWaitingOverlay');
        if (waitingOverlay) {
            waitingOverlay.remove();
            console.log('🧹 Removed lingering waiting overlay');
        }
        
        const clashScreen = document.getElementById('clashScreen');
        if (clashScreen) {
            clashScreen.remove();
            console.log('🧹 Removed lingering clash screen');
        }
        
        const detailedResults = document.getElementById('detailedDuelResults');
        if (detailedResults) {
            detailedResults.remove();
            console.log('🧹 Removed lingering detailed results');
        }
        
        const opponentNotification = document.querySelector('.opponent-submitted-notification');
        if (opponentNotification) {
            opponentNotification.remove();
            console.log('🧹 Removed opponent notification');
        }
        
        // Also remove any overlays with generic class names
        document.querySelectorAll('[id*="duel"], [id*="clash"], [id*="waiting"]').forEach(overlay => {
            if (overlay.style.position === 'fixed' && overlay.style.zIndex > 1000) {
                overlay.remove();
                console.log('🧹 Removed generic duel overlay:', overlay.id);
            }
        });
        
        // Extract video ID from URL if needed
        const videoId = (randomDemon?.video?.includes('youtube.com') || randomDemon?.video?.includes('youtu.be')) 
            ? this.extractVideoId(randomDemon.video) 
            : randomDemon?.video;
            
        console.log('🎥 [VIDEO DEBUG] New round video loading:', {
            round: this.currentGame.currentRound,
            demonName: randomDemon?.name,
            demonId: randomDemon?.id,
            demonPosition: randomDemon?.position,
            videoUrl: randomDemon?.video,
            extractedVideoId: videoId,
            difficulty: this.currentGame.difficulty,
            gameType: this.currentGame.gameType
        });
        
        // Load media based on difficulty
        if (this.currentGame.difficulty === 'thumbnail') {
            console.log('🎥 [VIDEO] Loading thumbnail for round', this.currentGame.currentRound);
            this.loadThumbnail(videoId);
        } else {
            console.log('🎥 [VIDEO] Loading YouTube video for round', this.currentGame.currentRound);
            this.loadYouTubeVideo(videoId);
        }
        
        this.displayHints();
        
        console.log('🎨 [UI UPDATE] Transitioning screens in startNewRound');
        const guessSection = document.getElementById('guessSection');
        const resultSection = document.getElementById('resultSection');
        
        console.log('🎨 [UI UPDATE] Before transition:', {
            guessSectionDisplay: guessSection?.style.display,
            resultSectionDisplay: resultSection?.style.display,
            guessSectionExists: !!guessSection,
            resultSectionExists: !!resultSection
        });
        
        if (guessSection) {
            guessSection.style.display = 'block';
            console.log('🎨 [UI UPDATE] Set guessSection to block');
        } else {
            console.error('🎨 [UI ERROR] guessSection element not found!');
        }
        
        if (resultSection) {
            resultSection.style.display = 'none';
            console.log('🎨 [UI UPDATE] Set resultSection to none');
        } else {
            console.error('🎨 [UI ERROR] resultSection element not found!');
        }
        
        document.getElementById('guessInput').value = '';
        
        console.log('🎨 [UI UPDATE] After transition:', {
            guessSectionDisplay: guessSection?.style.display,
            resultSectionDisplay: resultSection?.style.display
        });
        
        const listIndicator = document.querySelector('.list-indicator');
        listIndicator.style.display = 'none';
        
        if (this.currentGame.mode === 'blitz') {
            this.startTimer(15);
        } else if (this.currentGame.mode === 'timeattack') {
            this.startTimer(60);
        } else if (this.currentGame.gameType === 'ffa' && this.currentGame.ffaTimer > 0) {
            // FFA mode with custom timer
            this.startTimer(this.currentGame.ffaTimer);
            console.log('🏆 [FFA] Starting timer for', this.currentGame.ffaTimer, 'seconds');
        }
    }


    displayHints() {
        const hintSection = document.getElementById('hintSection');
        const hintDisplay = document.getElementById('hintDisplay');
        
        if (this.currentGame.difficulty === 'nmpz' || this.currentGame.difficulty === 'thumbnail') {
            hintSection.style.display = 'none';
            return;
        }
        
        const hints = [];
        const demon = this.currentGame.currentDemon;
        
        if (this.currentGame.hints.showDate) {
            hints.push(`<div class="hint-item">Date: Jan 2024</div>`);
        }
        if (this.currentGame.hints.showCreator) {
            const creatorName = demon.publisher?.name || demon.publisher || 'Unknown';
            hints.push(`<div class="hint-item">Creator: ${creatorName}</div>`);
        }
        if (this.currentGame.hints.showVerifier) {
            const verifierName = demon.verifier?.name || demon.verifier || 'Unknown';
            hints.push(`<div class="hint-item">Verifier: ${verifierName}</div>`);
        }
        if (this.currentGame.hints.showName) {
            hints.push(`<div class="hint-item">Name: ${demon.name}</div>`);
        }
        
        if (hints.length > 0) {
            hintSection.style.display = 'block';
            hintDisplay.innerHTML = hints.join('');
        } else {
            hintSection.style.display = 'none';
        }
    }

    startTimer(seconds) {
        const timerDisplay = document.getElementById('timerDisplay');
        timerDisplay.style.display = 'inline';
        let timeLeft = seconds;
        
        this.currentTimer = setInterval(() => {
            // Check if user has quit before continuing timer
            if (this.userHasQuit) {
                console.log('🚪 [QUIT] Stopping timer because user has quit');
                clearInterval(this.currentTimer);
                return;
            }
            
            timerDisplay.textContent = `${timeLeft}s`;
            timeLeft--;
            
            if (timeLeft < 0) {
                clearInterval(this.currentTimer);
                this.submitGuess(true);
            }
        }, 1000);
    }

    calculateScore(guess, actual) {
        const difference = Math.abs(guess - actual);
        
        // Perfect guess always gets 100 points
        if (difference === 0) return 100;
        
        // Determine which section and apply appropriate scoring curve
        let score;
        
        if (actual <= 75) {
            // Main list (1-75): 100 for perfect, 50 for 15 off
            // Using bell curve formula: score = 100 * e^(-(difference^2) / (2 * sigma^2))
            // sigma chosen so that difference=15 gives score≈50
            const sigma = 15 / Math.sqrt(2 * Math.log(2)); // ≈ 12.73
            score = 100 * Math.exp(-(difference * difference) / (2 * sigma * sigma));
            
        } else if (actual <= 150) {
            // Extended list (76-150): 100 for perfect, 50 for 30 off
            const sigma = 30 / Math.sqrt(2 * Math.log(2)); // ≈ 25.46
            score = 100 * Math.exp(-(difference * difference) / (2 * sigma * sigma));
            
            // Smooth transition from main list (positions 70-80)
            if (actual >= 70 && actual <= 80) {
                const mainSigma = 15 / Math.sqrt(2 * Math.log(2));
                const mainScore = 100 * Math.exp(-(difference * difference) / (2 * mainSigma * mainSigma));
                
                // Linear interpolation between main and extended curves
                const transitionFactor = (actual - 70) / 10;
                score = mainScore * (1 - transitionFactor) + score * transitionFactor;
            }
            
        } else {
            // Legacy list (151+): 100 for perfect, 50 for 50 off
            const sigma = 50 / Math.sqrt(2 * Math.log(2)); // ≈ 42.43
            score = 100 * Math.exp(-(difference * difference) / (2 * sigma * sigma));
            
            // Smooth transition from extended list (positions 145-155)
            if (actual >= 145 && actual <= 155) {
                const extendedSigma = 30 / Math.sqrt(2 * Math.log(2));
                const extendedScore = 100 * Math.exp(-(difference * difference) / (2 * extendedSigma * extendedSigma));
                
                // Linear interpolation between extended and legacy curves
                const transitionFactor = (actual - 145) / 10;
                score = extendedScore * (1 - transitionFactor) + score * transitionFactor;
            }
        }
        
        // Round to nearest integer and ensure minimum of 0
        // Cap at 99 to ensure only perfect guesses get 100
        score = Math.max(0, Math.round(score));
        return difference === 0 ? 100 : Math.min(99, score);
    }

    submitGuess(timeout = false) {
        console.log('[DEBUG] SUBMIT GUESS CALLED - Game Type:', this.currentGame?.gameType, 'Timeout:', timeout);
        this.logGameState('Submit guess');
        
        // Only clear timer if it's a timeout or not FFA mode
        // In FFA, timer should keep running for other players
        if (this.currentTimer && (timeout || this.currentGame?.gameType !== 'ffa')) {
            console.log('⏰ [TIMER] Clearing timer - timeout:', timeout, 'gameType:', this.currentGame?.gameType);
            clearInterval(this.currentTimer);
        } else if (this.currentTimer && this.currentGame?.gameType === 'ffa') {
            console.log('⏰ [TIMER] Keeping timer running for other FFA players');
        }
        
        const guessInput = document.getElementById('guessInput');
        const guess = timeout ? 999 : parseInt(guessInput.value);
        
        if (!timeout && (!guess || guess < 1)) {
            alert('Please enter a valid placement guess!');
            return;
        }
        
        const actual = this.currentGame.currentDemon.position;
        const points = this.calculateScore(guess, actual);
        console.log('📊 SCORE CALCULATED:', points, 'for guess:', guess, 'vs actual:', actual);
        
        this.currentGame.score += points;
        
        // Note: Current player's total score will be updated via handleOpponentScore when server sends totalScores
        
        this.currentGame.rounds.push({
            demon: this.currentGame.currentDemon,
            guess: guess,
            actual: actual,
            points: points
        });
        
        // Handle different game modes
        if (this.currentGame.gameType === 'ffa') {
            // FFA mode - submit score and wait for others
            const currentUserId = this.getCurrentUserId();
            
            // Update local FFA score
            if (this.currentGame.ffaScores && currentUserId) {
                this.currentGame.ffaScores[currentUserId] += points;
                console.log('🏆 [FFA] Updated score for', currentUserId, ':', this.currentGame.ffaScores[currentUserId]);
            }
            
            // Store round data for FFA
            if (!this.currentGame.ffaRoundData) {
                this.currentGame.ffaRoundData = {};
            }
            this.currentGame.ffaRoundData[currentUserId] = {
                guess: guess,
                score: points,
                totalScore: this.currentGame.ffaScores[currentUserId]
            };
            
            // Submit score to multiplayer server
            if (window.multiplayerManager) {
                window.multiplayerManager.submitScore({ 
                    score: points, 
                    guess: guess, 
                    totalScore: this.currentGame.ffaScores[currentUserId],
                    round: this.currentGame.currentRound 
                });
            }
            
            // Store pending results for reveal
            this.currentGame.pendingResults = {
                guess: guess,
                actual: actual,
                points: points
            };
            
            // Show waiting screen for ALL players after they submit (not just first)
            const submittedCount = Object.keys(this.currentGame.ffaRoundData || {}).length;
            console.log('🎯 [FFA] Showing waiting screen - player submitted');
            console.log('🎯 [FFA] Submitted count:', submittedCount, '/ Expected:', this.currentParty.members.length);
            this.showFFAWaitingState();
            
        } else if (this.currentGame.gameType === 'duels') {
            
            // Submit both score and guess
            this.submitDuelScore({ score: points, guess: guess });
            
            // Store our guess and score for later reveal
            this.currentGame.pendingResults = {
                guess: guess,
                actual: actual,
                points: points
            };
            
            // Only show waiting state if opponent hasn't submitted yet
            const currentUserId = this.getCurrentUserId();
            const memberIds = this.currentParty.members.map(m => m.id);
            const otherPlayerId = memberIds.find(id => id !== currentUserId);
            const opponentScore = this.currentGame.duelState.roundScores[otherPlayerId];
            
            
            // Check if clash is already ready (both players submitted)
            if (this.currentGame.duelState.clashReady) {
                // Both already submitted - clash will happen immediately
            } else if (opponentScore === undefined) {
                // We're first to submit - opponent hasn't submitted yet - show waiting state
                this.showDuelWaitingState();
            } else {
                // Opponent already submitted - we're second - skip waiting screen, clash will trigger immediately
                console.log('⚔️ [DUEL] Second to submit, skipping waiting screen');
            }
        } else {
            // Solo/non-duel mode - show results immediately
            this.showResult(guess, actual, points);
            this.updateStats(guess, actual);
        }
    }

    showFFAReveal() {
        console.log('🏆 [FFA] Showing FFA reveal screen');
        
        // Prevent showing FFA reveal if user has quit
        if (this.userHasQuit) {
            console.log('🚪 [QUIT] Ignoring showFFAReveal because user has quit');
            return;
        }
        
        // Remove waiting overlay
        const waitingOverlay = document.getElementById('ffaWaitingOverlay');
        if (waitingOverlay) {
            waitingOverlay.remove();
        }
        
        // Create reveal screen
        const revealScreen = document.createElement('div');
        revealScreen.id = 'ffaRevealScreen';
        revealScreen.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1001;
            color: white;
            animation: fadeIn 0.3s ease-in-out;
            overflow-y: auto;
            padding: 20px;
        `;
        
        const currentUserId = this.getCurrentUserId();
        const actual = this.currentGame.currentDemon.position;
        const demon = this.currentGame.currentDemon;
        const roundData = this.currentGame.ffaRoundData || {};
        
        // Sort players by score for this round
        const playerResults = [];
        for (const [playerId, data] of Object.entries(roundData)) {
            const member = this.currentParty.members.find(m => m.id === playerId);
            playerResults.push({
                id: playerId,
                name: member ? member.name : 'Unknown',
                guess: data.guess,
                score: data.score,
                totalScore: this.currentGame.ffaScores[playerId] || data.totalScore || 0,
                isYou: playerId === currentUserId
            });
        }
        playerResults.sort((a, b) => b.score - a.score);
        
        // Check if game is over (>= because last round completion means game is over)
        const isGameOver = this.currentGame.currentRound >= this.currentGame.totalRounds;
        const isHost = this.isHost;
        
        console.log('🎮 [FFA REVEAL] Screen setup:', {
            isHost: isHost,
            thisIsHost: this.isHost,
            currentRound: this.currentGame.currentRound,
            totalRounds: this.currentGame.totalRounds,
            isGameOver: isGameOver,
            buttonType: isHost ? (isGameOver ? 'End Game' : 'Next Round') : 'Waiting message'
        });
        
        revealScreen.innerHTML = `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 30px; max-width: 1200px; width: 100%; align-items: start;">
                <!-- Video Section -->
                <div style="background: rgba(0,0,0,0.3); border-radius: 15px; padding: 25px;">
                    <h3 style="font-size: 24px; margin-bottom: 15px; text-align: center; color: #8b5cf6;">
                        ${demon.name}
                    </h3>
                    <div style="position: relative; width: 100%; height: 300px; background: #000; border-radius: 10px; overflow: hidden; margin-bottom: 15px;">
                        <iframe id="ffaRevealVideo" width="100%" height="100%" 
                                src="https://www.youtube.com/embed/${demon.video}?autoplay=0&mute=1&controls=1&start=0" 
                                frameborder="0" allowfullscreen>
                        </iframe>
                    </div>
                    <div style="text-align: center;">
                        <div style="font-size: 20px; color: #ffd93d; margin-bottom: 10px;">
                            Actual Position: #${actual}
                        </div>
                        <div style="font-size: 16px; color: #aaa;">
                            <strong>Creator:</strong> ${demon.publisher?.name || demon.publisher || 'Unknown'}<br>
                            <strong>Verifier:</strong> ${demon.verifier?.name || demon.verifier || 'Unknown'}
                        </div>
                    </div>
                </div>
                
                <!-- Results Section -->
                <div style="background: rgba(0,0,0,0.3); border-radius: 15px; padding: 25px;">
                    <h2 style="font-size: 32px; margin-bottom: 20px; color: #8b5cf6; text-align: center;">
                        Round ${this.currentGame.currentRound} Results
                    </h2>
                    
                    <div style="margin-bottom: 25px;">
                        <h3 style="font-size: 20px; margin-bottom: 15px; color: #8b5cf6;">Round Scores</h3>
                        ${playerResults.map((player, index) => `
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; margin: 8px 0; background: ${player.isYou ? 'rgba(139, 92, 246, 0.2)' : 'rgba(255,255,255,0.05)'}; border-radius: 8px; border: ${player.isYou ? '2px solid #8b5cf6' : 'none'};">
                                <div style="display: flex; align-items: center;">
                                    <span style="font-size: 20px; font-weight: bold; margin-right: 15px; color: ${index === 0 ? '#ffd93d' : '#888'}; min-width: 35px;">
                                        #${index + 1}
                                    </span>
                                    <span style="font-size: 18px;">
                                        ${player.isYou ? 'You' : player.name}
                                    </span>
                                </div>
                                <div style="text-align: right;">
                                    <div style="font-size: 14px; color: #aaa;">
                                        Guess: ${this.formatGuessDisplay(player.guess)}
                                    </div>
                                    <div style="font-size: 18px; font-weight: bold; color: ${player.score >= 80 ? '#4CAF50' : player.score >= 50 ? '#FFC107' : '#F44336'};">
                                        +${player.score} pts
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    
                    <div style="margin-bottom: 25px;">
                        <h3 style="font-size: 20px; margin-bottom: 15px; color: #8b5cf6;">Total Scores</h3>
                        ${playerResults
                            .sort((a, b) => b.totalScore - a.totalScore)
                            .map((player, index) => `
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; margin: 5px 0; background: rgba(255,255,255,0.05); border-radius: 6px;">
                                <span style="font-size: 16px;">
                                    ${player.isYou ? 'You' : player.name}
                                </span>
                                <span style="font-size: 18px; font-weight: bold; color: ${index === 0 ? '#ffd93d' : 'white'};">
                                    ${player.totalScore} pts
                                </span>
                            </div>
                        `).join('')}
                    </div>
                    
                    <!-- Control Buttons -->
                    <div style="text-align: center;">
                        ${isGameOver ? 
                            `<button id="${isHost ? 'ffaViewResultsBtn' : 'ffaViewResultsBtnNonHost'}" style="padding: 15px 40px; font-size: 18px; background: #ffd93d; color: #1a1a2e; border: none; border-radius: 8px; cursor: pointer; font-weight: bold;">
                                View Final Results
                            </button>` : 
                            (isHost ? 
                                `<button onclick="game.nextFFARound()" style="padding: 15px 40px; font-size: 18px; background: #8b5cf6; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold;">
                                    Next Round
                                </button>` :
                                `<div style="padding: 15px; color: #888; font-style: italic; font-size: 16px;">
                                    Waiting for host to start next round...
                                </div>`
                            )
                        }
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(revealScreen);
        
        // Add event listeners to View Final Results buttons for BOTH host and non-host
        const hostBtn = document.getElementById('ffaViewResultsBtn');
        const nonHostBtn = document.getElementById('ffaViewResultsBtnNonHost');
        
        console.log('🎯 [FFA] Looking for buttons...');
        console.log('🎯 [FFA] Host button found:', !!hostBtn);
        console.log('🎯 [FFA] Non-host button found:', !!nonHostBtn);
        
        // Function to handle "View Results" click for ANY player
        const handleViewResults = (playerType) => {
            console.log(`🔥🔥🔥 [FFA] View Final Results clicked by ${playerType}!`);
            
            // Remove the reveal screen
            const revealScreen = document.getElementById('ffaRevealScreen');
            if (revealScreen) revealScreen.remove();
            
            // Show results screen locally for this player
            console.log(`🎯 [FFA] ${playerType} going to results screen locally`);
            this.endGame();
        };
        
        // Add listeners for host button
        if (hostBtn) {
            console.log('🎯 [FFA] Adding click listener to HOST View Final Results button');
            hostBtn.onclick = () => handleViewResults('HOST');
            hostBtn.addEventListener('click', () => handleViewResults('HOST'));
        }
        
        // Add listeners for non-host button  
        if (nonHostBtn) {
            console.log('🎯 [FFA] Adding click listener to NON-HOST View Final Results button');
            nonHostBtn.onclick = () => handleViewResults('NON-HOST');
            nonHostBtn.addEventListener('click', () => handleViewResults('NON-HOST'));
        }
        
        // Legacy support - keep existing logic for any remaining cases
        const viewResultsBtn = hostBtn || nonHostBtn;
        if (viewResultsBtn) {
            viewResultsBtn.addEventListener('click', () => {
                console.log('🔥🔥🔥 [FFA] View Final Results button clicked!');
                
                // Remove the reveal screen
                const revealScreen = document.getElementById('ffaRevealScreen');
                if (revealScreen) {
                    revealScreen.remove();
                }
                
                // Call endGame() - just for this player (no broadcast)
                console.log('🎯 [FFA] Calling endGame() to show multiplayer results locally');
                this.endGame();
            });
        }
    }
    
    nextFFARound() {
        console.log('🏆 [FFA] nextFFARound called!');
        console.log('🏆 [FFA] Current state:', {
            isHost: this.isHost,
            currentRound: this.currentGame?.currentRound,
            totalRounds: this.currentGame?.totalRounds,
            gameType: this.currentGame?.gameType
        });
        
        if (!this.isHost) {
            console.log('🚫 [FFA] Only host can advance rounds - blocking non-host');
            return;
        }
        
        console.log('🏆 [FFA] Host confirmed - removing reveal screen and advancing');
        
        // Remove reveal screen
        const revealScreen = document.getElementById('ffaRevealScreen');
        if (revealScreen) {
            revealScreen.remove();
        }
        
        // Clear round data for next round
        this.currentGame.ffaRoundData = {};
        
        // Advance to next round via multiplayer manager
        if (window.multiplayerManager) {
            console.log('🎮 [FFA] Host advancing to next round');
            window.multiplayerManager.nextRound(this.currentGame.currentRound);
        }
    }
    
    endFFAGame() {
        console.log('🔥🔥🔥 [FFA] endFFAGame() CALLED - View Final Results button clicked!');
        console.log('🎯 [FFA] isHost:', this.isHost);
        console.log('🎯 [FFA] gameType:', this.currentGame?.gameType);
        console.log('🎯 [FFA] currentRound:', this.currentGame?.currentRound);
        console.log('🎯 [FFA] Stack trace:', new Error().stack);
        
        if (!this.isHost) {
            console.log('🚫 [FFA] Only host can end game');
            return;
        }
        
        console.log('🎯 [FFA] 🚀 IMPLEMENTING VIEW RESULTS FORCING SOLUTION');
        
        // NEW: Use our forcing solution instead of traditional endFFAGame
        if (this.currentGame.isParty && window.multiplayerManager) {
            console.log('🎯 [FFA] Host broadcasting showFinalResults to all players');
            window.multiplayerManager.socket.emit('showFinalResults', {
                partyCode: this.currentParty?.code
            });
            console.log('🎯 [FFA] showFinalResults broadcast sent - forcing both players to results');
        }
        
        // Also do local transition for host (in case server broadcast fails)
        console.log('🎯 [FFA] Local transition to results screen for host');
        this.endGame();
    }
    
    continueFromFFAReveal() {
        // This function is now obsolete - replaced by nextFFARound/endFFAGame
        this.nextFFARound();
    }

    showFFAWaitingState() {
        // Hide guess section but keep video playing
        document.getElementById('guessSection').style.display = 'none';
        
        // Don't show result section yet - show custom waiting screen
        document.getElementById('resultSection').style.display = 'none';
        
        // Create and show waiting overlay
        const waitingOverlay = document.createElement('div');
        waitingOverlay.id = 'ffaWaitingOverlay';
        waitingOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            color: white;
            text-align: center;
            pointer-events: none;
        `;
        
        const submittedCount = Object.keys(this.currentGame.ffaRoundData || {}).length;
        const totalPlayers = this.currentParty.members.length;
        
        waitingOverlay.innerHTML = `
            <div style="font-size: 32px; font-weight: bold; margin-bottom: 20px;">
                🎯 GUESS SUBMITTED
            </div>
            <div style="font-size: 24px; margin-bottom: 30px;">
                Waiting for other players...
            </div>
            <div style="font-size: 20px; color: #8b5cf6;">
                ${submittedCount}/${totalPlayers} players submitted
            </div>
        `;
        
        document.body.appendChild(waitingOverlay);
    }

    showDuelWaitingState() {
        // Hide guess section but keep video playing
        document.getElementById('guessSection').style.display = 'none';
        
        // Don't show result section yet - show custom waiting screen
        document.getElementById('resultSection').style.display = 'none';
        
        // Create and show waiting overlay
        const waitingOverlay = document.createElement('div');
        waitingOverlay.id = 'duelWaitingOverlay';
        waitingOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            color: white;
            text-align: center;
            pointer-events: none;
        `;
        
        waitingOverlay.innerHTML = `
            <div style="font-size: 32px; font-weight: bold; margin-bottom: 20px;">
                ⚔️ GUESS SUBMITTED
            </div>
            <div style="font-size: 24px; margin-bottom: 30px;">
                Waiting for opponent to submit their guess...
            </div>
            <div id="duelCountdownDisplay" style="font-size: 48px; font-weight: bold; color: #ffd93d;">
                --
            </div>
        `;
        
        document.body.appendChild(waitingOverlay);
    }

    submitDuelScore(playerData) {
        if (!this.currentGame.duelState) return;
        
        const currentUserId = this.getCurrentUserId();
        
        // Always extract both score and guess from the object format
        let playerScore = playerData.score;
        let playerGuess = playerData.guess;
        
        // Validate score
        if (typeof playerScore !== 'number' || isNaN(playerScore)) {
            console.error('❌ INVALID SCORE DETECTED:', playerScore);
            playerScore = 0;
        }
        
        // Store this player's score and guess
        this.currentGame.duelState.roundScores[currentUserId] = playerScore;
        if (playerGuess !== undefined) {
            if (!this.currentGame.duelState.roundGuesses) {
                this.currentGame.duelState.roundGuesses = {};
            }
            this.currentGame.duelState.roundGuesses[currentUserId] = playerGuess;
        }
        
        // Get party member IDs
        const memberIds = this.currentParty.members.map(m => m.id);
        const otherPlayerId = memberIds.find(id => id !== currentUserId);
        
        // Check if opponent has already submitted
        const opponentScore = this.currentGame.duelState.roundScores[otherPlayerId];
        
        if (opponentScore !== undefined) {
            // Both players have submitted - trigger clash after brief delay to ensure data sync
            this.currentGame.duelState.clashReady = true;
            
            // Brief delay to ensure roundComplete event arrives with guess data
            setTimeout(() => {
                this.triggerDuelClash();
            }, 200); // 200ms delay for data sync
        } else {
            // Start 15-second countdown for opponent
            this.startDuelCountdown(otherPlayerId);
        }
        
        // Submit score and guess to server for synchronization
        if (window.multiplayerManager) {
            // Always send both score and guess in the object format
            const submissionData = { 
                score: playerScore, 
                guess: playerGuess 
            };
            window.multiplayerManager.submitScore(submissionData);
        }
    }
    
    startDuelCountdown(waitingForPlayerId) {
        // Clear any existing countdown timers
        if (this.currentGame.duelState.countdown) {
            clearTimeout(this.currentGame.duelState.countdown);
            this.currentGame.duelState.countdown = null;
        }
        if (this.currentGame.duelState.countdownInterval) {
            clearInterval(this.currentGame.duelState.countdownInterval);
            this.currentGame.duelState.countdownInterval = null;
        }
        
        // Initialize countdown display
        let remainingSeconds = 15;
        this.updateCountdownDisplay(remainingSeconds);
        
        // Set up interval timer for countdown display
        this.currentGame.duelState.countdownInterval = setInterval(() => {
            remainingSeconds--;
            this.updateCountdownDisplay(remainingSeconds);
            
            if (remainingSeconds <= 0) {
                clearInterval(this.currentGame.duelState.countdownInterval);
                this.currentGame.duelState.countdownInterval = null;
            }
        }, 1000);
        
        // Set timeout for when countdown expires
        this.currentGame.duelState.countdown = setTimeout(() => {
            // If opponent hasn't submitted, give them 0 score
            this.currentGame.duelState.roundScores[waitingForPlayerId] = 0;
            this.triggerDuelClash();
        }, 15000);
    }
    
    updateCountdownDisplay(seconds) {
        // Update the countdown display in the overlay (for person who submitted)
        const countdownDisplay = document.getElementById('duelCountdownDisplay');
        if (countdownDisplay) {
            countdownDisplay.textContent = `${Math.max(0, seconds)}`;
        }
        
        // Update the notification countdown (for person waiting to submit)
        const opponentCountdown = document.getElementById('opponentCountdown');
        if (opponentCountdown) {
            opponentCountdown.textContent = `${Math.max(0, seconds)}`;
        }
    }
    
    triggerDuelClash() {
        console.log('[DEBUG] triggerDuelClash called');
        console.log('[DEBUG] Current duel health at clash start:', this.currentGame.duelHealth);
        
        // DEFENSIVE: Check if clash already in progress to prevent double-execution
        if (this.currentGame.duelState?.clashInProgress) {
            console.log('[DEBUG] Clash already in progress, returning');
            return;
        }
        
        // Mark clash as in progress
        this.currentGame.duelState.clashInProgress = true;
        
        // AGGRESSIVE CLEANUP: Remove any stuck overlays before starting clash
        const stuckWaitingOverlay = document.getElementById('duelWaitingOverlay');
        if (stuckWaitingOverlay) {
            stuckWaitingOverlay.remove();
        }
        
        // Clear countdown timers
        if (this.currentGame.duelState.countdown) {
            clearTimeout(this.currentGame.duelState.countdown);
            this.currentGame.duelState.countdown = null;
        }
        if (this.currentGame.duelState.countdownInterval) {
            clearInterval(this.currentGame.duelState.countdownInterval);
            this.currentGame.duelState.countdownInterval = null;
        }
        
        // Get scores - CRITICAL: Store them before they get reset by server
        const memberIds = this.currentParty.members.map(m => m.id);
        const player1Id = memberIds[0];
        const player2Id = memberIds[1];
        const player1Score = this.currentGame.duelState.roundScores[player1Id] || 0;
        const player2Score = this.currentGame.duelState.roundScores[player2Id] || 0;
        
        // Store scores for clash display before they get reset
        this.currentGame.clashData = {
            player1Id,
            player2Id,
            player1Score,
            player2Score
        };
        
        console.log('⚔️ CLASH!', {player1Score, player2Score});
        
        // Calculate preliminary damage for display (server will override with authoritative values)
        const scoreDifference = Math.abs(player1Score - player2Score);
        const baseDamage = scoreDifference; // Full difference as damage
        const preliminaryDamage = Math.floor(baseDamage * this.currentGame.duelState.roundMultiplier);
        
        const currentUserId = this.getCurrentUserId();
        let combatResult = '';
        
        if (player1Score > player2Score) {
            console.log('💥 Player 1 wins round - damage to Player 2');
            combatResult = player1Id === currentUserId ? 
                `You dealt ${preliminaryDamage} damage! (${player1Score} vs ${player2Score})` :
                `Opponent dealt ${preliminaryDamage} damage! (${player2Score} vs ${player1Score})`;
        } else if (player2Score > player1Score) {
            console.log('💥 Player 2 wins round - damage to Player 1');
            combatResult = player2Id === currentUserId ?
                `You dealt ${preliminaryDamage} damage! (${player2Score} vs ${player1Score})` :
                `Opponent dealt ${preliminaryDamage} damage! (${player1Score} vs ${player2Score})`;
        } else {
            console.log('🤝 Draw round - no damage');
            combatResult = `Perfect tie! No damage dealt (${player1Score} vs ${player2Score})`;
        }
        
        // Store preliminary clash data (server will update with authoritative values)
        this.currentGame.clashData.damage = preliminaryDamage;
        this.currentGame.clashData.combatResult = combatResult;
        
        // NOTE: Do NOT modify actual health here - server handles that
        console.log('Preliminary damage calculated:', preliminaryDamage, '(Server will send authoritative values)');
        
        // Store guess data in clashData before it gets reset
        this.currentGame.clashData.roundGuesses = { ...this.currentGame.duelState.roundGuesses };
        
        // Update health display immediately
        this.updateDuelDisplay();
        
        // CRITICAL: Server is completely authoritative for damage calculation
        console.log('🟢 [CLASH] Server will calculate damage with multipliers - no client-side calculation needed');
        console.log('🟢 [CLASH] Waiting for server damage result with correct multiplier values...');
        
        // CRITICAL: Server handles multiplier management - no client-side multiplier changes
        console.log('🟢 [CLASH] Server will handle multiplier increments for next round');
        
        // Reset round scores and guesses for next round
        this.currentGame.duelState.roundScores = {};
        // Note: Don't reset roundGuesses here - they're needed for the detailed results screen
        // They will be reset when starting the next round
        
        // Hide countdown UI
        const statusElement = document.getElementById('gameStatus');
        if (statusElement) {
            statusElement.style.display = 'none';
        }
        
        // Remove waiting overlay and notifications
        const waitingOverlay = document.getElementById('duelWaitingOverlay');
        if (waitingOverlay) {
            waitingOverlay.remove();
        }
        
        const notification = document.getElementById('opponentSubmittedNotification');
        if (notification) {
            notification.remove();
        }
        
        // Show custom clash screen immediately (server will update damage later)
        console.log('🎭 [CLASH] Showing clash screen with preliminary damage calculation...');
        
        // Show clash screen immediately - damage will be corrected by server if needed
        this.showClashScreen(player1Score, player2Score, this.currentGame.clashData.damage, this.currentGame.clashData.combatResult);
        
        // CRITICAL: Continue with essential game flow logic (independent of damage calculation)
        
        // Server handles multiplier increments - no client-side multiplier changes needed
        console.log('🟢 [CLASH] Server manages multiplier progression');
        
        // Reset round scores and guesses for next round
        this.currentGame.duelState.roundScores = {};
        // Note: Don't reset roundGuesses here - they're needed for the detailed results screen
        // They will be reset when starting the next round
        
        // DEFENSIVE: Clear the clash in progress flag
        this.currentGame.duelState.clashInProgress = false;
    }

    showClashScreen(player1Score, player2Score, damage, result) {
        // Ensure scores and damage are numbers, not objects
        player1Score = typeof player1Score === 'number' ? player1Score : 0;
        player2Score = typeof player2Score === 'number' ? player2Score : 0;
        damage = typeof damage === 'number' ? damage : 0;
        
        // Use stored clash data if scores are 0 (means they got reset by server)
        if ((player1Score === 0 && player2Score === 0) && this.currentGame.clashData) {
            player1Score = this.currentGame.clashData.player1Score;
            player2Score = this.currentGame.clashData.player2Score;
            damage = this.currentGame.clashData.damage || damage;
        }
        
        
        // Get player names with safety checks
        if (!this.currentParty || !this.currentParty.members || this.currentParty.members.length < 2) {
            console.error('❌ Invalid party state in showClashScreen');
            return;
        }
        
        const memberIds = this.currentParty.members.map(m => m.id);
        const player1Name = this.currentParty.members.find(m => m.id === memberIds[0])?.name || 'Player 1';
        const player2Name = this.currentParty.members.find(m => m.id === memberIds[1])?.name || 'Player 2';
        
        const currentUserId = this.getCurrentUserId();
        const isPlayer1 = currentUserId === memberIds[0];
        
        // Hide any existing results screen before showing clash
        const resultsSection = document.getElementById('results');
        if (resultsSection) {
            resultsSection.style.display = 'none';
        }
        
        // Remove waiting overlay if it exists
        const waitingOverlay = document.getElementById('duelWaitingOverlay');
        if (waitingOverlay) {
            waitingOverlay.remove();
        }
        
        // Remove any existing clash screen
        const existingClash = document.getElementById('clashScreen');
        if (existingClash) {
            existingClash.remove();
        }
        
        // Create clash screen overlay
        const clashOverlay = document.createElement('div');
        clashOverlay.id = 'clashScreen';
        clashOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.9);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 1001;
            color: white;
            text-align: center;
            animation: clashEntry 0.5s ease-in-out;
        `;
        
        clashOverlay.innerHTML = `
            <style>
                @keyframes clashEntry {
                    0% { opacity: 0; transform: scale(0.8); }
                    100% { opacity: 1; transform: scale(1); }
                }
                @keyframes scoreReveal {
                    0% { opacity: 0; transform: translateY(20px); }
                    100% { opacity: 1; transform: translateY(0); }
                }
                .clash-container {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    height: 200px;
                    position: relative;
                }
                .clash-number {
                    font-size: 120px;
                    font-weight: 900;
                    color: #ffffff;
                    text-shadow: 0 0 20px rgba(255,255,255,0.5);
                    opacity: 0;
                    position: absolute;
                }
                .clash-number.left {
                    animation: clashLeft 1.5s cubic-bezier(0.25, 0, 0.25, 1) both;
                }
                .clash-number.right {
                    animation: clashRight 1.5s cubic-bezier(0.25, 0, 0.25, 1) both;
                }
                .clash-damage {
                    font-size: 80px;
                    font-weight: 900;
                    color: #ff4444;
                    text-shadow: 0 0 30px rgba(255,68,68,0.8);
                    opacity: 0;
                    animation: showDamage 2s ease-out both;
                    animation-delay: 1.6s;
                }
                @keyframes clashLeft {
                    0% { opacity: 0; transform: translateX(-50vw); }
                    2% { opacity: 1; transform: translateX(-50vw); }
                    50% { opacity: 1; transform: translateX(-35vw); }
                    99% { opacity: 1; transform: translateX(-50px); }
                    100% { opacity: 0; transform: translateX(-50px); }
                }
                @keyframes clashRight {
                    0% { opacity: 0; transform: translateX(50vw); }
                    2% { opacity: 1; transform: translateX(50vw); }
                    50% { opacity: 1; transform: translateX(35vw); }
                    99% { opacity: 1; transform: translateX(50px); }
                    100% { opacity: 0; transform: translateX(50px); }
                }
                @keyframes showDamage {
                    0% { opacity: 0; transform: scale(0); }
                    1% { opacity: 1; transform: scale(1.3); }
                    5% { opacity: 1; transform: scale(1); }
                    50% { opacity: 1; transform: scale(1); }
                    75% { opacity: 1; transform: scale(1); }
                    100% { opacity: 0; transform: scale(1); }
                }
            </style>
            
            <div class="clash-container">
                <div class="clash-number left">${player1Score}</div>
                <div class="clash-number right">${player2Score}</div>
                <div class="clash-damage">-${damage}</div>
            </div>
        `;
        
        document.body.appendChild(clashOverlay);
        
        // After 3.6s total animation (1.5s numbers + 1.6s delay + 0.5s fade), go to summary screen
        setTimeout(() => {
            clashOverlay.remove();
            // Show detailed duel results screen
            this.showDetailedDuelResults(player1Score, player2Score, damage);
        }, 3600);
        
        console.log('🎭 Showing clash screen');
    }
    
    showDetailedDuelResults(player1Score, player2Score, damage) {
        console.log('📊 SHOWING DUEL SUMMARY WITH VIDEO');
        
        // Get current demon and player info
        const currentDemon = this.currentGame.rounds[this.currentGame.currentRound - 1];
        const memberIds = this.currentParty.members.map(m => m.id);
        const currentUserId = this.getCurrentUserId();
        const player1Id = memberIds[0];
        const player2Id = memberIds[1];
        const isPlayer1 = currentUserId === player1Id;
        
        // Safety check for party members
        if (!this.currentParty || !this.currentParty.members || this.currentParty.members.length < 2) {
            console.error('❌ Invalid party state in showDetailedDuelResults');
            return;
        }
        
        const player1Name = this.currentParty.members.find(m => m.id === player1Id)?.name || 'Player 1';
        const player2Name = this.currentParty.members.find(m => m.id === player2Id)?.name || 'Player 2';
        
        // Get guesses from clash data (preserved before reset) or duel state - add debugging
        
        // Get guess data with priority: clashData -> duelState -> pendingResults
        const guessData = this.currentGame.clashData?.roundGuesses || this.currentGame.duelState?.roundGuesses || {};
        
        // Get guesses from the server data (this is the authoritative source)
        let myGuess = guessData[currentUserId] || 'Unknown';
        let opponentId = isPlayer1 ? player2Id : player1Id;
        let opponentGuess = guessData[opponentId] || 'Unknown';
        
        // Fallback to pending results for our own guess if missing
        if (myGuess === 'Unknown' && this.currentGame.pendingResults?.guess) {
            myGuess = this.currentGame.pendingResults.guess;
        }
        
        // Assign to display variables based on current user perspective
        const player1Guess = isPlayer1 ? myGuess : opponentGuess;
        const player2Guess = isPlayer1 ? opponentGuess : myGuess;
        
        
        // AGGRESSIVE DEBUG - Log everything
        console.log('Raw server guess data:', JSON.stringify(guessData));
        console.log('Current user ID:', currentUserId);
        console.log('Player 1 ID:', player1Id);
        console.log('Player 2 ID:', player2Id);
        console.log('Is current user player 1?', isPlayer1);
        console.log('My guess (from server):', guessData[currentUserId]);
        console.log('Opponent ID:', opponentId);
        console.log('Opponent guess (from server):', guessData[opponentId]);
        console.log('What will display as Player 1 guess:', player1Guess);
        console.log('What will display as Player 2 guess:', player2Guess);
        
        // Add big visible alert for debugging
        if (guessData[currentUserId] && guessData[opponentId]) {
            console.log('🚨 FINAL VERIFICATION:');
            console.log('I am Player ' + (isPlayer1 ? '1' : '2'));
            console.log('My actual guess from server:', guessData[currentUserId]);
            console.log('Opponent actual guess from server:', guessData[opponentId]);
            console.log('Player 1 section will show:', player1Guess);
            console.log('Player 2 section will show:', player2Guess);
        }
        
        
        // Create detailed results overlay
        const resultsOverlay = document.createElement('div');
        resultsOverlay.id = 'detailedDuelResults';
        resultsOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(135deg, #1a1a2e, #16213e);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 1002;
            color: white;
            padding: 40px;
            overflow-y: auto;
        `;
        
        // Extract video ID from current demon
        const videoId = (currentDemon?.demon?.video?.includes('youtube.com') || currentDemon?.demon?.video?.includes('youtu.be')) 
            ? this.extractVideoId(currentDemon.demon.video) 
            : currentDemon?.demon?.video;
        
        // Stop video playback
        this.stopCurrentVideo();
        
        resultsOverlay.innerHTML = `
            <!-- Health Bars at Top Corners (You vs Opponent perspective) -->
            <div style="position: absolute; top: 20px; left: 20px; display: flex; align-items: center; gap: 10px;">
                <div style="display: flex; flex-direction: column; align-items: flex-start;">
                    <span style="color: #fff; font-weight: bold; font-size: 14px; margin-bottom: 4px;">You</span>
                    <div style="width: 120px; height: 12px; background: rgba(255,255,255,0.2); border-radius: 6px; overflow: hidden;">
                        <div style="height: 100%; width: ${this.currentGame.duelHealth[currentUserId]}%; background: ${this.currentGame.duelHealth[currentUserId] > 50 ? '#4CAF50' : this.currentGame.duelHealth[currentUserId] > 10 ? '#FFC107' : '#F44336'}; transition: width 0.3s ease;"></div>
                    </div>
                    <span style="color: #fff; font-size: 12px; margin-top: 2px;">${this.currentGame.duelHealth[currentUserId] || 0}/100</span>
                </div>
            </div>
            <div style="position: absolute; top: 20px; right: 20px; display: flex; align-items: center; gap: 10px;">
                <div style="display: flex; flex-direction: column; align-items: flex-end;">
                    <span style="color: #fff; font-weight: bold; font-size: 14px; margin-bottom: 4px;">Opponent</span>
                    <div style="width: 120px; height: 12px; background: rgba(255,255,255,0.2); border-radius: 6px; overflow: hidden;">
                        <div style="height: 100%; width: ${this.currentGame.duelHealth[isPlayer1 ? player2Id : player1Id]}%; background: ${this.currentGame.duelHealth[isPlayer1 ? player2Id : player1Id] > 50 ? '#4CAF50' : this.currentGame.duelHealth[isPlayer1 ? player2Id : player1Id] > 10 ? '#FFC107' : '#F44336'}; transition: width 0.3s ease;"></div>
                    </div>
                    <span style="color: #fff; font-size: 12px; margin-top: 2px;">${this.currentGame.duelHealth[isPlayer1 ? player2Id : player1Id] || 0}/100</span>
                </div>
            </div>

            <!-- Main Content Container -->
            <div style="width: 100%; height: 100%; display: grid; grid-template-columns: 1fr 400px; gap: 40px; align-items: center; padding: 100px 40px 40px 40px;">
                
                <!-- Video Section -->
                <div style="display: flex; flex-direction: column; align-items: center;">
                    <div style="position: relative; width: 100%; max-width: 640px; padding-bottom: 36%; height: 0; margin-bottom: 30px;">
                        <iframe src="https://www.youtube.com/embed/${videoId}?autoplay=0&controls=1" 
                                style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: none; border-radius: 15px;"
                                allowfullscreen>
                        </iframe>
                    </div>
                    
                    <!-- Demon Info Center -->
                    <div style="background: rgba(30, 30, 50, 0.9); border-radius: 15px; padding: 25px; text-align: center; min-width: 300px;">
                        <h2 style="color: #ffd93d; font-size: 28px; margin: 0 0 10px 0;">${currentDemon?.demon?.name || 'Unknown'}</h2>
                        <p style="color: #fff; font-size: 20px; margin: 5px 0;">Actual Position: <span style="color: #4CAF50; font-weight: bold;">#${currentDemon?.actual || '?'}</span></p>
                        ${currentDemon?.demon?.creator ? `<p style="color: #aaa; font-size: 16px; margin: 5px 0;">by ${currentDemon.demon.creator}</p>` : ''}
                        
                    </div>
                </div>
                
                <!-- Stats Section -->
                <div style="display: flex; flex-direction: column; gap: 20px; height: 100%; justify-content: center;">
                    
                    <!-- Player 1 Stats -->
                    <div style="background: ${isPlayer1 ? 'rgba(76, 175, 80, 0.2)' : 'rgba(40, 40, 60, 0.8)'}; border: ${isPlayer1 ? '2px solid #4CAF50' : '2px solid #555'}; border-radius: 15px; padding: 25px; text-align: center;">
                        <h3 style="color: ${isPlayer1 ? '#4CAF50' : '#fff'}; margin: 0 0 15px 0; font-size: 20px;">
                            ${player1Name} ${isPlayer1 ? '(You)' : ''}
                        </h3>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <p style="color: #aaa; font-size: 14px; margin: 0;">${isPlayer1 ? 'Your Guess' : 'Their Guess'}</p>
                                <p style="color: #ffd93d; font-weight: bold; font-size: 24px; margin: 5px 0;">${this.formatGuessDisplay(player1Guess)}</p>
                            </div>
                            <div>
                                <p style="color: #aaa; font-size: 14px; margin: 0;">Points</p>
                                <p style="color: #4CAF50; font-weight: bold; font-size: 28px; margin: 5px 0;">${player1Score}</p>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Player 2 Stats -->
                    <div style="background: ${!isPlayer1 ? 'rgba(76, 175, 80, 0.2)' : 'rgba(40, 40, 60, 0.8)'}; border: ${!isPlayer1 ? '2px solid #4CAF50' : '2px solid #555'}; border-radius: 15px; padding: 25px; text-align: center;">
                        <h3 style="color: ${!isPlayer1 ? '#4CAF50' : '#fff'}; margin: 0 0 15px 0; font-size: 20px;">
                            ${player2Name} ${!isPlayer1 ? '(You)' : ''}
                        </h3>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <p style="color: #aaa; font-size: 14px; margin: 0;">${!isPlayer1 ? 'Your Guess' : 'Their Guess'}</p>
                                <p style="color: #ffd93d; font-weight: bold; font-size: 24px; margin: 5px 0;">${this.formatGuessDisplay(player2Guess)}</p>
                            </div>
                            <div>
                                <p style="color: #aaa; font-size: 14px; margin: 0;">Points</p>
                                <p style="color: #4CAF50; font-weight: bold; font-size: 28px; margin: 5px 0;">${player2Score}</p>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Next Round Button (Host Only) -->
                    ${this.isHost ? `
                        <div style="margin-top: 20px; text-align: center;">
                            <button id="duelNextRoundBtn" style="
                                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                                border: none;
                                padding: 12px 30px;
                                font-size: 18px;
                                font-weight: bold;
                                color: white;
                                border-radius: 25px;
                                cursor: pointer;
                                box-shadow: 0 4px 15px rgba(0,0,0,0.3);
                                transition: transform 0.2s;
                            " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                                ${this.currentGame.duelWinner ? 'View Summary' : 'Next Round'}
                            <!-- DEBUG: Winner=${this.currentGame.duelWinner}, Host=${this.isHost} -->
                            </button>
                        </div>
                    ` : `
                        <div style="margin-top: 20px; text-align: center; padding: 15px; background: rgba(255,193,7,0.2); border-radius: 15px;">
                            <p style="color: #ffc107; margin: 0;">Waiting for host to advance to next round...</p>
                        </div>
                    `}
                </div>
            </div>
        `;
        
        document.body.appendChild(resultsOverlay);
        
        // Add Next Round button functionality (host only)
        if (this.isHost) {
            setTimeout(() => {
                const nextRoundBtn = document.getElementById('duelNextRoundBtn');
                if (nextRoundBtn) {
                    nextRoundBtn.addEventListener('click', () => {
                        console.log('Button text:', nextRoundBtn.textContent);
                        console.log('Duel winner:', this.currentGame.duelWinner);
                        console.log('Current health state:', this.currentGame.duelHealth);
                        console.log('Game type:', this.currentGame.gameType);
                        console.log('Current round:', this.currentGame.currentRound);
                        console.log('Total rounds:', this.currentGame.totalRounds);
                        
                        // Check if anyone has 0 HP
                        const healthValues = Object.values(this.currentGame.duelHealth || {});
                        console.log('Health values:', healthValues);
                        console.log('Anyone at 0 HP?', healthValues.some(h => h <= 0));
                        
                        resultsOverlay.remove();
                        
                        // Check for duel end condition
                        if (this.currentGame.duelWinner) {
                            console.log('🏆 DUEL WINNER DETECTED - NOTIFYING ALL PLAYERS');
                            // Notify all players to show final results
                            if (window.multiplayerManager) {
                                console.log('🎮 Broadcasting final results to all players');
                                window.multiplayerManager.nextRound(); // This will trigger handleNextRoundStarted for all players
                            }
                            // Also show results locally for host
                            this.showDuelFinalResults();
                        } else {
                            console.log('⚠️ NO DUEL WINNER - ADVANCING TO NEXT ROUND');
                            // Advance to next round and notify other players
                            console.log('🎮 Host advancing to next round via button click');
                            console.log('🎮 Current round:', this.currentGame.currentRound);
                            console.log('🎮 Total rounds:', this.currentGame.totalRounds);
                            console.log('🎮 Party members:', this.currentParty.members.map(m => m.id));
                            
                            if (window.multiplayerManager) {
                                console.log('🎮 Using multiplayer manager to advance');
                                window.multiplayerManager.nextRound();
                            } else {
                                console.log('🎮 Using local nextRound function');
                                this.nextRound();
                            }
                        }
                    });
                }
            }, 100);
        }
    }

    showDuelResults() {
        // Now show the actual results
        if (this.currentGame.pendingResults) {
            const { guess, actual, points } = this.currentGame.pendingResults;
            this.showResult(guess, actual, points);
            this.updateStats(guess, actual);
            
            // Update display
            this.updateDuelDisplay();
            
            // Clear pending results
            this.currentGame.pendingResults = null;
        }
    }
    
    showDuelFinalResults() {
        
        // Preserve all duel data before showing results
        const duelResultsData = {
            winner: this.currentGame.duelWinner,
            health: { ...this.currentGame.duelHealth },
            finalScores: { ...this.currentGame.duelState.roundScores },
            finalGuesses: { ...this.currentGame.duelState.roundGuesses },
            rounds: [...this.currentGame.rounds],
            partyMembers: [...this.currentParty.members]
        };
        
        
        // Store in global for results screen
        this.currentGame.preservedDuelResults = duelResultsData;
        
        // Clean up any overlays
        const existingOverlays = document.querySelectorAll('#detailedDuelResults, #duelWaitingOverlay, #clashScreen');
        existingOverlays.forEach(overlay => overlay.remove());
        
        this.endGame();
    }

    handleOpponentScore(data) {
        console.log('🎯🎯🎯 [OPPONENT SCORE] handleOpponentScore called with data:', JSON.stringify(data, null, 2));
        
        // Prevent handling opponent score if user has quit
        if (this.userHasQuit) {
            console.log('🚪 [QUIT] Ignoring handleOpponentScore because user has quit');
            return;
        }
        
        // Handle FFA score updates
        if (this.currentGame.gameType === 'ffa') {
            const scores = data.scores || {};
            const guesses = data.guesses || {};
            const totalScores = data.totalScores || {};
            
            console.log('📊 [CLIENT] Received totalScores from server:', totalScores);
            console.log('📊 [CLIENT] Current local ffaScores before update:', this.currentGame.ffaScores);
            
            // Update all player scores from server (CRITICAL FIX for score desync)
            for (const [playerId, totalScore] of Object.entries(totalScores)) {
                if (totalScore !== undefined) {
                    // Update BOTH scoring systems to keep them in sync
                    if (this.currentGame.ffaScores) {
                        this.currentGame.ffaScores[playerId] = totalScore;
                    }
                    if (this.currentGame.playerScores) {
                        this.currentGame.playerScores[playerId] = totalScore;
                    }
                    console.log('🏆 [FFA SYNC FIX] Updated scores for', playerId, ':', totalScore);
                }
            }
            
            console.log('📊 [CLIENT] Updated local ffaScores after server sync:', this.currentGame.ffaScores);
            
            // Store all round data
            if (!this.currentGame.ffaRoundData) {
                this.currentGame.ffaRoundData = {};
            }
            
            for (const [playerId, score] of Object.entries(scores)) {
                if (!this.currentGame.ffaRoundData[playerId]) {
                    this.currentGame.ffaRoundData[playerId] = {
                        guess: guesses[playerId],
                        score: score,
                        totalScore: totalScores[playerId] || 0
                    };
                }
            }
            
            // Check if all players have submitted
            const submittedCount = Object.keys(this.currentGame.ffaRoundData).length;
            const expectedCount = this.currentParty.members.length;
            
            console.log('🏆 [FFA] Submissions:', submittedCount, '/', expectedCount);
            
            if (submittedCount >= expectedCount) {
                // All players submitted - show FFA reveal
                this.showFFAReveal();
            } else {
                // Update waiting screen count
                const waitingOverlay = document.getElementById('ffaWaitingOverlay');
                if (waitingOverlay) {
                    const countDisplay = waitingOverlay.querySelector('div:last-child');
                    if (countDisplay) {
                        countDisplay.innerHTML = `${submittedCount}/${expectedCount} players submitted`;
                    }
                }
            }
            
            return;
        }
        
        // Handle opponent score submission in duel mode
        if (!this.currentGame.duelState) {
            console.log('[DEBUG] No duel state, returning');
            return;
        }
        
        const scores = data.scores;
        const guesses = data.guesses || {};
        const totalScores = data.totalScores || {};
        const currentUserId = this.getCurrentUserId();
        
        console.log('[DEBUG] Server data breakdown:', {
            scores: scores,
            totalScores: totalScores,
            guesses: guesses
        });
        
        // Store all guesses from server
        if (Object.keys(guesses).length > 0) {
            if (!this.currentGame.duelState.roundGuesses) {
                this.currentGame.duelState.roundGuesses = {};
            }
            for (const [playerId, guess] of Object.entries(guesses)) {
                if (guess !== undefined) {
                    this.currentGame.duelState.roundGuesses[playerId] = guess;
                }
            }
        }
        
        // Update playerScores with server's accumulated totals (more reliable)
        for (const [playerId, totalScore] of Object.entries(totalScores)) {
            if (totalScore !== undefined) {
                // Use server's accumulated total for ALL players (including current player)
                this.currentGame.playerScores[playerId] = totalScore;
                const playerType = playerId === currentUserId ? 'SELF' : 'OPPONENT';
                console.log(`📊 [${playerType} TRACKING] Server total score:`, totalScore, 'for player:', playerId);
            }
        }
        
        // Still store round scores for clash logic
        for (const [playerId, score] of Object.entries(scores)) {
            if (playerId !== currentUserId && score !== undefined) {
                this.currentGame.duelState.roundScores[playerId] = score;
                console.log('📨 [ROUND TRACKING] Round score:', score, 'for player:', playerId);
                
                // If we already submitted our score, trigger clash
                if (this.currentGame.duelState.roundScores[currentUserId] !== undefined) {
                    
                    // Don't trigger clash if already triggered by submitDuelScore
                    if (!this.currentGame.duelState.clashReady) {
                        this.currentGame.duelState.clashReady = true;
                        this.triggerDuelClash();
                    }
                } else {
                }
                break;
            }
        }
        
        // Store server damage result AND UPDATE HEALTH
        if (data.damageResult) {
            console.log('[DEBUG] Received damage result from server:', data.damageResult);
            
            this.currentGame.lastServerDamageResult = data.damageResult;
            
            // CRITICAL: Update health from server - this is the authoritative health
            if (data.damageResult.health) {
                console.log('[HEALTH SYNC] Receiving server health update:', data.damageResult.health);
                console.log('[HEALTH SYNC] Previous client health:', this.currentGame.duelHealth);
                
                // Store the old health for comparison
                const oldHealth = { ...this.currentGame.duelHealth };
                
                // Apply server health (authoritative)
                this.currentGame.duelHealth = { ...data.damageResult.health };
                
                // Mark that we have server health so we don't overwrite it
                this.currentGame.hasServerHealth = true;
                
                console.log('[HEALTH SYNC] Updated to server health:', this.currentGame.duelHealth);
                console.log('🟢🟢🟢 SERVER HEALTH APPLIED - hasServerHealth flag set to true');
                
                // Check for victory condition based on server health
                const player1Id = this.currentParty.members[0].id;
                const player2Id = this.currentParty.members[1].id;
                
                if (this.currentGame.duelHealth[player1Id] <= 0 || this.currentGame.duelHealth[player2Id] <= 0) {
                    console.log('[HEALTH SYNC] Victory condition detected - someone at 0 HP');
                    console.log('[HEALTH SYNC] Waiting for server duelVictory event...');
                    
                    // CRITICAL FIX: Immediately update button text to prevent "Next Round" clicks
                    const nextBtn = document.getElementById('nextRoundBtn');
                    const duelNextBtn = document.getElementById('duelNextRoundBtn');
                    
                    if (nextBtn) {
                        nextBtn.textContent = 'View Results';
                        console.log('[HEALTH SYNC] Updated nextRoundBtn to "View Results"');
                    }
                    
                    if (duelNextBtn) {
                        duelNextBtn.textContent = 'View Results';
                        console.log('[HEALTH SYNC] Updated duelNextRoundBtn to "View Results"');
                    }
                }
                
                // CRITICAL: Update the display immediately after receiving server health
                this.updateDuelDisplay();
                console.log('[HEALTH SYNC] Display updated with server health');
                
                // CRITICAL: Update clash screen damage if it's currently showing
                if (data.damageResult.damage !== undefined) {
                    console.log('🎭 [CLASH UPDATE] Updating clash screen with server damage:', data.damageResult.damage);
                    
                    // Update clash screen DOM if it exists
                    const clashScreen = document.getElementById('clashScreen');
                    const damageElement = clashScreen?.querySelector('.clash-damage');
                    if (clashScreen && damageElement) {
                        damageElement.textContent = `-${data.damageResult.damage}`;
                        console.log('🎭 [CLASH UPDATE] Updated clash screen damage display');
                    }
                }
            }
        }
        
        // CRITICAL: Store guesses in clashData immediately when received from server
        if (Object.keys(guesses).length > 0 && this.currentGame.gameType === 'duels') {
            if (!this.currentGame.clashData) {
                this.currentGame.clashData = {};
            }
            this.currentGame.clashData.roundGuesses = { ...guesses };
        }
    }
    
    // Function for receiving opponent's score in real multiplayer
    receiveOpponentScore(opponentScore) {
        if (this.currentGame.waitingForOpponent && this.currentGame.gameType === 'duels') {
            this.executeDuelCombat(this.currentGame.playerRoundScore, opponentScore);
            
            // Update the display after combat is processed
            this.updateDuelDisplay();
        }
    }
    
    // Simulate adding a real player (for testing purposes)
    addTestOpponent() {
        if (this.currentParty && this.currentParty.gameType === 'duels' && this.currentParty.members.length === 1) {
            const testOpponent = {
                id: 'player2',
                name: 'Test Opponent'
            };
            
            this.currentParty.members.push(testOpponent);
            this.saveParty(); // Save updated party
            this.updatePartyVisual();
            
            return true;
        }
        return false;
    }

    checkPartyLink() {
        const urlParams = new URLSearchParams(window.location.search);
        const partyCode = urlParams.get('party');
        
        
        if (partyCode) {
            
            // Auto-join immediately instead of showing the form
            setTimeout(() => {
                this.attemptJoinParty(partyCode);
                
                // Clear the URL parameter to avoid re-joining on refresh
                window.history.replaceState({}, document.title, window.location.pathname);
            }, 1000);
        } else {
        }
    }

    saveParty() {
        if (!this.currentParty) {
            console.warn('No party to save');
            return;
        }
        
        // Save party to localStorage (simulating a backend)
        const partyKey = `party_${this.currentParty.code}`;
        const partyData = {
            ...this.currentParty,
            lastUpdated: Date.now()
        };
        
        try {
            localStorage.setItem(partyKey, JSON.stringify(partyData));
            console.log('✅ Party saved successfully:', partyKey, partyData);
            
            // Verify it was saved
            const verification = localStorage.getItem(partyKey);
            if (verification) {
                console.log('✅ Party verified in localStorage:', JSON.parse(verification));
            } else {
                console.error('❌ Failed to verify party in localStorage');
            }
        } catch (error) {
            console.error('[ERROR] Failed to save party:', error);
            console.error('[ERROR] Party save context:', {
                partyCode: this.currentParty?.code,
                membersCount: this.currentParty?.members?.length,
                gameType: this.currentParty?.gameType
            });
        }
    }

    loadParty(partyCode) {
        const partyKey = `party_${partyCode}`;
        console.log('🔍 Loading party with key:', partyKey);
        
        const partyData = localStorage.getItem(partyKey);
        console.log('📦 Raw party data:', partyData);
        
        if (partyData) {
            try {
                const party = JSON.parse(partyData);
                console.log('📋 Parsed party:', party);
                
                // Check if party is not too old (24 hours)
                const ageInMs = Date.now() - party.lastUpdated;
                const ageInHours = ageInMs / (1000 * 60 * 60);
                console.log(`⏰ Party age: ${ageInHours.toFixed(2)} hours`);
                
                if (ageInMs < 24 * 60 * 60 * 1000) {
                    console.log('✅ Party is valid and not expired');
                    return party;
                } else {
                    console.log('⚠️ Party is expired');
                }
            } catch (error) {
                console.error('[ERROR] Failed to parse party data for key:', key);
                console.error('[ERROR] Parse error details:', error);
            }
        } else {
            console.log('❌ No party data found');
        }
        return null;
    }

    attemptJoinParty(partyCode) {
        console.log('Attempting to join party:', partyCode);
        
        // Debug: Check all parties in localStorage
        this.debugListAllParties();
        
        const existingParty = this.loadParty(partyCode);
        console.log('Loaded party:', existingParty);
        
        if (!existingParty) {
            alert(`Party "${partyCode}" not found!\n\n` +
                  `Possible reasons:\n` +
                  `• Party hasn't been created yet\n` +
                  `• You're using a different browser (localStorage is not shared between Chrome/Brave/Firefox)\n` + 
                  `• You're in incognito/private mode\n\n` +
                  `For testing: Use the same browser in regular mode for both host and joining player.`);
            
            // Offer to simulate joining for testing
            const simulate = confirm(`Would you like to simulate joining this party for testing?\n\n` +
                                    `This will create a mock party setup.`);
            if (simulate) {
                this.simulatePartyJoin(partyCode);
            }
            return;
        }
        
        console.log('✅ Found existing party, proceeding to join...');
        
        // Check if party is full (for duels, max 2 players)
        if (existingParty.gameType === 'duels' && existingParty.members.length >= 2) {
            alert('This duel party is already full (2/2 players)!');
            return;
        }
        
        // Add current player to party
        const username = localStorage.getItem('username') || 'Player';
        const playerId = `player_${Date.now()}`;
        
        console.log('👤 Adding new member:', { id: playerId, name: username });
        
        const newMember = {
            id: playerId,
            name: username,
            joinedAt: Date.now()
        };
        
        existingParty.members.push(newMember);
        console.log('👥 Updated members list:', existingParty.members);
        
        // Update party in storage
        this.currentParty = existingParty;
        this.saveParty();
        
        console.log('💾 Party saved, now showing lobby...');
        
        // Show party lobby as a member (not host)
        this.showPartyLobby();
        
        console.log('🎉 Successfully joined party:', existingParty);
    }

    showPartyLobby() {
        console.log('🏠 Showing party lobby for member...');
        console.log('📊 Current party:', this.currentParty);
        
        // Show a simplified party view for members
        this.showScreen('partySetupScreen');
        console.log('📺 Screen changed to partySetupScreen');
        
        // Disable host controls
        console.log('🔒 Disabling host controls...');
        document.getElementById('partyGameType').disabled = true;
        document.getElementById('partyMainList').disabled = true;
        document.getElementById('partyExtendedList').disabled = true;
        document.getElementById('partyLegacyList').disabled = true;
        document.querySelectorAll('input[name="partyDifficulty"]').forEach(input => {
            input.disabled = true;
        });
        
        // Update party code display
        console.log('🏷️ Setting party code display...');
        document.getElementById('partyCode').textContent = this.currentParty.code;
        
        // Set the game type and update visual
        console.log('🎮 Setting game type and updating visual...');
        document.getElementById('partyGameType').value = this.currentParty.gameType;
        this.updatePartyGameType();
        
        console.log('🎉 Party lobby setup complete!');
        
        // Show member status
        alert(`Successfully joined party: ${this.currentParty.code}\nGame Type: ${this.currentParty.gameType}\nPlayers: ${this.currentParty.members.length}`);
        
        // Start party refresh for member too
        this.startPartyRefresh();
    }

    getCurrentUserId() {
        try {
            // Try to find current user in party members
            if (this.currentParty && this.currentParty.members && Array.isArray(this.currentParty.members)) {
                const username = localStorage.getItem('username') || 'Host';
                console.log('🔍 Looking for user ID, username:', username, 'members:', this.currentParty.members.map(m => ({id: m.id, name: m.name})));
                
                // First check if we're the host
                const hostMember = this.currentParty.members.find(m => m && (m.id === 'host' || m.id === this.currentParty.host));
                if (hostMember && hostMember.name === username) {
                    console.log('✅ Found as host:', hostMember.id);
                    return hostMember.id;
                }
                
                // Then check if we're another member
                const userMember = this.currentParty.members.find(m => m && m.name === username);
                if (userMember) {
                    console.log('✅ Found as member:', userMember.id);
                    return userMember.id;
                }
                
                console.warn('⚠️ User not found in party members, falling back to host');
            } else {
                console.warn('⚠️ No valid party or members found');
            }
            
            // Default fallback
            return 'host';
        } catch (error) {
            console.error('❌ Error in getCurrentUserId:', error);
            return 'host';
        }
    }

    startPartyRefresh() {
        // Clear any existing interval
        if (this.partyRefreshInterval) {
            clearInterval(this.partyRefreshInterval);
        }
        
        // Refresh party data every 2 seconds to check for new members
        this.partyRefreshInterval = setInterval(() => {
            if (this.currentParty && !this.currentGame) {
                const updatedParty = this.loadParty(this.currentParty.code);
                if (updatedParty && updatedParty.members.length !== this.currentParty.members.length) {
                    console.log('Party updated, refreshing display');
                    this.currentParty = updatedParty;
                    this.updatePartyVisual();
                }
            }
        }, 2000);
    }

    stopPartyRefresh() {
        if (this.partyRefreshInterval) {
            clearInterval(this.partyRefreshInterval);
            this.partyRefreshInterval = null;
        }
    }

    updateDuelDisplay() {
        console.log('[DEBUG] updateDuelDisplay called');
        if (!this.currentGame.duelHealth) {
            console.log('[DEBUG] No duel health, returning');
            return;
        }
        
        // Check if we're in clash mode or detailed results screen - don't update in these states
        const clashScreen = document.getElementById('clashScreen');
        const detailedResults = document.getElementById('detailedDuelResults');
        if (clashScreen || detailedResults) {
            console.log('🚫 [HEALTH BAR] Skipping update - in clash screen or detailed results view');
            return;
        }
        
        console.log('  Current User ID:', this.getCurrentUserId());
        console.log('  Is Host:', this.isHost);
        console.log('  Duel Health Object:', JSON.stringify(this.currentGame.duelHealth));
        console.log('  Party Members:', this.currentParty?.members?.map(m => ({id: m.id, name: m.name})));
        
        // Get player IDs
        const memberIds = this.currentParty.members.map(m => m.id);
        const player1Id = memberIds[0];
        const player2Id = memberIds[1];
        
        console.log('  Player 1 ID:', player1Id);
        console.log('  Player 2 ID:', player2Id);
        
        // Show health bars
        const healthDisplay = document.getElementById('duelHealthDisplay');
        if (healthDisplay) {
            healthDisplay.style.display = 'block';
        }
        
        // Map health display based on current user (not array order)
        const currentUserId = this.getCurrentUserId();
        const opponentId = memberIds.find(id => id !== currentUserId);
        
        const myHealth = this.currentGame.duelHealth[currentUserId] || 0;
        const opponentHealth = this.currentGame.duelHealth[opponentId] || 0;
        
        console.log('🩺 HEALTH MAPPING DEBUG (ENHANCED):');
        console.log('  Current User ID:', currentUserId, '→ My Health:', myHealth);
        console.log('  Opponent ID:', opponentId, '→ Opponent Health:', opponentHealth);
        console.log('  Full duelHealth object:', this.currentGame.duelHealth);
        console.log('  Health bars will show: You=' + myHealth + '/100, Opponent=' + opponentHealth + '/100');
        
        // Map to UI elements: player1 = "You", player2 = "Opponent"
        const player1Health = myHealth;        // "You" health bar
        const player2Health = opponentHealth;  // "Opponent" health bar
        
        const player1HealthPercent = (player1Health / 100) * 100;
        const player2HealthPercent = (player2Health / 100) * 100;
        
        const player1Bar = document.getElementById('player1Health');
        const player2Bar = document.getElementById('player2Health');
        const player1Value = document.getElementById('player1HealthValue');
        const player2Value = document.getElementById('player2HealthValue');
        
        if (player1Bar) {
            console.log('🔧 [HEALTH BAR] Updating player1Bar (You) to:', player1HealthPercent + '%', 'Health:', player1Health);
            player1Bar.style.width = `${player1HealthPercent}%`;
            // Color coding: green > 50%, yellow 10-50%, red <= 10%
            if (player1Health > 50) {
                player1Bar.style.background = '#4CAF50'; // Green - override gradient
                player1Bar.style.backgroundColor = '#4CAF50';
                console.log('🔧 [HEALTH BAR] Player1Bar set to GREEN');
            } else if (player1Health > 10) {
                player1Bar.style.background = '#FFC107'; // Yellow - override gradient
                player1Bar.style.backgroundColor = '#FFC107';  
                console.log('🔧 [HEALTH BAR] Player1Bar set to YELLOW');
            } else {
                player1Bar.style.background = '#F44336'; // Red - override gradient
                player1Bar.style.backgroundColor = '#F44336';
                console.log('🔧 [HEALTH BAR] Player1Bar set to RED');
            }
        } else {
            console.error('❌ [HEALTH BAR] player1Bar element not found!');
        }
        if (player2Bar) {
            console.log('🔧 [HEALTH BAR] Updating player2Bar (Opponent) to:', player2HealthPercent + '%', 'Health:', player2Health);
            player2Bar.style.width = `${player2HealthPercent}%`;
            // Color coding: green > 50%, yellow 10-50%, red <= 10%
            if (player2Health > 50) {
                player2Bar.style.background = '#4CAF50'; // Green - override gradient
                player2Bar.style.backgroundColor = '#4CAF50';
                console.log('🔧 [HEALTH BAR] Player2Bar set to GREEN');
            } else if (player2Health > 10) {
                player2Bar.style.background = '#FFC107'; // Yellow - override gradient
                player2Bar.style.backgroundColor = '#FFC107';
                console.log('🔧 [HEALTH BAR] Player2Bar set to YELLOW');
            } else {
                player2Bar.style.background = '#F44336'; // Red - override gradient
                player2Bar.style.backgroundColor = '#F44336';
                console.log('🔧 [HEALTH BAR] Player2Bar set to RED');
            }
        } else {
            console.error('❌ [HEALTH BAR] player2Bar element not found!');
        }
        if (player1Value) {
            console.log('💉 [HEALTH TEXT UPDATE] Setting player1Value (You) to:', `${player1Health}/100`);
            player1Value.textContent = `${player1Health}/100`;
        }
        if (player2Value) {
            console.log('💉 [HEALTH TEXT UPDATE] Setting player2Value (Opponent) to:', `${player2Health}/100`);
            player2Value.textContent = `${player2Health}/100`;
        }
        
        // CRITICAL: Health bars are properly handled by the clash screen's inline templates
        // and detailed results screen's embedded health values - no additional updates needed
        
        // Show combat result and multiplier info for duels only
        if (this.currentGame.lastCombatResult && this.currentGame.gameType === 'duels') {
            const combatResult = document.getElementById('duelCombatResult');
            const combatDetails = document.getElementById('combatDetails');
            const multiplier = document.getElementById('currentMultiplier');
            
            if (combatResult) {
                combatResult.style.display = 'block';
            }
            if (combatDetails) {
                combatDetails.textContent = this.currentGame.lastCombatResult.result;
            }
            if (multiplier && this.currentGame.duelState) {
                multiplier.textContent = `${this.currentGame.duelState.roundMultiplier.toFixed(1)}x`;
            }
        } else {
            // Hide multiplier display for non-duel games
            const multiplier = document.getElementById('currentMultiplier');
            if (multiplier) {
                multiplier.style.display = 'none';
            }
        }
    }

    showResult(guess, actual, points) {
        console.log('🔍 [SHOW RESULT] Function called - host debugging');
        console.log('🔍 [SHOW RESULT] Current user:', {
            isHost: this.isHost,
            isParty: this.currentGame?.isParty,
            gameType: this.currentGame?.gameType
        });
        
        // Add global error handlers to catch crashes
        if (!window.errorHandlerAdded) {
            window.errorHandlerAdded = true;
            window.addEventListener('error', (e) => {
                console.error('🚨 [FATAL ERROR] JavaScript error:', e.error);
                console.error('🚨 [FATAL ERROR] File:', e.filename);
                console.error('🚨 [FATAL ERROR] Line:', e.lineno);
                console.error('🚨 [FATAL ERROR] Stack:', e.error?.stack);
            });
            
            window.addEventListener('unhandledrejection', (e) => {
                console.error('🚨 [FATAL ERROR] Unhandled promise rejection:', e.reason);
            });
        }
        
        const demon = this.currentGame.currentDemon;
        
        let resultTitle = '';
        if (points === 100) {
            resultTitle = 'PERFECT!';
        } else if (points >= 75) {
            resultTitle = 'Excellent!';
        } else if (points >= 50) {
            resultTitle = 'Good!';
        } else if (points >= 20) {
            resultTitle = 'Not bad';
        } else {
            resultTitle = '';
        }
        
        document.getElementById('resultTitle').textContent = resultTitle;
        document.getElementById('actualPlacement').textContent = `#${actual}`;
        document.getElementById('yourGuess').textContent = this.formatGuessDisplay(guess);
        document.getElementById('pointsEarned').textContent = `${points} points`;
        document.getElementById('levelName').textContent = demon.name;
        document.getElementById('levelId').textContent = demon.level_id || 'N/A';
        document.getElementById('creator').textContent = demon.publisher?.name || demon.publisher || 'Unknown';
        document.getElementById('verifier').textContent = demon.verifier?.name || demon.verifier || 'Unknown';
        
        // Update score immediately
        document.getElementById('currentScore').textContent = this.currentGame.score;
        
        // Handle duel-specific display
        if (this.currentGame.gameType === 'duels') {
            this.updateDuelDisplay();
        }
        
        // Update button text for final round or duel end
        const nextBtn = document.getElementById('nextRoundBtn');
        console.log('🔍 [DEBUG] Button text decision:', {
            duelWinner: this.currentGame.duelWinner,
            currentRound: this.currentGame.currentRound,
            totalRounds: this.currentGame.totalRounds,
            gameType: this.currentGame.gameType,
            duelHealth: this.currentGame.duelHealth
        });
        
        if (this.currentGame.duelWinner) {
            console.log('🔍 [DEBUG] Setting button to "View Results" because duelWinner is:', this.currentGame.duelWinner);
            nextBtn.textContent = 'View Results';
        } else if (this.currentGame.currentRound >= this.currentGame.totalRounds && this.currentGame.gameType !== 'duels') {
            // 🎯 FIX: Use "View Results" for FFA games to trigger showFinalResults broadcast
            if (this.currentGame.gameType === 'ffa' && this.currentGame.isParty) {
                console.log('🔍 [DEBUG] Setting button to "View Results" for FFA final round');
                nextBtn.textContent = 'View Results';
            } else {
                nextBtn.textContent = 'End Game';
            }
        } else {
            nextBtn.textContent = 'Next Round';
        }
        
        // Hide next round button for non-hosts in multiplayer
        console.log('🔍 [BUTTON DEBUG] Button visibility check:', {
            isParty: this.currentGame.isParty,
            isHost: this.isHost,
            shouldHideButton: this.currentGame.isParty && !this.isHost
        });
        
        if (this.currentGame.isParty && !this.isHost) {
            console.log('🔍 [BUTTON DEBUG] Hiding button for non-host');
            nextBtn.style.display = 'none';
            
            // Show waiting message for non-hosts
            const waitingMsg = document.createElement('div');
            waitingMsg.id = 'waitingForHost';
            waitingMsg.style.cssText = 'text-align: center; padding: 10px; color: #888; font-style: italic;';
            waitingMsg.textContent = 'Waiting for host to advance to next round...';
            nextBtn.parentNode.insertBefore(waitingMsg, nextBtn.nextSibling);
        } else if (this.currentGame.isParty && this.isHost) {
            console.log('🔍 [BUTTON DEBUG] Showing button for HOST - should be clickable');
            nextBtn.style.display = 'block';
        } else {
            console.log('🔍 [BUTTON DEBUG] Solo game - showing button');
            nextBtn.style.display = 'block';
            
            // Remove any existing waiting message for host
            const waitingMsg = document.getElementById('waitingForHost');
            if (waitingMsg) {
                waitingMsg.remove();
            }
        }
        
        document.getElementById('guessSection').style.display = 'none';
        document.getElementById('resultSection').style.display = 'block';
    }

    nextRound() {
        console.log('🎮 [CLIENT] nextRound() called');
        console.log('🎮 [CLIENT] Game state:', {
            isParty: this.currentGame?.isParty,
            isHost: this.isHost,
            currentRound: this.currentGame?.currentRound,
            totalRounds: this.currentGame?.totalRounds,
            gameType: this.currentGame?.gameType,
            duelWinner: this.currentGame?.duelWinner
        });
        this.logGameState('Next round');
        
        // 🎯 Check if this is the "View Results" button being clicked
        const nextBtn = document.getElementById('nextRoundBtn');
        const buttonText = nextBtn?.textContent || '';
        console.log('🎯 [BUTTON] Button clicked - nextRound() called');
        console.log('🎯 [BUTTON] Button element found:', !!nextBtn);
        console.log('🎯 [BUTTON] Button text when clicked:', JSON.stringify(buttonText));
        console.log('🎯 [BUTTON] Button text trimmed:', JSON.stringify(buttonText.trim()));
        console.log('🎯 [BUTTON] Button text === "View Results":', buttonText === 'View Results');
        console.log('🎯 [BUTTON] Button text.trim() === "View Results":', buttonText.trim() === 'View Results');
        
        if (buttonText === 'View Results') {
            console.log('🎯 [BUTTON] "View Results" clicked - forcing all players to results screen');
            
            if (this.currentGame.isParty && this.isHost) {
                console.log('🎯 [BUTTON] Host broadcasting showFinalResults to all players');
                // Broadcast to all players to show results
                if (window.multiplayerManager) {
                    window.multiplayerManager.socket.emit('showFinalResults', {
                        partyCode: this.currentParty?.code
                    });
                    console.log('🎯 [BUTTON] showFinalResults broadcast sent');
                }
            }
            
            // Local transition to results
            console.log('🎯 [BUTTON] Local transition to results screen');
            this.endGame();
            return;
        }
        
        // Check if duel is over (someone won)
        if (this.currentGame.duelWinner) {
            console.log('🎮 [CLIENT] Duel is over - showing final results');
            this.endGame();
            return;
        }
        
        // For multiplayer games, only host can advance rounds
        if (this.currentGame.isParty) {
            if (this.isHost && window.multiplayerManager) {
                console.log('🎮 [CLIENT] Host advancing to next round via multiplayer manager');
                console.log('🎮 [CLIENT] Calling multiplayerManager.nextRound with current round:', this.currentGame.currentRound);
                const result = window.multiplayerManager.nextRound(this.currentGame.currentRound);
                console.log('🎮 [CLIENT] multiplayerManager.nextRound returned:', result);
            } else if (!this.isHost) {
                console.log('🎮 [CLIENT] Non-host player - cannot advance rounds');
                return; // Non-hosts can't advance rounds
            } else {
                console.log('🎮 [CLIENT] No multiplayer manager available!');
            }
        } else {
            console.log('🎮 [CLIENT] Solo game - advancing normally');
            // Solo game - advance normally
            this.stopCurrentVideo();
            
            if (this.currentGame.currentRound >= this.currentGame.totalRounds) {
                this.endGame();
            } else {
                this.startNewRound();
            }
        }
    }

    stopCurrentVideo() {
        if (this.ytPlayer && this.ytPlayer.pauseVideo) {
            this.ytPlayer.pauseVideo();
        }
        
        // Hide both containers
        document.querySelector('.video-container').style.display = 'none';
        document.getElementById('thumbnailContainer').style.display = 'none';
    }

    viewOnPointercrate() {
        const demon = this.currentGame.currentDemon;
        window.open(`https://pointercrate.com/demonlist/${demon.position}`, '_blank');
    }

    endGame() {
        console.log('🔴 [DEBUG] ========== endGame() CALLED ==========');
        
        // Prevent showing results if user has quit
        if (this.userHasQuit) {
            console.log('🚪 [QUIT] Ignoring endGame because user has quit - staying on home screen');
            return;
        }
        
        console.log('🔴 [DEBUG] Game state:', {
            gameType: this.currentGame?.gameType,
            currentRound: this.currentGame?.currentRound,
            isHost: this.isHost,
            totalScores: this.currentGame?.totalScores,
            currentScreen: document.querySelector('.screen.active')?.id
        });
        console.log('🔴 [DEBUG] Stack trace:', new Error().stack);
        
        // Clean up any remaining duel overlays
        const waitingOverlay = document.getElementById('duelWaitingOverlay');
        if (waitingOverlay) {
            waitingOverlay.remove();
        }
        
        const clashScreen = document.getElementById('clashScreen');
        if (clashScreen) {
            clashScreen.remove();
        }
        
        const detailedResults = document.getElementById('detailedDuelResults');
        if (detailedResults) {
            detailedResults.remove();
        }
        
        const finalScore = this.currentGame.score;
        const finalScoreElement = document.getElementById('finalScore');
        finalScoreElement.textContent = finalScore;
        
        // For duels, make the total score completely white instead of gradient
        if (this.currentGame.gameType === 'duels') {
            finalScoreElement.style.background = 'none';
            finalScoreElement.style.webkitBackgroundClip = 'unset';
            finalScoreElement.style.webkitTextFillColor = 'unset';
            finalScoreElement.style.color = 'white';
        }
        
        const roundSummary = document.getElementById('roundSummary');
        
        if (this.currentGame.isParty) {
            this.showPartyResults(roundSummary);
        } else {
            roundSummary.innerHTML = this.currentGame.rounds.map((round, index) => `
                <div class="round-item">
                    <div>
                        <strong>Round ${index + 1}:</strong> ${round.demon.name}
                    </div>
                    <div>
                        Guess: ${this.formatGuessDisplay(round.guess)} | Actual: #${round.actual} | Points: ${round.points}
                    </div>
                </div>
            `).join('');
        }
        
        this.saveGameToStats();
        
        // Remove any existing daily leaderboard button from previous games
        const existingBtn = document.getElementById('viewDailyLeaderboard');
        if (existingBtn) {
            existingBtn.remove();
        }
        
        if (this.currentGame.mode === 'daily') {
            this.saveDailyScore(finalScore);
            this.updateDailyChallengeBanner(true); // Mark as completed
            
            // Add button to view daily leaderboard only for daily games
            const resultsButtons = document.querySelector('#resultsScreen .results-buttons');
            if (resultsButtons) {
                const leaderboardBtn = document.createElement('button');
                leaderboardBtn.id = 'viewDailyLeaderboard';
                leaderboardBtn.className = 'play-again-btn';
                leaderboardBtn.textContent = 'Daily Leaderboard';
                leaderboardBtn.onclick = () => this.showDailyLeaderboard();
                resultsButtons.insertBefore(leaderboardBtn, resultsButtons.firstChild);
            }
        }
        
        console.log('🔴 [DEBUG] About to call showScreen("resultsScreen")');
        console.log('🔴 [DEBUG] Current screen before transition:', document.querySelector('.screen.active')?.id);
        this.showScreen('resultsScreen');
        console.log('🔴 [DEBUG] ✅ showScreen("resultsScreen") completed');
        console.log('🔴 [DEBUG] Current screen after transition:', document.querySelector('.screen.active')?.id);
        
        // Change button text for duels
        if (this.currentGame?.isParty && this.currentGame?.gameType === 'duels') {
            const playAgainBtn = document.querySelector('.play-again-btn');
            if (playAgainBtn) {
                playAgainBtn.textContent = 'Back to Lobby';
            }
        }
    }

    showPartyResults(roundSummary) {
        const gameType = this.currentGame.gameType;
        
        if (gameType === 'ffa') {
            // FFA: Show individual leaderboard with actual scores
            const currentUserId = this.getCurrentUserId();
            const ffaScores = this.currentGame.ffaScores || {};
            
            const playerScores = this.currentParty.members.map(member => {
                const isCurrentUser = member.id === currentUserId;
                const score = ffaScores[member.id] || 0;
                return {
                    name: member.name,
                    score: score,
                    isYou: isCurrentUser,
                    id: member.id
                };
            });
            
            // Sort by score descending
            playerScores.sort((a, b) => b.score - a.score);
            
            roundSummary.innerHTML = `
                <div class="party-results">
                    <h3>Free For All Results</h3>
                    <div class="ffa-leaderboard">
                        ${playerScores.map((player, index) => `
                            <div class="leaderboard-item ${index === 0 ? 'winner' : ''}">
                                <span class="rank">#${index + 1}</span>
                                <span class="player-name">${player.isYou ? 'You' : player.name}</span>
                                <span class="player-score">${player.score} pts</span>
                            </div>
                        `).join('')}
                    </div>
                    <div class="rounds-summary">
                        <h4>Round Summary</h4>
                        ${this.currentGame.rounds.map((round, index) => `
                            <div class="round-item">
                                <div><strong>Round ${index + 1}:</strong> ${round.demon.name}</div>
                                <div>Your Guess: ${this.formatGuessDisplay(round.guess)} | Actual: #${round.actual} | Points: ${round.points}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        } else if (gameType === 'teams') {
            // Teams: Show team scores with real member names
            const teams = Object.values(this.currentGame.teams).filter(team => team.members.length > 0);
            const teamScores = teams.map(team => ({
                name: team.name,
                score: Math.floor(this.currentGame.score * (Math.random() * 0.3 + 0.7)),
                members: team.members.map(memberId => {
                    const member = this.currentParty.members.find(m => m.id === memberId);
                    if (!member) return 'Unknown';
                    return member.id === 'host' ? (localStorage.getItem('username') || 'You') : member.name.replace(' (Host)', '');
                })
            }));
            teamScores.sort((a, b) => b.score - a.score);
            
            roundSummary.innerHTML = `
                <div class="party-results">
                    <h3>Team Results</h3>
                    <div class="team-leaderboard">
                        ${teamScores.map((team, index) => `
                            <div class="team-result ${index === 0 ? 'winner' : ''}">
                                <div class="team-rank">#${index + 1}</div>
                                <div class="team-info">
                                    <h4>${team.name}</h4>
                                    <p>${team.members.join(', ')}</p>
                                </div>
                                <div class="team-score">${team.score} pts</div>
                            </div>
                        `).join('')}
                    </div>
                    <div class="rounds-summary">
                        <h4>Your Performance</h4>
                        ${this.currentGame.rounds.map((round, index) => `
                            <div class="round-item">
                                <div><strong>Round ${index + 1}:</strong> ${round.demon.name}</div>
                                <div>Your Guess: ${this.formatGuessDisplay(round.guess)} | Actual: #${round.actual} | Points: ${round.points}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        } else if (gameType === 'duels') {
            // Duels: Show combat results with health system
            const currentUserId = this.getCurrentUserId();
            const memberIds = this.currentParty?.members?.map(m => m.id) || [];
            const player1Id = memberIds[0];
            const player2Id = memberIds[1];
            const isPlayer1 = currentUserId === player1Id;
            
            const opponent = this.currentParty?.members?.find(m => m && m.id !== currentUserId);
            const opponentName = opponent ? (opponent.name || 'Opponent').replace(' (Host)', '') : 'Opponent';
            
            // Fix win detection based on actual health values
            
            const myHealthRaw = this.currentGame.duelHealth?.[currentUserId];
            const opponentId = isPlayer1 ? player2Id : player1Id;
            const opponentHealthRaw = this.currentGame.duelHealth?.[opponentId];
            
            const myHealth = myHealthRaw ?? 0;
            const opponentHealth = opponentHealthRaw ?? 0;
            
            let winMessage = '';
            let youWon = false;
            let opponentWon = false;
            
            if (myHealth > 0 && opponentHealth === 0) {
                winMessage = 'Victory';
                this.currentGame.duelWinner = currentUserId;
                youWon = true;
            } else if (myHealth === 0 && opponentHealth > 0) {
                winMessage = 'Defeat';
                this.currentGame.duelWinner = isPlayer1 ? player2Id : player1Id;
                opponentWon = true;
            } else if (myHealth === 0 && opponentHealth === 0) {
                winMessage = 'Draw';
            } else {
                // Both still have health - shouldn't happen at game end
                winMessage = '⚔️ Battle continues...';
            }
            
            roundSummary.innerHTML = `
                <div class="party-results">
                    <h3>Duel Results</h3>
                    <div class="duel-victory-message">
                        <h2 style="color: ${youWon ? '#ffd93d' : opponentWon ? '#ff6b6b' : '#888'}; font-size: 48px; margin: 20px 0;">${winMessage}</h2>
                    </div>
                    <div class="duel-final-health">
                        <div class="final-health-display">
                            <div class="player-final-health">
                                <span class="player-name">You</span>
                                <div class="health-bar">
                                    <div class="health-fill" style="width: ${myHealth}%; background: ${myHealth > 50 ? '#4CAF50' : myHealth > 10 ? '#FFC107' : '#F44336'};"></div>
                                </div>
                                <span class="health-value">${myHealth}/100 HP</span>
                            </div>
                            <div class="vs-final">VS</div>
                            <div class="player-final-health">
                                <span class="player-name">${opponentName}</span>
                                <div class="health-bar">
                                    <div class="health-fill" style="width: ${opponentHealth}%; background: ${opponentHealth > 50 ? '#4CAF50' : opponentHealth > 10 ? '#FFC107' : '#F44336'};"></div>
                                </div>
                                <span class="health-value">${opponentHealth}/100 HP</span>
                            </div>
                        </div>
                    </div>
                    <div class="duel-results">
                        <div class="duel-match completed">
                            <div class="duel-player ${youWon ? 'winner' : ''}">
                                <span class="player-name">You</span>
                                <span class="player-score">${this.currentGame.score} pts</span>
                            </div>
                            <div class="vs">VS</div>
                            <div class="duel-player ${opponentWon ? 'winner' : ''}">
                                <span class="player-name">${opponentName}</span>
                                <span class="player-score">${(() => {
                                    const opponentScore = this.currentGame.playerScores?.[opponentId] || 0;
                                    console.log('🏆 [VICTORY SCREEN DEBUG] Opponent Score Display:', {
                                        opponentId: opponentId,
                                        opponentScore: opponentScore,
                                        fullPlayerScores: this.currentGame.playerScores,
                                        allKeys: Object.keys(this.currentGame.playerScores || {}),
                                        currentUserId: this.getCurrentUserId()
                                    });
                                    return opponentScore;
                                })()} pts</span>
                            </div>
                        </div>
                    </div>
                    <div class="rounds-summary">
                        <h4>Your Performance</h4>
                        ${this.currentGame.rounds.map((round, index) => `
                            <div class="round-item">
                                <div><strong>Round ${index + 1}:</strong> ${round.demon.name}</div>
                                <div>Your Guess: ${this.formatGuessDisplay(round.guess)} | Actual: #${round.actual} | Points: ${round.points}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }
    }

    playAgain() {
        // For duels, go back to party setup screen to stay in party
        if (this.currentGame?.isParty && this.currentGame?.gameType === 'duels') {
            this.showScreen('partySetupScreen');
        } else {
            // For solo games, go to game setup screen
            this.showScreen('gameSetupScreen');
        }
    }

    backToLobby() {
        // CRITICAL FIX: Hide duel health display when returning to lobby
        const healthDisplay = document.getElementById('duelHealthDisplay');
        if (healthDisplay) {
            healthDisplay.style.display = 'none';
            console.log('🔄 [LOBBY] Hidden health display when returning to lobby');
        }
        
        // For all multiplayer party games, go back to party setup screen
        if (this.currentGame?.isParty) {
            this.showScreen('partySetupScreen');
        } else {
            // For solo games, go to game setup screen  
            this.showScreen('gameSetupScreen');
        }
    }

    quitGame() {
        if (confirm('Are you sure you want to quit the current game?')) {
            // Set flag to prevent any automatic screen transitions after quitting
            console.log('🚪 [QUIT] User has quit - preventing automatic screen transitions');
            this.userHasQuit = true;
            
            // Stop any running timer to prevent automatic guess submission
            if (this.currentTimer) {
                console.log('🚪 [QUIT] Clearing FFA timer to prevent automatic round completion');
                clearInterval(this.currentTimer);
                this.currentTimer = null;
            }
            
            this.goHome();
        }
    }
    
    // Comprehensive cleanup function to remove all game overlays and notifications
    clearAllGameOverlays() {
        console.log('🧹 [CLEANUP] Removing all game overlays and notifications');
        
        // List of all overlay/notification IDs to remove
        const overlayIds = [
            'ffaRevealScreen',
            'ffaWaitingOverlay', 
            'duelWaitingOverlay',
            'opponentSubmittedNotification',
            'clashScreen',
            'detailedDuelResults',
            'guessSubmittedOverlay',
            'waitingOverlay'
        ];
        
        // Remove by ID
        overlayIds.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                console.log(`🧹 [CLEANUP] Removing ${id}`);
                element.remove();
            }
        });
        
        // Remove any other overlays by class/querySelector
        const additionalSelectors = [
            '.overlay',
            '.notification', 
            '.waiting-screen',
            '.reveal-screen',
            '[id*="overlay"]',
            '[id*="Overlay"]',
            '[id*="notification"]',
            '[id*="Notification"]'
        ];
        
        additionalSelectors.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(element => {
                // Don't remove permanent UI elements
                if (!element.closest('#app') && !element.closest('.screen')) {
                    console.log(`🧹 [CLEANUP] Removing element matching ${selector}`);
                    element.remove();
                }
            });
        });
        
        console.log('🧹 [CLEANUP] All overlays and notifications cleared');
    }
    
    // Go home with full cleanup (for buttons that should leave party and clear overlays)
    goHome() {
        console.log('🏠 [HOME] Going home with full cleanup');
        
        // Reset quit flag since user is explicitly going home
        this.userHasQuit = false;
        
        // Leave party if in one
        if (this.currentParty) {
            console.log('🚪 [HOME] Leaving party before going home');
            this.leaveCurrentParty();
        }
        
        // Clear all game overlays and notifications
        this.clearAllGameOverlays();
        
        // Go to home screen
        this.showScreen('homeScreen');
    }
    
    // Helper function to format guess display (handles timeout case)
    formatGuessDisplay(guess) {
        return (guess === 999 || guess === null || guess === undefined) ? 'No guess submitted' : `#${guess}`;
    }
    
    leaveCurrentParty() {
        if (this.currentParty && this.multiplayerManager?.isConnected()) {
            console.log('🚪 [CLIENT] Leaving current party:', this.currentParty.code);
            
            // Call the multiplayer manager to leave the party
            this.multiplayerManager.leaveParty();
            
            // Clear local party state
            this.currentParty = null;
            this.isHost = false;
            
            // Reset current game state if it was a party game
            if (this.currentGame?.isParty) {
                this.currentGame = null;
            }
            
            console.log('🚪 [CLIENT] Successfully left party and cleared local state');
        }
    }

    startDailyChallenge() {
        console.log('Daily challenge clicked!');
        console.log('Demons loaded:', this.demons.length);
        
        if (!this.demons || this.demons.length === 0) {
            console.error('No demons loaded yet');
            alert('Please wait for demons to load...');
            return;
        }
        
        const today = new Date().toDateString();
        // Removed completion check for testing
        
        const seed = today;
        const randomizer = this.seededRandom(seed);
        
        const dailyDemons = [];
        const mainAndExtended = this.demons.filter(d => d.position <= 150);
        const legacy = this.demons.filter(d => d.position > 150);
        
        console.log(`Available demons: Main/Extended: ${mainAndExtended.length}, Legacy: ${legacy.length}`);
        
        for (let i = 0; i < 5; i++) {
            const useLegacy = randomizer() < 0.15 && legacy.length > 0;
            const pool = useLegacy ? legacy : mainAndExtended;
            
            if (pool.length === 0) {
                console.error('No demons in pool:', useLegacy ? 'legacy' : 'mainAndExtended');
                continue;
            }
            
            const index = Math.floor(randomizer() * pool.length);
            const selectedDemon = pool[index];
            
            if (selectedDemon && selectedDemon.video) {
                dailyDemons.push(selectedDemon);
                console.log(`Daily demon ${i+1}:`, selectedDemon.name, `(#${selectedDemon.position})`);
            } else {
                console.warn('Skipping invalid demon:', selectedDemon);
                i--; // Try again
            }
        }
        
        console.log('Daily demons selected:', dailyDemons);
        
        if (dailyDemons.length < 5) {
            console.error('Could only select', dailyDemons.length, 'demons for daily challenge');
            if (dailyDemons.length === 0) {
                alert('No valid demons available for daily challenge!');
                return;
            }
        }
        
        this.currentGame = {
            mode: 'daily',
            difficulty: 'nmpz',
            hints: {},
            lists: { mainList: true, extendedList: true, legacyList: true },
            rounds: [],
            currentRound: 0,
            totalRounds: 5,
            score: 0,
            dailyDemons: dailyDemons,
            startTime: Date.now()
        };
        
        console.log('Starting first round...');
        this.showScreen('gameScreen');
        this.startNewRound();
    }

    seededRandom(seed) {
        let hash = 0;
        for (let i = 0; i < seed.length; i++) {
            hash = ((hash << 5) - hash) + seed.charCodeAt(i);
            hash = hash & hash;
        }
        return () => {
            hash = (hash * 9301 + 49297) % 233280;
            // Ensure result is always positive between 0 and 1
            return Math.abs(hash / 233280);
        };
    }


    getLeaderboard(type) {
        const stored = localStorage.getItem(`leaderboard_${type}`);
        return stored ? JSON.parse(stored) : this.generateMockLeaderboard();
    }

    generateMockLeaderboard() {
        return [
            { name: 'SpaceUK', score: 485 },
            { name: 'Zoink', score: 470 },
            { name: 'Trick', score: 455 },
            { name: 'Cursed', score: 440 },
            { name: 'Diamond', score: 425 }
        ];
    }

    loadStats() {
        const stored = localStorage.getItem('demonGuessr_stats');
        return stored ? JSON.parse(stored) : {
            gamesPlayed: 0,
            totalScore: 0,
            perfectGuesses: 0,
            totalGuesses: 0,
            gamesWon: 0,
            accuracyByRange: {}
        };
    }

    saveStats() {
        localStorage.setItem('demonGuessr_stats', JSON.stringify(this.stats));
    }

    updateStats(guess, actual) {
        this.stats.totalGuesses++;
        if (guess === actual) {
            this.stats.perfectGuesses++;
        }
        
        const range = actual <= 75 ? 'main' : actual <= 150 ? 'extended' : 'legacy';
        if (!this.stats.accuracyByRange[range]) {
            this.stats.accuracyByRange[range] = { total: 0, accurate: 0 };
        }
        this.stats.accuracyByRange[range].total++;
        if (Math.abs(guess - actual) <= 10) {
            this.stats.accuracyByRange[range].accurate++;
        }
        
        this.saveStats();
    }

    saveGameToStats() {
        this.stats.gamesPlayed++;
        this.stats.totalScore += this.currentGame.score;
        
        // Check if this was a win (score above certain threshold or party game performance)
        const isWin = this.determineIfWin();
        if (isWin) {
            this.stats.gamesWon++;
        }
        
        this.saveStats();
        this.updateProfileStats();
        
    }
    
    determineIfWin() {
        // Only party games and future online games count as wins
        if (!this.currentGame.isParty) {
            return false; // Solo games don't count as wins
        }
        
        // For party games, determine based on game type
        if (this.currentGame.gameType === 'ffa') {
            // In FFA, you win if you're in top position (simplified for demo)
            return Math.random() > 0.5; // Placeholder - in real multiplayer, check actual ranking
        } else if (this.currentGame.gameType === 'teams') {
            // In teams, you win if your team wins (simplified for demo)
            return Math.random() > 0.5; // Placeholder - in real multiplayer, check team performance
        } else if (this.currentGame.gameType === 'duels') {
            // In duels, you win if you beat opponent (simplified for demo)
            return Math.random() > 0.5; // Placeholder - in real multiplayer, check vs opponent
        }
        
        return false;
    }

    updateProfileStats() {
        document.getElementById('gamesPlayed').textContent = this.stats.gamesPlayed;
        document.getElementById('avgScore').textContent = 
            this.stats.gamesPlayed > 0 ? 
            Math.round(this.stats.totalScore / this.stats.gamesPlayed) : 0;
        document.getElementById('bestScore').textContent = 
            localStorage.getItem('bestScore') || 0;
        
        if (this.currentGame.score > (localStorage.getItem('bestScore') || 0)) {
            localStorage.setItem('bestScore', this.currentGame.score);
        }
    }


    checkDailyStatus() {
        const today = new Date().toDateString();
        
        // For testing - clear the completion status (remove this later if you want persistence)
        localStorage.removeItem('dailyCompleted');
        
        const completedToday = localStorage.getItem('dailyCompleted') === today;
        this.updateDailyChallengeBanner(completedToday);
        
        // Add click handler for daily challenge
        document.getElementById('dailyChallengeBanner').addEventListener('click', () => {
            // Check completion status again at click time (not cached)
            const currentlyCompleted = localStorage.getItem('dailyCompleted') === today;
            if (currentlyCompleted) {
                this.showDailyLeaderboard();
            } else {
                this.startDailyChallenge();
            }
        });
    }

    updateDailyChallengeBanner(completed) {
        const banner = document.getElementById('dailyChallengeBanner');
        const status = document.getElementById('dailyStatus');
        
        if (completed) {
            banner.classList.add('completed');
            status.textContent = '✅ Completed! View Leaderboard';
            const today = new Date().toDateString();
            localStorage.setItem('dailyCompleted', today);
        } else {
            banner.classList.remove('completed');
            status.textContent = 'Play today\'s 5 demons';
            // Don't store anything in localStorage if not completed
        }
    }

    saveDailyScore(score) {
        const today = new Date().toDateString();
        const username = localStorage.getItem('username') || `Player${Math.floor(Math.random()*1000)}`;
        
        let dailyLeaderboard = JSON.parse(localStorage.getItem('dailyLeaderboard') || '{}');
        
        if (!dailyLeaderboard[today]) {
            dailyLeaderboard[today] = [];
        }
        
        dailyLeaderboard[today].push({
            name: username,
            score: score,
            time: Date.now(),
            customAvatar: localStorage.getItem('customAvatar')
        });
        
        // Sort by score descending
        dailyLeaderboard[today].sort((a, b) => b.score - a.score);
        
        localStorage.setItem('dailyLeaderboard', JSON.stringify(dailyLeaderboard));
        console.log('Saved daily score:', score, 'for', username);
        console.log('Today\'s leaderboard:', dailyLeaderboard[today]);
    }

    showDailyLeaderboard() {
        const today = new Date().toDateString();
        const dailyLeaderboard = JSON.parse(localStorage.getItem('dailyLeaderboard') || '{}');
        const todayScores = dailyLeaderboard[today] || [];
        
        this.showScreen('leaderboardScreen');
        
        // Set daily tab as active
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelector('.tab-btn').classList.add('active');
        
        const leaderboardList = document.getElementById('leaderboardList');
        if (todayScores.length === 0) {
            leaderboardList.innerHTML = '<div class="leaderboard-item"><span>No scores yet today! Be the first to play.</span><span>-</span></div>';
        } else {
            leaderboardList.innerHTML = todayScores.slice(0, 10).map((entry, index) => `
                <div class="leaderboard-item">
                    <div class="leaderboard-player">
                        ${this.getUserAvatar(entry.name, entry.customAvatar)}
                        <span>#${index + 1} ${entry.name}</span>
                    </div>
                    <span>${entry.score} points</span>
                </div>
            `).join('');
        }
    }

    showLeaderboard(type) {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        event.target.classList.add('active');
        
        const leaderboardList = document.getElementById('leaderboardList');
        
        if (type === 'daily') {
            const today = new Date().toDateString();
            const dailyLeaderboard = JSON.parse(localStorage.getItem('dailyLeaderboard') || '{}');
            const todayScores = dailyLeaderboard[today] || [];
            
            if (todayScores.length === 0) {
                leaderboardList.innerHTML = '<div class="leaderboard-item">No scores yet today!</div>';
            } else {
                leaderboardList.innerHTML = todayScores.slice(0, 10).map((entry, index) => `
                    <div class="leaderboard-item">
                        <div class="leaderboard-player">
                            ${this.getUserAvatar(entry.name, entry.customAvatar)}
                            <span>#${index + 1} ${entry.name}</span>
                        </div>
                        <span>${entry.score} points</span>
                    </div>
                `).join('');
            }
        } else {
            const leaderboard = this.getLeaderboard(type);
            leaderboardList.innerHTML = leaderboard.map((entry, index) => `
                <div class="leaderboard-item">
                    <div class="leaderboard-player">
                        ${this.getUserAvatar(entry.name, entry.customAvatar)}
                        <span>#${index + 1} ${entry.name}</span>
                    </div>
                    <span>${entry.score} points</span>
                </div>
            `).join('');
        }
    }
    
    // Debug helper methods
    logGameState(context = '') {
        if (this.debugMode || localStorage.getItem('debug') === 'true') {
            console.log(`[STATE] ${context}:`, {
                currentGame: {
                    exists: !!this.currentGame,
                    mode: this.currentGame?.mode,
                    currentRound: this.currentGame?.currentRound,
                    totalRounds: this.currentGame?.totalRounds,
                    isParty: this.currentGame?.isParty,
                    gameType: this.currentGame?.gameType
                },
                currentParty: {
                    exists: !!this.currentParty,
                    code: this.currentParty?.code,
                    membersCount: this.currentParty?.members?.length,
                    gameType: this.currentParty?.gameType
                },
                multiplayer: {
                    managerExists: !!window.multiplayerManager,
                    connected: window.multiplayerManager?.connected,
                    isHost: this.isHost
                },
                data: {
                    finalListLength: this.finalList?.length || 0,
                    consolidatedListLength: this.consolidatedList?.length || 0,
                    blacklistedCount: this.blacklistedDemons?.length || 0
                }
            });
        }
    }

    logError(context, error, additionalData = {}) {
        console.error(`[ERROR] ${context}:`, {
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name
            },
            context: additionalData,
            gameState: {
                currentGame: !!this.currentGame,
                currentParty: !!this.currentParty,
                isHost: this.isHost,
                multiplayerConnected: window.multiplayerManager?.connected
            }
        });
    }

    // Connect to multiplayer server
    connectToMultiplayer() {
        console.log('[DEBUG] Connecting to multiplayer server');
        
        // Check if multiplayer manager exists
        if (typeof window.multiplayerManager === 'undefined') {
            console.log('[DEBUG] MultiplayerManager not found, retrying in 1 second');
            setTimeout(() => this.connectToMultiplayer(), 1000);
            return;
        }
        
        // Connect to the server
        window.multiplayerManager.connect();
        
        // Set up event callbacks
        this.setupMultiplayerCallbacks();
    }
    
    // Set up multiplayer event callbacks
    setupMultiplayerCallbacks() {
        console.log('🔧 [SETUP-2] setupMultiplayerCallbacks() called at:', new Date().toISOString());
        console.log('🔧 [SETUP-2] Context:', {
            isHost: this.isHost,
            socketId: window.multiplayerManager?.socket?.id,
            connected: window.multiplayerManager?.connected
        });
        
        if (!window.multiplayerManager) return;
        
        window.multiplayerManager.onConnected = () => {
            console.log('[MULTIPLAYER] Connected to server');
        };
        
        window.multiplayerManager.onPartyCreated = (data) => {
            console.log('[MULTIPLAYER] Party created:', data.code);
            this.currentParty = data.party;
            this.isHost = true;
            this.showPartyLobby(data.party);
        };
        
        window.multiplayerManager.onJoinSuccess = (party) => {
            console.log('[MULTIPLAYER] Joined party:', party.code);
            this.currentParty = party;
            this.isHost = (party.host === window.multiplayerManager.socket.id);
            this.showPartyLobby(party);
        };
        
        window.multiplayerManager.onJoinError = (error) => {
            console.log('[MULTIPLAYER] Join error:', error.message);
            alert('Failed to join party: ' + error.message);
        };
        
        // CRITICAL: Add the missing onPartyUpdated callback for non-host players
        window.multiplayerManager.onPartyUpdated = (party) => {
            console.log('🔥 [NON-HOST CALLBACK] onPartyUpdated triggered for non-host');
            this.handlePartyUpdate(party);
        };
        
        // Add missing onGameStarted callback
        window.multiplayerManager.onGameStarted = (data) => {
            console.log('🎮 [CLIENT] onGameStarted callback triggered with data:', data);
            this.handleMultiplayerGameStart(data);
        };
        
        // Add missing onRoundComplete callback
        window.multiplayerManager.onRoundComplete = (data) => {
            console.log('🎯 [CLIENT] onRoundComplete callback triggered with data:', data);
            this.handleOpponentScore(data);
        };
        
        // Add missing onNextRoundStarted callback
        window.multiplayerManager.onNextRoundStarted = (data) => {
            console.log('🎯 [CLIENT] onNextRoundStarted callback triggered with data:', data);
            this.handleNextRoundStarted(data);
        };
        
        // Add missing onPlayerScoreSubmitted callback
        window.multiplayerManager.onPlayerScoreSubmitted = (data) => {
            console.log('📊 [CLIENT] onPlayerScoreSubmitted callback triggered with data:', data);
            this.handlePlayerScoreSubmitted(data);
        };
        
        // Add missing onDuelVictory callback
        window.multiplayerManager.onDuelVictory = (data) => {
            console.log('🏆 [CLIENT] Duel victory received from server:', data);
            this.handleDuelVictory(data);
        };
        
        // Add gameFinished callback for FFA results screen access
        console.log('🔧 [CALLBACK-2] ========== SETTING CALLBACK (OVERRIDE WARNING) ==========');
        console.log('🔧 [CALLBACK-2] ⚠️  This will OVERRIDE any existing callback!');
        console.log('🔧 [CALLBACK-2] Setting onGameFinished callback for:', {
            isHost: this.isHost,
            socketId: window.multiplayerManager?.socket?.id,
            timestamp: new Date().toISOString(),
            existingCallback: typeof window.multiplayerManager?.onGameFinished,
            multiplayerExists: !!window.multiplayerManager
        });
        
        // Store callback with debugging wrapper
        const gameFinishedCallback2 = (data) => {
            console.log('🏁 [CLIENT-2] ========== CALLBACK-2 FIRED ==========');
            console.log('🏁 [CLIENT-2] Game finished - bringing player to results screen:', data);
            console.log('🏁 [CLIENT-2] This is host?', this.isHost);
            console.log('🏁 [CLIENT-2] Socket ID:', window.multiplayerManager?.socket?.id);
            console.log('🏁 [CLIENT-2] About to call handleGameFinished');
            
            try {
                this.handleGameFinished(data);
                console.log('🏁 [CLIENT-2] ✅ handleGameFinished completed');
            } catch (error) {
                console.error('🏁 [CLIENT-2] ❌ handleGameFinished failed:', error);
            }
            
            console.log('🏁 [CLIENT-2] ========== CALLBACK-2 COMPLETED ==========');
        };
        
        // ⚠️  CRITICAL: This overwrites the previous callback!
        window.multiplayerManager.onGameFinished = gameFinishedCallback2;
        
        // Verify callback was set
        console.log('✅ [CALLBACK-2] Callback set. Verification:', {
            callbackExists: typeof window.multiplayerManager.onGameFinished === 'function',
            callbackMatches: window.multiplayerManager.onGameFinished === gameFinishedCallback2
        });
        
        console.log('🔧 [CALLBACK-2] ⚠️  CALLBACK-1 HAS BEEN OVERRIDDEN BY CALLBACK-2!');
    }
    
    // Basic multiplayer navigation methods
    showMultiplayerOptions() {
        this.showScreen('multiplayerOptionsScreen');
    }
    
    showPartySetup() {
        if (!window.multiplayerManager || !window.multiplayerManager.connected) {
            alert('Not connected to multiplayer server. Please wait and try again.');
            return;
        }
        
        const username = localStorage.getItem('username') || 'Player';
        window.multiplayerManager.createParty(username);
    }
    
    showJoinParty() {
        this.showScreen('joinPartyScreen');
    }
    
    joinParty() {
        if (!window.multiplayerManager || !window.multiplayerManager.connected) {
            alert('Not connected to multiplayer server. Please wait and try again.');
            return;
        }
        
        const code = document.getElementById('joinPartyCode').value.trim().toUpperCase();
        if (!code) {
            alert('Please enter a party code');
            return;
        }
        
        const username = localStorage.getItem('username') || 'Player';
        window.multiplayerManager.joinParty(code, username);
    }
    
    showPartyLobby(party) {
        this.showScreen('partySetupScreen');
        
        // Update party code display
        const partyCodeElement = document.getElementById('partyCode');
        if (partyCodeElement) {
            partyCodeElement.textContent = party.code;
        }
        
        // Update member count and list
        this.updatePartyDisplay();
    }
    
    updatePartyDisplay() {
        if (!this.currentParty) return;
        
        const memberCount = document.getElementById('memberCount');
        const membersList = document.getElementById('membersList');
        
        if (memberCount) {
            memberCount.textContent = this.currentParty.members.length;
        }
        
        if (membersList) {
            membersList.innerHTML = '';
            this.currentParty.members.forEach(member => {
                const memberDiv = document.createElement('div');
                memberDiv.className = 'member-item';
                memberDiv.innerHTML = `
                    <span class="member-name">${member.name}${member.id === this.currentParty.host ? ' (Host)' : ''}</span>
                    <span class="member-status">Ready</span>
                `;
                membersList.appendChild(memberDiv);
            });
        }
        
        // Show/hide start button for host
        const startBtn = document.getElementById('startPartyBtn');
        if (startBtn) {
            startBtn.style.display = this.isHost ? 'block' : 'none';
        }
    }
}

// Enable detailed debug logging with: localStorage.setItem('debug', 'true')
// Disable with: localStorage.removeItem('debug')
const game = new DemonListGuessr();
window.game = game;
