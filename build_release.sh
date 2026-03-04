#!/bin/bash
set -e

echo "🚀 Building GenieTerm Release..."

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Build Rust library in release mode
echo -e "${BLUE}Building Rust library (release)...${NC}"
cargo build --release --lib

# Build Swift app in release mode
echo -e "${BLUE}Building Swift app (release)...${NC}"
cd native/GenieTerm
swift build -c release

# Get the built executable
EXECUTABLE_PATH=".build/release/GenieTerm"

if [ ! -f "$EXECUTABLE_PATH" ]; then
    # Try alternative path
    EXECUTABLE_PATH=".build/arm64-apple-macosx/release/GenieTerm"
fi

if [ ! -f "$EXECUTABLE_PATH" ]; then
    echo "❌ Error: Could not find built executable"
    ls -la .build/
    exit 1
fi

echo -e "${GREEN}✓ Build complete: $EXECUTABLE_PATH${NC}"

# Create release directory
cd ../..
RELEASE_DIR="release"
mkdir -p "$RELEASE_DIR"

# Create .app bundle structure
APP_BUNDLE="$RELEASE_DIR/GenieTerm.app"
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources"

# Copy executable
echo -e "${BLUE}Creating app bundle...${NC}"
cp "native/GenieTerm/$EXECUTABLE_PATH" "$APP_BUNDLE/Contents/MacOS/GenieTerm"
chmod +x "$APP_BUNDLE/Contents/MacOS/GenieTerm"

# Copy icon
if [ -f "assets/AppIcon.icns" ]; then
    cp "assets/AppIcon.icns" "$APP_BUNDLE/Contents/Resources/"
fi

# Create Info.plist
cat > "$APP_BUNDLE/Contents/Info.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>GenieTerm</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundleIdentifier</key>
    <string>com.genieterm.app</string>
    <key>CFBundleName</key>
    <string>GenieTerm</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>0.1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSMinimumSystemVersion</key>
    <string>13.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSHumanReadableCopyright</key>
    <string>Copyright © 2026 Ry3nG. All rights reserved.</string>
</dict>
</plist>
EOF

echo -e "${GREEN}✓ App bundle created: $APP_BUNDLE${NC}"

# Create DMG
echo -e "${BLUE}Creating DMG installer...${NC}"
DMG_NAME="GenieTerm-$(date +%Y%m%d).dmg"
DMG_PATH="$RELEASE_DIR/$DMG_NAME"

# Remove old DMG if exists
rm -f "$DMG_PATH"

# Create temporary directory for DMG contents
DMG_TEMP="$RELEASE_DIR/dmg_temp"
rm -rf "$DMG_TEMP"
mkdir -p "$DMG_TEMP"

# Copy app to temp directory
cp -R "$APP_BUNDLE" "$DMG_TEMP/"

# Create symbolic link to Applications folder
ln -s /Applications "$DMG_TEMP/Applications"

# Create DMG (use absolute path)
hdiutil create -volname "GenieTerm" \
    -srcfolder "$DMG_TEMP" \
    -ov -format UDZO \
    "$(pwd)/$DMG_PATH"

# Clean up temp directory
rm -rf "$DMG_TEMP"

echo -e "${GREEN}✓ DMG created: $DMG_PATH${NC}"

# Get file size
DMG_SIZE=$(du -h "$DMG_PATH" | cut -f1)

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✨ Release build complete!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 App bundle: $APP_BUNDLE"
echo "💿 DMG installer: $DMG_PATH ($DMG_SIZE)"
echo ""
echo "To install:"
echo "  1. Open $DMG_NAME"
echo "  2. Drag GenieTerm.app to Applications folder"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
