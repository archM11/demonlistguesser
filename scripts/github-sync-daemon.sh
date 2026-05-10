#!/bin/bash
# Background daemon that pushes new local commits to GitHub every 60 seconds.
# This ensures code changes made outside agent task merges are also synced.

INTERVAL=60

echo "GitHub sync daemon started. Checking every ${INTERVAL}s..."

while true; do
  if [ -n "$GITHUB_TOKEN" ]; then
    ORIGIN_URL=$(git remote get-url origin 2>/dev/null || echo "")

    if [ -n "$ORIGIN_URL" ]; then
      # Attempt the push directly and rely on the exit code to determine if
      # there was anything to push. This avoids a separate unauthenticated
      # ls-remote call that can fail or return empty for private repos.
      OUTPUT=$(git \
        -c "credential.helper=!f() { echo username=x-access-token; echo \"password=${GITHUB_TOKEN}\"; }; f" \
        push "$ORIGIN_URL" "HEAD:$(git symbolic-ref --short HEAD 2>/dev/null || git rev-parse --short HEAD)" \
        2>&1) && {
        if echo "$OUTPUT" | grep -q "Everything up-to-date"; then
          echo "[$(date -u +%H:%M:%S)] Already in sync."
        else
          echo "[$(date -u +%H:%M:%S)] Push complete: $(git rev-parse --short HEAD)"
        fi
      } || echo "[$(date -u +%H:%M:%S)] Push skipped or failed (non-fast-forward). Will retry."
    fi
  else
    echo "[$(date -u +%H:%M:%S)] GITHUB_TOKEN not set — sleeping."
  fi

  sleep "$INTERVAL"
done
