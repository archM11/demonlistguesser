#!/bin/bash

echo "🚀 Setting up DemonList Guessr Multiplayer..."

# Install Node.js dependencies
echo "📦 Installing dependencies..."
npm install

echo "✅ Setup complete!"
echo ""
echo "To run the servers:"
echo "1. Start the multiplayer server: npm start (runs on port 3002)"
echo "2. In another terminal, start the game server: npm run serve (runs on port 3001)"
echo ""
echo "Then open http://localhost:3001 in your browser!"