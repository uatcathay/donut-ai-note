#!/bin/bash
# 安裝／反安裝 Browser AI Note 的常駐伺服器（macOS LaunchAgent）。
# 用法：
#   bash scripts/install-launchagent.sh              安裝並立即啟動
#   bash scripts/install-launchagent.sh --uninstall  停止並移除
#   bash scripts/install-launchagent.sh --print-plist 只印出 plist（不做任何事，供測試用）
set -euo pipefail

LABEL="com.local.browser-ai-note"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-3000}"
LOG="/tmp/browser-ai-note.log"

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
