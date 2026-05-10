#!/bin/bash
# Background daemon that pushes new local commits to GitHub every 60 seconds.
# This ensures code changes made outside agent task merges are also synced.

INTERVAL=60

echo "GitHub sync daemon started. Checking every ${INTERVAL}s..."

while true; do
  if [ -n "$GITHUB_TOKEN" ]; then
    ORIGIN_URL=$(git remote get-url origin 2>/dev/null || echo "")

    if [ -n "$ORIGIN_URL" ]; then
      # Count commits that exist locally but not on the remote ref
      LOCAL_SHA=$(git rev-parse HEAD 2>/dev/null || echo "")
      REMOTE_SHA=$(git ls-remote "$ORIGIN_URL" refs/heads/main 2>/dev/null | awk '{print $1}' || echo "")

      if [ -n "$LOCAL_SHA" ] && [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
        echo "[$(date -u +%H:%M:%S)] Local and remote differ — pushing..."
        bash scripts/sync-to-github.sh && echo "[$(date -u +%H:%M:%S)] Push complete." \
          || echo "[$(date -u +%H:%M:%S)] Push skipped or failed (non-fast-forward). Will retry."
      else
        echo "[$(date -u +%H:%M:%S)] Already in sync."
      fi
    fi
  else
    echo "[$(date -u +%H:%M:%S)] GITHUB_TOKEN not set — sleeping."
  fi

  sleep "$INTERVAL"
done
