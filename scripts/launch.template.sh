#!/bin/bash
# Browser AI Note 啟動器（此為樣板；實際檔案由 build-app.sh 注入路徑後產生於 .app 內）
# 行為：確保伺服器就緒 → 開 Chrome 獨立小窗 → 阻塞至關窗 → 關掉本腳本啟動的伺服器
PROJECT_DIR="__PROJECT_DIR__"
PORT="__PORT__"
NODE_BIN="__NODE__"   # 由 build-app.sh 以 `command -v node` 注入絕對路徑（GUI 啟動時 PATH 精簡，不能只靠 node）
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

cd "$PROJECT_DIR" 2>/dev/null || {
  osascript -e 'display alert "Browser AI Note" message "找不到專案目錄，請重新建置。"'
  exit 1
}

# 0) 確認 node 可用（絕對路徑）
if [ ! -x "$NODE_BIN" ]; then
  osascript -e 'display alert "Browser AI Note" message "找不到 Node（請確認已安裝，並重新執行 build-app.sh）。"'
  exit 1
fi

# 1) 確保伺服器就緒（未在跑才啟動；記錄本腳本啟動的 PID）
SERVER_PID=""
if ! curl -s "http://localhost:$PORT/" >/dev/null 2>&1; then
  "$NODE_BIN" src/server.js >/tmp/browser-ai-note.log 2>&1 &
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

# 若伺服器是既有的（本腳本沒啟動），改用 lsof 取得其 PID 以便監看
if [ -z "$SERVER_PID" ]; then
  SERVER_PID="$(lsof -ti:"$PORT" 2>/dev/null | head -1)"
fi

# 3) 開獨立小窗（專屬設定檔，與日常 Chrome 分離）。背景啟動，不阻塞。
#    macOS 上關掉最後一個視窗 Chrome 並不會退出，所以不靠等 Chrome 結束來判斷關窗。
"$CHROME" --user-data-dir="$HOME/.browser-ai-note-chrome" \
  --no-first-run --no-default-browser-check \
  --app="http://localhost:$PORT/" \
  --window-size=480,720 >/dev/null 2>&1 &

# 4) 關窗即結束：使用者關閉視窗時，頁面會打 /shutdown 讓伺服器程序自己退出。
#    這裡監看伺服器程序；它一消失，代表視窗已關，接著關掉 app 視窗的 Chrome 實例並結束。
while [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; do
  sleep 0.5
done
pkill -f "browser-ai-note-chrome" 2>/dev/null
exit 0
