
class DemonListGuessr {
    constructor() {
        console.log('[DEBUG] DemonListGuessr constructor starting');
        
        // Virtual routing system
        this.currentRoute = 'hub';  // 'hub' or 'game'
        this.setupRouting();
        this.demons = [];
        this.consolidatedList = [];
        this.apiList = [];
        this.finalList = [];
        this.blacklistedDemons = [];
        this.currentGame = null;
        this.currentParty = null;
        this.isHost = false;
        this.hasLeftGame = false;  // Flag to prevent events after leaving
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
            this.checkForPartyInvite();
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
        
        // Make game object available globally for direct multiplayer updates
        window.game = this;
        try {
            // Load consolidated local data first
            console.log('🔄 [STARTUP] Verifying demon list...');
            console.log('[DEBUG] Fetching consolidated demon data');
            const consolidatedResponse = await fetch('data/demons_consolidated.json');
            this.consolidatedList = await consolidatedResponse.json();
            console.log(`✅ Loaded ${this.consolidatedList.length} demons from AREDL consolidated data`);

            // Store metadata
            this.listMetadata = {
                totalDemons: this.consolidatedList.length,
                source: 'AREDL + Pointercrate',
                lastVerified: new Date().toISOString(),
                apiStatus: 'checking...'
            };

            // Fetch API data for positions 1-200 to verify/update
            console.log('🌐 [STARTUP] Verifying top 200 demons with Pointercrate API...');
            const apiPromises = [];

            // Main List (1-75)
            apiPromises.push(
                fetch('https://pointercrate.com/api/v2/demons/listed?limit=75')
                    .then(r => r.json())
                    .catch(e => {
                        console.error('⚠️ Error fetching main list:', e);
                        return [];
                    })
            );

            // Extended List (76-150)
            apiPromises.push(
                fetch('https://pointercrate.com/api/v2/demons/listed?limit=75&after=75')
                    .then(r => r.json())
                    .catch(e => {
                        console.error('⚠️ Error fetching extended list:', e);
                        return [];
                    })
            );

            // First 50 of Legacy List (151-200)
            apiPromises.push(
                fetch('https://pointercrate.com/api/v2/demons/listed?limit=50&after=150')
                    .then(r => r.json())
                    .catch(e => {
                        console.error('⚠️ Error fetching legacy list API:', e);
                        return [];
                    })
            );

            const apiResults = await Promise.all(apiPromises);
            this.apiList = apiResults.flat();

            if (this.apiList.length > 0) {
                console.log(`✅ Verified ${this.apiList.length} demons from Pointercrate API`);
                this.listMetadata.apiStatus = 'connected';
                this.listMetadata.apiDemons = this.apiList.length;
            } else {
                console.log('⚠️ Could not connect to Pointercrate API - using local data');
                this.listMetadata.apiStatus = 'offline (using cached data)';
            }

            // Merge data
            this.mergeData();

            // Log final verification summary
            const demonsWithVideos = this.finalList.filter(d => d.video);
            const mainListVideos = demonsWithVideos.filter(d => d.position <= 75).length;
            const extendedListVideos = demonsWithVideos.filter(d => d.position > 75 && d.position <= 150).length;
            const legacyListVideos = demonsWithVideos.filter(d => d.position > 150).length;

            console.log('═══════════════════════════════════════════════════');
            console.log('✅ DEMON LIST VERIFIED');
            console.log(`📊 Total demons: ${this.finalList.length}`);
            console.log(`🌐 API Status: ${this.listMetadata.apiStatus}`);
            console.log(`📹 Playable demons (with videos): ${demonsWithVideos.length}`);
            console.log(`   • Main List (1-75): ${mainListVideos}/75`);
            console.log(`   • Extended (76-150): ${extendedListVideos}/75`);
            console.log(`   • Legacy (151+): ${legacyListVideos}/${this.finalList.length - 150}`);
            console.log(`⏰ Last verified: ${new Date().toLocaleString()}`);
            console.log('═══════════════════════════════════════════════════');

            // Update UI status banner
            this.updateListStatusBanner();
            
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

        console.log('🔀 [MERGE] Combining API and local data...');

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
            console.log(`  ✅ Added ${this.apiList.length} demons from Pointercrate API (positions 1-200)`);

            // Add consolidated demons that aren't in API range
            const apiPositions = new Set(this.apiList.map(d => d.position));
            let localCount = 0;
            for (const demon of this.consolidatedList) {
                if (!apiPositions.has(demon.position) && demon.position > 200) {
                    merged.push(demon);
                    localCount++;
                }
            }
            console.log(`  ✅ Added ${localCount} demons from AREDL data (positions 201+)`);
        } else {
            // No API data, use consolidated list
            merged.push(...this.consolidatedList);
            console.log(`  ⚠️ Using all ${this.consolidatedList.length} demons from local data (API unavailable)`);
        }

        // Sort by position
        merged.sort((a, b) => a.position - b.position);
        this.finalList = merged;
        this.demons = merged; // Also set demons for backward compatibility

        console.log(`  📋 Final merged list: ${this.finalList.length} demons`);
    }

    updateListStatusBanner() {
        const banner = document.getElementById('listStatusBanner');
        const statusText = document.getElementById('listStatus');
        const icon = banner?.querySelector('.status-icon');

        if (!banner || !statusText || !icon) return;

        const demonsWithVideos = this.finalList.filter(d => d.video).length;
        const apiConnected = this.listMetadata?.apiStatus === 'connected';

        if (apiConnected) {
            banner.classList.remove('offline');
            banner.classList.add('verified');
            icon.textContent = '✅';
            statusText.textContent = `${demonsWithVideos} playable demons (${this.finalList.length} total) • API connected`;
        } else {
            banner.classList.remove('verified');
            banner.classList.add('offline');
            icon.textContent = '⚠️';
            statusText.textContent = `${demonsWithVideos} playable demons (${this.finalList.length} total) • Using cached data`;
        }
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
        console.log('🎥 [VIDEO FIX] loadYouTubeVideo called with videoId:', videoId);
        
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
            console.error('🚫 [VIDEO FIX] No valid video ID provided:', videoId);
            const playerDiv = document.getElementById('youtubePlayer');
            playerDiv.innerHTML = '<div style="color: white; text-align: center; line-height: 400px; background: var(--surface);">No video available for this demon</div>';
            return;
        }
        
        console.log('🎥 [VIDEO FIX] Loading video:', videoId);
        const playerDiv = document.getElementById('youtubePlayer');
        
        // CRITICAL FIX: Check if YouTube API is available before attempting to create player
        if (typeof YT === 'undefined' || typeof YT.Player === 'undefined') {
            console.warn('⏳ [VIDEO FIX] YouTube API not ready - waiting...');
            playerDiv.innerHTML = `<div style="color: white; text-align: center; line-height: 400px; background: var(--surface);">
                <p>Loading video...</p>
                <p>Video ID: ${videoId}</p>
            </div>`;
            
            // Wait for YouTube API to be ready
            let retryCount = 0;
            const maxRetries = 10;
            const retryInterval = setInterval(() => {
                retryCount++;
                if (typeof YT !== 'undefined' && YT.Player) {
                    clearInterval(retryInterval);
                    console.log('✅ [VIDEO FIX] YouTube API now ready - loading video');
                    this.loadYouTubeVideo(videoId); // Retry loading
                } else if (retryCount >= maxRetries) {
                    clearInterval(retryInterval);
                    console.error('🚫 [VIDEO FIX] YouTube API failed to load after 5 seconds');
                    console.error('🚫 [VIDEO FIX] This is likely due to ad blocker or browser extension blocking YouTube');
                    playerDiv.innerHTML = `<div style="color: white; text-align: center; padding: 20px; background: var(--surface);">
                        <p style="color: #ff6b6b; font-weight: bold;">YouTube Player Blocked</p>
                        <p style="margin: 10px 0;">Unable to load video (possibly blocked by ad blocker)</p>
                        <p style="margin: 10px 0;">Video ID: ${videoId}</p>
                        <a href="https://youtube.com/watch?v=${videoId}" target="_blank" style="color: #00ff00; text-decoration: underline;">Watch on YouTube →</a>
                        <p style="margin-top: 20px; font-size: 12px; color: #999;">Try disabling ad blocker for this site</p>
                    </div>`;
                }
            }, 500);
            return;
        }
        
        if (this.ytPlayer && this.ytPlayer.loadVideoById) {
            try {
                this.ytPlayer.loadVideoById(videoId);
            } catch (error) {
                console.error('🚫 [VIDEO FIX] Error reusing player:', error);
                this.createNewYouTubePlayer(playerDiv, videoId);
            }
        } else {
            console.log('🆕 [VIDEO FIX] Creating new YouTube player');
            this.createNewYouTubePlayer(playerDiv, videoId);
        }
    }
    
    createNewYouTubePlayer(playerDiv, videoId) {
        try {
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
                },
                events: {
                    'onReady': (event) => {
                        console.log('✅ [VIDEO FIX] YouTube player ready for video:', videoId);
                    },
                    'onError': (event) => {
                        console.error('🚫 [VIDEO FIX] YouTube player error:', event.data);
                        playerDiv.innerHTML = `<div style="color: white; text-align: center; line-height: 400px; background: var(--surface);">
                            <p>Error loading video</p>
                            <p>Video ID: ${videoId}</p>
                            <a href="https://youtube.com/watch?v=${videoId}" target="_blank" style="color: #00ff00;">Watch on YouTube</a>
                        </div>`;
                    }
                }
            });
        } catch (error) {
            console.error('🚫 [VIDEO FIX] Error creating YouTube player:', error);
            playerDiv.innerHTML = `<div style="color: white; text-align: center; line-height: 400px; background: var(--surface);">
                <p>Failed to create video player</p>
                <p>Video ID: ${videoId}</p>
                <a href="https://youtube.com/watch?v=${videoId}" target="_blank" style="color: #00ff00;">Watch on YouTube</a>
            </div>`;
        }
    }
    
    loadYouTubeAPI() {
        if (!document.getElementById('youtube-api-script')) {
            const script = document.createElement('script');
            script.id = 'youtube-api-script';
            script.src = 'https://www.youtube.com/iframe_api';
            document.head.appendChild(script);
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

            // CRITICAL: For video modes, only include demons with videos
            // For thumbnail mode, we can include demons without videos
            if (gameMode !== 'thumbnail' && !demon.video) {
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
            console.log('✅ [VIDEO FIX] YouTube API ready');
            this.youtubeAPIReady = true;
        };
        
        // Also check if API is already loaded
        if (typeof YT !== 'undefined' && YT.Player) {
            console.log('✅ [VIDEO FIX] YouTube API already loaded');
            this.youtubeAPIReady = true;
        }
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
            
            // CRITICAL: Update the waiting screen submission count when another player submits
            this.updateFFAWaitingCount();
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

            // Show opponent submitted notification (not full overlay)
            this.showOpponentSubmittedNotification();

            // Start countdown for us to submit
            this.startDuelCountdown(currentUserId);
        }

        // If we already submitted and opponent just submitted, cancel countdown and trigger clash
        if (data.playerId !== currentUserId && this.currentGame.duelState.roundScores[currentUserId] !== undefined) {
            console.log('📨 Both players submitted - cancelling countdown and triggering clash');

            // Cancel the duel countdown we started while waiting
            if (this.currentGame.duelState.countdown) {
                clearTimeout(this.currentGame.duelState.countdown);
                this.currentGame.duelState.countdown = null;
            }
            if (this.currentGame.duelState.countdownInterval) {
                clearInterval(this.currentGame.duelState.countdownInterval);
                this.currentGame.duelState.countdownInterval = null;
            }

            // Trigger clash if not already in progress
            if (!this.currentGame.duelState.clashReady && !this.currentGame.duelState.clashInProgress) {
                this.currentGame.duelState.clashReady = true;
                setTimeout(() => {
                    this.triggerDuelClash();
                }, 200);
            }
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
    
    cleanupGameUI() {
        
        // CRITICAL FIX: Clear any existing timers to prevent flickering
        if (this.currentTimer) {
            clearInterval(this.currentTimer);
            this.currentTimer = null;
        }
        
        // Clear any countdown timers from duel state
        if (this.currentGame?.duelState?.countdown) {
            clearTimeout(this.currentGame.duelState.countdown);
            this.currentGame.duelState.countdown = null;
        }
        if (this.currentGame?.duelState?.countdownInterval) {
            clearInterval(this.currentGame.duelState.countdownInterval);
            this.currentGame.duelState.countdownInterval = null;
        }
        
        // CRITICAL FIX: Remove opponent submitted notifications
        const opponentNotifications = document.querySelectorAll('.opponent-submitted-notification');
        opponentNotifications.forEach(notification => {
            notification.remove();
        });
        
        // Remove all game overlays
        const overlaysToRemove = [
            'ffaWaitingOverlay',
            'duelWaitingOverlay',
            'clashScreen',
            'detailedDuelResults',
            'ffaRevealScreen'
        ];
        
        overlaysToRemove.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.remove();
            }
        });
        
        // Also remove any lingering overlays with generic selectors
        document.querySelectorAll('[id*="duel"], [id*="clash"], [id*="waiting"], [id*="reveal"]').forEach(overlay => {
            if (overlay.style.position === 'fixed' && overlay.style.zIndex > 1000) {
                overlay.remove();
            }
        });
        
        // Reset timer display
        const timerDisplay = document.getElementById('timerDisplay');
        if (timerDisplay) {
            timerDisplay.style.display = 'none';
            timerDisplay.textContent = '';
        }
        
        console.log('✅ [CLEANUP] Game UI cleanup complete');
    }

    handleNextRoundStarted(data) {
        console.log('[CLIENT] Current game state:', {
            currentRound: this.currentGame?.currentRound,
            totalRounds: this.currentGame?.totalRounds,
            gameType: this.currentGame?.gameType,
            isHost: this.isHost
        });
        
        // Prevent handling next round if user has quit
        if (this.userHasQuit) {
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
            ffaRevealScreen.remove();
        }
        
        // Also remove FFA waiting overlay if it exists
        const ffaWaitingOverlay = document.getElementById('ffaWaitingOverlay');
        if (ffaWaitingOverlay) {
            ffaWaitingOverlay.remove();
        }
        
        // Force hide result section to ensure clean transition
        const resultSection = document.getElementById('resultSection');
        if (resultSection && resultSection.style.display !== 'none') {
            resultSection.style.display = 'none';
        }
        
        // Force next round for all players
        this.stopCurrentVideo();
        
        // Synchronize client round counter with server
        if (data.round && this.currentGame) {
            console.log('[CLIENT] Synchronizing round counter:', {
                clientRound: this.currentGame.currentRound,
                serverRound: data.round,
                totalRounds: this.currentGame.totalRounds
            });
            // Set to server round directly - startNewRound will NOT increment because we're in multiplayer
            this.currentGame.currentRound = data.round;
        }
        
        // CRITICAL: Sync health data from party to game to prevent HP bar movement
        if (data.party && data.party.duelHealth && this.currentGame && this.currentGame.gameType === 'duels') {
            
            // CRITICAL FIX: Apply any pending health first before syncing new health
            if (this.currentGame.pendingDuelHealth) {
                this.currentGame.duelHealth = { ...this.currentGame.pendingDuelHealth };
                this.currentGame.pendingDuelHealth = null;
            }
            
            this.currentGame.duelHealth = { ...data.party.duelHealth };
            
            // CRITICAL FIX: Don't check for victory conditions when starting a new round!
            // Victory conditions should only be checked when receiving scores, not when starting rounds
            console.log('[HEALTH SYNC] Skipping victory check during round start - victory is determined by server');
            
            // CRITICAL FIX: At round start, just display correct values without animation
            if (this.currentGame.healthJustAnimated) {
                console.log('[HEALTH SYNC] Health animated after clash - skipping round start animation');
                this.currentGame.healthJustAnimated = false; // Clear the flag
                // Health is already correct from clash animation, no need to update display
            } else {
                console.log('[HEALTH SYNC] Updating display with synced health values (no animation expected)');
                this.updateDuelDisplay();
                
                // Force update health bars for ALL rounds when starting
                console.log('[HEALTH-DEBUG] 🔄 ROUND START - applying health update');
                console.log('[HEALTH-DEBUG] Round number:', data.round);
                console.log('[HEALTH-DEBUG] Health from server:', JSON.stringify(data.party.duelHealth));
                
                // Always update health bars when starting a round
                setTimeout(() => {
                    console.log('[HEALTH-DEBUG] 🔄 Calling forceHealthBarUpdate for round', data.round);
                    this.forceHealthBarUpdate();
                }, 100);
            }
        }
        
        // CRITICAL: Sync multiplier from server to ensure UI displays correct value
        if (data.multiplier !== undefined && this.currentGame && this.currentGame.duelState) {
            this.currentGame.duelState.roundMultiplier = data.multiplier;
        }
        
        // Check for duel winner first - show final results instead of generic end game
        if (this.currentGame.duelWinner) {
            this.showDuelFinalResults();
            return;
        }
        
        // For duels, never end based on round count - only end when someone hits 0 HP
        if (this.currentGame.gameType === 'duels') {
            this.startNewRound();
        } else if (this.currentGame.currentRound > this.currentGame.totalRounds) {
            this.endGame();
        } else {
            this.startNewRound();
        }
    }

    connectToMultiplayer() {
        console.log('[DEBUG] Attempting to connect to multiplayer');
        
        // HEURISTIC FIX: Set up connection timeout and recovery
        this.connectionTimeout = setTimeout(() => {
            console.warn('[HEURISTIC] Multiplayer connection timeout - forcing cleanup');
            this.handleConnectionFailure();
        }, 10000); // 10 second timeout
        
        // Ensure multiplayer manager is connected
        if (window.multiplayerManager) {
            console.log('[DEBUG] Multiplayer manager found, setting up connection');
            // Set up the connection callback to re-register event handlers
            window.multiplayerManager.onConnected = () => {
                console.log('[DEBUG] Multiplayer connected callback triggered');
                clearTimeout(this.connectionTimeout);
                this.setupMultiplayerCallbacks();
            };
            
            console.log('[DEBUG] Initiating multiplayer connection');
            window.multiplayerManager.connect();
            
            // Also register callbacks immediately in case already connected
            if (window.multiplayerManager.connected) {
                console.log('[DEBUG] Multiplayer already connected, setting up callbacks');
                clearTimeout(this.connectionTimeout);
                this.setupMultiplayerCallbacks();
            }
        } else {
            console.warn('[DEBUG] Multiplayer manager not found, will retry in 1 second');
            setTimeout(() => this.connectToMultiplayer(), 1000);
        }
    }

    autoCompleteRoundOnDisconnect() {
        console.log('[HEURISTIC] Auto-completing round due to disconnect');
        
        if (!this.currentGame?.pendingResults) {
            console.warn('[HEURISTIC] No pending results to auto-complete with');
            this.handleConnectionFailure();
            return;
        }
        
        // Simulate receiving round results with our pending data
        const fakeRoundResult = {
            damage: 0, // No damage since host disconnected
            duelHealth: this.currentGame.duelHealth || {},
            scores: {},
            guesses: {},
            demon: { name: 'Connection Lost', actualPosition: 0 },
            completedByLeave: true,
            hostDisconnected: true
        };
        
        // Add our pending guess to the fake result
        if (this.currentGame.pendingResults) {
            const currentUserId = this.getCurrentUserId();
            fakeRoundResult.scores[currentUserId] = this.currentGame.pendingResults.score;
            fakeRoundResult.guesses[currentUserId] = this.currentGame.pendingResults.guess;
        }
        
        console.log('[HEURISTIC] Simulating round completion with fake data:', fakeRoundResult);
        
        // Show a brief "completing round" message
        this.showNotification('Host disconnected. Completing round...', 'info');
        
        // Simulate the round ending and show results
        setTimeout(() => {
            this.handleRoundCompleted(fakeRoundResult);
            
            // After showing results, provide option to return home
            setTimeout(() => {
                this.showNotification('Host disconnected. Click anywhere to return to menu.', 'warning');
                
                // Auto-return to home after 10 seconds if no interaction
                setTimeout(() => {
                    if (this.hasLeftGame) {
                        this.handleConnectionFailure();
                    }
                }, 10000);
            }, 3000);
        }, 1500);
    }

    handleForcePartyRefresh(data) {
        console.log('🔄 [FORCE REFRESH] Forcing complete visual update for reason:', data.reason);
        
        // SOLUTION 1: Preserve host status during force refresh
        const wasHost = this.isHost;
        const wasMultiplayerHost = window.multiplayerManager?.isHost;
        
        // Update party data
        this.currentParty = data.party;
        
        // Keep existing host status unless explicitly changed
        this.isHost = wasHost;
        if (window.multiplayerManager) {
            window.multiplayerManager.isHost = wasMultiplayerHost;
        }
        console.log('🔄 [FORCE REFRESH] Preserving host status:', this.isHost);
        
        // Force complete visual update
        if (document.getElementById('partySetupScreen')?.classList.contains('active')) {
            // Always update party display when we get a force refresh
            this.updatePartyDisplay();
            
            // Update visual based on game type
            if (this.currentParty.gameType === 'ffa') {
                this.updateFFAVisual();
                // Multiple updates to ensure it sticks
                setTimeout(() => this.updateFFAVisual(), 50);
                setTimeout(() => this.updateFFAVisual(), 100);
            } else if (this.currentParty.gameType === 'teams') {
                this.updateTeamsVisual();
            } else if (this.currentParty.gameType === 'duels') {
                this.updateDuelsVisual();
            }
            
            // Update title based on game type
            const partyTitle = document.querySelector('#partySetupScreen h2');
            if (partyTitle && data.party.gameType) {
                if (data.party.gameType === 'duels') {
                    partyTitle.textContent = '1v1 Duel';
                } else if (data.party.gameType === 'teams') {
                    partyTitle.textContent = 'Teams';
                } else {
                    partyTitle.textContent = 'Free For All';
                }
                console.log('🔄 [FORCE REFRESH] Updated title to:', partyTitle.textContent);
            }
            
            // Force update all visuals
            this.updatePartyGameTypeVisuals();
            this.updatePartyDisplay();
            this.updatePartyVisual();
            
            if (data.party.gameType === 'duels') {
                this.updateDuelsVisual();
            }
            
            console.log('🔄 [FORCE REFRESH] Complete visual update finished');
        }
    }

    handleConnectionFailure() {
        console.warn('[HEURISTIC] Handling connection failure - resetting game state');
        
        // Clear any stale party state
        this.currentParty = null;
        this.currentGame = null;
        this.isHost = false;
        this.hasLeftGame = false;
        
        // Force return to home screen
        this.showScreen('homeScreen');
        
        // Show user-friendly message
        this.showNotification('Connection lost. Returned to main menu.', 'warning');
        
        // Clear URL parameters
        const newUrl = window.location.pathname;
        window.history.replaceState({}, '', newUrl);
        
        console.log('[HEURISTIC] Game state reset complete');
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
            this.handleOpponentScore(data);
        };
        
        window.multiplayerManager.onGameStarted = (data) => {
            this.handleMultiplayerGameStart(data);
        };
        
        window.multiplayerManager.onPartyUpdated = (party) => {
            this.handlePartyUpdate(party);
            
            // Immediate nuclear FFA update if needed
            if (party.gameType === 'ffa' && 
                document.getElementById('partySetupScreen')?.classList.contains('active')) {
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

        window.multiplayerManager.onDuelViewSummary = (data) => {
            console.log('📊 [CLIENT] Host requested final results screen');
            this.handleShowFinalResults(data);
        };

        window.multiplayerManager.onMemberLeft = (data) => {
            this.handleMemberLeft(data);
        };
        
        // SOLUTION 1: Handle forced party refresh from server
        window.multiplayerManager.onForcePartyRefresh = (data) => {
            console.log('🔄 [FORCE REFRESH] Received forced party refresh:', data.reason);
            this.handleForcePartyRefresh(data);
        };
        
        window.multiplayerManager.onMemberJoined = (data) => {
            this.handleMemberJoined(data);
        };
        
        window.multiplayerManager.onPlayersUpdate = (data) => {
            this.handlePlayersUpdate(data);
        };
        
        window.multiplayerManager.onForceResultsScreen = (data) => {
            this.handleForceResultsScreen(data);
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
            console.log('[CLIENT-1] Game finished - bringing player to results screen:', data);
            console.log('[CLIENT-1] This is host?', this.isHost);
            console.log('[CLIENT-1] Socket ID:', window.multiplayerManager?.socket?.id);
            console.log('[CLIENT-1] About to call handleGameFinished');
            
            try {
                this.handleGameFinished(data);
            } catch (error) {
                console.error('🏁 [CLIENT-1] ❌ handleGameFinished failed:', error);
            }
            
        };
        
        window.multiplayerManager.onGameFinished = gameFinishedCallback;
        
        // Verify callback was set
        console.log('✅ [CALLBACK-1] Callback set. Verification:', {
            callbackExists: typeof window.multiplayerManager.onGameFinished === 'function',
            callbackMatches: window.multiplayerManager.onGameFinished === gameFinishedCallback
        });
        
        // Set up monitoring to detect if callback gets overridden
        setTimeout(() => {
            console.log('[CALLBACK-1] 1-second check - callback still exists:', 
                typeof window.multiplayerManager?.onGameFinished === 'function',
                'matches original:', window.multiplayerManager?.onGameFinished === gameFinishedCallback
            );
        }, 1000);
        
        setTimeout(() => {
            console.log('[CALLBACK-1] 5-second check - callback still exists:', 
                typeof window.multiplayerManager?.onGameFinished === 'function',
                'matches original:', window.multiplayerManager?.onGameFinished === gameFinishedCallback
            );
        }, 5000);
    }

    handlePartyCreated(data) {
        console.log('🎉 [HANDLE PARTY CREATED] ========== PARTY CREATED ==========');
        console.log('[HANDLE PARTY CREATED] handlePartyCreated called with data:', data);
        console.log('[HANDLE PARTY CREATED] Full party object from server:', JSON.stringify(data.party, null, 2));
        console.log('[HANDLE PARTY CREATED] Party gameType:', data.party?.gameType);
        console.log('[HANDLE PARTY CREATED] Party members:', data.party?.members);
        console.log('[HANDLE PARTY CREATED] Party created successfully:', {
            partyCode: data.code,
            hostId: data.party.host,
            myId: window.multiplayerManager?.getSocketId()
        });

        // CRITICAL: Clear ALL previous party/game state before setting up new party
        console.log('[HANDLE PARTY CREATED] Clearing all previous state...');
        console.log('[HANDLE PARTY CREATED] OLD currentParty gameType:', this.currentParty?.gameType);
        this.currentGame = null;
        this.hasLeftGame = false;

        // Clear any stale UI elements
        const existingNotification = document.getElementById('gameNotification');
        if (existingNotification) {
            existingNotification.remove();
        }

        console.log('🔴 [DEBUG-HOST] BEFORE setting host in handlePartyCreated:', {
            'this.isHost': this.isHost,
            'multiplayerManager.isHost': window.multiplayerManager?.isHost
        });

        this.currentParty = data.party;
        console.log('[HANDLE PARTY CREATED] NEW currentParty gameType after assignment:', this.currentParty.gameType);
        this.isHost = true;

        console.log('🟢 [DEBUG-HOST] AFTER setting host in handlePartyCreated:', {
            'this.isHost': this.isHost,
            'multiplayerManager.isHost': window.multiplayerManager?.isHost
        });

        // CRITICAL: Also set host status in multiplayer manager
        if (window.multiplayerManager) {
            window.multiplayerManager.isHost = true;
            console.log('[HANDLE PARTY CREATED] Set multiplayerManager.isHost = true');
        }

        // Update URL to game route
        console.log('[HANDLE PARTY CREATED] Calling navigateToGame with code:', data.code);
        this.navigateToGame(data.code);

        console.log('[HANDLE PARTY CREATED] Calling showScreen(partySetupScreen)');
        this.showScreen('partySetupScreen');
        console.log('[HANDLE PARTY CREATED] showScreen completed, setting party code');
        document.getElementById('partyCode').textContent = data.code;
        console.log('[HANDLE PARTY CREATED] Party code set to:', data.code);
        
        // Apply host/non-host restrictions (host gets full access)
        this.applyHostRestrictions();

        // CRITICAL: Ensure the visual display container is visible (clearPartyUI may have hidden it)
        const partyVisualDisplay = document.getElementById('partyVisualDisplay');
        if (partyVisualDisplay) {
            console.log('[HANDLE PARTY CREATED] Making partyVisualDisplay visible');
            partyVisualDisplay.style.display = 'block';
        }

        // CRITICAL: Force update visual displays multiple times to ensure stale UI is cleared
        console.log('[HANDLE PARTY CREATED] Forcing visual updates...');
        this.updatePartyGameTypeVisuals();
        this.updatePartyVisual();

        // Force again after a short delay to override any stale state
        setTimeout(() => {
            console.log('[HANDLE PARTY CREATED] Second visual update pass...');
            this.updatePartyGameTypeVisuals();
            this.updatePartyVisual();

            // Force update the specific game mode visual
            if (this.currentParty.gameType === 'ffa') {
                this.rebuildFFADisplay();
            } else if (this.currentParty.gameType === 'duels') {
                console.log('[HANDLE PARTY CREATED] Updating duels visual...');
                this.updateDuelsVisual();
            }
        }, 50);

        // 🔥 NUCLEAR: Simple immediate update
        if (this.currentParty.gameType === 'ffa') {
            this.rebuildFFADisplay();
            this.startFFAAutoFix(); // Start auto-fix monitoring
        } else if (this.currentParty.gameType === 'duels') {
            console.log('[HANDLE PARTY CREATED] Initial duels visual update...');
            this.updateDuelsVisual();
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
        console.log('[CLIENT] Successfully joined party:', {
            partyCode: party.code,
            memberCount: party.members.length,
            gameType: party.gameType,
            hostId: party.host,
            myId: window.multiplayerManager?.getSocketId()
        });
        
        console.log('🔴 [DEBUG-HOST] BEFORE handlePartyJoined processing:', {
            'this.isHost': this.isHost,
            'multiplayerManager.isHost': window.multiplayerManager?.isHost,
            'party.host': party.host,
            'mySocketId': window.multiplayerManager?.getSocketId()
        });
        
        this.currentParty = party;
        // Check if current user is the host by comparing socket IDs
        const mySocketId = window.multiplayerManager?.getSocketId();
        const calculatedIsHost = party.host === mySocketId;
        
        console.log('🟡 [DEBUG-HOST] Host calculation in handlePartyJoined:', {
            'calculatedIsHost': calculatedIsHost,
            'currentIsHost': this.isHost,
            'willOverride': !this.isHost && calculatedIsHost ? 'YES' : 'NO'
        });
        
        this.isHost = party.host === mySocketId;
        
        // CRITICAL: Also set host status in multiplayer manager
        if (window.multiplayerManager) {
            window.multiplayerManager.isHost = this.isHost;
            console.log('[CLIENT] Set multiplayerManager.isHost =', this.isHost);
        }
        
        console.log('[CLIENT] Joined party as', this.isHost ? 'host' : 'non-host');
        
        // Update URL to game route
        this.navigateToGame(party.code);
        
        
        this.showScreen('partySetupScreen');
        document.getElementById('partyCode').textContent = party.code;
        
        // Apply host/non-host restrictions
        this.applyHostRestrictions();
        
        // Update visual displays
        this.updatePartyGameTypeVisuals();
        this.updatePartyVisual();
        
        // Force visual update for joined party with delay to ensure DOM is ready
        console.log('🎨 [CLIENT] Force updating visual for joined party, gameType:', party.gameType);
        
        // CRITICAL FIX: Force update the title to match game type
        setTimeout(() => {
            const partyTitle = document.querySelector('#partySetupScreen h2');
            if (partyTitle && party.gameType) {
                console.log('🎨 [TITLE FIX] Updating title for gameType:', party.gameType);
                if (party.gameType === 'duels') {
                    partyTitle.textContent = '1v1 Duel';
                } else if (party.gameType === 'teams') {
                    partyTitle.textContent = 'Teams';
                } else {
                    partyTitle.textContent = 'Free For All';
                }
            }
            
            // Also force update the visuals
            this.updatePartyGameTypeVisuals();
            if (party.gameType === 'duels') {
                this.updateDuelsVisual();
            }
        }, 100);
        
        // Direct call to updatePartyDisplay to ensure member list is updated
        this.updatePartyDisplay();
        
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
            
            // Another updatePartyDisplay call after visual updates
            this.updatePartyDisplay();
        }, 100);
    }

    applyHostRestrictions() {
        console.log('🔐 [CLIENT] Applying host restrictions, isHost:', this.isHost);
        console.log('🔵 [DEBUG-HOST] applyHostRestrictions called with:', {
            'this.isHost': this.isHost,
            'multiplayerManager.isHost': window.multiplayerManager?.isHost,
            'currentParty': this.currentParty?.code,
            'socketId': window.multiplayerManager?.getSocketId(),
            'partyHost': this.currentParty?.host,
            'stackTrace': new Error().stack.split('\n').slice(1, 4).join(' -> ')
        });
        
        // 🔧 CRITICAL SYNC FIX: Ensure host status consistency
        // IMPORTANT: multiplayerManager has the source of truth from server!
        if (window.multiplayerManager) {
            if (this.isHost !== window.multiplayerManager.isHost) {
                console.warn('🔧 [SYNC] Host status mismatch in applyHostRestrictions!');
                console.warn('🔧 [SYNC] game.isHost =', this.isHost, 'multiplayerManager.isHost =', window.multiplayerManager.isHost);
                // FIX: Trust the multiplayer manager (source of truth from server)
                this.isHost = window.multiplayerManager.isHost;
                console.log('🔧 [SYNC] SYNCED: game.isHost corrected to', this.isHost);
            }
        }
        
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

        // Set the winner from server data
        this.currentGame.duelWinner = data.winner;

        // Always use server's finalHealth — it's authoritative for the victory state
        if (data.finalHealth) {
            this.currentGame.duelHealth = { ...data.finalHealth };
            this.currentGame.pendingHealthUpdate = { ...data.finalHealth };
        }

        console.log('🏆 [CLIENT] Duel ended - Winner:', data.winner);
        console.log('🏆 [CLIENT] Final health:', this.currentGame.duelHealth);

        // Update the button text if it exists
        const nextBtn = document.getElementById('nextRoundBtn');
        const duelNextBtn = document.getElementById('duelNextRoundBtn');

        if (nextBtn) nextBtn.textContent = 'View Summary';
        if (duelNextBtn) duelNextBtn.textContent = 'View Summary';

        // Non-host stays on "Waiting for host..." screen.
        // They will transition when the host clicks "View Summary",
        // which triggers the showFinalResults event.
    }

    handleShowFinalResults(data) {
        // Update health if provided
        if (data.finalHealth) {
            this.currentGame.duelHealth = { ...data.finalHealth };
            this.currentGame.pendingHealthUpdate = { ...data.finalHealth };
        }
        // Transition to game statistics screen
        this.showDuelFinalResults();
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

    handlePartyEnded(data) {
        console.log('🔚 [CLIENT] Party ended:', data);
        
        // Show notification
        this.showNotification(data.reason || 'Party ended', 'warning');
        
        // Clear all party state
        this.currentParty = null;
        this.isHost = false;
        this.currentGame = null;
        this.hasLeftGame = true;
        
        // Clean URL
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({route: 'hub'}, '', cleanUrl);
        this.currentRoute = 'hub';
        
        // Return to multiplayer options screen
        this.showScreen('multiplayerOptionsScreen');
        
        // Remove any UI artifacts
        document.querySelectorAll('.waiting-overlay, .modal, .popup, .overlay, [class*="overlay"], [id*="overlay"]').forEach(el => el.remove());
        const nonHostMessage = document.getElementById('nonHostMessage');
        if (nonHostMessage) {
            nonHostMessage.remove();
        }
    }
    
    handleMemberLeft(data) {
        console.log('👋 [CLIENT] Member left:', data);

        // Don't show notification if the user is the one leaving
        if (this.userIsLeaving) {
            console.log('👋 [CLIENT] User is actively leaving - skipping notification');
            this.userIsLeaving = false; // Reset flag
            return;
        }

        // Update the local party data with the latest from server
        if (data.party) {
            this.currentParty = data.party;
            console.log('👋 [CLIENT] Updated party from server:', this.currentParty);
        } else if (this.currentParty && data.playerId) {
            // Fallback: manually remove the member if no party data provided
            this.currentParty.members = this.currentParty.members.filter(m => m.id !== data.playerId);
            console.log('👋 [CLIENT] Manually updated party members:', this.currentParty.members);
        }

        // Show different notifications based on game state
        if (this.currentScreen === 'gameScreen' || this.currentScreen === 'ffaRevealScreen') {
            // During active game - show notification that fades after 2 seconds
            const notification = this.showNotification(`${data.playerName} left the game. Adjusting player count...`, 'warning');
            setTimeout(() => {
                if (notification && notification.parentElement) {
                    notification.style.transition = 'opacity 0.5s ease-out';
                    notification.style.opacity = '0';
                    setTimeout(() => notification.remove(), 500);
                }
            }, 2000); // Changed from 3000 to 2000
        } else {
            // In lobby/setup - show notification that fades after 2 seconds
            const notification = this.showNotification(`${data.playerName} left the party`, 'info');
            setTimeout(() => {
                if (notification && notification.parentElement) {
                    notification.style.transition = 'opacity 0.5s ease-out';
                    notification.style.opacity = '0';
                    setTimeout(() => notification.remove(), 500);
                }
            }, 2000);
        }
        
        // Always update party display when someone leaves
        this.updatePartyDisplay();
        
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

        // Show notification to existing players
        this.showNotification(data.message || `${data.newMember?.name || 'Someone'} joined the party`, 'success');

        // Update party data and force visual update
        if (data.party) {
            this.currentParty = data.party;
            this.isHost = data.party.host === window.multiplayerManager?.getSocketId();


            // Force visual update if on party setup screen
            if (document.getElementById('partySetupScreen').classList.contains('active')) {
                this.updatePartyVisual();
                this.updatePartyGameTypeVisuals();

                // Multiple aggressive FFA updates
                if (data.party.gameType === 'ffa') {
                    this.updateFFAVisual();
                    setTimeout(() => this.updateFFAVisual(), 10);
                    setTimeout(() => this.updateFFAVisual(), 50);
                    setTimeout(() => this.updateFFAVisual(), 100);
                    setTimeout(() => this.updateFFAVisual(), 200);
                }
            }
        }
    }

    handlePartyEnded(data) {
        console.log('🔚 [CLIENT] Party ended:', data);

        // Clear any existing notifications
        const existingNotification = document.getElementById('gameNotification');
        if (existingNotification) {
            existingNotification.remove();
        }

        // Clear party state completely
        this.currentParty = null;
        this.isHost = false;
        this.hasLeftGame = false;
        this.currentGame = null;

        // Show in-game notification
        const notification = this.showNotification(data.reason || 'The party has ended.', 'error');

        // Return to home immediately and let notification fade out
        this.showScreen('homeScreen');

        // Remove notification after 2 seconds with fade effect
        if (notification) {
            setTimeout(() => {
                notification.style.transition = 'opacity 0.5s ease-out';
                notification.style.opacity = '0';
                setTimeout(() => {
                    if (notification.parentElement) {
                        notification.remove();
                    }
                }, 500);
            }, 2000);
        }
    }

    handlePlayersUpdate(data) {
        
        // Show real-time notification about player count changes during game
        if (this.currentScreen === 'gameScreen') {
            if (data.message) {
                this.showNotification(data.message, 'warning');
            }
            
            // Update the waiting message if it exists
            const waitingMessage = document.querySelector('.game-status, .waiting-message');
            if (waitingMessage && data.waitingFor !== undefined) {
                if (data.waitingFor > 0) {
                    waitingMessage.textContent = `Waiting for ${data.waitingFor} more player${data.waitingFor === 1 ? '' : 's'}...`;
                } else {
                    waitingMessage.textContent = 'Processing results...';
                }
            }
            
            // Update submission count if the element exists
            const submissionStatus = document.querySelector('.submission-status');
            if (submissionStatus && data.submittedCount !== undefined && data.activePlayers !== undefined) {
                submissionStatus.textContent = `${data.submittedCount}/${data.activePlayers} players submitted`;
            }
            
            console.log('[CLIENT] Updated UI for players change:', {
                activePlayers: data.activePlayers,
                submittedCount: data.submittedCount,
                waitingFor: data.waitingFor
            });
        }
    }

    handleForceResultsScreen(data) {
        
        // Show notification about why this is happening
        if (data.message) {
            this.showNotification(data.message, 'warning');
        }
        
        // Force transition to results screen regardless of current state
        
        // If we're currently on the game screen (waiting), force transition to results
        if (this.currentScreen === 'gameScreen') {
            console.log('🚀 [SOLUTION-1] Currently on game screen - transitioning to results');
            
            // Set up basic results data if we don't have complete data
            if (!this.currentGame || !this.currentGame.results) {
                console.log('🚀 [SOLUTION-1] Setting up basic results data for forced transition');
                if (!this.currentGame) this.currentGame = {};
                this.currentGame.results = {
                    forceCompleted: true,
                    reason: data.reason || 'playerLeft',
                    completedByLeave: true
                };
            }
            
            // Force show results screen
            this.showScreen('resultsScreen');
            this.showNotification('Round completed due to player leaving', 'info');
        } else {
            console.log('🚀 [SOLUTION-1] Not on game screen, current screen:', this.currentScreen);
        }
    }

    // Removed complex failsafe timer - keeping it simple
    
    // Removed clearFailsafeTimer function

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

        return notification; // Return the notification element for fade-out handling

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

    copyPartyCode() {
        if (!this.currentParty || !this.currentParty.code) {
            alert('No party code available');
            return;
        }
        
        navigator.clipboard.writeText(this.currentParty.code).then(() => {
            this.showNotification(`Party code copied: ${this.currentParty.code}`, 'success');
        }).catch(() => {
            alert(`Party Code: ${this.currentParty.code}`);
        });
    }

    copyPartyLink() {
        if (!this.currentParty || !this.currentParty.code) {
            alert('No party code available');
            return;
        }
        
        const link = `${window.location.origin}${window.location.pathname}?party=${this.currentParty.code}`;
        navigator.clipboard.writeText(link).then(() => {
            this.showNotification('Invite link copied to clipboard!', 'success');
        }).catch(() => {
            alert(`Invite Link: ${link}`);
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
    
    setupRouting() {
        // Listen for browser back/forward
        window.addEventListener('popstate', (event) => {
            console.log('[ROUTING] Browser navigation detected');
            this.handleRouteChange();
        });
        
        // REFRESH FIX: Leave party on page refresh/close
        window.addEventListener('beforeunload', (e) => {
            if (this.currentParty && window.multiplayerManager?.isConnected()) {
                console.log('[REFRESH] Page refreshing/closing - leaving party:', this.currentParty.code);
                
                // Try to leave party via socket
                if (window.multiplayerManager?.socket) {
                    window.multiplayerManager.socket.emit('leaveParty');
                }
                
                // Also use sendBeacon for reliability during page unload
                try {
                    const serverUrl = window.location.hostname === 'localhost' ? 
                        'http://localhost:3002' : window.location.origin;
                    const data = JSON.stringify({
                        socketId: window.multiplayerManager.socket?.id,
                        partyCode: this.currentParty.code
                    });
                    navigator.sendBeacon(`${serverUrl}/api/leave-party`, data);
                } catch (err) {
                    console.log('[REFRESH] sendBeacon failed:', err);
                }
            }
        });
        
        // REFRESH FIX: Clear party state on page load if it's stale
        window.addEventListener('load', () => {
            // Check if we have a stale party in URL but no active connection
            const urlParams = new URLSearchParams(window.location.search);
            const partyCode = urlParams.get('party');
            
            if (partyCode && !this.currentParty) {
                console.log('[REFRESH] Stale party code in URL detected, cleaning up');
                // Clean the URL
                const cleanUrl = window.location.origin + window.location.pathname;
                window.history.replaceState(null, '', cleanUrl);
            }
        });
        
        // Check initial route
        this.handleRouteChange();
    }
    
    handleRouteChange() {
        const urlParams = new URLSearchParams(window.location.search);
        const partyCode = urlParams.get('party');
        
        if (partyCode) {
            console.log('[ROUTING] Game route detected with party:', partyCode);
            this.currentRoute = 'game';
            // Don't clear URL if we're actively joining/in a party
            if (!this.currentParty || this.currentParty.code !== partyCode) {
                console.log('[ROUTING] Clearing party parameter from URL - no active party');
                const newUrl = window.location.pathname;
                window.history.replaceState({}, '', newUrl);
            }
            
            console.log('[ROUTING] Party parameter detected but not auto-joining');
        } else {
            console.log('[ROUTING] Hub route detected');
            this.currentRoute = 'hub';
            
            // If we're in a game but URL says hub, clean up FIRST
            if (this.currentParty) {
                console.log('[ROUTING] Back button detected - leaving party:', this.currentParty.code);
                // Leave party first, which will clean everything up
                this.leaveCurrentParty();
            } else {
                // Clean URL even if no party (ensure clean state)
                const cleanUrl = window.location.origin + window.location.pathname;
                if (window.location.href !== cleanUrl) {
                    console.log('[ROUTING] Cleaning URL from:', window.location.href, 'to:', cleanUrl);
                    window.history.replaceState({route: 'hub'}, '', cleanUrl);
                }
            }
        }
    }
    
    leaveCurrentParty() {
        console.log('🚪 [PARTY] 🚪 leaveCurrentParty() called! 🚪');
        console.log('[PARTY] Leaving current party:', this.currentParty?.code);

        // Set flag to prevent showing "you left" notification to yourself
        this.userIsLeaving = true;

        // Use window.multiplayerManager since that's how it's initialized
        const manager = window.multiplayerManager;
        console.log('[PARTY] window.multiplayerManager exists?', !!manager);
        console.log('[PARTY] multiplayerManager connected?', manager?.isConnected());
        console.log('[PARTY] multiplayerManager socket?', !!manager?.socket);
        console.log('[PARTY] multiplayerManager socket connected?', manager?.socket?.connected);
        
        // Leave party via multiplayer manager first
        if (manager && manager.socket && manager.socket.connected) {
            console.log('[PARTY] ✅ Calling multiplayerManager.leaveParty()');
            const result = manager.leaveParty();
            console.log('[PARTY] leaveParty result:', result);
        } else {
            console.log('[PARTY] ❌ WARNING: Cannot send leave event - connection issue');
            console.log('[PARTY] Debug info:', {
                manager: !!manager,
                socket: !!manager?.socket,
                connected: manager?.socket?.connected
            });
        }
        
        // Clear all game state
        this.currentGame = null;
        this.currentParty = null;
        this.isHost = false;
        this.hasLeftGame = true;
        
        // Clean URL immediately
        const cleanUrl = window.location.origin + window.location.pathname;
        console.log('[PARTY] Cleaning URL to:', cleanUrl);
        window.history.replaceState({route: 'hub'}, '', cleanUrl);
        this.currentRoute = 'hub';
        
        // Show multiplayer options screen (where they came from)
        this.showScreen('multiplayerOptionsScreen');
        
        // Clear party UI elements
        this.clearPartyUI();
        
        // Remove any UI artifacts
        document.querySelectorAll('.waiting-overlay, .modal, .popup, .overlay, [class*="overlay"], [id*="overlay"]').forEach(el => el.remove());
        const nonHostMessage = document.getElementById('nonHostMessage');
        if (nonHostMessage) {
            nonHostMessage.remove();
        }
    }

    navigateToHub() {
        console.log('[ROUTING] Navigating to hub');
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.pushState({route: 'hub'}, '', cleanUrl);
        this.currentRoute = 'hub';
        this.forceCleanup();
    }
    
    navigateToGame(partyCode) {
        console.log('[ROUTING] Navigating to game:', partyCode);
        const gameUrl = `${window.location.origin}${window.location.pathname}?party=${partyCode}`;
        window.history.pushState({route: 'game', party: partyCode}, '', gameUrl);
        this.currentRoute = 'game';
    }
    
    forceCleanup() {
        console.log('[CLEANUP] Force cleanup initiated');
        
        // Kill all timers
        const highestId = setTimeout(() => {}, 0);
        for (let i = 0; i < highestId; i++) {
            clearTimeout(i);
            clearInterval(i);
        }
        
        // Remove all overlays
        document.querySelectorAll('.waiting-overlay, .modal, .popup, .overlay, [class*="overlay"], [id*="overlay"]').forEach(el => el.remove());
        
        // Remove persistent party status messages
        const nonHostMessage = document.getElementById('nonHostMessage');
        if (nonHostMessage) {
            nonHostMessage.remove();
        }
        
        // CRITICAL: Leave party properly before disconnecting
        if (this.currentParty && this.multiplayerManager?.isConnected()) {
            console.log('[CLEANUP] Leaving party before cleanup:', this.currentParty.code);
            this.multiplayerManager.leaveParty();
        }
        
        // Reset game state
        this.currentGame = null;
        this.currentParty = null;
        this.isHost = false;
        this.hasLeftGame = true;
        
        // CRITICAL: Immediately clean the URL
        const cleanUrl = window.location.origin + window.location.pathname;
        console.log('[CLEANUP] Cleaning URL to:', cleanUrl);
        window.history.replaceState({route: 'hub'}, '', cleanUrl);
        this.currentRoute = 'hub';
        
        // Don't disconnect the socket - just leave the party
        // This allows reconnecting to a new party without issues
        // if (this.multiplayerManager?.socket) {
        //     this.multiplayerManager.socket.disconnect();
        // }
        
        // Force show home screen
        this.showScreen('homeScreen');
    }
    
    checkForPartyInvite() {
        // Replaced by setupRouting and handleRouteChange
        this.handleRouteChange();
    }
    
    autoJoinParty(partyCode) {
        console.log('🔗 [INVITE] Auto-joining party:', partyCode);
        this.showNotification(`Auto-joining party: ${partyCode}`, 'info');
        
        // Wait for multiplayer connection then join
        setTimeout(() => {
            if (window.multiplayerManager?.connected) {
                this.showJoinParty();
                document.getElementById('joinPartyCode').value = partyCode;
                setTimeout(() => {
                    this.joinParty();
                }, 500);
            } else {
                console.log('🔗 [INVITE] Waiting for multiplayer connection...');
                setTimeout(() => this.autoJoinParty(partyCode), 1000);
            }
        }, 1000);
    }

    selectPartyGameType(gameType) {
        if (!this.currentParty) return;
        
        this.currentParty.gameType = gameType;
        document.getElementById('partyGameType').value = gameType;
        
        this.updatePartyGameType();
    }

    updatePartyGameType() {
        console.log('🎮 [GAME TYPE] updatePartyGameType called');
        console.log('🎮 [GAME TYPE] isHost:', this.isHost);
        console.log('🎮 [GAME TYPE] multiplayerManager.isHost:', window.multiplayerManager?.isHost);
        console.log('🎮 [GAME TYPE] multiplayerManager.connected:', window.multiplayerManager?.connected);
        
        // 🔧 CRITICAL SYNC FIX: Force synchronization of host status
        if (this.isHost && window.multiplayerManager) {
            if (!window.multiplayerManager.isHost) {
                console.warn('🔧 [SYNC] HOST STATUS MISMATCH DETECTED!');
                console.warn('🔧 [SYNC] game.isHost =', this.isHost, 'but multiplayerManager.isHost =', window.multiplayerManager.isHost);
                window.multiplayerManager.isHost = true;
                console.log('🔧 [SYNC] FIXED: multiplayerManager.isHost = true');
            }
        } else if (!this.isHost && window.multiplayerManager) {
            if (window.multiplayerManager.isHost) {
                console.warn('🔧 [SYNC] NON-HOST STATUS MISMATCH DETECTED!');
                console.warn('🔧 [SYNC] game.isHost =', this.isHost, 'but multiplayerManager.isHost =', window.multiplayerManager.isHost);
                window.multiplayerManager.isHost = false;
                console.log('🔧 [SYNC] FIXED: multiplayerManager.isHost = false');
            }
        }
        
        if (!this.isHost) {
            console.log('⛔ Not host, cannot change game type');
            return;
        }
        
        const gameType = document.getElementById('partyGameType').value;
        console.log('🎮 [GAME TYPE] Selected gameType:', gameType);
        
        if (this.currentParty) {
            this.currentParty.gameType = gameType;
            
            // Sync with server if using real multiplayer
            if (window.multiplayerManager && window.multiplayerManager.connected) {
                console.log('🎮 [GAME TYPE] Calling multiplayerManager.updateGameType');
                const result = window.multiplayerManager.updateGameType(gameType);
                console.log('🎮 [GAME TYPE] Server update result:', result);
            } else {
                console.warn('🎮 [GAME TYPE] No multiplayer connection available');
            }
        } else {
            console.warn('🎮 [GAME TYPE] No current party');
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
                <button onclick="window.game.removeTeam(${teamId})" class="remove-team-btn">×</button>
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
        console.log('NUCLEAR v2.1: Starting complete FFA display rebuild with !important styling');
        
        // Enhanced debugging
        console.log('NUCLEAR DEBUG:', {
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
        
        console.log('NUCLEAR: Found container:', container.className);
        
        // Get party members with validation
        const members = this.currentParty?.members || [];
        if (members.length === 0) {
            console.log('NUCLEAR: No members to display');
            container.innerHTML = '<div class="no-players">No players in party</div>';
            return;
        }
        
        console.log('NUCLEAR: Rebuilding with members:', members.map(m => `${m.name} (${m.id})`));
        
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
        
        console.log('NUCLEAR: Display refresh complete with flex layout');
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
                    console.log('NUCLEAR: Auto-fix detected member count mismatch');
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
        console.log('[CLIENT] startParty() called');
        console.log('[CLIENT] Current party:', this.currentParty);
        console.log('[CLIENT] Is host:', this.isHost);
        console.log('[CLIENT] Multiplayer manager connected:', window.multiplayerManager?.isConnected());
        
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
        // For duels, default to 'classic' since game mode dropdown was removed
        const gameMode = 'classic';
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

        // Simple approach: let the server use placeholder data, client handles demon display
        console.log('[CLIENT] Starting game without pre-generating demons');

        // Send game start to server for all players
        console.log('[CLIENT] About to call multiplayerManager.startGame with data:', gameData);
        if (window.multiplayerManager) {
            console.log('[CLIENT] Calling multiplayerManager.startGame()');
            const result = window.multiplayerManager.startGame(gameData);
            console.log('[CLIENT] multiplayerManager.startGame() returned:', result);
        } else {
            console.error('❌ [CLIENT] No multiplayer manager available, using fallback');
            // Fallback for local testing
            this.handleMultiplayerGameStart({ party: this.currentParty, gameData, seed: gameSeed });
        }
    }

    async handleMultiplayerGameStart(data) {
        console.log('[CLIENT] handleMultiplayerGameStart called with data:', data);
        console.log('[CLIENT] Current screen:', document.querySelector('.screen.active')?.id);
        
        // CRITICAL FIX: Clean up any leftover UI elements from previous games
        this.cleanupGameUI();
        
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
        console.log('[DEBUG] Initializing currentGame object');
        console.log('[DEBUG] duelWinner before init:', this.currentGame?.duelWinner);
        
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
        
        console.log('[DEBUG] After full game init, duelWinner is:', this.currentGame.duelWinner);
        console.log('[DEBUG] currentGame properties:', {
            gameType: this.currentGame.gameType,
            duelWinner: this.currentGame.duelWinner,
            duelHealth: this.currentGame.duelHealth,
            playerScores: this.currentGame.playerScores
        });
        console.log('💯 [INIT] playerScores initialized as:', JSON.stringify(this.currentGame.playerScores));
        
        console.log('[CLIENT] About to start game - switching to gameScreen');
        console.log('[CLIENT] Game object created:', {
            mode: this.currentGame.mode,
            gameType: this.currentGame.gameType,
            totalRounds: this.currentGame.totalRounds,
            seed: this.currentGame.seed,
            partyMembers: this.currentParty.members.length
        });
        
        // Start the game
        this.showScreen('gameScreen');
        console.log('[CLIENT] Screen switched to gameScreen');
        
        this.startNewRound();
        console.log('[CLIENT] startNewRound() called - game should be running now');
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
        
        const myId = window.multiplayerManager?.getSocketId();
        const currentScreen = document.querySelector('.screen.active')?.id;
        
        // SOLUTION 1: Preserve host status through updates
        const wasHost = this.isHost;
        const wasMultiplayerHost = window.multiplayerManager?.isHost;
        
        this.currentParty = party;
        
        // Only change host status if there's an explicit host transfer
        // (when the actual host leaves and someone else becomes host)
        if (party.host !== myId && wasHost) {
            // We were host but now someone else is
            console.log('🔄 [CLIENT] Lost host status');
            this.isHost = false;
            if (window.multiplayerManager) {
                window.multiplayerManager.isHost = false;
            }
        } else if (party.host === myId && !wasHost) {
            // We weren't host but now we are (host transfer)
            console.log('🔄 [CLIENT] Gained host status');
            this.isHost = true;
            if (window.multiplayerManager) {
                window.multiplayerManager.isHost = true;
            }
        } else {
            // Keep existing host status
            this.isHost = wasHost;
            if (window.multiplayerManager) {
                window.multiplayerManager.isHost = wasMultiplayerHost;
            }
            console.log('🔄 [CLIENT] Keeping host status:', this.isHost);
        }
        
        // Only transition to party screen if game is NOT in progress
        // This prevents forcing users back to lobby when rejoining after refresh
        const gameInProgress = party.gameState?.inProgress;
        if (party.members.some(m => m.id === myId) && currentScreen !== 'partySetupScreen' && !gameInProgress) {
            console.log('[CLIENT] Party update with user as member - transitioning to lobby');
            console.log('[CLIENT] Current screen:', currentScreen, '-> partySetupScreen');
            console.log('[CLIENT] Party code:', party.code, 'Members:', party.members.length);
            this.showScreen('partySetupScreen');
            document.getElementById('partyCode').textContent = party.code;
            this.applyHostRestrictions();
        } else if (gameInProgress) {
            console.log('[CLIENT] Game in progress - staying on current screen');
        }
        
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
            
            // Always update the party display to ensure member list is current
            console.log('🔄 [CLIENT] Calling updatePartyDisplay from handlePartyUpdate');
            this.updatePartyDisplay();
            
            console.log('🔄 [CLIENT] Party visual update complete');
        }
    }

    updatePartyGameTypeVisuals() {
        if (!this.currentParty) {
            console.warn('🎨 [CLIENT] updatePartyGameTypeVisuals called but no currentParty!');
            return;
        }

        const gameType = this.currentParty.gameType || 'ffa';

        console.log('🎨 [CLIENT] updatePartyGameTypeVisuals called');
        console.log('🎨 [DEBUG] Current party gameType:', this.currentParty.gameType);
        console.log('🎨 [DEBUG] Resolved gameType:', gameType);
        console.log('🎨 [DEBUG] Is host?', this.isHost);
        console.log('🎨 [DEBUG] Full party object:', JSON.stringify(this.currentParty, null, 2));

        // CRITICAL: Update the game type dropdown to match the party's game type
        const gameTypeSelect = document.getElementById('partyGameType');
        if (gameTypeSelect) {
            console.log('🎨 [DROPDOWN] Setting dropdown value to:', gameType);
            console.log('🎨 [DROPDOWN] Current dropdown value:', gameTypeSelect.value);
            gameTypeSelect.value = gameType;
            console.log('🎨 [DROPDOWN] Dropdown value after update:', gameTypeSelect.value);
        } else {
            console.warn('🎨 [DROPDOWN] ⚠️ Game type dropdown not found!');
        }

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
        
        // Game Mode section was removed from HTML, so no need to hide/show it
        
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
            if (screenId === 'partySetupScreen') {
                // Set up back button event listener every time we show the party screen
                console.log('🔧 [CLIENT] Setting up party back button listener');
                const partyBackBtn = document.getElementById('partyBackBtn');
                if (partyBackBtn) {
                    // Remove any existing listeners first
                    const newBackBtn = partyBackBtn.cloneNode(true);
                    partyBackBtn.parentNode.replaceChild(newBackBtn, partyBackBtn);
                    
                    // Add fresh listener
                    newBackBtn.addEventListener('click', () => {
                        console.log('🚪🚪🚪 PARTY BACK BUTTON CLICKED! 🚪🚪🚪');
                        this.leaveCurrentParty();
                    });
                    console.log('✅ [CLIENT] Back button listener attached');
                } else {
                    console.error('❌ [CLIENT] partyBackBtn element not found!');
                }
                
                if (this.currentParty) {
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
        if (multiplayerOptions) {
            multiplayerOptions.style.display = mode === 'multiplayer' ? 'block' : 'none';
        }
    }

    async startGame() {
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

        // Ensure demons are loaded before starting
        if (this.finalList.length === 0 && this.consolidatedList.length === 0) {
            console.log('⏳ [CLIENT] Demons not loaded yet, waiting...');
            await this.loadDemonList();
        }

        console.log('✅ [CLIENT] Demons loaded for solo game');
        console.log('✅ [CLIENT] Final list length:', this.finalList.length);
        console.log('✅ [CLIENT] Consolidated list length:', this.consolidatedList.length);

        const gameModeSelect = document.getElementById('gameModeSelect');
        const gameMode = gameModeSelect ? gameModeSelect.value : 'classic';
        const difficultyElement = document.querySelector('input[name="difficulty"]:checked');
        const difficulty = difficultyElement ? difficultyElement.value : 'nmpz';

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
        console.log('Starting new round - clearing server health flag and duel winner');
        
        // If there's a duel winner, don't start new round - the duel is over
        if (this.currentGame.duelWinner) {
            console.log('[DEBUG] Duel is over, not starting new round. Winner:', this.currentGame.duelWinner);
            return;
        }
        
        // Clear server health flag and pending health for new round
        if (this.currentGame.hasServerHealth) {
            this.currentGame.hasServerHealth = false;
            console.log('✅ Cleared hasServerHealth flag for new round');
        }
        this.currentGame.pendingHealthUpdate = null;
        
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
            console.log('Removed lingering waiting overlay');
        }
        
        const clashScreen = document.getElementById('clashScreen');
        if (clashScreen) {
            clashScreen.remove();
            console.log('Removed lingering clash screen');
        }
        
        const detailedResults = document.getElementById('detailedDuelResults');
        if (detailedResults) {
            detailedResults.remove();
            console.log('Removed lingering detailed results');
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
        
        // Check if hint section elements exist
        if (!hintSection || !hintDisplay) {
            console.log('[HINTS] Hint display elements not found');
            return;
        }
        
        // Get difficulty from current game (works for both single-player and multiplayer)
        const difficulty = this.currentGame.difficulty;
        console.log('[HINTS] Current difficulty:', difficulty);
        
        // Only show hints for 'move' difficulty (which corresponds to "With Hints")
        if (difficulty !== 'move') {
            hintSection.style.display = 'none';
            console.log('[HINTS] Hiding hints - difficulty is not "move"');
            return;
        }
        
        const hints = [];
        const demon = this.currentGame.currentDemon;
        
        if (!demon) {
            console.log('[HINTS] No demon data available');
            hintSection.style.display = 'none';
            return;
        }
        
        console.log('[HINTS] Demon data:', demon);
        console.log('[HINTS] Current hints settings:', this.currentGame.hints);
        
        // Check each hint type and add to display
        if (this.currentGame.hints?.showCreator) {
            const creatorName = demon.publisher?.name || demon.publisher || demon.creator || 'Unknown';
            hints.push(`<div class="hint-item">👤 Creator: ${creatorName}</div>`);
        }
        if (this.currentGame.hints?.showVerifier) {
            const verifierName = demon.verifier?.name || demon.verifier || 'Unknown';
            hints.push(`<div class="hint-item">✅ Verifier: ${verifierName}</div>`);
        }
        if (this.currentGame.hints?.showName) {
            hints.push(`<div class="hint-item">🏷️ Level Name: ${demon.name}</div>`);
        }
        
        console.log('[HINTS] Generated hints:', hints);
        
        if (hints.length > 0) {
            hintSection.style.display = 'block';
            hintDisplay.innerHTML = hints.join('');
            console.log('[HINTS] Displaying', hints.length, 'hints');
        } else {
            hintSection.style.display = 'none';
            console.log('[HINTS] No hints to display');
        }
    }

    startTimer(seconds) {
        const timerDisplay = document.getElementById('timerDisplay');
        timerDisplay.style.display = 'inline';
        let timeLeft = seconds;
        
        // CRITICAL FIX: Clear any existing timer to prevent flickering
        if (this.currentTimer) {
            console.log('[TIMER FIX] Clearing existing timer to prevent flickering');
            clearInterval(this.currentTimer);
            this.currentTimer = null;
        }
        
        // CRITICAL FIX: Set initial timer display immediately to prevent showing old value
        timerDisplay.textContent = `${timeLeft}s`;
        console.log('[TIMER FIX] Timer started with', timeLeft, 'seconds');
        
        this.currentTimer = setInterval(() => {
            // Check if user has quit before continuing timer
            if (this.userHasQuit) {
                console.log('[QUIT] Stopping timer because user has quit');
                clearInterval(this.currentTimer);
                return;
            }
            
            timeLeft--;
            timerDisplay.textContent = `${timeLeft}s`;
            
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

        // Prevent submissions after game is finished or duel is won
        if (this.currentGame?.isFinished || this.currentGame?.duelWinner) {
            console.log('[SUBMIT] Ignoring guess — game is finished or duel has a winner');
            if (this.currentTimer) { clearInterval(this.currentTimer); this.currentTimer = null; }
            return;
        }

        // Only clear timer if it's a timeout or not FFA mode
        // In FFA, timer should keep running for other players
        if (this.currentTimer && (timeout || this.currentGame?.gameType !== 'ffa')) {
            console.log('[TIMER] Clearing timer - timeout:', timeout, 'gameType:', this.currentGame?.gameType);
            clearInterval(this.currentTimer);
        } else if (this.currentTimer && this.currentGame?.gameType === 'ffa') {
            console.log('[TIMER] Keeping timer running for other FFA players');
        }
        
        const guessInput = document.getElementById('guessInput');
        const guess = timeout ? 999 : parseInt(guessInput.value);
        
        if (!timeout && (!guess || guess < 1)) {
            alert('Please enter a valid placement guess!');
            return;
        }
        
        const actual = this.currentGame.currentDemon.position;
        const points = this.calculateScore(guess, actual);
        console.log('SCORE CALCULATED:', points, 'for guess:', guess, 'vs actual:', actual);
        
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
            if (window.multiplayerManager && !this.currentGame?.isFinished) {
                window.multiplayerManager.submitScore({ 
                    score: points, 
                    guess: guess, 
                    totalScore: this.currentGame.ffaScores[currentUserId],
                    round: this.currentGame.currentRound 
                });
            } else if (this.currentGame?.isFinished) {
                console.log('🚫 [SCORE SUBMIT] Game is finished - ignoring FFA score submission');
            }
            
            // Store pending results for reveal
            this.currentGame.pendingResults = {
                guess: guess,
                actual: actual,
                points: points
            };
            
            // Show waiting screen for ALL players after they submit (not just first)
            const submittedCount = Object.keys(this.currentGame.ffaRoundData || {}).length;
            console.log('[FFA] Showing waiting screen - player submitted');
            console.log('[FFA] Submitted count:', submittedCount, '/ Expected:', this.currentParty.members.length);
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
                console.log('[DUEL] Second to submit, skipping waiting screen');
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
            console.log('[QUIT] Ignoring showFFAReveal because user has quit');
            return;
        }

        // Remove waiting overlay
        const waitingOverlay = document.getElementById('ffaWaitingOverlay');
        if (waitingOverlay) {
            waitingOverlay.remove();
        }

        // Restore the game header that was hidden during FFA waiting
        const gameHeader = document.querySelector('.game-header');
        if (gameHeader) {
            gameHeader.style.display = '';
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
                                `<button onclick="window.game.nextFFARound()" style="padding: 15px 40px; font-size: 18px; background: #8b5cf6; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold;">
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
        
        console.log('[FFA] Looking for buttons...');
        console.log('[FFA] Host button found:', !!hostBtn);
        console.log('[FFA] Non-host button found:', !!nonHostBtn);
        
        // Function to handle "View Results" click for ANY player
        const handleViewResults = (playerType) => {
            console.log(`🔥🔥🔥 [FFA] View Final Results clicked by ${playerType}!`);
            
            // Request final results from server (server will send gameFinished event)
            if (window.multiplayerManager && window.multiplayerManager.socket) {
                console.log('[FFA] Requesting individual final results from server');
                window.multiplayerManager.socket.emit('showFinalResults', {
                    partyCode: this.currentParty?.code
                });
            } else {
                // Fallback for local games
                console.log('[FFA] No multiplayer connection, showing results locally');
                const revealScreen = document.getElementById('ffaRevealScreen');
                if (revealScreen) revealScreen.remove();
                this.endGame();
            }
        };
        
        // Add listeners for host button
        if (hostBtn) {
            console.log('[FFA] Adding click listener to HOST View Final Results button');
            hostBtn.onclick = () => handleViewResults('HOST');
            hostBtn.addEventListener('click', () => handleViewResults('HOST'));
        }
        
        // Add listeners for non-host button  
        if (nonHostBtn) {
            console.log('[FFA] Adding click listener to NON-HOST View Final Results button');
            nonHostBtn.onclick = () => handleViewResults('NON-HOST');
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
    
    // Legacy function - kept for compatibility but no longer used
    endFFAGame() {
        console.log('🔥🔥🔥 [FFA] endFFAGame() CALLED - This is now handled individually');
        // This function is obsolete - players now individually request final results
        // Each player clicks "View Final Results" which triggers showFinalResults event
    }
    
    continueFromFFAReveal() {
        // This function is now obsolete - replaced by nextFFARound
        this.nextFFARound();
    }

    updateFFAWaitingCount() {
        // Update the submission count display in the waiting overlay
        const waitingOverlay = document.getElementById('ffaWaitingOverlay');
        if (!waitingOverlay) return;
        
        // Recalculate submission count
        let submittedCount = 1; // Current player
        const ffaRoundData = this.currentGame.ffaRoundData || {};
        const currentUserId = this.getCurrentUserId();
        
        for (const playerId in ffaRoundData) {
            if (playerId !== currentUserId) {
                submittedCount++;
            }
        }
        
        const totalPlayers = this.currentParty.members.length;
        
        console.log('[WAITING UPDATE] Updating submission count:', {
            submittedCount,
            ffaRoundData: Object.keys(ffaRoundData),
            currentUserId,
            totalPlayers
        });
        
        // Update the count display
        const countElement = waitingOverlay.querySelector('.submission-count');
        if (countElement) {
            countElement.textContent = `${submittedCount}/${totalPlayers} players submitted`;
        }
    }
    
    showFFAWaitingState() {
        // CRITICAL: Don't show waiting state if game is finished
        if (this.currentGame?.isFinished) {
            console.log('🚫 [WAITING STATE] Game is finished - ignoring showFFAWaitingState');
            return;
        }

        console.log('[WAITING STATE] Showing FFA waiting state');

        // Hide guess section but keep video playing and visible
        document.getElementById('guessSection').style.display = 'none';

        // Don't show result section yet - show custom waiting screen
        document.getElementById('resultSection').style.display = 'none';

        // Hide the game header to prevent empty box above the video
        const gameHeader = document.querySelector('.game-header');
        if (gameHeader) {
            gameHeader.style.display = 'none';
        }
        
        // Ensure video container stays visible
        const videoContainer = document.querySelector('.video-container');
        if (videoContainer) {
            videoContainer.style.display = 'block';
            videoContainer.style.zIndex = '999'; // Below overlay but visible
        }
        
        // Create and show waiting overlay with transparent background to show video
        const waitingOverlay = document.createElement('div');
        waitingOverlay.id = 'ffaWaitingOverlay';
        waitingOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(to bottom, rgba(0, 0, 0, 0.1) 0%, rgba(0, 0, 0, 0.9) 80%, rgba(0, 0, 0, 0.95) 100%);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-end;
            z-index: 1000;
            color: white;
            text-align: center;
            pointer-events: none;
            padding-bottom: 80px;
        `;
        
        // CRITICAL FIX: Use a more reliable submission count
        // Start with 1 (current player who just submitted)
        let submittedCount = 1;
        
        // Add any other players who have already submitted (from ffaRoundData)
        const ffaRoundData = this.currentGame.ffaRoundData || {};
        const currentUserId = this.getCurrentUserId();
        
        // Count other players who have submitted (excluding current player to avoid double counting)
        for (const playerId in ffaRoundData) {
            if (playerId !== currentUserId) {
                submittedCount++;
            }
        }
        
        const totalPlayers = this.currentParty.members.length;
        
        console.log('[WAITING STATE] Submission count:', {
            submittedCount,
            ffaRoundData: Object.keys(ffaRoundData),
            currentUserId,
            totalPlayers
        });
        
        waitingOverlay.innerHTML = `
            <div style="font-size: 32px; font-weight: bold; margin-bottom: 20px;">
                🎯 GUESS SUBMITTED
            </div>
            <div style="font-size: 24px; margin-bottom: 30px;">
                Waiting for other players...
            </div>
            <div class="submission-count" style="font-size: 20px; color: #8b5cf6;">
                ${submittedCount}/${totalPlayers} players submitted
            </div>
        `;
        
        // 🚨 FAILSAFE TIMER: Auto-complete if stuck waiting for 10 seconds
        // Removed failsafe timer
        
        document.body.appendChild(waitingOverlay);
    }

    showDuelWaitingState() {
        // CRITICAL: Don't show waiting state if game is finished
        if (this.currentGame?.isFinished) {
            console.log('🚫 [WAITING STATE] Game is finished - ignoring showDuelWaitingState');
            return;
        }
        
        console.log('[WAITING STATE] Showing duel waiting state');
        
        // Hide guess section but keep video playing and visible
        document.getElementById('guessSection').style.display = 'none';
        
        // Don't show result section yet - show custom waiting screen
        document.getElementById('resultSection').style.display = 'none';
        
        // Ensure video container stays visible
        const videoContainer = document.querySelector('.video-container');
        if (videoContainer) {
            videoContainer.style.display = 'block';
            videoContainer.style.zIndex = '999'; // Below overlay but visible
        }
        
        // Create and show waiting overlay with transparent background to show video
        const waitingOverlay = document.createElement('div');
        waitingOverlay.id = 'duelWaitingOverlay';
        waitingOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(to bottom, rgba(0, 0, 0, 0.1) 0%, rgba(0, 0, 0, 0.9) 80%, rgba(0, 0, 0, 0.95) 100%);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-end;
            z-index: 1000;
            color: white;
            text-align: center;
            pointer-events: none;
            padding-bottom: 80px;
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
        
        // 🚨 FAILSAFE TIMER: Auto-complete if stuck waiting for 10 seconds  
        // Removed failsafe timer
        
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
            
            if (!this.currentGame?.isFinished) {
                window.multiplayerManager.submitScore(submissionData);
            } else {
                console.log('🚫 [SCORE SUBMIT] Game is finished - ignoring duel score submission');
            }
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
            // Give the non-submitting player a 0 score
            this.currentGame.duelState.roundScores[waitingForPlayerId] = 0;

            // CRITICAL: If we are the non-submitting player, auto-submit to the server
            // Without this, the server never receives our score and damage is never applied
            const currentUserId = this.getCurrentUserId();
            if (waitingForPlayerId === currentUserId) {
                console.log('[COUNTDOWN] Auto-submitting score 0 to server (player did not guess in time)');
                if (!this.currentGame.duelState.roundGuesses) {
                    this.currentGame.duelState.roundGuesses = {};
                }
                this.currentGame.duelState.roundGuesses[currentUserId] = 999;
                if (window.multiplayerManager && !this.currentGame?.isFinished) {
                    window.multiplayerManager.submitScore({ score: 0, guess: 999 });
                }
            }

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
        
        console.log('CLASH!', {player1Score, player2Score});
        
        // Calculate preliminary damage for display (server will override with authoritative values)
        const scoreDifference = Math.abs(player1Score - player2Score);
        const baseDamage = scoreDifference; // Full difference as damage
        const preliminaryDamage = Math.floor(baseDamage * this.currentGame.duelState.roundMultiplier);
        
        const currentUserId = this.getCurrentUserId();
        let combatResult = '';
        
        if (player1Score > player2Score) {
            console.log('Player 1 wins round - damage to Player 2');
            combatResult = player1Id === currentUserId ? 
                `You dealt ${preliminaryDamage} damage! (${player1Score} vs ${player2Score})` :
                `Opponent dealt ${preliminaryDamage} damage! (${player2Score} vs ${player1Score})`;
        } else if (player2Score > player1Score) {
            console.log('Player 2 wins round - damage to Player 1');
            combatResult = player2Id === currentUserId ?
                `You dealt ${preliminaryDamage} damage! (${player2Score} vs ${player1Score})` :
                `Opponent dealt ${preliminaryDamage} damage! (${player1Score} vs ${player2Score})`;
        } else {
            console.log('Draw round - no damage');
            combatResult = `Perfect tie! No damage dealt (${player1Score} vs ${player2Score})`;
        }
        
        // Store preliminary clash data (server will update with authoritative values)
        this.currentGame.clashData.damage = preliminaryDamage;
        this.currentGame.clashData.combatResult = combatResult;
        
        // NOTE: Do NOT modify actual health here - server handles that
        console.log('Preliminary damage calculated:', preliminaryDamage, '(Server will send authoritative values)');
        
        // Store guess data in clashData before it gets reset
        this.currentGame.clashData.roundGuesses = { ...this.currentGame.duelState.roundGuesses };
        
        // CRITICAL FIX: Don't update health display immediately - wait for damage animation
        // The health bar update will happen after the damage animation (1.6s delay + animation time)
        console.log('[CLASH] Delaying health bar update to sync with damage animation');
        
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
                <div class="clash-number left">${isPlayer1 ? player1Score : player2Score}</div>
                <div class="clash-number right">${isPlayer1 ? player2Score : player1Score}</div>
                <div class="clash-damage">-${damage}</div>
            </div>
        `;
        
        document.body.appendChild(clashOverlay);
        
        // CRITICAL: Update health bars IMMEDIATELY when clash screen shows (not delayed)
        console.log('⚡ [HEALTH] Updating health bars instantly on clash screen display');
        this.updateHealthAtGameSummary();

        // After 3.6s total animation (1.5s numbers + 1.6s delay + 0.5s fade), go to summary screen
        console.log('🕐 [CLASH] Setting 3.6s timeout to show detailed results');
        setTimeout(() => {
            console.log('⏰ [CLASH] Timeout triggered! Removing clash screen and showing detailed results...');
            clashOverlay.remove();
            console.log('🗑️ [CLASH] Clash overlay removed');
            // Show detailed duel results screen
            console.log('📊 [CLASH] Calling showDetailedDuelResults with scores:', player1Score, player2Score, 'damage:', damage);
            this.showDetailedDuelResults(player1Score, player2Score, damage);
            console.log('✅ [CLASH] showDetailedDuelResults call completed');
        }, 3600);

        console.log('🎭 Showing clash screen');
    }
    
    showDetailedDuelResults(player1Score, player2Score, damage) {
        console.log('🎬 [DUEL RESULTS] ========== SHOWING DUEL SUMMARY WITH VIDEO ==========');
        console.log('🎬 [DUEL RESULTS] Parameters:', { player1Score, player2Score, damage });
        console.log('🎬 [DUEL RESULTS] this.isHost:', this.isHost);
        console.log('🎬 [DUEL RESULTS] this.currentParty:', this.currentParty);

        // CRITICAL: Remove any existing results overlay before creating new one
        const existingOverlay = document.getElementById('detailedDuelResults');
        if (existingOverlay) {
            console.log('[DUEL RESULTS] Removing existing overlay to prevent duplicate buttons');
            existingOverlay.remove();
        } else {
            console.log('[DUEL RESULTS] No existing overlay found - creating fresh');
        }

        // CRITICAL: Update health values when detailed results show (no animation)
        this.updateHealthAtGameSummary();
        
        // CRITICAL FIX: Convert scores from player ID perspective to user perspective
        const memberIds = this.currentParty.members.map(m => m.id);
        const currentUserId = this.getCurrentUserId();
        const player1Id = memberIds[0];
        const player2Id = memberIds[1];
        const isPlayer1 = currentUserId === player1Id;
        
        // Convert scores to user perspective: "You" vs "Opponent"
        const yourScore = isPlayer1 ? player1Score : player2Score;
        const opponentScore = isPlayer1 ? player2Score : player1Score;
        
        console.log('[SCORE FIX] Score perspective conversion:', {
            originalPlayer1Score: player1Score,
            originalPlayer2Score: player2Score,
            currentUserId,
            isPlayer1,
            yourScore,
            opponentScore
        });
        
        // Use corrected scores for display (reassign to original variables for minimal code changes)
        player1Score = yourScore;
        player2Score = opponentScore;
        
        // Get current demon and player info - prioritize REAL demon data over placeholders
        const roundIndex = this.currentGame.currentRound - 1;
        let currentDemon = null;
        
        // Priority 1: Check rounds array for real demon data
        if (this.currentGame.rounds[roundIndex]?.demon?.name && 
            this.currentGame.rounds[roundIndex].demon.name !== 'Current Demon') {
            currentDemon = {
                demon: this.currentGame.rounds[roundIndex].demon,
                actual: this.currentGame.rounds[roundIndex].actual
            };
            console.log('📝 [DUEL RESULTS] Using demon from rounds array (Priority 1)');
        }
        // Priority 2: Check currentDemon for real data
        else if (this.currentGame.currentDemon?.name && 
                 this.currentGame.currentDemon.name !== 'Current Demon') {
            currentDemon = {
                demon: this.currentGame.currentDemon,
                actual: this.currentGame.currentDemon.position
            };
            console.log('📝 [DUEL RESULTS] Using currentDemon (Priority 2)');
        }
        // Priority 3: Check clashData as fallback
        else if (this.currentGame.clashData?.currentDemon?.demon?.name &&
                 this.currentGame.clashData.currentDemon.demon.name !== 'Current Demon') {
            currentDemon = this.currentGame.clashData.currentDemon;
            console.log('📝 [DUEL RESULTS] Using clashData (Priority 3)');
        }
        // Last resort: Use placeholder data
        else {
            currentDemon = this.currentGame.currentDemon || this.currentGame.rounds[roundIndex] || this.currentGame.clashData?.currentDemon;
            console.log('📝 [DUEL RESULTS] Using placeholder/fallback data (Last Resort)');
        }
        
        console.log('📝 [DUEL RESULTS] Final demon data:', {
            demon: currentDemon?.demon,
            actual: currentDemon?.actual,
            source: 'See above log for source priority'
        });
        
        // Safety check for party - for duels, check duelHealth instead of members
        // (disconnected players may have been removed from members but are still in duelHealth)
        if (!this.currentParty) {
            console.error('❌ No current party in showDetailedDuelResults');
            return;
        }

        if (this.currentGame.gameType === 'duels' && this.currentGame.duelHealth) {
            const playerCount = Object.keys(this.currentGame.duelHealth).length;
            if (playerCount < 2) {
                console.error('❌ Invalid duel state - less than 2 players in duelHealth');
                return;
            }
        } else if (!this.currentParty.members || this.currentParty.members.length < 2) {
            console.error('❌ Invalid party state - less than 2 members');
            return;
        }
        
        // Get player names with better debugging  
        const player1Member = this.currentParty.members.find(m => m.id === player1Id);
        const player2Member = this.currentParty.members.find(m => m.id === player2Id);
        
        console.log('[NAME DEBUG] Player ID lookup:', {
            player1Id, 
            player2Id,
            player1Member: player1Member ? {id: player1Member.id, name: player1Member.name} : null,
            player2Member: player2Member ? {id: player2Member.id, name: player2Member.name} : null,
            allMembers: this.currentParty.members.map(m => ({id: m.id, name: m.name}))
        });
        
        // Use user perspective for names: "You" vs opponent name
        const yourName = currentUserId === player1Id ? player1Member?.name : player2Member?.name;
        const opponentMember = currentUserId === player1Id ? player2Member : player1Member;
        const opponentName = opponentMember?.name || 'Opponent';
        
        // Assign to display variables (player1 = "You", player2 = "Opponent")  
        const player1Name = yourName; // Will show as "You" in template
        const player2Name = opponentName;
        
        // Get guesses from clash data (preserved before reset) or duel state - add debugging
        
        // Get guess data with priority: clashData -> duelState -> pendingResults
        const guessData = this.currentGame.clashData?.roundGuesses || this.currentGame.duelState?.roundGuesses || {};
        
        // Get guesses from user perspective: "You" vs "Opponent"
        const yourGuess = guessData[currentUserId] || 'Unknown';
        const opponentId = isPlayer1 ? player2Id : player1Id;
        const opponentGuess = guessData[opponentId] || 'Unknown';
        
        // Assign to display variables (player1 = "You", player2 = "Opponent")
        let player1Guess = yourGuess;
        let player2Guess = opponentGuess;
        
        // Fallback to pending results for current user's guess if missing
        if (this.currentGame.pendingResults?.guess && player1Guess === 'Unknown') {
            player1Guess = this.currentGame.pendingResults.guess; // player1 is always "You" now
        }
        
        
        // ENHANCED DEBUG - Log everything with better context
        console.log('[GUESS DEBUG] Detailed guess resolution:', {
            currentUserId,
            player1Id,
            player2Id,
            isPlayer1,
            guessData,
            player1Guess,
            player2Guess,
            pendingResults: this.currentGame.pendingResults,
            clashData: this.currentGame.clashData?.roundGuesses,
            duelState: this.currentGame.duelState?.roundGuesses
        });
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
            console.log('FINAL VERIFICATION:');
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
                        
                        <!-- Round Multiplier and Damage Info -->
                        <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.2);">
                            <div style="display: flex; justify-content: space-around; gap: 20px;">
                                <div style="text-align: center;">
                                    <p style="color: #aaa; font-size: 14px; margin: 0;">Round Multiplier</p>
                                    <p style="color: #8b5cf6; font-weight: bold; font-size: 18px; margin: 5px 0;">${(this.currentGame.duelState?.roundMultiplier || 1).toFixed(1)}x</p>
                                </div>
                                <div style="text-align: center;">
                                    <p style="color: #aaa; font-size: 14px; margin: 0;">Damage Dealt</p>
                                    <p style="color: #ff4444; font-weight: bold; font-size: 18px; margin: 5px 0;">${damage || 0}</p>
                                </div>
                            </div>
                        </div>
                        
                    </div>
                </div>
                
                <!-- Stats Section -->
                <div style="display: flex; flex-direction: column; gap: 20px; height: 100%; justify-content: center;">
                    
                    <!-- Player 1 Stats (You) -->
                    <div style="background: rgba(76, 175, 80, 0.2); border: 2px solid #4CAF50; border-radius: 15px; padding: 25px; text-align: center;">
                        <h3 style="color: #4CAF50; margin: 0 0 15px 0; font-size: 20px;">
                            Player (You)
                        </h3>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <p style="color: #aaa; font-size: 14px; margin: 0;">Your Guess</p>
                                <p style="color: #ffd93d; font-weight: bold; font-size: 24px; margin: 5px 0;">${this.formatGuessDisplay(player1Guess)}</p>
                            </div>
                            <div>
                                <p style="color: #aaa; font-size: 14px; margin: 0;">Points</p>
                                <p style="color: #4CAF50; font-weight: bold; font-size: 28px; margin: 5px 0;">${player1Score}</p>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Player 2 Stats (Opponent) -->
                    <div style="background: rgba(40, 40, 60, 0.8); border: 2px solid #555; border-radius: 15px; padding: 25px; text-align: center;">
                        <h3 style="color: #fff; margin: 0 0 15px 0; font-size: 20px;">
                            ${player2Name}
                        </h3>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <p style="color: #aaa; font-size: 14px; margin: 0;">Their Guess</p>
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
        console.log('🔘 [BUTTON] About to attach event listener');
        console.log('🔘 [BUTTON] this.isHost:', this.isHost);
        console.log('🔘 [BUTTON] Button should be visible:', this.isHost);

        if (this.isHost) {
            console.log('✅ [BUTTON] Host detected - attaching event listener');
            setTimeout(() => {
                const nextRoundBtn = document.getElementById('duelNextRoundBtn');
                console.log('🔘 [BUTTON] Button element found:', !!nextRoundBtn);
                console.log('🔘 [BUTTON] Button in DOM:', document.contains(nextRoundBtn));
                if (nextRoundBtn) {
                    console.log('✅ [BUTTON] Attaching click event listener to button');

                    // DIAGNOSTIC: Check button position and properties
                    const rect = nextRoundBtn.getBoundingClientRect();
                    const computedStyle = window.getComputedStyle(nextRoundBtn);
                    console.log('🔍 [BUTTON DIAGNOSTIC] Button position:', {
                        top: rect.top,
                        left: rect.left,
                        width: rect.width,
                        height: rect.height,
                        bottom: rect.bottom,
                        right: rect.right
                    });
                    console.log('🔍 [BUTTON DIAGNOSTIC] Button styles:', {
                        display: computedStyle.display,
                        visibility: computedStyle.visibility,
                        pointerEvents: computedStyle.pointerEvents,
                        opacity: computedStyle.opacity,
                        zIndex: computedStyle.zIndex
                    });
                    console.log('🔍 [BUTTON DIAGNOSTIC] Parent z-index:', window.getComputedStyle(nextRoundBtn.parentElement).zIndex);

                    // DIAGNOSTIC: Check what element is at button's position
                    const centerX = rect.left + rect.width / 2;
                    const centerY = rect.top + rect.height / 2;
                    const elementAtCenter = document.elementFromPoint(centerX, centerY);
                    console.log('🔍 [BUTTON DIAGNOSTIC] Element at button center:', {
                        tagName: elementAtCenter?.tagName,
                        id: elementAtCenter?.id,
                        className: elementAtCenter?.className,
                        isButton: elementAtCenter === nextRoundBtn
                    });

                    // CRITICAL: Store the click handler logic in a function
                    const handleClick = (event) => {
                        console.log('🎯 [BUTTON CLICKED] ========== NEXT ROUND BUTTON CLICKED ==========');
                        console.log('🎯 [BUTTON CLICKED] Event details:', {
                            type: event.type,
                            target: event.target,
                            currentTarget: event.currentTarget,
                            button: event.button
                        });
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
                            // Tell all other players to show final results
                            if (window.multiplayerManager) {
                                window.multiplayerManager.duelViewSummary();
                            }
                            // Also show results locally for host
                            this.showDuelFinalResults();
                        } else {
                            console.log('NO DUEL WINNER - ADVANCING TO NEXT ROUND');
                            // Advance to next round and notify other players
                            console.log('Host advancing to next round via button click');
                            console.log('Current round:', this.currentGame.currentRound);
                            console.log('Total rounds:', this.currentGame.totalRounds);
                            console.log('Party members:', this.currentParty.members.map(m => m.id));

                            if (window.multiplayerManager) {
                                console.log('Using multiplayer manager to advance');
                                window.multiplayerManager.nextRound();
                            } else {
                                console.log('Using local nextRound function');
                                this.nextRound();
                            }
                        }
                    };

                    // Attach click handler (only one method to prevent double-fire)
                    nextRoundBtn.onclick = handleClick;

                    // DIAGNOSTIC: Add mousedown event to see if ANY mouse events are reaching the button
                    nextRoundBtn.addEventListener('mousedown', (e) => {
                        console.log('🖱️ [BUTTON MOUSEDOWN] Button received mousedown event!', e);
                    });
                    nextRoundBtn.addEventListener('mouseup', (e) => {
                        console.log('🖱️ [BUTTON MOUSEUP] Button received mouseup event!', e);
                    });
                    nextRoundBtn.addEventListener('mouseover', (e) => {
                        console.log('🖱️ [BUTTON MOUSEOVER] Button received mouseover event!', e);
                    });

                    // DIAGNOSTIC: Add global click listener to see where clicks are going
                    const globalClickHandler = (e) => {
                        console.log('🌍 [GLOBAL CLICK] Click detected on document:', {
                            target: e.target,
                            targetId: e.target.id,
                            targetTag: e.target.tagName,
                            x: e.clientX,
                            y: e.clientY,
                            isButton: e.target === nextRoundBtn || e.target.closest('#duelNextRoundBtn')
                        });
                    };
                    document.addEventListener('click', globalClickHandler, { once: false });

                    // Clean up global listener when overlay is removed
                    const originalRemove = resultsOverlay.remove.bind(resultsOverlay);
                    resultsOverlay.remove = function() {
                        console.log('🧹 [CLEANUP] Removing global click listener');
                        document.removeEventListener('click', globalClickHandler);
                        originalRemove();
                    };

                    console.log('✅ [BUTTON] Event listener attached successfully (both onclick and addEventListener)');
                    console.log('✅ [BUTTON] Diagnostic listeners also attached (mousedown, mouseup, mouseover, global click)');
                } else {
                    console.error('❌ [BUTTON] Button element not found in DOM!');
                }
            }, 100);
        } else {
            console.warn('⚠️ [BUTTON] Not host - skipping event listener attachment');
            console.warn('⚠️ [BUTTON] Showing "Waiting for host" message instead');
        }
    }

    showDuelResults() {
        // CRITICAL: Apply any pending health updates FIRST, regardless of pendingResults
        if (this.currentGame.pendingHealthUpdate) {
            console.log('🩺 [DUEL RESULTS] Applying pending health update FIRST in showDuelResults');
            this.currentGame.duelHealth = { ...this.currentGame.pendingHealthUpdate };
            this.currentGame.pendingHealthUpdate = null;
            console.log('🩺 [DUEL RESULTS] Updated health to:', this.currentGame.duelHealth);
            
            // Update display immediately after applying health
            this.updateDuelDisplay();
            this.forceHealthBarUpdate();
        }
        
        // Now show the actual results if they exist
        if (this.currentGame.pendingResults) {
            const { guess, actual, points } = this.currentGame.pendingResults;
            this.showResult(guess, actual, points);
            this.updateStats(guess, actual);
            
            // Update display with correct health (now has updated values)
            this.updateDuelDisplay();
            
            // FORCE health bar update for all rounds as backup
            console.log('[HEALTH-DEBUG] 🔄 Forcing health bar update in showDuelResults');
            this.forceHealthBarUpdate();
            
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
        console.log('[OPPONENT SCORE] handleOpponentScore called with data:', JSON.stringify(data, null, 2));
        
        // HEALTH DEBUG: Check if health data is in the roundComplete event
        if (data.damageResult && data.damageResult.health) {
            console.log('[HEALTH-DEBUG] Health data found in roundComplete:', data.damageResult.health);
        } else {
            console.log('[HEALTH-DEBUG] ❌ NO health data in roundComplete event');
            console.log('[HEALTH-DEBUG] damageResult:', data.damageResult);
        }
        
        // Clear failsafe timer since normal completion is happening
        // Removed failsafe timer clearing
        
        // Prevent handling opponent score if user has quit or left the game
        if (this.userHasQuit || this.hasLeftGame) {
            console.log('[QUIT/LEAVE] Ignoring handleOpponentScore because user has quit or left');
            return;
        }
        
        // CRITICAL: Don't overwrite local demon data with server placeholders
        // Only update if we don't have local demon data OR if server data looks real (not placeholder)
        if (data.currentDemon) {
            console.log('📝 [DEMON SYNC] Received demon data from server:', data.currentDemon);
            
            const isServerDataPlaceholder = data.currentDemon.demon?.name === 'Current Demon' || 
                                           data.currentDemon.demon?.position === 1 ||
                                           data.currentDemon.actual === 1;
            
            const hasLocalDemonData = this.currentGame.currentDemon && 
                                     this.currentGame.currentDemon.name !== 'Current Demon';
            
            console.log('📝 [DEMON CHECK]', {
                isServerDataPlaceholder,
                hasLocalDemonData,
                serverDemonName: data.currentDemon.demon?.name,
                localDemonName: this.currentGame.currentDemon?.name
            });
            
            // Only update if server data is not a placeholder OR we have no local data
            if (!isServerDataPlaceholder || !hasLocalDemonData) {
                console.log('📝 [DEMON SYNC] Using server demon data');
                
                // Ensure rounds array exists and has the current round
                const roundIndex = (data.round || this.currentGame.currentRound) - 1;
                if (!this.currentGame.rounds[roundIndex]) {
                    this.currentGame.rounds[roundIndex] = {};
                }
                
                // Update the current demon data for this round
                this.currentGame.rounds[roundIndex] = {
                    demon: data.currentDemon.demon,
                    actual: data.currentDemon.actual
                };
                
                // Also update currentDemon for immediate display
                this.currentGame.currentDemon = data.currentDemon.demon;
            } else {
                console.log('📝 [DEMON PRESERVE] Keeping local demon data instead of server placeholder');
            }
        }
        
        // CRITICAL: Always ensure we have demon data for results display
        // If no demon data from server, make sure we preserve the local demon
        const roundIndex = (data.round || this.currentGame.currentRound) - 1;
        if (!this.currentGame.rounds[roundIndex] && this.currentGame.currentDemon) {
            console.log('📝 [DEMON BACKUP] Storing local demon data for results display');
            this.currentGame.rounds[roundIndex] = {
                demon: this.currentGame.currentDemon,
                actual: this.currentGame.currentDemon.position
            };
        }
        
        // Additional backup: Store local demon data in rounds if we have it and it's real
        if (this.currentGame.currentDemon && 
            this.currentGame.currentDemon.name && 
            this.currentGame.currentDemon.name !== 'Current Demon') {
            
            if (!this.currentGame.rounds[roundIndex] || 
                !this.currentGame.rounds[roundIndex].demon || 
                this.currentGame.rounds[roundIndex].demon.name === 'Current Demon') {
                
                console.log('📝 [DEMON FORCE BACKUP] Force storing real local demon data');
                this.currentGame.rounds[roundIndex] = {
                    demon: this.currentGame.currentDemon,
                    actual: this.currentGame.currentDemon.position
                };
            }
        }
        
        // Handle FFA score updates
        if (this.currentGame.gameType === 'ffa') {
            const scores = data.scores || {};
            const guesses = data.guesses || {};
            const totalScores = data.totalScores || {};
            
            console.log('[CLIENT] Received totalScores from server:', totalScores);
            console.log('[CLIENT] Current local ffaScores before update:', this.currentGame.ffaScores);
            
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
            
            console.log('[CLIENT] Updated local ffaScores after server sync:', this.currentGame.ffaScores);
            
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
                console.log(`[${playerType} TRACKING] Server total score:`, totalScore, 'for player:', playerId);
            }
        }
        
        // Still store round scores for clash logic
        for (const [playerId, score] of Object.entries(scores)) {
            if (playerId !== currentUserId && score !== undefined) {
                this.currentGame.duelState.roundScores[playerId] = score;
                console.log('📨 [ROUND TRACKING] Round score:', score, 'for player:', playerId);

                // Store our own score from server data (important for timer auto-submission)
                if (scores[currentUserId] !== undefined) {
                    this.currentGame.duelState.roundScores[currentUserId] = scores[currentUserId];
                    console.log('📨 [TIMER FIX] Storing own score from server:', scores[currentUserId]);
                }

                // If we have both players' scores (either from manual submission or timer auto-submit), trigger clash
                if (this.currentGame.duelState.roundScores[currentUserId] !== undefined) {

                    // Don't trigger clash if already triggered by submitDuelScore
                    if (!this.currentGame.duelState.clashReady) {
                        this.currentGame.duelState.clashReady = true;
                        this.triggerDuelClash();
                    }
                } else {
                    console.log('⏳ [TIMER FIX] Waiting for own score before triggering clash');
                }
                break;
            }
        }
        
        // Handle single player scenario (when damageResult is null)
        if (data.damageResult === null) {
            console.log('🏃 [SINGLE PLAYER] Only one player remaining - checking for health data');
            console.log('🏃 [SINGLE PLAYER] Full data received:', JSON.stringify(data, null, 2));
            
            // CRITICAL: Check if there's still health data even though damageResult is null
            // This can happen if damage was calculated before the player left
            if (data.health) {
                console.log('🏥 [SINGLE PLAYER] Found health data despite null damageResult:', data.health);
                this.currentGame.pendingHealthUpdate = { ...data.health };
                console.log('🏥 [SINGLE PLAYER] Stored pending health update for display');
            }
            
            // CRITICAL: Clear all countdown timers to prevent auto-advance
            if (this.currentGame.duelState?.countdown) {
                console.log('[SINGLE PLAYER] Clearing countdown timer to prevent auto-advance');
                clearTimeout(this.currentGame.duelState.countdown);
                this.currentGame.duelState.countdown = null;
            }
            if (this.currentGame.duelState?.countdownInterval) {
                console.log('[SINGLE PLAYER] Clearing countdown display interval');
                clearInterval(this.currentGame.duelState.countdownInterval);
                this.currentGame.duelState.countdownInterval = null;
            }
            
            // Handle different game types when only one player remains
            if (this.currentGame.gameType === 'duels') {
                console.log('🏃 [SINGLE PLAYER] Duel opponent left - showing summary and waiting for user input');
                
                // Show duel results screen and let player manually continue
                this.showDuelResults();
                
                // Force update health display immediately
                setTimeout(() => {
                    console.log('🏃 [SINGLE PLAYER] Forcing health display update after opponent left');
                    this.updateDuelDisplay();
                }, 100);
                
                // Update button text to indicate what will happen
                setTimeout(() => {
                    const nextBtn = document.getElementById('duelNextRoundBtn');
                    if (nextBtn) {
                        if (this.currentGame.currentRound >= this.currentGame.totalRounds || 
                            this.currentGame.currentRound >= 10) {
                            nextBtn.textContent = 'End Game (Opponent Left)';
                        } else {
                            nextBtn.textContent = 'Next Round (Opponent Left)';
                        }
                    }
                }, 100);
                
            } else if (this.currentGame.gameType === 'ffa') {
                console.log('🏃 [SINGLE PLAYER] FFA player(s) left - showing summary and waiting for user input');
                
                // Show FFA results and let player manually continue
                this.showFFAResults();
                
                // Update button text
                setTimeout(() => {
                    const nextBtn = document.getElementById('nextRoundBtn');
                    if (nextBtn) {
                        if (this.currentGame.currentRound >= this.currentGame.totalRounds) {
                            nextBtn.textContent = 'View Final Results';
                        } else {
                            nextBtn.textContent = 'Next Round';
                        }
                    }
                }, 100);
            }
            return; // Don't process damage/clash logic
        }
        
        // Store server damage result AND UPDATE HEALTH
        if (data.damageResult) {
            console.log('[DEBUG] Received damage result from server:', data.damageResult);
            console.log('🔍 [TIMER-DEBUG] 📡 SERVER DAMAGE RESULT RECEIVED - timestamp:', new Date().toISOString());
            
            this.currentGame.lastServerDamageResult = data.damageResult;
            
            // CRITICAL: Store server health but don't apply immediately during clash animation
            if (data.damageResult.health) {
                console.log('[HEALTH SYNC] Receiving server health update:', data.damageResult.health);
                console.log('[HEALTH SYNC] Previous client health:', this.currentGame.duelHealth);
                
                // Store new health values to apply at game summary
                this.currentGame.pendingHealthUpdate = { ...data.damageResult.health };
                
                // Mark that we have server health so we don't overwrite it
                this.currentGame.hasServerHealth = true;
                
                console.log('[HEALTH SYNC] Stored pending health update (will apply at game summary):', this.currentGame.pendingHealthUpdate);
                console.log('🟢🟢🟢 SERVER HEALTH STORED - will update at game summary');
                console.log('🔍 [TIMER-DEBUG] Health update received - checking if timer expiration case');
                console.log('🔍 [TIMER-DEBUG] Current screen:', document.querySelector('.screen.active')?.id);
                console.log('🔍 [TIMER-DEBUG] Results screen active:', document.getElementById('resultsScreen')?.classList.contains('active'));
                
                // FIX: Initialize duelHealth if it's empty
                if (!this.currentGame.duelHealth || Object.keys(this.currentGame.duelHealth).length === 0) {
                    console.log('🚨 [HEALTH FIX] duelHealth was empty! Initializing from party members');
                    if (this.currentParty && this.currentParty.members && this.currentParty.members.length >= 2) {
                        this.currentGame.duelHealth = {
                            [this.currentParty.members[0].id]: 100,
                            [this.currentParty.members[1].id]: 100
                        };
                        console.log('🚨 [HEALTH FIX] Initialized duelHealth to:', this.currentGame.duelHealth);
                    }
                }
                
                // SOLUTION 2: ALWAYS apply health update immediately when received
                console.log('[HEALTH-DEBUG] 📡 SERVER HEALTH RECEIVED');
                console.log('[HEALTH-DEBUG] OLD duelHealth:', JSON.stringify(this.currentGame.duelHealth));
                console.log('[HEALTH-DEBUG] NEW health from server:', JSON.stringify(this.currentGame.pendingHealthUpdate));
                console.log('[HEALTH-DEBUG] Party member IDs:', this.currentParty?.members?.map(m => ({id: m.id, name: m.name})));
                console.log('[HEALTH-DEBUG] Current user ID:', this.getCurrentUserId());
                
                // DON'T apply health here - let showDuelResults handle it properly
                // this.currentGame.duelHealth = { ...this.currentGame.pendingHealthUpdate };
                // this.currentGame.pendingHealthUpdate = null;
                
                console.log('[HEALTH-DEBUG] Stored pending health for showDuelResults to apply');
                console.log('[HEALTH-DEBUG] pendingHealthUpdate:', JSON.stringify(this.currentGame.pendingHealthUpdate));
                console.log('[HEALTH-DEBUG] Will be applied when showing results');
                
                // Check for victory condition based on pending health values
                const player1Id = this.currentParty.members[0].id;
                const player2Id = this.currentParty.members[1].id;
                
                if (this.currentGame.pendingHealthUpdate[player1Id] <= 0 || this.currentGame.pendingHealthUpdate[player2Id] <= 0) {
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
                
                // CRITICAL: Don't update display immediately - keep old values during clash
                console.log('[HEALTH SYNC] NOT updating display yet - waiting for clash animation to finish');
                
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
            
            // Also store demon data if received from server
            if (data.currentDemon) {
                this.currentGame.clashData.currentDemon = data.currentDemon;
                console.log('📝 [CLASH DATA] Stored demon data for clash display:', data.currentDemon);
            }
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
            // PRIORITY 1: Use Socket.io ID if available (most reliable for multiplayer)
            if (window.multiplayerManager && window.multiplayerManager.socket && window.multiplayerManager.socket.id) {
                console.log('✅ Using Socket.io ID:', window.multiplayerManager.socket.id);
                return window.multiplayerManager.socket.id;
            }
            
            // PRIORITY 2: Try to find current user in party members by username
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
        console.log('🔍 [TIMER-DEBUG] updateDuelDisplay called');
        console.log('🔍 [TIMER-DEBUG] Current duelHealth values:', this.currentGame.duelHealth);
        console.log('🔍 [TIMER-DEBUG] Current screen:', document.querySelector('.screen.active')?.id);
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

    forceHealthBarUpdate() {
        console.log('[HEALTH-DEBUG] 🔄 forceHealthBarUpdate called');
        console.log('[HEALTH-DEBUG] Current duelHealth:', JSON.stringify(this.currentGame.duelHealth));
        
        if (!this.currentGame.duelHealth) {
            console.log('[HEALTH-DEBUG] ❌ No duelHealth - returning');
            return;
        }
        
        // SIMPLE FIX: Just use the two health values directly without ID mapping
        const healthValues = Object.values(this.currentGame.duelHealth);
        const healthKeys = Object.keys(this.currentGame.duelHealth);
        
        console.log('[HEALTH-DEBUG] Available health keys:', healthKeys);
        console.log('[HEALTH-DEBUG] Available health values:', healthValues);
        console.log('[HEALTH-DEBUG] Party member IDs:', this.currentParty?.members?.map(m => m.id));
        console.log('[HEALTH-DEBUG] Current user ID:', this.getCurrentUserId());
        
        if (healthValues.length < 2) {
            console.log('[HEALTH-DEBUG] ❌ Not enough health values - returning');
            return;
        }
        
        // Simple approach: Use values in order, find which one is lower (damaged player)
        const health1 = healthValues[0];
        const health2 = healthValues[1];
        
        // Determine which player took damage by checking current user ID
        const currentUserId = this.getCurrentUserId();
        let player1Health, player2Health;
        
        if (healthKeys[0] === currentUserId) {
            // Current user is first in health object
            player1Health = health1;  // "You"
            player2Health = health2;  // "Opponent"
        } else {
            // Current user is second in health object
            player1Health = health2;  // "You" 
            player2Health = health1;  // "Opponent"
        }
        
        console.log('[HEALTH-DEBUG] Health values:', { 
            player1Health, 
            player2Health,
            health1,
            health2,
            currentUserIdMatch: healthKeys[0] === currentUserId
        });
        
        // Get the actual elements (player1 is always left, player2 is always right)
        const player1HealthFill = document.getElementById('player1Health');
        const player1HealthText = document.getElementById('player1HealthValue');
        const player2HealthFill = document.getElementById('player2Health');
        const player2HealthText = document.getElementById('player2HealthValue');
        
        console.log('[HEALTH-DEBUG] DOM elements found:', {
            player1HealthFill: !!player1HealthFill,
            player1HealthText: !!player1HealthText,
            player2HealthFill: !!player2HealthFill,
            player2HealthText: !!player2HealthText
        });
        
        // Just update both health bars with their actual values
        if (player1HealthFill && player1HealthText) {
            console.log('[HEALTH-DEBUG] 🔧 Updating Player 1 health bar to:', player1Health);
            console.log('[HEALTH-DEBUG] 🔧 Player1 element ID:', player1HealthFill.id, 'current width before:', player1HealthFill.style.width);
            player1HealthFill.style.width = `${player1Health}%`;
            player1HealthText.textContent = `${player1Health}/100`;
            console.log('[HEALTH-DEBUG] 🔧 Player1 width after update:', player1HealthFill.style.width);
        }
        
        if (player2HealthFill && player2HealthText) {
            console.log('[HEALTH-DEBUG] 🔧 Updating Player 2 health bar to:', player2Health);
            console.log('[HEALTH-DEBUG] 🔧 Player2 element ID:', player2HealthFill.id, 'current width before:', player2HealthFill.style.width);
            player2HealthFill.style.width = `${player2Health}%`;
            player2HealthText.textContent = `${player2Health}/100`;
            console.log('[HEALTH-DEBUG] 🔧 Player2 width after update:', player2HealthFill.style.width);
        }
        
        console.log('[HEALTH-DEBUG] ✅ forceHealthBarUpdate complete');
        
        // MUTATION OBSERVER: Track what changes the health bars after we set them
        if (player1HealthFill && player2HealthFill) {
            this.setupHealthBarWatcher(player1HealthFill, player2HealthFill, player1Health, player2Health);
        }
        
        // Check if DOM values get overridden after a delay
        setTimeout(() => {
            const currentPlayer1Width = player1HealthFill?.style.width;
            const currentPlayer2Width = player2HealthFill?.style.width;
            const currentPlayer1Text = player1HealthText?.textContent;
            const currentPlayer2Text = player2HealthText?.textContent;
            console.log('[HEALTH-DEBUG] 🔍 DOM CHECK after 100ms:');
            console.log('[HEALTH-DEBUG] Player1 width:', currentPlayer1Width, 'text:', currentPlayer1Text);
            console.log('[HEALTH-DEBUG] Player2 width:', currentPlayer2Width, 'text:', currentPlayer2Text);
            if (currentPlayer1Width !== `${player1Health}%` || currentPlayer2Width !== `${player2Health}%`) {
                console.log('[HEALTH-DEBUG] ❌ VALUES WERE OVERRIDDEN! Something else changed the DOM');
            } else {
                console.log('[HEALTH-DEBUG] ✅ Values are still correct');
            }
        }, 100);
    }

    setupHealthBarWatcher(player1Element, player2Element, expectedP1Health, expectedP2Health) {
        console.log('[MUTATION-OBSERVER] 🔍 Setting up health bar watchers');
        
        // Create mutation observer for player 1 health bar
        const observer1 = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    const newWidth = player1Element.style.width;
                    const expectedWidth = `${expectedP1Health}%`;
                    if (newWidth !== expectedWidth) {
                        console.log('[MUTATION-OBSERVER] 🚨 PLAYER 1 HEALTH BAR OVERRIDDEN!');
                        console.log('[MUTATION-OBSERVER] Expected:', expectedWidth, 'Got:', newWidth);
                        console.log('[MUTATION-OBSERVER] Call stack:', new Error().stack);
                    }
                }
            });
        });
        
        // Create mutation observer for player 2 health bar
        const observer2 = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    const newWidth = player2Element.style.width;
                    const expectedWidth = `${expectedP2Health}%`;
                    if (newWidth !== expectedWidth) {
                        console.log('[MUTATION-OBSERVER] 🚨 PLAYER 2 HEALTH BAR OVERRIDDEN!');
                        console.log('[MUTATION-OBSERVER] Expected:', expectedWidth, 'Got:', newWidth);
                        console.log('[MUTATION-OBSERVER] Call stack:', new Error().stack);
                    }
                }
            });
        });
        
        // Start observing
        observer1.observe(player1Element, { attributes: true, attributeFilter: ['style'] });
        observer2.observe(player2Element, { attributes: true, attributeFilter: ['style'] });
        
        // Stop observing after 5 seconds
        setTimeout(() => {
            observer1.disconnect();
            observer2.disconnect();
            console.log('[MUTATION-OBSERVER] ✅ Watchers disconnected after 5 seconds');
        }, 5000);
    }

    updateDuelDisplayText() {
        console.log('[DEBUG] updateDuelDisplayText called - updating only text values and colors');
        if (!this.currentGame.duelHealth) {
            return;
        }
        
        // Get player IDs and map health
        const memberIds = this.currentParty.members.map(m => m.id);
        const currentUserId = this.getCurrentUserId();
        const opponentId = memberIds.find(id => id !== currentUserId);
        
        const myHealth = this.currentGame.duelHealth[currentUserId] || 0;
        const opponentHealth = this.currentGame.duelHealth[opponentId] || 0;
        
        // Update text values
        const player1Value = document.getElementById('player1HealthValue');
        const player2Value = document.getElementById('player2HealthValue');
        
        if (player1Value) {
            player1Value.textContent = `${myHealth}/100`;
        }
        if (player2Value) {
            player2Value.textContent = `${opponentHealth}/100`;
        }
        
        // Update colors only (not width)
        const player1Bar = document.getElementById('player1Health');
        const player2Bar = document.getElementById('player2Health');
        
        if (player1Bar) {
            if (myHealth > 50) {
                player1Bar.style.background = '#4CAF50';
                player1Bar.style.backgroundColor = '#4CAF50';
            } else if (myHealth > 10) {
                player1Bar.style.background = '#FFC107';
                player1Bar.style.backgroundColor = '#FFC107';
            } else {
                player1Bar.style.background = '#F44336';
                player1Bar.style.backgroundColor = '#F44336';
            }
        }
        
        if (player2Bar) {
            if (opponentHealth > 50) {
                player2Bar.style.background = '#4CAF50';
                player2Bar.style.backgroundColor = '#4CAF50';
            } else if (opponentHealth > 10) {
                player2Bar.style.background = '#FFC107';
                player2Bar.style.backgroundColor = '#FFC107';
            } else {
                player2Bar.style.background = '#F44336';
                player2Bar.style.backgroundColor = '#F44336';
            }
        }
    }

    updateHealthAtGameSummary() {
        console.log('🩺 [HEALTH UPDATE] Updating health at game summary');

        // Prefer pendingHealthUpdate (from roundComplete) — it's always the most recent
        // authoritative data for the current round. currentParty.duelHealth can be stale
        // because game.js and multiplayer.js hold separate party references.
        // NOTE: Don't nullify pendingHealthUpdate here — it may be needed by subsequent
        // calls if updateDuelDisplay bails (e.g. clash screen is up). Cleared on new round.
        if (this.currentGame.pendingHealthUpdate) {
            console.log('🩺 [HEALTH UPDATE] Applying pending health update:', this.currentGame.pendingHealthUpdate);

            this.currentGame.duelHealth = { ...this.currentGame.pendingHealthUpdate };
            this.currentGame.healthJustAnimated = true;
            this.updateDuelDisplay();

            console.log('🩺 [HEALTH UPDATE] Health updated to:', this.currentGame.duelHealth);
            return;
        }

        // Fallback: use party health data
        if (this.currentParty && this.currentParty.duelHealth) {
            console.log('🩺 [HEALTH UPDATE] Using health from party:', this.currentParty.duelHealth);
            this.currentGame.duelHealth = { ...this.currentParty.duelHealth };
            this.currentGame.healthJustAnimated = true;
            this.updateDuelDisplay();
            console.log('🩺 [HEALTH UPDATE] Health updated from party to:', this.currentGame.duelHealth);
            return;
        }

        console.log('🩺 [HEALTH UPDATE] No health data available - current health:', this.currentGame.duelHealth);
        this.updateDuelDisplay();
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
            console.log('🔍 [TIMER-DEBUG] showResult called for duels - checking health state');
            console.log('🔍 [TIMER-DEBUG] Current duelHealth:', this.currentGame.duelHealth);
            
            // Health update is now handled in showDuelResults() before calling showResult()
            // Just update the display with the current health values  
            console.log('🩺 [SHOW RESULT] Using current health (already updated in showDuelResults):', this.currentGame.duelHealth);
            
            this.updateDuelDisplay();
            
            // AGGRESSIVE HEALTH FIX: Force update health bars with current values
            console.log('🔍 [TIMER-DEBUG] 💪 AGGRESSIVE: Forcing health bar update with current values');
            this.forceHealthBarUpdate();
            
            // No fallback needed - health is already applied in showDuelResults()
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
            
            if (this.currentGame.isParty) {
                if (this.isHost) {
                    console.log('🎯 [BUTTON] Host broadcasting showFinalResults to all players');
                    // Broadcast to all players to show results
                    if (window.multiplayerManager) {
                        window.multiplayerManager.socket.emit('showFinalResults', {
                            partyCode: this.currentParty?.code
                        });
                        console.log('🎯 [BUTTON] showFinalResults broadcast sent');
                    }
                } else {
                    console.log('🎯 [BUTTON] Non-host requesting showFinalResults from server');
                    // Non-host can also request final results
                    if (window.multiplayerManager) {
                        window.multiplayerManager.socket.emit('showFinalResults', {
                            partyCode: this.currentParty?.code
                        });
                        console.log('🎯 [BUTTON] Non-host showFinalResults request sent');
                    }
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
            console.log('[QUIT] Ignoring endGame because user has quit - staying on home screen');
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
        
        // CRITICAL: Clean up all overlays and reset game state to prevent re-triggering
        console.log('🧹 [CLEANUP] Cleaning up all game overlays and state');
        
        // Use comprehensive cleanup function
        this.cleanupGameUI();
        
        // Remove FFA waiting overlay
        const ffaWaitingOverlay = document.getElementById('ffaWaitingOverlay');
        if (ffaWaitingOverlay) {
            ffaWaitingOverlay.remove();
            console.log('🧹 [CLEANUP] Removed FFA waiting overlay');
        }
        
        // Remove duel overlays
        const duelWaitingOverlay = document.getElementById('duelWaitingOverlay');
        if (duelWaitingOverlay) {
            duelWaitingOverlay.remove();
            console.log('🧹 [CLEANUP] Removed duel waiting overlay');
        }
        
        const clashScreen = document.getElementById('clashScreen');
        if (clashScreen) {
            clashScreen.remove();
            console.log('🧹 [CLEANUP] Removed clash screen');
        }
        
        const detailedResults = document.getElementById('detailedDuelResults');
        if (detailedResults) {
            detailedResults.remove();
            console.log('🧹 [CLEANUP] Removed detailed duel results');
        }
        
        // CRITICAL: Mark game as completely finished to prevent any further state changes
        if (this.currentGame) {
            this.currentGame.isFinished = true;
            this.currentGame.gameActive = false;
            console.log('🧹 [CLEANUP] Marked game as finished');
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
            console.log('[QUIT] User has quit - preventing automatic screen transitions');
            this.userHasQuit = true;
            
            // Stop any running timer to prevent automatic guess submission
            if (this.currentTimer) {
                console.log('[QUIT] Clearing FFA timer to prevent automatic round completion');
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

        // If in a party, leave and refresh the page
        if (this.currentParty) {
            console.log('🚪 [HOME] Leaving party — refreshing page');
            if (window.multiplayerManager?.socket?.connected) {
                window.multiplayerManager.socket.emit('leaveParty');
            }
            const cleanUrl = window.location.origin + window.location.pathname;
            window.location.href = cleanUrl;
            return;
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
    

    kickPlayer(playerId) {
        if (!this.isHost) {
            console.error('❌ [CLIENT] Only host can kick players');
            return;
        }

        if (!this.currentParty) {
            console.error('❌ [CLIENT] No party to kick from');
            return;
        }

        const playerToKick = this.currentParty.members.find(m => m.id === playerId);
        if (!playerToKick) {
            console.error('❌ [CLIENT] Player not found in party');
            return;
        }

        // Confirm kick action
        const confirmKick = confirm(`Are you sure you want to kick ${playerToKick.name} from the party?`);
        if (!confirmKick) {
            return;
        }

        console.log('👢 [CLIENT] Host kicking player:', playerToKick.name, playerId);
        
        // Add kick functionality to multiplayer manager
        if (window.multiplayerManager?.isConnected()) {
            // Emit kick event to server
            window.multiplayerManager.socket.emit('kickPlayer', { 
                playerId: playerId,
                playerName: playerToKick.name
            });
            console.log('👢 [CLIENT] Kick request sent to server');
        } else {
            console.error('❌ [CLIENT] Not connected to server, cannot kick player');
            alert('Cannot kick player - not connected to server');
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
        return [];
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
            if (leaderboard.length === 0) {
                leaderboardList.innerHTML = '<div class="leaderboard-item">No scores yet!</div>';
            } else {
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
    
    // Set up multiplayer event callbacks - DUPLICATE REMOVED
    setupMultiplayerCallbacks_REMOVED() {
        // This function was a duplicate causing conflicts
        // The real setupMultiplayerCallbacks() is defined earlier
        return;
        
        window.multiplayerManager.onConnected = () => {
            console.log('[MULTIPLAYER] Connected to server');
        };
        
        // onPartyCreated callback is already set in setupMultiplayerCallbacks()
        // onJoinSuccess callback is already set in setupMultiplayerCallbacks()
        // Don't override it here to avoid conflicts
        
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
            this.handleMultiplayerGameStart(data);
        };
        
        // Remove duplicate onRoundComplete callback - already set above
        
        // Add missing onNextRoundStarted callback
        window.multiplayerManager.onNextRoundStarted = (data) => {
            console.log('🎯 [CLIENT] onNextRoundStarted callback triggered with data:', data);
            this.handleNextRoundStarted(data);
        };
        
        // Add missing onPlayerScoreSubmitted callback
        window.multiplayerManager.onPlayerScoreSubmitted = (data) => {
            console.log('[CLIENT] onPlayerScoreSubmitted callback triggered with data:', data);
            this.handlePlayerScoreSubmitted(data);
        };
        
        // Add missing onDuelVictory callback
        window.multiplayerManager.onDuelVictory = (data) => {
            console.log('🏆 [CLIENT] Duel victory received from server:', data);
            this.handleDuelVictory(data);
        };

        window.multiplayerManager.onDuelViewSummary = (data) => {
            console.log('📊 [CLIENT] Host requested final results screen');
            this.handleShowFinalResults(data);
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
        console.log('🟡 [SHOW-PARTY-SETUP] ========== SHOW PARTY SETUP CALLED ==========');

        if (!window.multiplayerManager) {
            console.error('🟡 [SHOW-PARTY-SETUP] ❌ Multiplayer manager not found!');
            alert('Multiplayer system not initialized. Please refresh the page.');
            return;
        }

        console.log('🟡 [SHOW-PARTY-SETUP] Multiplayer manager exists');
        console.log('🟡 [SHOW-PARTY-SETUP] Connected:', window.multiplayerManager.connected);
        console.log('🟡 [SHOW-PARTY-SETUP] onPartyCreated callback set:', typeof window.multiplayerManager.onPartyCreated === 'function');

        if (!window.multiplayerManager.connected) {
            // Try to connect if not connected
            console.log('[CLIENT] Attempting to connect to multiplayer server...');
            window.multiplayerManager.connect();

            // Give a brief moment for connection, then show screen anyway
            setTimeout(() => {
                if (!window.multiplayerManager.connected) {
                    console.warn('[CLIENT] Still connecting to multiplayer server...');
                    alert('Connecting to multiplayer server... This may take a moment. You can try creating/joining a party in a few seconds.');
                }
            }, 1000);
        }

        const username = localStorage.getItem('username') || 'Player';
        console.log('🟡 [SHOW-PARTY-SETUP] Creating party for username:', username);
        console.log('🟡 [SHOW-PARTY-SETUP] Calling multiplayerManager.createParty()...');
        window.multiplayerManager.createParty(username);
        console.log('🟡 [SHOW-PARTY-SETUP] createParty() call completed (waiting for server response)');
    }
    
    showJoinParty() {
        this.showScreen('joinPartyScreen');
    }
    
    joinParty() {
        if (!window.multiplayerManager) {
            alert('Multiplayer system not initialized. Please refresh the page.');
            return;
        }
        
        if (!window.multiplayerManager.connected) {
            alert('Connecting to multiplayer server... Please try again in a moment.');
            // Try to connect
            window.multiplayerManager.connect();
            return;
        }
        
        const code = document.getElementById('joinPartyCode').value.trim().toUpperCase();
        if (!code) {
            alert('Please enter a party code');
            return;
        }
        
        if (code.length !== 6) {
            alert('Party code must be 6 characters!');
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
        console.log('🎯 [PARTY DISPLAY] updatePartyDisplay called');
        if (!this.currentParty) {
            console.log('🎯 [PARTY DISPLAY] No current party, returning');
            return;
        }
        
        console.log('🎯 [PARTY DISPLAY] Current party members:', this.currentParty.members);
        
        const memberCount = document.getElementById('memberCount');
        const membersList = document.getElementById('membersList');
        
        console.log('🎯 [PARTY DISPLAY] Elements found:', {
            memberCount: !!memberCount,
            membersList: !!membersList
        });
        
        if (memberCount) {
            memberCount.textContent = this.currentParty.members.length;
        }
        
        if (membersList) {
            console.log('🎯 [PARTY DISPLAY] Clearing and rebuilding member list');
            membersList.innerHTML = '';
            this.currentParty.members.forEach((member, index) => {
                console.log(`🎯 [PARTY DISPLAY] Processing member ${index + 1}:`, member);
                const memberDiv = document.createElement('div');
                memberDiv.className = 'member-item';
                memberDiv.setAttribute('data-member-id', member.id);
                
                const isHost = member.id === this.currentParty.host;
                const isMe = member.id === window.multiplayerManager?.getSocketId();
                const canKick = this.isHost && !isHost && !isMe; // Host can kick non-host members (not themselves)
                
                // Get avatar (use first letter of name)
                const avatarLetter = member.name.charAt(0).toUpperCase() || 'P';
                
                memberDiv.innerHTML = `
                    <div class="member-info">
                        <div class="member-avatar">${avatarLetter}</div>
                        <div class="member-details">
                            <div class="member-name">${member.name}${isMe ? ' (You)' : ''}</div>
                            <div class="member-role">${isHost ? 'Host' : 'Player'}</div>
                        </div>
                    </div>
                    <div class="member-actions">
                        <span class="member-status">Ready</span>
                        ${canKick ? `<button class="kick-btn" onclick="window.game.kickPlayer('${member.id}')">Kick</button>` : ''}
                    </div>
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

    clearPartyUI() {
        console.log('🧹 [PARTY] Clearing party UI elements');
        
        // Clear party code display span
        const partyCodeSpan = document.getElementById('partyCode');
        if (partyCodeSpan) {
            console.log('🧹 [PARTY] Clearing party code span');
            partyCodeSpan.textContent = 'Generating...';
        }
        
        // Clear the join party code input
        const joinPartyCodeInput = document.getElementById('joinPartyCode'); 
        if (joinPartyCodeInput) {
            console.log('🧹 [PARTY] Clearing join party code input');
            joinPartyCodeInput.value = '';
        }
        
        // Clear any party-related input fields by class
        const partyInputs = document.querySelectorAll('.party-code-input, .party-input, input[id*="party"], input[id*="Party"]');
        partyInputs.forEach(input => {
            console.log('🧹 [PARTY] Clearing input:', input.id || input.className);
            if (input.type === 'text') {
                input.value = '';
            }
        })
        
        // Clear member count and list
        const memberCount = document.getElementById('memberCount');
        const membersList = document.getElementById('membersList');
        
        if (memberCount) {
            memberCount.textContent = '';
        }
        
        if (membersList) {
            membersList.innerHTML = '';
        }
        
        // Hide party-specific elements
        const partyElements = document.querySelectorAll('.party-visual-display, #partyVisualDisplay, .member-item, .party-member');
        partyElements.forEach(el => {
            el.style.display = 'none';
            if (el.classList.contains('member-item') || el.classList.contains('party-member')) {
                el.remove();
            }
        });
        
        // Hide start button
        const startBtn = document.getElementById('startPartyBtn');
        if (startBtn) {
            startBtn.style.display = 'none';
        }
        
        console.log('🧹 [PARTY] Party UI cleared');
    }
}

// Enable detailed debug logging with: localStorage.setItem('debug', 'true')
// Disable with: localStorage.removeItem('debug')

// Wait for DOM to be ready before initializing game
document.addEventListener('DOMContentLoaded', function() {
    console.log('[DEBUG] DOM loaded, creating game instance');
    const game = new DemonListGuessr();
    window.game = game;
    console.log('[DEBUG] Game instance created and assigned to window.game');
    
    // Set up party back button event listener
    const partyBackBtn = document.getElementById('partyBackBtn');
    if (partyBackBtn) {
        partyBackBtn.addEventListener('click', function() {
            console.log('🚪 Party back button clicked!');
            if (window.game && window.game.leaveCurrentParty) {
                window.game.leaveCurrentParty();
            } else {
                console.error('Game not loaded yet');
            }
        });
    }
});
