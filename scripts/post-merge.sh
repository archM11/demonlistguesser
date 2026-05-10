#!/bin/bash
set -e

echo "Running post-merge setup..."

# Install dependencies if package.json changed
if git diff --name-only HEAD~1 HEAD 2>/dev/null | grep -q "package.json"; then
  echo "package.json changed, running npm install..."
  npm install --prefer-offline
fi

# Push to GitHub automatically using GITHUB_TOKEN.
# Credentials are passed ephemerally via a credential helper so the token
# is never stored in git config or the remote URL.
if [ -n "$GITHUB_TOKEN" ]; then
  echo "Pushing to GitHub..."

  # Ensure origin points to the unauthenticated HTTPS URL (no token in URL)
  git remote set-url origin "https://github.com/archM11/demonlistguesser.git"

  # Fetch latest state from origin so --force-with-lease can detect real conflicts
  GIT_ASKPASS="" GIT_TERMINAL_PROMPT=0 \
    git -c "credential.helper=!f() { echo username=x-access-token; echo \"password=${GITHUB_TOKEN}\"; }; f" \
    fetch origin main 2>/dev/null || true

  # Push using --force-with-lease (safer than --force: fails if remote advanced
  # unexpectedly since our last fetch, protecting against overwriting others' work)
  GIT_ASKPASS="" GIT_TERMINAL_PROMPT=0 \
    git -c "credential.helper=!f() { echo username=x-access-token; echo \"password=${GITHUB_TOKEN}\"; }; f" \
    push --force-with-lease origin main

  echo "Successfully pushed to GitHub."
else
  echo "WARNING: GITHUB_TOKEN is not set. Skipping GitHub push."
  echo "Set the GITHUB_TOKEN secret in Replit Secrets to enable automatic syncing."
fi

echo "Post-merge setup complete."
