// Test script for FFA timer and round completion fixes
const io = require('socket.io-client');

// Wait for all connections before starting
let connections = 0;

// Connect multiple test clients
const host = io('http://localhost:3002');
const player2 = io('http://localhost:3002');
const player3 = io('http://localhost:3002');

let partyCode = null;
let testPhase = 1;

console.log('🧪 Starting FFA fix test...\n');

// Track connections
host.on('connect', () => {
    console.log('✅ Host connected');
    connections++;
    checkAllConnected();
});

player2.on('connect', () => {
    console.log('✅ Player2 connected');
    connections++;
    checkAllConnected();
});

player3.on('connect', () => {
    console.log('✅ Player3 connected');
    connections++;
    checkAllConnected();
});

function checkAllConnected() {
    if (connections === 3) {
        console.log('✅ All clients connected\n');
        // Host creates party after all are connected
        setTimeout(() => {
            host.emit('createParty', { username: 'Host' });
        }, 500);
    }
}

host.on('partyCreated', (data) => {
    partyCode = data.party.code;
    console.log(`🎉 Party created with code: ${partyCode}`);
    console.log('⏳ Waiting for other players to join...\n');
    
    // Have other players join
    setTimeout(() => {
        player2.emit('joinParty', { partyCode, username: 'Player2' });
    }, 500);
    
    setTimeout(() => {
        player3.emit('joinParty', { partyCode, username: 'Player3' });
    }, 1000);
});

// Track party updates
host.on('partyUpdated', (party) => {
    console.log(`👥 Party updated - Members: ${party.members.length}`);
    
    if (party.members.length === 3 && testPhase === 1) {
        testPhase = 2;
        console.log('\n🎮 Starting game with 3 players...');
        setTimeout(() => {
            host.emit('startGame', {
                lists: ['main'],
                timer: 30,
                gameType: 'ffa'
            });
        }, 1000);
    }
});

// Track game start
host.on('gameStarted', () => {
    console.log('🚀 Game started!\n');
    console.log('📝 TEST SCENARIO 1: All players submit normally');
    
    // All players submit scores
    setTimeout(() => {
        console.log('  - Host submitting score...');
        host.emit('submitScore', {
            score: 85,
            guess: 10,
            round: 1,
            totalScore: 85
        });
    }, 2000);
    
    setTimeout(() => {
        console.log('  - Player2 submitting score...');
        player2.emit('submitScore', {
            score: 72,
            guess: 15,
            round: 1,
            totalScore: 72
        });
    }, 3000);
    
    setTimeout(() => {
        console.log('  - Player3 submitting score...');
        player3.emit('submitScore', {
            score: 90,
            guess: 8,
            round: 1,
            totalScore: 90
        });
    }, 4000);
});

// Party join confirmations
player2.on('partyJoined', (data) => {
    console.log('  ✓ Player2 joined party');
});

player3.on('partyJoined', (data) => {
    console.log('  ✓ Player3 joined party');
});

player2.on('gameStarted', () => {
    console.log('  ✓ Player2 received game start');
});

player3.on('gameStarted', () => {
    console.log('  ✓ Player3 received game start');
});

// Track round completions
host.on('roundComplete', (data) => {
    console.log(`\n✅ Round ${data.round || 1} completed!`);
    console.log(`   Scores:`, data.scores);
    
    if (testPhase === 2) {
        testPhase = 3;
        console.log('\n📝 TEST SCENARIO 2: Player leaves mid-round');
        
        // Start next round
        setTimeout(() => {
            host.emit('nextRound', {});
        }, 1000);
    }
});

host.on('nextRoundStarted', (data) => {
    if (testPhase === 3) {
        console.log(`\n🔄 Round ${data.round} started`);
        
        // Host submits
        setTimeout(() => {
            console.log('  - Host submitting score...');
            host.emit('submitScore', {
                score: 80,
                guess: 12,
                round: 2,
                totalScore: 165
            });
        }, 1000);
        
        // Player 2 submits
        setTimeout(() => {
            console.log('  - Player2 submitting score...');
            player2.emit('submitScore', {
                score: 75,
                guess: 14,
                round: 2,
                totalScore: 147
            });
        }, 2000);
        
        // Player 3 disconnects before submitting
        setTimeout(() => {
            console.log('  - Player3 leaving the game...');
            player3.disconnect();
        }, 3000);
    }
});

// Track member leaving
host.on('memberLeft', (data) => {
    console.log(`\n⚠️  ${data.playerName} left the game`);
    console.log(`   Remaining players: ${data.remainingMembers}`);
    console.log('   ✓ Round should complete immediately since all remaining players have submitted');
});

// Second round completion
let roundCompletions = 0;
host.on('roundComplete', (data) => {
    roundCompletions++;
    if (roundCompletions === 2) {
        console.log(`\n✅ Round 2 completed automatically after player left!`);
        console.log(`   This confirms the fix is working correctly.`);
        console.log('\n🎉 TEST PASSED: Round completes immediately when all active players have submitted\n');
        
        // Clean up
        setTimeout(() => {
            host.disconnect();
            player2.disconnect();
            process.exit(0);
        }, 1000);
    }
});

// Error handling
host.on('error', (err) => console.error('Host error:', err));
player2.on('error', (err) => console.error('Player2 error:', err));
player3.on('error', (err) => console.error('Player3 error:', err));

// Timeout safety
setTimeout(() => {
    console.error('\n❌ Test timed out after 30 seconds');
    process.exit(1);
}, 30000);