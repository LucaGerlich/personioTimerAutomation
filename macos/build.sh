#!/bin/bash
# ==============================================================================
# Build the Personio Timer menu bar app.
# Compiles the Swift file and creates a proper .app bundle.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="PersonioTimer"
SWIFT_FILE="${SCRIPT_DIR}/${APP_NAME}.swift"
BUILD_DIR="${SCRIPT_DIR}/build"
APP_BUNDLE="${BUILD_DIR}/${APP_NAME}.app"

echo "Building ${APP_NAME}..."

# Clean previous build
rm -rf "$BUILD_DIR"
mkdir -p "${APP_BUNDLE}/Contents/MacOS"
mkdir -p "${APP_BUNDLE}/Contents/Resources"

# Compile
swiftc \
	-framework AppKit \
	-framework Foundation \
	-O \
	"$SWIFT_FILE" \
	-o "${APP_BUNDLE}/Contents/MacOS/${APP_NAME}"

# Create Info.plist (hides from dock, identifies the app)
cat > "${APP_BUNDLE}/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key>
	<string>PersonioTimer</string>
	<key>CFBundleIdentifier</key>
	<string>dev.lucagerlich.personio-timer</string>
	<key>CFBundleVersion</key>
	<string>1.0</string>
	<key>CFBundleExecutable</key>
	<string>PersonioTimer</string>
	<key>LSUIElement</key>
	<true/>
</dict>
</plist>
PLIST

# Copy config if it exists
if [[ -f "${SCRIPT_DIR}/config.env" ]]; then
	cp "${SCRIPT_DIR}/config.env" "${APP_BUNDLE}/Contents/Resources/config.env"
fi

echo ""
echo "Build complete: ${APP_BUNDLE}"
echo ""
echo "To run directly:  open ${APP_BUNDLE}"
echo "To install:       ./install.sh"
