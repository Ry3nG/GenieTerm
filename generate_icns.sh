#!/bin/bash
# 生成 .icns 格式的图标文件

set -e

ICON_SOURCE="assets/avatar.png"
ICONSET_DIR="assets/AppIcon.iconset"
ICNS_OUTPUT="assets/AppIcon.icns"

# 创建 iconset 目录
mkdir -p "$ICONSET_DIR"

# 生成所有需要的尺寸
sips -z 16 16     "$ICON_SOURCE" --out "$ICONSET_DIR/icon_16x16.png"
sips -z 32 32     "$ICON_SOURCE" --out "$ICONSET_DIR/icon_16x16@2x.png"
sips -z 32 32     "$ICON_SOURCE" --out "$ICONSET_DIR/icon_32x32.png"
sips -z 64 64     "$ICON_SOURCE" --out "$ICONSET_DIR/icon_32x32@2x.png"
sips -z 128 128   "$ICON_SOURCE" --out "$ICONSET_DIR/icon_128x128.png"
sips -z 256 256   "$ICON_SOURCE" --out "$ICONSET_DIR/icon_128x128@2x.png"
sips -z 256 256   "$ICON_SOURCE" --out "$ICONSET_DIR/icon_256x256.png"
sips -z 512 512   "$ICON_SOURCE" --out "$ICONSET_DIR/icon_256x256@2x.png"
sips -z 512 512   "$ICON_SOURCE" --out "$ICONSET_DIR/icon_512x512.png"
cp "$ICON_SOURCE" "$ICONSET_DIR/icon_512x512@2x.png"

# 转换为 .icns
iconutil -c icns "$ICONSET_DIR" -o "$ICNS_OUTPUT"

# 清理临时文件
rm -rf "$ICONSET_DIR"

echo "✅ Generated $ICNS_OUTPUT"
