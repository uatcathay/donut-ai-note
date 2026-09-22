#!/bin/bash
# 安裝／反安裝 Donut AI Note 的常駐伺服器（macOS LaunchAgent）。
# 用法：
#   bash scripts/install-launchagent.sh              安裝並立即啟動
#   bash scripts/install-launchagent.sh --uninstall  停止並移除
#   bash scripts/install-launchagent.sh --print-plist 只印出 plist（不做任何事，供測試用）
set -euo pipefail

LABEL="com.local.donut-ai-note"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-3737}"
# 不要放 /tmp：macOS 重開機會清空它，log 加時間戳記的用意（事後查得到失敗發生在何時）
# 就完全落空了。~/Library/Logs 是 macOS 使用者層級 log 的慣例位置，Console.app 也看得到。
LOG="$HOME/Library/Logs/donut-ai-note.log"

mkdir -p "$(dirname "$LOG")"

usage() {
  cat >&2 <<USAGE
用法：
  bash scripts/install-launchagent.sh              安裝並立即啟動
  bash scripts/install-launchagent.sh --uninstall  停止並移除
  bash scripts/install-launchagent.sh --print-plist 只印出 plist（不做任何事，供測試用）
USAGE
}

# launchd 啟動時的 PATH 極精簡，node 必須是絕對路徑。
# 只有真的會把 NODE_BIN 寫進 plist 的模式（安裝、印 plist）才需要這項檢查。
require_node() {
  NODE_BIN="$(command -v node || true)"
  if [ -z "$NODE_BIN" ]; then
    echo "錯誤：找不到 node，請先安裝 Node.js（需 20 以上）" >&2
    exit 1
  fi
}

# 只有真的要啟動伺服器（安裝模式）才需要確認專案結構存在；
# --uninstall 是收尾用的逃生門，不該被同一組前置檢查卡住。
require_project_layout() {
  if [ ! -f "$PROJECT_DIR/src/server.js" ]; then
    echo "錯誤：$PROJECT_DIR/src/server.js 不存在，請在專案內執行本腳本" >&2
    exit 1
  fi
}

print_plist() {
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$PROJECT_DIR/src/server.js</string>
  </array>
  <key>WorkingDirectory</key><string>$PROJECT_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key><string>$PORT</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST
}

unload_if_loaded() {
  launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
}

MODE="${1:-}"

case "$MODE" in
  --print-plist)
    require_node
    print_plist
    exit 0
    ;;
  --uninstall)
    unload_if_loaded
    rm -f "$PLIST"
    echo "已反安裝 $LABEL（伺服器已停止）"
    exit 0
    ;;
  '')
    # 無參數＝安裝模式，往下執行
    ;;
  *)
    echo "錯誤：未知參數：$MODE" >&2
    usage
    exit 1
    ;;
esac

require_node
require_project_layout

mkdir -p "$(dirname "$PLIST")"
print_plist > "$PLIST"
unload_if_loaded

# 卸載自己這個 LaunchAgent 後，若埠仍被佔用，代表是別的程序（例如手動執行的
# npm start）在用它。這種情況下就算 curl 輪詢成功，也只是量到別人的伺服器，
# launchd 這邊實際是 EADDRINUSE crash-loop（KeepAlive 每 10 秒重啟一次），
# 跟腳本印出的「已安裝並啟動」正好相反，必須在啟動前擋下來。
# 只算 LISTEN 狀態：-ti 會連帶列出其他狀態的連線，可能把殘留連線誤判成佔用。
if lsof -ti:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "錯誤：連接埠 $PORT 已被其他程序占用（例如手動執行中的 npm start），無法安裝常駐服務。" >&2
  echo "請先停止該程序（例如：lsof -ti:$PORT -sTCP:LISTEN | xargs kill），再重新執行本腳本。" >&2
  rm -f "$PLIST"
  exit 1
fi

launchctl bootstrap "gui/$UID" "$PLIST"

# 驗證真的起得來，避免留下一個載入了卻跑不動的服務
for _ in $(seq 1 40); do
  if curl -sf "http://localhost:$PORT/" >/dev/null 2>&1; then
    echo "已安裝並啟動：$LABEL（http://localhost:$PORT）"
    echo "反安裝：bash scripts/install-launchagent.sh --uninstall"
    exit 0
  fi
  sleep 0.25
done

# 起不來就別留著：KeepAlive=true 會讓 launchd 無限重啟一個壞掉的程序，
# 所以驗證失敗時要卸載並移除剛才寫入的 plist，讓機器回到「未安裝」的乾淨狀態。
unload_if_loaded
rm -f "$PLIST"
echo "錯誤：服務啟動失敗，10 秒內未回應 http://localhost:$PORT；已卸載並移除剛安裝的 LaunchAgent（目前為未安裝狀態）" >&2
echo "--- $LOG 尾端 ---" >&2
tail -20 "$LOG" >&2 || true
exit 1
