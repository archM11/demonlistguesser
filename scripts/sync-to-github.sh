#!/bin/bash
# Pushes committed local changes to the GitHub remote (origin).
# Credentials are passed ephemerally — the token never touches git config or the remote URL.
# Usage: bash scripts/sync-to-github.sh

set -e

if [ -z "$GITHUB_TOKEN" ]; then
  echo "GITHUB_TOKEN is not set — skipping GitHub push."
  exit 0
fi

# Derive the repo URL from the existing remote so nothing is hardcoded here.
ORIGIN_URL=$(git remote get-url origin)

# Derive the current branch dynamically (no hardcoded branch names).
CURRENT_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || git rev-parse --short HEAD)

# Push using an ephemeral credential helper scoped only to this command.
# The token is never written to .git/config or the remote URL.
git -c "credential.helper=!f() { echo username=x-access-token; echo \"password=${GITHUB_TOKEN}\"; }; f" \
  push "$ORIGIN_URL" "HEAD:${CURRENT_BRANCH}"

echo "Synced to GitHub: $(git rev-parse --short HEAD) -> ${CURRENT_BRANCH}"
