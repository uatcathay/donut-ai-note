#!/bin/bash
# 產生 Browser AI Note.app（圖示 + 啟動器）。可重複執行。
set -e
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-3000}"
APP="$PROJECT_DIR/Browser AI Note.app"
ICON_SRC="$PROJECT_DIR/assets/icon.png"
ICONSET="$PROJECT_DIR/assets/icon.iconset"
NODE_BIN="$(command -v node)"   # 烤進啟動器，GUI 啟動不受精簡 PATH 影響

if [ ! -f "$ICON_SRC" ]; then
  echo "錯誤：找不到 $ICON_SRC"; exit 1
fi
if [ -z "$NODE_BIN" ]; then
  echo "錯誤：找不到 node（請先安裝 Node.js）"; exit 1
fi

# 1) 由 512 PNG 產生 iconset（最大到 512×512，無需上採樣）
rm -rf "$ICONSET"; mkdir -p "$ICONSET"
sips -z 16 16   "$ICON_SRC" --out "$ICONSET/icon_16x16.png"     >/dev/null
sips -z 32 32   "$ICON_SRC" --out "$ICONSET/icon_16x16@2x.png"  >/dev/null
sips -z 32 32   "$ICON_SRC" --out "$ICONSET/icon_32x32.png"     >/dev/null
sips -z 64 64   "$ICON_SRC" --out "$ICONSET/icon_32x32@2x.png"  >/dev/null
sips -z 128 128 "$ICON_SRC" --out "$ICONSET/icon_128x128.png"   >/dev/null
sips -z 256 256 "$ICON_SRC" --out "$ICONSET/icon_128x128@2x.png">/dev/null
sips -z 256 256 "$ICON_SRC" --out "$ICONSET/icon_256x256.png"   >/dev/null
sips -z 512 512 "$ICON_SRC" --out "$ICONSET/icon_256x256@2x.png">/dev/null
sips -z 512 512 "$ICON_SRC" --out "$ICONSET/icon_512x512.png"   >/dev/null

# 2) 組 app bundle
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/icon.icns"
cp "$PROJECT_DIR/scripts/Info.plist" "$APP/Contents/Info.plist"
sed -e "s|__PROJECT_DIR__|$PROJECT_DIR|g" -e "s|__PORT__|$PORT|g" -e "s|__NODE__|$NODE_BIN|g" \
  "$PROJECT_DIR/scripts/launch.template.sh" > "$APP/Contents/MacOS/launch"
chmod +x "$APP/Contents/MacOS/launch"
touch "$APP"   # 提示 Finder 重讀圖示

echo "已產生：$APP"
