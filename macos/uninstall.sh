#!/bin/bash
# ==============================================================================
# Uninstall the Personio Timer from macOS:
#   1. Removes the menu bar app from ~/Applications/
#   2. Removes the Wi-Fi monitor launchd agent
# ==============================================================================

set -euo pipefail

APP_NAME="PersonioTimer"
PLIST_NAME="dev.lucagerlich.personio-timer"
PLIST_DEST="${HOME}/Library/LaunchAgents/${PLIST_NAME}.plist"
STATE_FILE="${TMPDIR:-/tmp}/personio-wifi-state"
APP_DEST="${HOME}/Applications/${APP_NAME}.app"

echo "=== Uninstalling ==="

# Stop and remove launchd agent
launchctl bootout "gui/$(id -u)/${PLIST_NAME}" 2>/dev/null || true
rm -f "$PLIST_DEST"
echo "Removed Wi-Fi monitor agent"

# Remove app
rm -rf "$APP_DEST"
echo "Removed ${APP_DEST}"

# Remove state file
rm -f "$STATE_FILE"

echo ""
echo "Done. Log file kept at: ~/Library/Logs/personio-timer.log"
echo "Config kept at: macos/config.env"
