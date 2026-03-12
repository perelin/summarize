#!/usr/bin/env bash
set -euo pipefail

# Sync local config.json to production server.
#
# Usage: ./scripts/deploy-config.sh [--dry-run]

REMOTE_HOST="pve-htz-docker"
REMOTE_CONFIG="/opt/apps/summarize/data/config.json"
LOCAL_CONFIG="$(cd "$(dirname "$0")/.." && pwd)/config.json"

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

if [[ ! -f "$LOCAL_CONFIG" ]]; then
  echo "Error: local config.json not found at $LOCAL_CONFIG" >&2
  echo "Copy config.example.json to config.json and fill in your accounts." >&2
  exit 1
fi

echo "Local:  $LOCAL_CONFIG"
echo "Remote: $REMOTE_HOST:$REMOTE_CONFIG"
echo ""

# Fetch remote config for diff
REMOTE_CONTENT=$(ssh "$REMOTE_HOST" "cat $REMOTE_CONFIG 2>/dev/null" || echo "")

if [[ -z "$REMOTE_CONTENT" ]]; then
  echo "Remote config does not exist yet. Will create it."
else
  REMOTE_TMP=$(mktemp)
  LOCAL_TMP=$(mktemp)
  trap 'rm -f "$REMOTE_TMP" "$LOCAL_TMP"' EXIT
  echo "$REMOTE_CONTENT" > "$REMOTE_TMP"
  cat "$LOCAL_CONFIG" > "$LOCAL_TMP"

  if diff -q "$LOCAL_TMP" "$REMOTE_TMP" >/dev/null 2>&1; then
    echo "Remote config is already in sync."
    exit 0
  fi

  echo "Diff (remote → local):"
  diff --color=auto -u "$REMOTE_TMP" "$LOCAL_TMP" || true
fi

if $DRY_RUN; then
  echo ""
  echo "[dry-run] No changes applied."
  exit 0
fi

echo ""
read -r -p "Push local config to $REMOTE_HOST? [y/N] " confirm
if [[ "$confirm" != [yY] ]]; then
  echo "Aborted."
  exit 0
fi

scp "$LOCAL_CONFIG" "$REMOTE_HOST:$REMOTE_CONFIG"
echo "Config synced. Restart the container to apply:"
echo "  ssh $REMOTE_HOST 'cd /opt/apps/summarize && docker compose restart'"
