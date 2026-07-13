#!/usr/bin/env bash
# Source this file so the variables remain in your current shell:
#   source ./setup.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VARS_FILE="$ROOT/server/.dev.vars"

if [[ ! -f "$VARS_FILE" ]]; then
  echo "Missing $VARS_FILE. Create it from server/.dev.vars.example first." >&2
  return 1 2>/dev/null || exit 1
fi

SECRET_LINE="$(grep -m1 '^DESKTOP_HMAC_SECRET=' "$VARS_FILE" || true)"
if [[ -z "$SECRET_LINE" || -z "${SECRET_LINE#*=}" ]]; then
  echo 'DESKTOP_HMAC_SECRET is missing or empty in server/.dev.vars.' >&2
  return 1 2>/dev/null || exit 1
fi

export VAANI_GATEWAY_URL='https://vanni-server.kabootr.com'
export VAANI_GATEWAY_ACCESS_KEY="${SECRET_LINE#*=}"

echo 'Vaani gateway environment configured for this shell session.'
echo "VAANI_GATEWAY_URL=$VAANI_GATEWAY_URL"
