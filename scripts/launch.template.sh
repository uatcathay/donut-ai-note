#!/bin/bash
# Browser AI Note 啟動器（此為樣板；實際檔案由 build-app.sh 注入路徑後產生於 .app 內）
# 行為：確保伺服器就緒 → 用日常 Chrome 開一個 app 視窗 → 阻塞至關窗 → 關掉本腳本啟動的伺服器
PROJECT_DIR="__PROJECT_DIR__"
PORT="__PORT__"
NODE_BIN="__NODE__"   # 由 build-app.sh 以 `command -v node` 注入絕對路徑（GUI 啟動時 PATH 精簡，不能只靠 node）
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

LAUNCH_LOG="/tmp/browser-ai-note-launch.log"
log() { echo "$(date '+%H:%M:%S') pid=$$ ppid=$PPID $1" >> "$LAUNCH_LOG"; }
log "啟動器被執行"

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
  # APP_MODE=1 讓 /shutdown 真的結束伺服器（關窗即結束）。
  # 不設此變數時（例如開發用的 npm start），/shutdown 只會留下提示、不結束程序，
  # 這樣在一般瀏覽器分頁重新整理才不會把自己的伺服器關掉。
  APP_MODE=1 "$NODE_BIN" src/server.js >/tmp/browser-ai-note.log 2>&1 &
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

# 3) 用「日常的 Chrome」開一個 app 視窗（--app 提供無網址列、無標籤列的乾淨小窗）。
#    刻意不使用 --user-data-dir：獨立設定檔會另外冷啟一個 Chrome 實例，
#    造成啟動慢約 5 秒，且該實例在 Dock 上是獨立圖示——點它時 Chrome 會判定
#    「只有 app 視窗、沒有一般瀏覽器視窗」而多開一個新分頁視窗。
#    交由日常 Chrome 承載後，這兩個問題一併消失，視窗外觀完全不變。
log "開 app 視窗"
"$CHROME" --app="http://localhost:$PORT/" --window-size=480,720 >/dev/null 2>&1 &

# 4) 關窗即結束：使用者關閉視窗時，頁面會打 /shutdown 讓伺服器程序自己退出。
#    這裡監看伺服器程序；它一消失就代表視窗已關，本腳本隨之結束。
#    注意：不可以再 pkill Chrome——現在承載視窗的是使用者日常的 Chrome。
while [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; do
  sleep 0.5
done
exit 0
