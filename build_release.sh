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

# Get the built app path
APP_PATH=".build/apple/Products/Release/GenieTerm.app"

if [ ! -d "$APP_PATH" ]; then
    # Try alternative path
    APP_PATH=".build/arm64-apple-macosx/release/GenieTerm.app"
fi

if [ ! -d "$APP_PATH" ]; then
    echo "❌ Error: Could not find built app"
    exit 1
fi

echo -e "${GREEN}✓ Build complete: $APP_PATH${NC}"

# Create release directory
cd ../..
RELEASE_DIR="release"
mkdir -p "$RELEASE_DIR"

# Copy app to release directory
echo -e "${BLUE}Copying app to release directory...${NC}"
rm -rf "$RELEASE_DIR/GenieTerm.app"
cp -R "native/GenieTerm/$APP_PATH" "$RELEASE_DIR/"

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
cp -R "$RELEASE_DIR/GenieTerm.app" "$DMG_TEMP/"

# Create symbolic link to Applications folder
ln -s /Applications "$DMG_TEMP/Applications"

# Create DMG
hdiutil create -volname "GenieTerm" \
    -srcfolder "$DMG_TEMP" \
    -ov -format UDZO \
    "$DMG_PATH"

# Clean up temp directory
rm -rf "$DMG_TEMP"

echo -e "${GREEN}✓ DMG created: $DMG_PATH${NC}"

# Get file size
DMG_SIZE=$(du -h "$DMG_PATH" | cut -f1)

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✨ Release build complete!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 App bundle: $RELEASE_DIR/GenieTerm.app"
echo "💿 DMG installer: $DMG_PATH ($DMG_SIZE)"
echo ""
echo "To install:"
echo "  1. Open $DMG_NAME"
echo "  2. Drag GenieTerm.app to Applications folder"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
