#!/usr/bin/env bash
set -euo pipefail

# Sync local .env vars to production server, preserving remote-only settings.
#
# Usage: ./scripts/deploy-env.sh [--dry-run]
#
# Remote-only vars (never overwritten from local):
#   - *_BASE_URL (remote uses internal IPs)
#   - YT_DLP_*  (production-only)

REMOTE_HOST="pve-htz-docker"
REMOTE_ENV="/opt/apps/summarize/.env"
LOCAL_ENV="$(cd "$(dirname "$0")/.." && pwd)/.env"

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

# Vars that should never be synced from local to remote
SKIP_PATTERNS=(
  "_BASE_URL="
  "YT_DLP_"
)

should_skip() {
  local line="$1"
  for pat in "${SKIP_PATTERNS[@]}"; do
    if [[ "$line" == *"$pat"* ]]; then
      return 0
    fi
  done
  return 1
}

# Parse a .env file into KEY=VALUE pairs (strip comments and blank lines)
parse_env() {
  grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$1" | sed 's/#.*//' | sed 's/[[:space:]]*$//'
}

if [[ ! -f "$LOCAL_ENV" ]]; then
  echo "Error: local .env not found at $LOCAL_ENV" >&2
  exit 1
fi

echo "Fetching remote .env from $REMOTE_HOST:$REMOTE_ENV ..."
REMOTE_CONTENT=$(ssh "$REMOTE_HOST" "cat $REMOTE_ENV")
REMOTE_TMP=$(mktemp)
echo "$REMOTE_CONTENT" > "$REMOTE_TMP"
trap 'rm -f "$REMOTE_TMP"' EXIT

# Build lists of changes
declare -a UPDATES=()
declare -a ADDITIONS=()
declare -a SKIPPED=()

while IFS= read -r line; do
  key="${line%%=*}"
  value="${line#*=}"

  if should_skip "$line"; then
    SKIPPED+=("$key (remote-only, preserved)")
    continue
  fi

  remote_line=$(grep -E "^${key}=" "$REMOTE_TMP" 2>/dev/null || true)
  if [[ -z "$remote_line" ]]; then
    ADDITIONS+=("$line")
  elif [[ "$remote_line" != "$line" ]]; then
    UPDATES+=("$line")
  fi
done < <(parse_env "$LOCAL_ENV")

# Report
if [[ ${#ADDITIONS[@]} -eq 0 && ${#UPDATES[@]} -eq 0 ]]; then
  echo "Remote .env is already in sync (${#SKIPPED[@]} remote-only vars preserved)."
  exit 0
fi

if [[ ${#ADDITIONS[@]} -gt 0 ]]; then
  echo ""
  echo "New vars to add:"
  for line in "${ADDITIONS[@]}"; do
    echo "  + ${line%%=*}"
  done
fi

if [[ ${#UPDATES[@]} -gt 0 ]]; then
  echo ""
  echo "Changed vars to update:"
  for line in "${UPDATES[@]}"; do
    key="${line%%=*}"
    old=$(grep -E "^${key}=" "$REMOTE_TMP" | head -1)
    echo "  ~ $key"
    echo "    remote: ${old#*=}"
    echo "    local:  ${line#*=}"
  done
fi

if [[ ${#SKIPPED[@]} -gt 0 ]]; then
  echo ""
  echo "Preserved (remote-only):"
  for s in "${SKIPPED[@]}"; do
    echo "  - $s"
  done
fi

if $DRY_RUN; then
  echo ""
  echo "[dry-run] No changes applied."
  exit 0
fi

echo ""
read -r -p "Apply these changes to $REMOTE_HOST? [y/N] " confirm
if [[ "$confirm" != [yY] ]]; then
  echo "Aborted."
  exit 0
fi

# Build sed commands for updates
SED_CMDS=""
for line in "${UPDATES[@]}"; do
  key="${line%%=*}"
  # Escape sed special chars in value
  escaped=$(printf '%s' "$line" | sed 's/[&/\]/\\&/g')
  SED_CMDS+="s|^${key}=.*|${escaped}|;"
done

# Apply updates via sed, then append new vars
ssh "$REMOTE_HOST" bash -s <<DEPLOY_SCRIPT
set -euo pipefail
cd /opt/apps/summarize

# Update existing vars
if [[ -n "$SED_CMDS" ]]; then
  sed -i '${SED_CMDS}' .env
fi

# Append new vars
$(for line in "${ADDITIONS[@]}"; do
  echo "echo '${line}' >> .env"
done)

echo "Remote .env updated."
DEPLOY_SCRIPT

echo "Done. Restart the container to apply: ssh $REMOTE_HOST 'cd /opt/apps/summarize && docker compose restart'"
