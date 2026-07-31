#!/bin/bash
# 雙擊即可啟動會議記錄工具。請把本檔留在專案根目錄。
cd "$(dirname "$0")" || exit 1
if [ ! -d node_modules ]; then
  echo "首次啟動，安裝相依中…"
  npm install
fi
node src/server.js &
SERVER_PID=$!
sleep 1.5
open "http://localhost:3000"
echo "工具已啟動（PID $SERVER_PID）。關閉此終端機視窗即會停止伺服器。"
wait $SERVER_PID
