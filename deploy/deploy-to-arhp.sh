#!/usr/bin/env bash
set -Eeuo pipefail

# Deploy the current Avreise checkout to arhp.no.
#
# Usage from the project root or from this deploy/ directory:
#   VPS_USER=your-admin-user ./deploy/deploy-to-arhp.sh
#
# Override VPS_HOST if the existing administration route uses another host:
#   VPS_USER=your-admin-user VPS_HOST=serv ./deploy/deploy-to-arhp.sh
#
# This script deliberately does not edit the existing Nginx server block. The
# one-time location include must be installed and reviewed separately.

VPS_USER="${VPS_USER:-}"
VPS_HOST="${VPS_HOST:-10.77.0.1}"
REMOTE_APP_ROOT="${REMOTE_APP_ROOT:-/opt/umbrella-signage}"
REMOTE_SERVICE_USER="${REMOTE_SERVICE_USER:-umbrella-signage}"
PUBLIC_URL="${PUBLIC_URL:-https://arhp.no/umbrella}"
REMOTE_STAGE="/tmp/umbrella-signage-release-$(date -u +%Y%m%dT%H%M%SZ)-$$"
RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)"

if [[ -z "$VPS_USER" ]]; then
  printf 'Set VPS_USER to the existing VPS administrator username.\n' >&2
  printf 'Example: VPS_USER=your-admin-user %s\n' "$0" >&2
  exit 2
fi

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${VPS_USER}@${VPS_HOST}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Missing local command: %s\n' "$1" >&2
    exit 1
  }
}

require_command rsync
require_command ssh
require_command curl

cleanup() {
  ssh "$TARGET" "rm -rf -- '$REMOTE_STAGE'" >/dev/null 2>&1 || true
}

trap cleanup EXIT

printf '%s\n' '==> Running local checks'
(cd "$PROJECT_ROOT" && npm run check && npm test)

printf '%s\n' '==> Checking the VPS administration path'
ssh "$TARGET" 'hostname'

printf '%s\n' '==> Staging the release on the VPS'
ssh "$TARGET" "mkdir -p -- '$REMOTE_STAGE'"
rsync -a --delete \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude '.DS_Store' \
  "$PROJECT_ROOT/" "$TARGET:$REMOTE_STAGE/"

printf '%s\n' '==> Installing and restarting Avreise (umbrella-signage service)'
ssh -tt "$TARGET" \
  "sudo -v && sudo /usr/bin/bash '$REMOTE_STAGE/deploy/remote-install.sh' '$REMOTE_STAGE' '$REMOTE_APP_ROOT' '$REMOTE_SERVICE_USER' '$RELEASE_ID'"

printf '%s\n' '==> Public health check'
curl -fsS "$PUBLIC_URL/healthz"
printf '\n'

printf '%s\n' '==> Public PNG check'
public_png="$(mktemp --suffix=.png)"
trap 'rm -f -- "$public_png"' EXIT
curl -fsS -o "$public_png" \
  "$PUBLIC_URL/status.png?width=800&height=600"
file "$public_png"

printf '\nDeployment complete: %s/\n' "$PUBLIC_URL"
