#!/bin/bash
set -e

echo "Running post-merge setup..."

# Install dependencies if package.json changed
if git diff --name-only HEAD~1 HEAD 2>/dev/null | grep -q "package.json"; then
  echo "package.json changed, running npm install..."
  npm install --prefer-offline
fi

# Push to GitHub automatically using GITHUB_TOKEN
# Force push since Replit is the source of truth for this project
if [ -n "$GITHUB_TOKEN" ]; then
  echo "Pushing to GitHub..."
  git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/archM11/demonlistguesser.git"
  git push --force origin main
  echo "Successfully pushed to GitHub."
else
  echo "WARNING: GITHUB_TOKEN is not set. Skipping GitHub push."
fi

echo "Post-merge setup complete."
