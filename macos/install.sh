#!/bin/bash
# ==============================================================================
# Install the Personio Timer for macOS:
#   1. Builds and installs the menu bar app to ~/Applications/
#   2. Installs the Wi-Fi monitor as a launchd user agent
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="PersonioTimer"
PLIST_NAME="dev.lucagerlich.personio-timer"
PLIST_SRC="${SCRIPT_DIR}/${PLIST_NAME}.plist"
PLIST_DEST="${HOME}/Library/LaunchAgents/${PLIST_NAME}.plist"
MONITOR_SCRIPT="${SCRIPT_DIR}/wifi-monitor.sh"
LOG_DIR="${HOME}/Library/Logs"
CONFIG_FILE="${SCRIPT_DIR}/config.env"
APP_DEST="${HOME}/Applications/${APP_NAME}.app"

# Check config exists
if [[ ! -f "$CONFIG_FILE" ]]; then
	echo "ERROR: config.env not found."
	echo ""
	echo "  cp config.env.example config.env"
	echo "  Then edit config.env with your SSID and token."
	exit 1
fi

echo "=== Building menu bar app ==="
bash "${SCRIPT_DIR}/build.sh"

echo ""
echo "=== Installing menu bar app ==="
# Copy app bundle to ~/Applications
mkdir -p "${HOME}/Applications"
rm -rf "$APP_DEST"
cp -R "${SCRIPT_DIR}/build/${APP_NAME}.app" "$APP_DEST"
# Ensure config is in the Resources folder
cp "$CONFIG_FILE" "${APP_DEST}/Contents/Resources/config.env"
echo "Installed: ${APP_DEST}"

echo ""
echo "=== Installing Wi-Fi monitor ==="
# Make monitor script executable
chmod +x "$MONITOR_SCRIPT"

# Create log directory
mkdir -p "$LOG_DIR"

# Generate plist with correct paths
sed \
	-e "s|SCRIPT_PATH_PLACEHOLDER|${MONITOR_SCRIPT}|g" \
	-e "s|LOG_PATH_PLACEHOLDER|${LOG_DIR}|g" \
	"$PLIST_SRC" > "$PLIST_DEST"

# Unload if already loaded
launchctl bootout "gui/$(id -u)/${PLIST_NAME}" 2>/dev/null || true

# Load the agent
launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST"
echo "Installed Wi-Fi monitor as launchd agent"

echo ""
echo "=== Done ==="
echo ""
echo "Menu bar app: ${APP_DEST}"
echo "  Open it:     open '${APP_DEST}'"
echo "  Add to Login Items in System Settings to start automatically."
echo ""
echo "Wi-Fi monitor: ${PLIST_DEST}"
echo "  Logs: tail -f ~/Library/Logs/personio-timer.log"
echo ""
echo "To uninstall: ./uninstall.sh"
