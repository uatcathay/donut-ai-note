#!/bin/bash
# Browser AI Note 啟動器（此為樣板；實際檔案由 build-app.sh 注入路徑後產生於 .app 內）
# 行為：確保伺服器就緒 → 開 Chrome 獨立小窗 → 阻塞至關窗 → 關掉本腳本啟動的伺服器
PROJECT_DIR="__PROJECT_DIR__"
PORT="__PORT__"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

cd "$PROJECT_DIR" 2>/dev/null || {
  osascript -e 'display alert "Browser AI Note" message "找不到專案目錄，請重新建置。"'
  exit 1
}

# 1) 確保伺服器就緒（未在跑才啟動；記錄本腳本啟動的 PID）
SERVER_PID=""
if ! curl -s "http://localhost:$PORT/" >/dev/null 2>&1; then
  node src/server.js >/tmp/browser-ai-note.log 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 40); do
    if curl -s "http://localhost:$PORT/" >/dev/null 2>&1; then break; fi
    sleep 0.25
  done
fi

# 2) 檢查 Chrome
if [ ! -x "$CHROME" ]; then
  osascript -e 'display alert "Browser AI Note" message "找不到 Google Chrome，請先安裝。"'
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  exit 1
fi

# 3) 開獨立小窗（專屬設定檔，與日常 Chrome 分離）；此指令阻塞至該視窗關閉
"$CHROME" --user-data-dir="$HOME/.browser-ai-note-chrome" \
  --app="http://localhost:$PORT/" \
  --window-size=480,720 >/dev/null 2>&1

# 4) 關窗即結束：關掉本腳本啟動的伺服器（若伺服器是既有的則不動）
[ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
exit 0
