# Browser AI Note — App 打包與啟動器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `會議記錄.command` 換成 `Browser AI Note.app`（自訂圖示、Chrome 應用程式視窗模式的獨立小窗、關窗即結束），並提供可重跑的建置腳本。

**Architecture:** 維持現有「本機 Node 伺服器 + 瀏覽器頁面」架構。新增兩支腳本樣板（`scripts/launch.template.sh`、`scripts/Info.plist`）與一支建置腳本（`scripts/build-app.sh`）；建置腳本把 512 PNG 轉成 `.icns`、把專案絕對路徑與埠號注入啟動器樣板、組出 `Browser AI Note.app`。啟動器啟動伺服器、開 Chrome `--app` 獨立小窗、阻塞等待、關窗後關伺服器。

**Tech Stack:** macOS `sips` / `iconutil`（圖示）、bash（啟動器與建置）、Google Chrome `--app` 模式、既有 Node/Express 後端（不變）。

## Global Constraints

- 平台：macOS；需已安裝 Google Chrome 於 `/Applications/Google Chrome.app`。
- App 名稱固定為 `Browser AI Note`。
- 圖示來源：`assets/icon.png`（512×512 PNG，已存在）。
- 獨立視窗初始尺寸 480×720；埠號預設 3000（沿用後端 `PORT`）。
- 繁體中文提示文案。
- 後端 `src/`、`test/` 不得更動；現有 `npm test` 須維持全綠（本計畫作為回歸防護）。
- UI 外觀重做**不在本計畫範圍**（等使用者提供參考設計後另行規劃）。

## 檔案結構

```
meeting-recorder/
├── assets/
│   ├── icon.png              # 既有輸入（512×512）
│   └── icon.iconset/         # 建置產物（git 忽略）
├── scripts/
│   ├── Info.plist            # 新增：app bundle 的 Info.plist（靜態）
│   ├── launch.template.sh    # 新增：啟動器樣板（含 __PROJECT_DIR__ / __PORT__ 佔位）
│   └── build-app.sh          # 新增：建置腳本（產 icns + 組 .app）
├── Browser AI Note.app/      # 建置產物（git 忽略）
├── 會議記錄.command           # 移除
├── README.md                 # 更新使用說明
└── .gitignore                # 新增忽略項
```

---

## Task 1: 啟動器樣板與 Info.plist

**Files:**
- Create: `scripts/launch.template.sh`
- Create: `scripts/Info.plist`

**Interfaces:**
- Consumes: 無
- Produces:
  - `scripts/launch.template.sh`：含佔位符 `__PROJECT_DIR__`、`__PORT__`；被 `build-app.sh`（Task 2）以 `sed` 取代後放入 app bundle 的 `Contents/MacOS/launch`。
  - `scripts/Info.plist`：`CFBundleExecutable=launch`、`CFBundleIconFile=icon`、`CFBundleName=Browser AI Note`。

- [ ] **Step 1: 建立啟動器樣板 `scripts/launch.template.sh`**

```bash
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
```

- [ ] **Step 2: 語法檢查啟動器樣板**

Run: `bash -n scripts/launch.template.sh`
Expected: 無輸出、離開碼 0（語法正確）。

- [ ] **Step 3: 建立 `scripts/Info.plist`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Browser AI Note</string>
  <key>CFBundleDisplayName</key><string>Browser AI Note</string>
  <key>CFBundleIdentifier</key><string>com.local.browser-ai-note</string>
  <key>CFBundleVersion</key><string>1.1</string>
  <key>CFBundleShortVersionString</key><string>1.1</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundleIconFile</key><string>icon</string>
</dict>
</plist>
```

- [ ] **Step 4: 驗證 plist 格式合法**

Run: `plutil -lint scripts/Info.plist`
Expected: `scripts/Info.plist: OK`

- [ ] **Step 5: Commit**

```bash
git add scripts/launch.template.sh scripts/Info.plist
git commit -m "feat: Browser AI Note 啟動器樣板與 Info.plist"
```

---

## Task 2: 建置腳本（產 icns + 組 .app）

**Files:**
- Create: `scripts/build-app.sh`
- Create（產物，git 忽略）: `Browser AI Note.app/`、`assets/icon.iconset/`

**Interfaces:**
- Consumes: `scripts/launch.template.sh`、`scripts/Info.plist`（Task 1）、`assets/icon.png`
- Produces: 可執行的 `scripts/build-app.sh`；執行後在專案根目錄產出 `Browser AI Note.app`。

- [ ] **Step 1: 建立 `scripts/build-app.sh`**

```bash
#!/bin/bash
# 產生 Browser AI Note.app（圖示 + 啟動器）。可重複執行。
set -e
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-3000}"
APP="$PROJECT_DIR/Browser AI Note.app"
ICON_SRC="$PROJECT_DIR/assets/icon.png"
ICONSET="$PROJECT_DIR/assets/icon.iconset"

if [ ! -f "$ICON_SRC" ]; then
  echo "錯誤：找不到 $ICON_SRC"; exit 1
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
sed -e "s|__PROJECT_DIR__|$PROJECT_DIR|g" -e "s|__PORT__|$PORT|g" \
  "$PROJECT_DIR/scripts/launch.template.sh" > "$APP/Contents/MacOS/launch"
chmod +x "$APP/Contents/MacOS/launch"
touch "$APP"   # 提示 Finder 重讀圖示

echo "已產生：$APP"
```

- [ ] **Step 2: 語法檢查建置腳本**

Run: `bash -n scripts/build-app.sh`
Expected: 無輸出、離開碼 0。

- [ ] **Step 3: 執行建置**

Run: `bash scripts/build-app.sh`
Expected: 印出 `已產生：.../Browser AI Note.app`，無錯誤。

- [ ] **Step 4: 驗證產物結構與注入結果**

Run:
```bash
ls "Browser AI Note.app/Contents/MacOS/launch" "Browser AI Note.app/Contents/Resources/icon.icns" "Browser AI Note.app/Contents/Info.plist"
grep -c "__PROJECT_DIR__" "Browser AI Note.app/Contents/MacOS/launch"
```
Expected: 三個檔案都存在；`grep -c` 回傳 `0`（佔位符已被實際路徑取代乾淨）。

- [ ] **Step 5: 手動驗證啟動與關窗（需真人操作）**

先確保 `.env` 已填、且埠 3000 目前沒有殘留伺服器（`lsof -ti:3000` 應為空；有的話 `lsof -ti:3000 | xargs kill`）。
- [ ] 於 Finder 雙擊 `Browser AI Note.app` → Dock 出現自訂甜甜圈圖示；跳出一個約 480×720、無網址列的獨立小窗，顯示會議記錄工具頁。
- [ ] 關閉該小窗 → 幾秒內背景伺服器結束：`lsof -ti:3000` 回傳空（無殘留）。
- [ ] 再次雙擊可正常重開。

- [ ] **Step 6: Commit**

```bash
git add scripts/build-app.sh
git commit -m "feat: build-app.sh 產生 Browser AI Note.app（icns + 啟動器注入）"
```

---

## Task 3: 移除舊啟動器、忽略產物、更新 README

**Files:**
- Delete: `會議記錄.command`
- Modify: `.gitignore`
- Modify: `README.md`

**Interfaces:**
- Consumes: 上述任務產出的 `Browser AI Note.app`
- Produces: 一致的文件與版控狀態。

- [ ] **Step 1: 忽略建置產物**

在 `.gitignore` 追加：
```
/Browser AI Note.app/
/assets/icon.iconset/
```

- [ ] **Step 2: 移除舊的 `.command` 啟動器**

Run: `git rm "會議記錄.command"`
Expected: 檔案自版控與工作區移除。

- [ ] **Step 3: 更新 README 使用說明**

在 `README.md` 的「三、使用」段落，把雙擊 `會議記錄.command` 的說明替換為：
```markdown
## 三、使用

1. 首次或更新後，先建置 App：`bash scripts/build-app.sh`（會在專案根目錄產生 `Browser AI Note.app`）。
2. **雙擊 `Browser AI Note`**（可拖到 Dock）→ 會開一個獨立小視窗。
3. 填標題（可跳過）→ 開始錄音 →（可暫停/繼續/重新開始）→ 停止並分析 → 取得 Notion 連結或 `.md` 路徑。
4. **關閉視窗即結束**（背景伺服器會一併關閉，不留殘留程序）。

> 需要 Google Chrome。若沒設定 Notion，結果會存成桌面 `.md`。
```

- [ ] **Step 4: 驗證 README 無殘留舊名稱**

Run: `grep -c "會議記錄.command" README.md`
Expected: `0`

- [ ] **Step 5: 後端回歸防護**

Run: `npm test`
Expected: `tests 39 / pass 39 / fail 0`（後端未動，應維持全綠）。

- [ ] **Step 6: Commit**

```bash
git add .gitignore README.md
git commit -m "chore: 移除舊 .command 啟動器、忽略 App 產物、更新 README"
```

---

## 自我檢查（Self-Review）結果

**1. Spec 覆蓋**
- macOS app bundle（Info.plist/launch/icns）→ Task 1、2 ✅
- 啟動：確保伺服器就緒 → Task 1 launch 樣板 ✅
- 獨立小窗（Chrome --app、480×720、專屬 user-data-dir）→ Task 1 ✅
- 關窗即結束（阻塞等待 + kill 本腳本啟動的伺服器）→ Task 1 ✅
- 自訂圖示（512 PNG → icns）→ Task 2 ✅
- 移除 `會議記錄.command`、README 更新 → Task 3 ✅
- 後端不動、測試維持綠 → Task 3 Step 5 回歸 ✅
- 已知限制（既有孤兒伺服器不接管）→ 由 launch 的 SERVER_PID 空值守衛體現 ✅
- UI 外觀重做：明列為非範圍，本計畫不含 ✅

**2. Placeholder 掃描**：無 TBD/TODO；每個程式步驟都有完整內容；`__PROJECT_DIR__`/`__PORT__` 是刻意的樣板佔位符（Task 2 Step 4 驗證其被取代乾淨），非計畫空白。

**3. 一致性**：`scripts/launch.template.sh` 的佔位符與 `build-app.sh` 的 `sed` 取代字串一致（`__PROJECT_DIR__`、`__PORT__`）；`Info.plist` 的 `CFBundleExecutable=launch` 與 bundle 內 `Contents/MacOS/launch` 一致；`CFBundleIconFile=icon` 與 `Resources/icon.icns` 一致；埠號預設 3000 與後端 `PORT` 一致。
