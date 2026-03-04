#!/bin/bash

# GenieTerm Launcher Script
# This script properly launches the SwiftUI app with GUI support

set -e

cd "$(dirname "$0")"

# Build the app
echo "Building GenieTerm..."
cargo build --lib
cd native/GenieTerm
swift build

APP_NAME="GenieTerm"
BUILD_DIR="$(swift build --show-bin-path)"
APP_BUNDLE="$BUILD_DIR/$APP_NAME.app"

if [ ! -d "$APP_BUNDLE" ]; then
    echo "Creating app bundle..."
    mkdir -p "$APP_BUNDLE/Contents/MacOS"
    mkdir -p "$APP_BUNDLE/Contents/Resources"

    # Create Info.plist
    cat > "$APP_BUNDLE/Contents/Info.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>$APP_NAME</string>
    <key>CFBundleIdentifier</key>
    <string>com.genieterm.app</string>
    <key>CFBundleName</key>
    <string>$APP_NAME</string>
    <key>CFBundleDisplayName</key>
    <string>GenieTerm</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSMinimumSystemVersion</key>
    <string>13.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSSupportsAutomaticTermination</key>
    <true/>
    <key>NSSupportsSuddenTermination</key>
    <true/>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>NSHumanReadableCopyright</key>
    <string>Copyright © 2024 GenieTerm. All rights reserved.</string>
    <key>CFBundleHelpBookFolder</key>
    <string>GenieTerm Help</string>
    <key>CFBundleHelpBookName</key>
    <string>com.genieterm.help</string>
</dict>
</plist>
EOF

    # Copy icon if available
    if [ -f "../../assets/AppIcon.icns" ]; then
        cp "../../assets/AppIcon.icns" "$APP_BUNDLE/Contents/Resources/AppIcon.icns"
    fi
fi

# Always refresh executable with latest build
cp "$BUILD_DIR/$APP_NAME" "$APP_BUNDLE/Contents/MacOS/$APP_NAME"

# Launch the app
echo "Launching GenieTerm..."
open "$APP_BUNDLE"
