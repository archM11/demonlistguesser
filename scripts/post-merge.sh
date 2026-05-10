#!/bin/bash
set -e

echo "Running post-merge setup..."

# Install dependencies if package.json changed
if git diff --name-only HEAD~1 HEAD 2>/dev/null | grep -q "package.json"; then
  echo "package.json changed, running npm install..."
  npm install --prefer-offline
fi

# Push to GitHub automatically after every task merge
bash scripts/sync-to-github.sh

echo "Post-merge setup complete."
