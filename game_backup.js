
class DemonListGuessr {
    constructor() {
        console.log('[DEBUG] DemonListGuessr constructor starting');
        this.demons = [];
        this.consolidatedList = [];
        this.apiList = [];
        this.finalList = [];
        this.blacklistedDemons = [];
        this.currentGame = null;
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
        console.log('[DEBUG] Loading demon list...');
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

            // Add Enter key support for guess input
            document.addEventListener('keydown', (e) => {
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
        // Handle when any player submits their score 
        if (!this.currentGame.duelState) return;
        
        const currentUserId = this.getCurrentUserId();
        
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
        
        // Close any duel results overlay for non-hosts
        const duelResultsOverlay = document.getElementById('detailedDuelResults');
        if (duelResultsOverlay) {
            duelResultsOverlay.remove();
        }
        
        // Force next round for all players
        this.stopCurrentVideo();
        
        // Check for duel winner first - show final results instead of generic end game
        if (this.currentGame.duelWinner) {
            this.showDuelFinalResults();
            return;
        }
        
        if (this.currentGame.currentRound >= this.currentGame.totalRounds) {
            this.endGame();
        } else {
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
        
        window.multiplayerManager.onPlayerScoreSubmitted = (data) => {
            this.handlePlayerScoreSubmitted(data);
        };
        
        window.multiplayerManager.onRoundComplete = (data) => {
            this.handleOpponentScore(data);
        };
        
        window.multiplayerManager.onGameStarted = (data) => {
            this.handleMultiplayerGameStart(data);
        };
        
        window.multiplayerManager.onPartyUpdated = (party) => {
            this.handlePartyUpdate(party);
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
    }

    handlePartyCreated(data) {
        this.currentParty = data.party;
        this.isHost = true;
        
        this.showScreen('partySetupScreen');
        document.getElementById('partyCode').textContent = data.code;
        this.updatePartyVisual();
        
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
        this.currentParty = party;
        this.isHost = false;
        
        this.showScreen('partySetupScreen');
        document.getElementById('partyCode').textContent = party.code;
        this.updatePartyVisual();
        
        // Hide ALL settings sections except game type for non-hosts
        const allSections = document.querySelectorAll('#partySetupScreen .setup-section');
        allSections.forEach(section => {
            const heading = section.querySelector('h3');
            if (heading && heading.textContent !== 'Game Type') {
                section.style.display = 'none';
            } else if (heading && heading.textContent === 'Game Type') {
                // Keep game type visible but disabled
                const select = section.querySelector('#partyGameType');
                if (select) {
                    select.disabled = true;
                    select.style.opacity = '0.7';
                }
            }
        });
        
        // Hide start game button for non-hosts
        const startButton = document.getElementById('startPartyGameBtn');
        if (startButton) {
            startButton.style.display = 'none';
        }
        
        // Add a message for non-hosts
        const messageDiv = document.createElement('div');
        messageDiv.id = 'nonHostMessage';
        messageDiv.style.cssText = 'text-align: center; padding: 20px; color: #888; font-style: italic; font-size: 16px;';
        messageDiv.innerHTML = '🎮 You are a party member<br>Host is configuring game settings...';
        
        const setupContainer = document.querySelector('#partySetupScreen .container');
        if (setupContainer) {
            setupContainer.appendChild(messageDiv);
        }
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
        if (!this.currentParty) return;
        
        const gameType = this.currentParty.gameType;
        const userAvatar = localStorage.getItem('userAvatar') || '👤';
        const username = localStorage.getItem('username') || 'You';
        
        // Hide/show Start Party Game button based on host status
        const startPartyBtn = document.getElementById('startPartyBtn');
        if (startPartyBtn) {
            startPartyBtn.style.display = this.isHost ? 'block' : 'none';
        }
        
        if (gameType === 'ffa') {
            this.updateFFAVisual();
        } else if (gameType === 'teams') {
            this.updateTeamsVisual();
        } else if (gameType === 'duels') {
            this.updateDuelsVisual();
        }
    }

    updateFFAVisual() {
        const ffaPlayersContainer = document.querySelector('.ffa-players');
        const customAvatar = localStorage.getItem('customAvatar');
        const username = localStorage.getItem('username') || 'You';
        
        // Clear and rebuild
        ffaPlayersContainer.innerHTML = '';
        
        // Add all players
        this.currentParty.members.forEach(member => {
            const playerDiv = document.createElement('div');
            playerDiv.className = 'player-avatar';
            
            let avatarContent;
            if (member.id === 'host') {
                if (customAvatar) {
                    avatarContent = `<img src="${customAvatar}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
                } else {
                    const letter = username.charAt(0).toUpperCase() || 'Y';
                    avatarContent = letter;
                }
            } else {
                avatarContent = '🤖';
            }
            
            playerDiv.innerHTML = `
                <div class="avatar">${avatarContent}</div>
                <span class="player-name">${member.id === 'host' ? username : member.name}</span>
            `;
            ffaPlayersContainer.appendChild(playerDiv);
        });
    }

    updateTeamsVisual() {
        const teamsDisplay = document.querySelector('.teams-display');
        const customAvatar = localStorage.getItem('customAvatar');
        const username = localStorage.getItem('username') || 'You';
        
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
                    if (member.id === 'host') {
                        if (customAvatar) {
                            avatarContent = `<img src="${customAvatar}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
                        } else {
                            const letter = username.charAt(0).toUpperCase() || 'Y';
                            avatarContent = letter;
                        }
                    } else {
                        avatarContent = '🤖';
                    }
                    
                    playerDiv.innerHTML = `
                        <div class="avatar">${avatarContent}</div>
                        <span class="player-name">${member.id === 'host' ? username : member.name}</span>
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
        const customAvatar = localStorage.getItem('customAvatar');
        const username = localStorage.getItem('username') || 'You';
        
        // Clear and rebuild
        duelDisplay.innerHTML = '';
        
        // Player 1 (You)
        const player1Div = document.createElement('div');
        player1Div.className = 'duel-player';
        let avatarContent;
        if (customAvatar) {
            avatarContent = `<img src="${customAvatar}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
        } else {
            const letter = username.charAt(0).toUpperCase() || 'Y';
            avatarContent = letter;
        }
        
        player1Div.innerHTML = `
            <div class="player-avatar">
                <div class="avatar">${avatarContent}</div>
                <span class="player-name">${username}</span>
            </div>
        `;
        
        // VS divider
        const vsDiv = document.createElement('div');
        vsDiv.className = 'vs-divider';
        vsDiv.textContent = 'VS';
        
        // Player 2 (Opponent or waiting)
        const player2Div = document.createElement('div');
        player2Div.className = 'duel-player';
        
        // Find the opponent (anyone who isn't the current user)  
        const currentUserId = this.getCurrentUserId();
        const opponent = this.currentParty?.members?.find(m => m && m.id !== currentUserId);
        if (opponent) {
            // Get opponent's avatar if available (for real multiplayer)
            const opponentName = opponent.name || 'Opponent';
            let opponentAvatarContent = `<div style="width: 40px; height: 40px; border-radius: 50%; background: #666; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 18px;">${opponentName.charAt(0).toUpperCase()}</div>`;
            
            player2Div.innerHTML = `
                <div class="player-avatar">
                    <div class="avatar">${opponentAvatarContent}</div>
                    <span class="player-name">${opponentName}</span>
                </div>
            `;
        } else {
            player2Div.innerHTML = `
                <div class="player-avatar waiting">
                    <div class="avatar"><div style="width: 40px; height: 40px; border-radius: 50%; background: #555; display: flex; align-items: center; justify-content: center; color: white;">❓</div></div>
                    <span class="player-name">Waiting for opponent...</span>
                </div>
            `;
        }
        
        duelDisplay.appendChild(player1Div);
        duelDisplay.appendChild(vsDiv);
        duelDisplay.appendChild(player2Div);
    }

    startParty() {
        if (!this.currentParty) {
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
        
        const gameMode = document.getElementById('partyGameMode').value;
        const difficulty = document.querySelector('input[name="partyDifficulty"]:checked').value;
        
        const hints = {
            showDate: document.getElementById('partyShowDate')?.checked || false,
            showCreator: document.getElementById('partyShowCreator')?.checked || false,
            showVerifier: document.getElementById('partyShowVerifier')?.checked || false,
            showName: document.getElementById('partyShowName')?.checked || false
        };

        // Update party settings
        this.currentParty.settings = {
            lists: { mainList, extendedList, legacyList },
            mode: gameMode,
            difficulty: difficulty,
            hints: hints
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
            totalRounds: (this.currentParty && this.currentParty.gameType === 'duels') ? 999 : (gameMode === 'classic' ? 5 : 10)
        };

        // Send game start to server for all players
        if (window.multiplayerManager) {
            window.multiplayerManager.startGame(gameData);
        } else {
            // Fallback for local testing
            this.handleMultiplayerGameStart({ party: this.currentParty, gameData, seed: gameSeed });
        }
    }

    async handleMultiplayerGameStart(data) {
        console.log('🚀 Starting multiplayer game for all players:', data);
        
        // Ensure demons are loaded before starting
        if (this.finalList.length === 0 && this.consolidatedList.length === 0) {
            console.log('⏳ Demons not loaded yet, waiting...');
            await this.loadDemonList();
        }
        
        console.log('✅ Demons loaded, proceeding with game start');
        console.log('✅ Final list length:', this.finalList.length);
        console.log('✅ Consolidated list length:', this.consolidatedList.length);
        
        const gameData = data.gameData || data;
        const party = data.party || this.currentParty;
        const seed = data.seed || gameData.seed || (Date.now() + Math.random() * 1000000).toString();
        
        console.log('🎲 RECEIVED GAME START - Using seed:', seed);
        console.log('🎲 Previous game seed was:', this.currentGame?.seed);

        // Initialize game for this player
        this.currentGame = {
            mode: gameData.mode,
            difficulty: gameData.difficulty,
            hints: gameData.hints,
            lists: gameData.lists,
            rounds: [],
            currentRound: 0,
            totalRounds: gameData.totalRounds,
            score: 0,
            startTime: Date.now(),
            isParty: true,
            partyCode: party.code,
            gameType: gameData.gameType,
            teams: gameData.teams,
            seed: seed,
            playerScores: {},
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
                countdown: null, // Countdown timer
                clashReady: false, // Whether clash can happen
                roundMultiplier: 1.0 // Starts at 1x, increases each round
            } : null,
            duelWinner: null // Track duel winner - NEVER RESET!
        };

        // Set current party reference
        this.currentParty = party;
        
        // Start the game
        this.showScreen('gameScreen');
        this.startNewRound();
    }

    handlePartyUpdate(party) {
        this.currentParty = party;
        
        // Update UI if we're on the party setup screen
        if (document.getElementById('partySetupScreen').classList.contains('active')) {
            // Update game type selector to match server state
            const gameTypeSelect = document.getElementById('partyGameType');
            if (gameTypeSelect && gameTypeSelect.value !== party.gameType) {
                gameTypeSelect.value = party.gameType;
            }
            
            // Manually trigger the visual update without server sync
            this.updatePartyGameTypeVisuals();
            this.updatePartyVisual();
        }
    }

    updatePartyGameTypeVisuals() {
        const gameType = this.currentParty?.gameType || 'ffa';
        
        // Show/hide appropriate management sections
        document.getElementById('ffaMembersList').style.display = gameType === 'ffa' ? 'block' : 'none';
        document.getElementById('teamManagement').style.display = gameType === 'teams' ? 'block' : 'none';
        document.getElementById('duelsManagement').style.display = gameType === 'duels' ? 'block' : 'none';
        
        // Show/hide visual displays
        document.getElementById('ffaVisual').style.display = gameType === 'ffa' ? 'block' : 'none';
        document.getElementById('teamsVisual').style.display = gameType === 'teams' ? 'block' : 'none';
        document.getElementById('duelsVisual').style.display = gameType === 'duels' ? 'block' : 'none';
        
    }

    showScreen(screenId) {
        this.stopCurrentVideo();
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        document.getElementById(screenId).classList.add('active');
    }

    showGameSetup(mode) {
        this.gameMode = mode;
        this.showScreen('gameSetupScreen');
        const multiplayerOptions = document.getElementById('multiplayerOptions');
        multiplayerOptions.style.display = mode === 'multiplayer' ? 'block' : 'none';
    }

    startGame() {
        console.log('[DEBUG] Starting game...');
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
        console.log('🔄 Starting new round - clearing server health flag');
        
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
            
            
            if (availableDemons.length === 0) {
                // If all demons used, use all eligible demons again
                randomDemon = eligibleDemons[Math.floor(rng() * eligibleDemons.length)];
            } else {
                const rngValue = rng();
                const arrayLength = availableDemons.length;
                const index = Math.floor(rngValue * arrayLength);
                
                randomDemon = availableDemons[index];
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
        this.currentGame.currentRound++;
        
        document.getElementById('currentRound').textContent = this.currentGame.currentRound;
        document.getElementById('currentScore').textContent = this.currentGame.score;
        
        // Update multiplier display for duels
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
        }
        
        // Show duel health display for duels and reset state
        if (this.currentGame.gameType === 'duels') {
            this.updateDuelDisplay();
            
            // Reset duel state for new round - but NEVER reset duelWinner!
            if (this.currentGame.duelState && !this.currentGame.duelWinner) {
                this.currentGame.duelState.roundScores = {};
                this.currentGame.duelState.roundGuesses = {};
                this.currentGame.duelState.clashReady = false;
                this.currentGame.hasServerHealth = false; // Reset for new round
                
                // Clear any countdown
                if (this.currentGame.duelState.countdown) {
                    clearTimeout(this.currentGame.duelState.countdown);
                    this.currentGame.duelState.countdown = null;
                }
                
            } else if (this.currentGame.duelWinner) {
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
        }
        
        // Extract video ID from URL if needed
        const videoId = (randomDemon?.video?.includes('youtube.com') || randomDemon?.video?.includes('youtu.be')) 
            ? this.extractVideoId(randomDemon.video) 
            : randomDemon?.video;
        
        // Load media based on difficulty
        if (this.currentGame.difficulty === 'thumbnail') {
            this.loadThumbnail(videoId);
        } else {
            this.loadYouTubeVideo(videoId);
        }
        
        this.displayHints();
        
        document.getElementById('guessSection').style.display = 'block';
        document.getElementById('resultSection').style.display = 'none';
        document.getElementById('guessInput').value = '';
        
        const listIndicator = document.querySelector('.list-indicator');
        listIndicator.style.display = 'none';
        
        if (this.currentGame.mode === 'blitz') {
            this.startTimer(15);
        } else if (this.currentGame.mode === 'timeattack') {
            this.startTimer(60);
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
        
        if (this.currentTimer) {
            clearInterval(this.currentTimer);
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
        this.currentGame.rounds.push({
            demon: this.currentGame.currentDemon,
            guess: guess,
            actual: actual,
            points: points
        });
        
        // Handle duel mode differently - don't show results immediately
        if (this.currentGame.gameType === 'duels') {
            
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
            } else if (opponentScore === undefined) {
                // Opponent hasn't submitted yet - show waiting state
                this.showDuelWaitingState();
            }
            // If opponent already submitted, clash will trigger immediately
        } else {
            // Solo/non-duel mode - show results immediately
            this.showResult(guess, actual, points);
            this.updateStats(guess, actual);
        }
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
        // Clear any existing countdown
        if (this.currentGame.duelState.countdown) {
            clearTimeout(this.currentGame.duelState.countdown);
        }
        
        // Show countdown UI
        this.showDuelCountdown(15);
        
        // Set countdown timer
        this.currentGame.duelState.countdown = setTimeout(() => {
            
            // If opponent hasn't submitted, give them 0 score
            this.currentGame.duelState.roundScores[waitingForPlayerId] = 0;
            this.triggerDuelClash();
        }, 15000);
    }
    
    showDuelCountdown(seconds) {
        // Update the countdown display in the overlay (for person who submitted)
        const countdownDisplay = document.getElementById('duelCountdownDisplay');
        if (countdownDisplay) {
            countdownDisplay.textContent = `${seconds}`;
        }
        
        // Update the notification countdown (for person waiting to submit)
        const opponentCountdown = document.getElementById('opponentCountdown');
        if (opponentCountdown) {
            opponentCountdown.textContent = `${seconds}`;
        }
        
        if (seconds > 0) {
            setTimeout(() => this.showDuelCountdown(seconds - 1), 1000);
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
        
        // Clear countdown
        if (this.currentGame.duelState.countdown) {
            clearTimeout(this.currentGame.duelState.countdown);
            this.currentGame.duelState.countdown = null;
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
        
        // Calculate damage
        const scoreDifference = Math.abs(player1Score - player2Score);
        const baseDamage = scoreDifference; // Full difference as damage
        const finalDamage = Math.floor(baseDamage * this.currentGame.duelState.roundMultiplier);
        
        // Apply damage to lower scorer
        let combatResult = '';
        const currentUserId = this.getCurrentUserId();
        
        console.log('⚔️ DAMAGE CALCULATION:');
        console.log('Player 1 Score:', player1Score, 'Player 2 Score:', player2Score, 'Damage:', finalDamage);
        console.log('Before damage - P1 HP:', this.currentGame.duelHealth[player1Id], 'P2 HP:', this.currentGame.duelHealth[player2Id]);
        
        if (player1Score > player2Score) {
            this.currentGame.duelHealth[player2Id] -= finalDamage;
            console.log('💥 Player 1 wins round - damage to Player 2');
            combatResult = player1Id === currentUserId ? 
                `You dealt ${finalDamage} damage! (${player1Score} vs ${player2Score})` :
                `Opponent dealt ${finalDamage} damage! (${player2Score} vs ${player1Score})`;
        } else if (player2Score > player1Score) {
            this.currentGame.duelHealth[player1Id] -= finalDamage;
            console.log('💥 Player 2 wins round - damage to Player 1');
            combatResult = player2Id === currentUserId ?
                `You dealt ${finalDamage} damage! (${player2Score} vs ${player1Score})` :
                `Opponent dealt ${finalDamage} damage! (${player1Score} vs ${player2Score})`;
        } else {
            console.log('🤝 Draw round - no damage');
            combatResult = `Perfect tie! No damage dealt (${player1Score} vs ${player2Score})`;
        }
        
        console.log('After damage - P1 HP:', this.currentGame.duelHealth[player1Id], 'P2 HP:', this.currentGame.duelHealth[player2Id]);
        
        // Ensure health doesn't go below 0
        this.currentGame.duelHealth[player1Id] = Math.max(0, this.currentGame.duelHealth[player1Id]);
        this.currentGame.duelHealth[player2Id] = Math.max(0, this.currentGame.duelHealth[player2Id]);
        
        // Store combat result
        this.currentGame.lastCombatResult = {
            player1Score,
            player2Score,
            damage: finalDamage,
            multiplier: this.currentGame.duelState.roundMultiplier,
            result: combatResult
        };
        
        // Also store in clashData for display
        this.currentGame.clashData.damage = finalDamage;
        this.currentGame.clashData.combatResult = combatResult;
        
        // Store guess data in clashData before it gets reset
        this.currentGame.clashData.roundGuesses = { ...this.currentGame.duelState.roundGuesses };
        
        // Update health display immediately
        this.updateDuelDisplay();
        
        // CRITICAL: Skip ALL client-side damage calculation if we have server health
        console.log('🔴🔴🔴 DAMAGE CALCULATION CHECK:');
        console.log('  Has Server Health Flag:', this.currentGame.hasServerHealth);
        console.log('  Current Health Values:', JSON.stringify(this.currentGame.duelHealth));
        console.log('  Player 1 Score:', player1Score);
        console.log('  Player 2 Score:', player2Score);
        console.log('  Current Round:', this.currentGame.currentRound);
        console.log('  Round Multiplier:', this.currentGame.duelState.roundMultiplier);
        
        if (this.currentGame.hasServerHealth) {
            // DO NOT MODIFY HEALTH - Server is authoritative
            console.log('🟢 USING SERVER HEALTH - SKIPPING CLIENT DAMAGE CALCULATION');
            // NOTE: Flag will be cleared when new round starts, not here
        } else {
            console.log('🔴 NO SERVER HEALTH FLAG - FALLING BACK TO CLIENT CALCULATION');
            // FALLBACK: CLIENT-SIDE DAMAGE CALCULATION (only if no server data)
            const clientScoreDiff = Math.abs(player1Score - player2Score);
            const clientDamage = Math.floor(clientScoreDiff * (this.currentGame.duelState.roundMultiplier || 1.0));
            
            console.log('⚔️ CLIENT DAMAGE CALC:', {
                p1Score: player1Score,
                p2Score: player2Score,
                difference: clientScoreDiff,
                multiplier: this.currentGame.duelState.roundMultiplier,
                damage: clientDamage
            });
            
            // DEFENSIVE: Check if health would go negative before applying damage
            console.log('💣💣💣 APPLYING CLIENT DAMAGE:');
            console.log('  Damage Amount:', clientDamage);
            console.log('  Health BEFORE damage:', JSON.stringify(this.currentGame.duelHealth));
            
            // Apply damage locally
            if (player1Score > player2Score) {
                const oldHealth = this.currentGame.duelHealth[player2Id];
                const newHealth = Math.max(0, oldHealth - clientDamage);
                
                console.log(`  Player 2 taking damage: ${oldHealth} -> ${newHealth} (-${clientDamage})`);
                
                // DEFENSIVE: Only apply damage if it makes sense
                if (oldHealth > 0) {
                    this.currentGame.duelHealth[player2Id] = newHealth;
                } else {
                }
                
                // Broadcast health update to sync both players
                if (window.multiplayerManager && this.isHost) {
                    const healthUpdate = { 
                    type: 'healthUpdate', 
                    health: { ...this.currentGame.duelHealth },
                    damage: clientDamage,
                    winner: player1Id 
                };
                    // Note: We'd need server support for this, but for now force both clients to sync
                }
            } else if (player2Score > player1Score) {
                const oldHealth = this.currentGame.duelHealth[player1Id];
                const newHealth = Math.max(0, oldHealth - clientDamage);
                
                
                // DEFENSIVE: Only apply damage if it makes sense
                if (oldHealth > 0) {
                    this.currentGame.duelHealth[player1Id] = newHealth;
                } else {
                }
                
                if (window.multiplayerManager && this.isHost) {
                    const healthUpdate = { 
                        type: 'healthUpdate', 
                        health: { ...this.currentGame.duelHealth },
                        damage: clientDamage,
                        winner: player2Id 
                    };
                }
            }
        }
        
        // Check for win condition
        
        if (this.currentGame.duelHealth[player1Id] <= 0) {
            this.currentGame.duelWinner = player2Id;
            
            // Update display to show "View Results" button instead of "Next Round"
            setTimeout(() => {
                this.updateDuelDisplay(); // Update button text to "View Results"
            }, 100);
            
        } else if (this.currentGame.duelHealth[player2Id] <= 0) {
            this.currentGame.duelWinner = player1Id;
            
            setTimeout(() => {
                this.updateDuelDisplay(); // Update button text to "View Results"
            }, 100);
            
        } else {
        }
        
        // Increase multiplier for next round (but not after the first round)
        if (this.currentGame.currentRound > 1) {
            this.currentGame.duelState.roundMultiplier += 0.2; // +0.2x each round after first
        } else {
        }
        
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
        
        // Show custom clash screen first
        this.showClashScreen(player1Score, player2Score, finalDamage, combatResult);
        
        
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
                    animation: clashLeft 1.5s cubic-bezier(0.2, 0, 0.05, 1) both;
                }
                .clash-number.right {
                    animation: clashRight 1.5s cubic-bezier(0.2, 0, 0.05, 1) both;
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
                                <p style="color: #ffd93d; font-weight: bold; font-size: 24px; margin: 5px 0;">#${player1Guess}</p>
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
                                <p style="color: #ffd93d; font-weight: bold; font-size: 24px; margin: 5px 0;">#${player2Guess}</p>
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
                                ${this.currentGame.duelWinner ? 'View Results' : 'Next Round'}
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
        console.log('[DEBUG] handleOpponentScore called with data:', data);
        
        // Handle opponent score submission in duel mode
        if (!this.currentGame.duelState) {
            console.log('[DEBUG] No duel state, returning');
            return;
        }
        
        const scores = data.scores;
        const guesses = data.guesses || {};
        const currentUserId = this.getCurrentUserId();
        
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
        
        // Find opponent's score
        for (const [playerId, score] of Object.entries(scores)) {
            if (playerId !== currentUserId && score !== undefined) {
                
                // Store opponent's score
                this.currentGame.duelState.roundScores[playerId] = score;
                
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
                console.log('[DEBUG] Updating health from server:', data.damageResult.health);
                console.log('[DEBUG] Previous health:', this.currentGame.duelHealth);
                
                this.currentGame.duelHealth = { ...data.damageResult.health };
                
                // Mark that we have server health so we don't overwrite it
                this.currentGame.hasServerHealth = true;
                
                console.log('[DEBUG] New health after server update:', this.currentGame.duelHealth);
                console.log('🟢🟢🟢 SERVER HEALTH APPLIED - hasServerHealth flag set to true');
                
                // CRITICAL: Update the display immediately after receiving server health
                this.updateDuelDisplay();
                console.log('[DEBUG] Called updateDuelDisplay after server health update');
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
        
        // Update health bars (now using 100 HP max)
        const player1Health = this.currentGame.duelHealth[player1Id] || 0;
        const player2Health = this.currentGame.duelHealth[player2Id] || 0;
        
        console.log('🩺 HEALTH MAPPING DEBUG:');
        console.log('  Player 1 ID:', player1Id, '→ Health:', player1Health);
        console.log('  Player 2 ID:', player2Id, '→ Health:', player2Health);
        console.log('  Current User ID:', this.getCurrentUserId());
        console.log('  Am I Player 1?', this.getCurrentUserId() === player1Id);
        console.log('  Am I Player 2?', this.getCurrentUserId() === player2Id);
        console.log('  Full duelHealth object:', this.currentGame.duelHealth);
        console.log('  Available keys in duelHealth:', Object.keys(this.currentGame.duelHealth));
        
        // Check if player IDs match health keys
        const healthKeys = Object.keys(this.currentGame.duelHealth);
        console.log('  Do memberIds match health keys?');
        memberIds.forEach((memberId, index) => {
            const hasHealthKey = healthKeys.includes(memberId);
            console.log(`    Member ${index + 1} (${memberId}): ${hasHealthKey ? '✅ HAS' : '❌ MISSING'} health key`);
        });
        const player1HealthPercent = (player1Health / 100) * 100;
        const player2HealthPercent = (player2Health / 100) * 100;
        
        const player1Bar = document.getElementById('player1Health');
        const player2Bar = document.getElementById('player2Health');
        const player1Value = document.getElementById('player1HealthValue');
        const player2Value = document.getElementById('player2HealthValue');
        
        if (player1Bar) {
            player1Bar.style.width = `${player1HealthPercent}%`;
            // Color coding: green > 50%, yellow 10-50%, red <= 10%
            if (player1Health > 50) {
                player1Bar.style.background = '#4CAF50'; // Green - override gradient
                player1Bar.style.backgroundColor = '#4CAF50';
            } else if (player1Health > 10) {
                player1Bar.style.background = '#FFC107'; // Yellow - override gradient
                player1Bar.style.backgroundColor = '#FFC107';  
            } else {
                player1Bar.style.background = '#F44336'; // Red - override gradient
                player1Bar.style.backgroundColor = '#F44336';
            }
        }
        if (player2Bar) {
            player2Bar.style.width = `${player2HealthPercent}%`;
            // Color coding: green > 50%, yellow 10-50%, red <= 10%
            if (player2Health > 50) {
                player2Bar.style.background = '#4CAF50'; // Green - override gradient
                player2Bar.style.backgroundColor = '#4CAF50';
            } else if (player2Health > 10) {
                player2Bar.style.background = '#FFC107'; // Yellow - override gradient
                player2Bar.style.backgroundColor = '#FFC107';
            } else {
                player2Bar.style.background = '#F44336'; // Red - override gradient
                player2Bar.style.backgroundColor = '#F44336';
            }
        }
        if (player1Value) player1Value.textContent = `${player1Health}/100`;
        if (player2Value) player2Value.textContent = `${player2Health}/100`;
        
        // Show combat result and multiplier info
        if (this.currentGame.lastCombatResult) {
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
        }
    }

    showResult(guess, actual, points) {
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
        document.getElementById('yourGuess').textContent = `#${guess}`;
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
        if (this.currentGame.duelWinner) {
            nextBtn.textContent = 'View Results';
        } else if (this.currentGame.currentRound >= this.currentGame.totalRounds) {
            nextBtn.textContent = 'End Game';
        } else {
            nextBtn.textContent = 'Next Round';
        }
        
        // Hide next round button for non-hosts in multiplayer
        if (this.currentGame.isParty && !this.isHost) {
            nextBtn.style.display = 'none';
            
            // Show waiting message for non-hosts
            const waitingMsg = document.createElement('div');
            waitingMsg.id = 'waitingForHost';
            waitingMsg.style.cssText = 'text-align: center; padding: 10px; color: #888; font-style: italic;';
            waitingMsg.textContent = 'Waiting for host to advance to next round...';
            nextBtn.parentNode.insertBefore(waitingMsg, nextBtn.nextSibling);
        } else if (this.currentGame.isParty) {
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
        console.log('[DEBUG] Next round called - isParty:', this.currentGame?.isParty, 'isHost:', this.isHost);
        this.logGameState('Next round');
        // For multiplayer games, only host can advance rounds
        if (this.currentGame.isParty) {
            if (this.isHost && window.multiplayerManager) {
                console.log('[DEBUG] Host advancing to next round via multiplayer manager');
                window.multiplayerManager.nextRound(this.currentGame.currentRound);
            } else if (!this.isHost) {
                return; // Non-hosts can't advance rounds
            }
        } else {
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
        document.getElementById('finalScore').textContent = finalScore;
        
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
                        Guess: #${round.guess} | Actual: #${round.actual} | Points: ${round.points}
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
                leaderboardBtn.className = 'share-btn';
                leaderboardBtn.textContent = 'Daily Leaderboard';
                leaderboardBtn.onclick = () => this.showDailyLeaderboard();
                resultsButtons.insertBefore(leaderboardBtn, resultsButtons.firstChild);
            }
        }
        
        this.showScreen('resultsScreen');
    }

    showPartyResults(roundSummary) {
        const gameType = this.currentGame.gameType;
        
        if (gameType === 'ffa') {
            // FFA: Show individual leaderboard with real party members
            const playerScores = this.currentParty.members.map(member => {
                const isHost = member.id === 'host';
                const baseScore = isHost ? this.currentGame.score : Math.floor(this.currentGame.score * (0.6 + Math.random() * 0.4));
                return {
                    name: isHost ? (localStorage.getItem('username') || 'You') : member.name.replace(' (Host)', ''),
                    score: baseScore,
                    isYou: isHost
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
                                <div>Your Guess: #${round.guess} | Actual: #${round.actual} | Points: ${round.points}</div>
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
                                <div>Your Guess: #${round.guess} | Actual: #${round.actual} | Points: ${round.points}</div>
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
            
            if (myHealth > 0 && opponentHealth <= 0) {
                winMessage = '🏆 Victory! You defeated your opponent!';
                this.currentGame.duelWinner = currentUserId;
                youWon = true;
            } else if (myHealth <= 0 && opponentHealth > 0) {
                winMessage = '💀 Defeat! Your opponent overwhelmed you!';
                this.currentGame.duelWinner = isPlayer1 ? player2Id : player1Id;
                opponentWon = true;
            } else if (myHealth <= 0 && opponentHealth <= 0) {
                winMessage = '⚔️ Battle ended in a draw!';
            } else {
                // Both still have health - shouldn't happen at game end
                winMessage = '⚔️ Battle continues...';
            }
            
            roundSummary.innerHTML = `
                <div class="party-results">
                    <h3>Duel Results</h3>
                    <div class="duel-victory-message">
                        <h2>${winMessage}</h2>
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
                                <span class="player-score">Opponent Score</span>
                            </div>
                        </div>
                    </div>
                    <div class="rounds-summary">
                        <h4>Your Performance</h4>
                        ${this.currentGame.rounds.map((round, index) => `
                            <div class="round-item">
                                <div><strong>Round ${index + 1}:</strong> ${round.demon.name}</div>
                                <div>Your Guess: #${round.guess} | Actual: #${round.actual} | Points: ${round.points}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }
    }

    playAgain() {
        this.showScreen('gameSetupScreen');
    }

    shareResults() {
        const text = `I scored ${this.currentGame.score} points in DemonList Guessr!\n` +
                    `Mode: ${this.currentGame.mode}\n` +
                    `Perfect guesses: ${this.currentGame.rounds.filter(r => r.points === 100).length}/${this.currentGame.totalRounds}`;
        
        if (navigator.share) {
            navigator.share({ text: text });
        } else {
            navigator.clipboard.writeText(text);
            alert('Results copied to clipboard!');
        }
    }

    quitGame() {
        if (confirm('Are you sure you want to quit the current game?')) {
            this.showScreen('homeScreen');
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
}

// Enable detailed debug logging with: localStorage.setItem('debug', 'true')
// Disable with: localStorage.removeItem('debug')
const game = new DemonListGuessr();
