# Chrome PWA App Shim 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 Browser AI Note 在 Dock 上成為有專屬圖示、點擊可回到既有視窗的真正 App——改用 Chrome PWA app shim 承載視窗，伺服器改由 macOS LaunchAgent 登入常駐。

**Architecture:** 前端加上 Web App Manifest，讓 `localhost:3000` 可被 Chrome 安裝成 app shim（真正的 macOS bundle，跑在日常 Chrome 的設定檔上）。伺服器脫離「隨視窗開關」的生命週期，改由 launchd 常駐；原本的 shell script 啟動器與 `/shutdown` 機制隨之移除。

**Tech Stack:** Node 20+（ESM）、Express 5、`node --test`、macOS launchd、Chrome PWA

**設計文件：** `docs/superpowers/specs/2026-08-04-pwa-app-shim-design.md`

## Global Constraints

- **Node ≥ 20**，專案為 ESM（`package.json` 有 `"type": "module"`），一律用 `import`，不可用 `require`。
- **測試指令一律 `npm test`**（等同 `node --test`），測試檔放 `test/*.test.js`，用 `node:test` + `node:assert/strict`。
- **註解語言沿用專案現況：繁體中文。**（註：使用者全域 CLAUDE.md 訂的是「comments in English only」，但本專案既有程式碼全為中文註解；此處以專案一致性為準，若使用者要求改為英文再全面調整。）
- **Commit 訊息用英文 conventional commits**（`feat:` / `fix:` / `chore:` / `docs:` / `test:`）。
- **分支：`feature/pwa-app-shim`**，不可直接推 main。
- **每個 Task 結束前都要跑一次完整 `npm test`**，全綠才可 commit。
- **Task 2 是硬性關卡。** Task 2 未由使用者確認全數通過，**不得開始 Task 3 以後的任何任務**——Task 3–5 會刪除現行可用的啟動方式。
- 埠號一律取 `process.env.PORT || 3000`，不可寫死在程式邏輯中（manifest 的 `start_url` 用相對路徑 `/` 故不受影響）。

---

## 檔案結構

### 第一階段（只增不刪）

| 檔案 | 責任 |
|---|---|
| `public/manifest.webmanifest`（新增） | 宣告 App 名稱、顯示模式、圖示，供 Chrome 安裝 |
| `public/icons/icon-192.png`（新增） | PWA 圖示，由 `assets/icon.png` 產生 |
| `public/icons/icon-512.png`（新增） | 同上 |
| `public/index.html`（修改，第 6 行後） | 加入 `<link rel="manifest">` 與 `<meta name="theme-color">` |
| `test/server.test.js`（修改，附加） | 驗證 manifest 與圖示被正確服務 |

### 第二階段（動刀）

| 檔案 | 責任 |
|---|---|
| `scripts/install-launchagent.sh`（新增） | 產生／載入／反安裝 LaunchAgent；`--print-plist` 供測試 |
| `test/launchagent.test.js`（新增） | 驗證產生的 plist 內容（純輸出，無副作用） |
| `src/server.js`（修改） | 移除 `/shutdown` 路由、`makeShutdown`、`onShutdown` 相依 |
| `public/app.js`（修改，第 267–271 行） | 移除 `pagehide` 的 `/shutdown` beacon |
| `test/server.test.js`（修改） | 移除 4 項 shutdown 測試，改加「`/shutdown` 已不存在」回歸測試 |
| `README.md`（修改，「三、使用」節） | 改寫啟動與結束方式 |
| `.gitignore`（修改） | 移除 `/Browser AI Note.app/` 與 `/assets/icon.iconset/` 兩行 |
| `scripts/build-app.sh`、`scripts/launch.template.sh`、`scripts/Info.plist`（刪除） | 舊 App bundle 建置流程 |

---

## Task 1: PWA Manifest 與圖示

**Files:**
- Create: `public/manifest.webmanifest`
- Create: `public/icons/icon-192.png`、`public/icons/icon-512.png`
- Modify: `public/index.html`（第 6 行 `<title>` 之後）
- Test: `test/server.test.js`（附加於檔尾）

**Interfaces:**
- Consumes: `createApp()`（`src/server.js` 既有匯出）、`assets/icon.png`（既有 512×512 來源圖）
- Produces: `/manifest.webmanifest` 與 `/icons/*.png` 兩個可公開取得的路徑，Task 2 的手動安裝依賴它們

- [ ] **Step 1: 寫失敗的測試**

附加到 `test/server.test.js` 檔尾：

```js
test('GET /manifest.webmanifest 提供可安裝 PWA 的必要欄位', async () => {
  const app = createApp({ processMeeting: async () => ({}) });
  const server = app.listen(0);
  const { port } = server.address();
  const res = await fetch(`http://localhost:${port}/manifest.webmanifest`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/manifest\+json/);
  const m = await res.json();
  assert.equal(m.name, 'Browser AI Note');
  assert.equal(m.start_url, '/');
  assert.equal(m.display, 'standalone');
  const sizes = m.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192'), '缺 192x192 圖示');
  assert.ok(sizes.includes('512x512'), '缺 512x512 圖示');
  server.close();
});

test('manifest 宣告的圖示檔實際取得得到', async () => {
  const app = createApp({ processMeeting: async () => ({}) });
  const server = app.listen(0);
  const { port } = server.address();
  for (const p of ['/icons/icon-192.png', '/icons/icon-512.png']) {
    const res = await fetch(`http://localhost:${port}${p}`);
    assert.equal(res.status, 200, `${p} 取不到`);
    assert.match(res.headers.get('content-type'), /image\/png/);
  }
  server.close();
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|not ok"`
Expected: FAIL — 兩項新測試皆因 404 而失敗（`res.status` 為 404，非 200）

- [ ] **Step 3: 產生圖示**

```bash
mkdir -p public/icons
sips -z 192 192 assets/icon.png --out public/icons/icon-192.png
sips -z 512 512 assets/icon.png --out public/icons/icon-512.png
```

- [ ] **Step 4: 建立 manifest**

`public/manifest.webmanifest`：

```json
{
  "name": "Browser AI Note",
  "short_name": "Browser AI Note",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#F9C05C",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

`background_color` 取自 `index.html` 的 `--bg`，`theme_color` 取自 `--grad-from`。

- [ ] **Step 5: 在 index.html 掛上 manifest**

`public/index.html` 第 6 行 `<title>Browser AI Note</title>` 之後插入：

```html
  <link rel="manifest" href="/manifest.webmanifest" />
  <meta name="theme-color" content="#F9C05C" />
```

- [ ] **Step 6: 跑測試確認通過**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|not ok"`
Expected: PASS，`fail 0`，總數由 49 增為 51

若 `content-type` 那一項失敗（express 的 mime 表未涵蓋 `.webmanifest`），在 `src/server.js` 的 `app.use(express.static(PUBLIC_DIR));` 之前插入明確路由：

```js
  app.get('/manifest.webmanifest', (_req, res) => {
    res.type('application/manifest+json');
    res.sendFile(path.join(PUBLIC_DIR, 'manifest.webmanifest'));
  });
```

- [ ] **Step 7: Commit**

```bash
git add public/manifest.webmanifest public/icons public/index.html test/server.test.js
git commit -m "feat: add web app manifest so the page can be installed as a Chrome app"
```

---

## Task 2: 實機驗收關卡（手動，無程式碼）

**這是硬性關卡。五項全部通過才可進入 Task 3。任一項失敗即停止，回報使用者後依「退場」段處理。**

**Files:** 無（純人工驗證）

**Interfaces:**
- Consumes: Task 1 產出的 `/manifest.webmanifest` 與圖示
- Produces: 使用者對五項關卡的確認，以及 `~/Applications/Chrome Apps.localized/Browser AI Note.app`

- [ ] **Step 1: 啟動伺服器**

```bash
npm start
```

Expected: 印出 `會議記錄工具運作中： http://localhost:3000`

- [ ] **Step 2: 請使用者安裝 PWA**

請使用者在**日常的 Chrome**（非 App 小窗）開啟 `http://localhost:3000/`，然後：
網址列右側的安裝圖示，或 ⋮ 選單 →「投放、儲存及分享」→「安裝頁面為應用程式…」

**關卡 1**：該選項存在且可點（若只出現「建立捷徑」而非「安裝為應用程式」，代表 manifest 未被辨識 → 失敗）

- [ ] **Step 3: 確認 shim 產生**

```bash
ls -d "$HOME/Applications/Chrome Apps.localized/Browser AI Note.app" && \
  defaults read "$HOME/Applications/Chrome Apps.localized/Browser AI Note.app/Contents/Info.plist" | grep -E "CrAppModeShortcutID|CrAppModeShortcutURL"
```

Expected: 目錄存在，且 `CrAppModeShortcutURL` 為 `http://localhost:3000/`

- [ ] **Step 4: 請使用者逐項確認四個行為關卡**

- **關卡 2 — Dock 圖示與點擊行為**：Dock 出現甜甜圈圖示；在視窗已開啟的狀態下點它，**回到既有視窗**，不會多開一個
- **關卡 3 — 麥克風（最高風險項）**：在 PWA 視窗按開始錄音，**能正常錄音且不需重新授權**
- **關卡 4 — 視窗大小記憶**：把視窗拉成想要的大小 → 關閉 → 再開，維持該大小
- **關卡 5 — 啟動速度**：Chrome 已在執行時，點圖示到視窗出現接近瞬開（無數秒等待）

- [ ] **Step 5: 記錄結果並決定去留**

五項全過 → 進入 Task 3。

任一項失敗 → **停止，不執行 Task 3–5**，並執行退場：

```bash
# 移除新增檔案，回到 Task 1 之前的狀態
git revert --no-edit HEAD
rm -rf public/icons
```

再請使用者於 Chrome 的 `chrome://apps` 對該 App 按右鍵移除。舊的 `Browser AI Note.app` 全程未被更動，仍可照常使用。

---

## Task 3: LaunchAgent 安裝腳本

**Files:**
- Create: `scripts/install-launchagent.sh`
- Test: `test/launchagent.test.js`

**Interfaces:**
- Consumes: `src/server.js` 的 `start()`（既有；由 `node src/server.js` 觸發）
- Produces: `~/Library/LaunchAgents/com.local.browser-ai-note.plist`；腳本的 `--print-plist` 模式將 plist 印到 stdout 而**不產生任何副作用**，供測試使用

- [ ] **Step 1: 寫失敗的測試**

建立 `test/launchagent.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function printPlist() {
  return execFileSync('bash', ['scripts/install-launchagent.sh', '--print-plist'], {
    cwd: ROOT, encoding: 'utf8',
  });
}

test('--print-plist 產出 launchd 需要的基本欄位', () => {
  const out = printPlist();
  assert.match(out, /<key>Label<\/key>\s*<string>com\.local\.browser-ai-note<\/string>/);
  assert.match(out, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(out, /<key>KeepAlive<\/key>\s*<true\/>/);
});

test('--print-plist 的 ProgramArguments 必須是絕對路徑', () => {
  // launchd 的 PATH 極精簡，相對路徑或裸的 node 都會啟動失敗
  const out = printPlist();
  const block = out.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/);
  assert.ok(block, '找不到 ProgramArguments');
  const paths = [...block[1].matchAll(/<string>(.*?)<\/string>/g)].map((m) => m[1]);
  assert.equal(paths.length, 2);
  for (const p of paths) assert.ok(p.startsWith('/'), `不是絕對路徑：${p}`);
  assert.ok(paths[1].endsWith('/src/server.js'), `第二個參數應為 server.js：${paths[1]}`);
});

test('--print-plist 的 WorkingDirectory 指向專案根（伺服器需讀 .env）', () => {
  const out = printPlist();
  const wd = out.match(/<key>WorkingDirectory<\/key>\s*<string>(.*?)<\/string>/);
  assert.ok(wd, '找不到 WorkingDirectory');
  assert.equal(wd[1].replace(/\/$/, ''), ROOT.replace(/\/$/, ''));
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|not ok"`
Expected: FAIL — 三項皆因 `scripts/install-launchagent.sh` 不存在而拋錯

- [ ] **Step 3: 寫安裝腳本**

建立 `scripts/install-launchagent.sh`：

> **註（回填，2026-08-09）**：下方腳本是本步驟當時寫出的版本。後續 `f201e93`（同分支，Task 5 之後）另外做了一輪硬化——拒絕未知參數、`--uninstall` 不再受 node／專案結構前置檢查卡住、驗證失敗時卸載並移除剛寫入的 plist——並補了對應測試，但未回填進本文件，導致這裡曾與實際程式碼不一致。目前程式碼中的版本（含 `usage`、`require_node`、`require_project_layout`、失敗自我收尾）才是最終行為，請以 `scripts/install-launchagent.sh` 原始碼為準。

```bash
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

# launchd 啟動時的 PATH 極精簡，node 必須是絕對路徑
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "錯誤：找不到 node，請先安裝 Node.js（需 20 以上）" >&2
  exit 1
fi
if [ ! -f "$PROJECT_DIR/src/server.js" ]; then
  echo "錯誤：$PROJECT_DIR/src/server.js 不存在，請在專案內執行本腳本" >&2
  exit 1
fi

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

case "${1:-}" in
  --print-plist)
    print_plist
    exit 0
    ;;
  --uninstall)
    unload_if_loaded
    rm -f "$PLIST"
    echo "已反安裝 $LABEL（伺服器已停止）"
    exit 0
    ;;
esac

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

echo "錯誤：服務已載入但 10 秒內未回應 http://localhost:$PORT" >&2
echo "--- $LOG 尾端 ---" >&2
tail -20 "$LOG" >&2 || true
exit 1
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|not ok"`
Expected: PASS，`fail 0`，總數由 51 增為 54

- [ ] **Step 5: 實際安裝並驗證**

```bash
# 先確保沒有手動啟動的伺服器佔著 3000（KeepAlive 會讓埠衝突變成重啟迴圈）
lsof -ti:3000 | xargs -r kill 2>/dev/null || true
bash scripts/install-launchagent.sh
launchctl print "gui/$UID/com.local.browser-ai-note" | grep -E "state|path" | head -5
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/
```

Expected: 腳本印出「已安裝並啟動」；`curl` 回 `HTTP 200`

- [ ] **Step 6: 驗證重開機後仍在（不實際重開機）**

```bash
launchctl print "gui/$UID/com.local.browser-ai-note" | grep -E "runatload|state"
```

Expected: 顯示 `runatload = 1`、`state = running`

- [ ] **Step 7: Commit**

```bash
git add scripts/install-launchagent.sh test/launchagent.test.js
git commit -m "feat: add LaunchAgent installer so the server runs at login"
```

---

## Task 4: 移除「關窗即結束」機制

伺服器改為常駐後，`APP_MODE` 永遠不會被設定，`/shutdown` 只會在每次關窗時於 log 留下一行「已忽略」。整組機制成為死程式碼，一併移除。

**Files:**
- Modify: `src/server.js`（`makeShutdown` 定義、`createApp` 內的 `/shutdown` 路由與 `shutdown` 變數、`start()` 內的 `onShutdown`）
- Modify: `public/app.js:267-271`
- Test: `test/server.test.js`（移除 4 項既有測試，新增 1 項回歸測試）

**Interfaces:**
- Consumes: 無
- Produces: `createApp(deps)` 的 `deps` 只剩 `processMeeting`；`makeShutdown` 不再匯出（任何 import 它的程式碼都會壞）

- [ ] **Step 1: 改測試——刪除舊的、加上回歸測試**

在 `test/server.test.js` 中：

1. 第 4 行的 import 改為（移除 `makeShutdown`）：

```js
import { checkConfig, createApp } from '../src/server.js';
```

2. 刪除這四項測試（原第 70–104 行）：`POST /shutdown 回 200 並呼叫 onShutdown…`、`makeShutdown：App 模式…`、`makeShutdown：非 App 模式（一般分頁開發）…`、`makeShutdown：非 App 模式忽略時會留下提示訊息`

3. 在原位置加上回歸測試：

> **註（回填，2026-08-09）**：下方是當時寫出的初版。`aa6f614` 後續改用 `t.after` 做清理，避免測試在斷言失敗時因跳過 `server.close()` 造成 socket 洩漏；目前程式碼中的版本已是 `t.after` 版，請以 `test/server.test.js` 原始碼為準。

```js
test('/shutdown 已移除（伺服器改為常駐，關窗不再結束程序）', async (t) => {
  const app = createApp({ processMeeting: async () => ({}) });
  const server = app.listen(0);
  t.after(() => server.close());
  const { port } = server.address();
  const res = await fetch(`http://localhost:${port}/shutdown`, { method: 'POST' });
  assert.equal(res.status, 404);
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|not ok"`
Expected: FAIL — 回歸測試拿到 200（路由仍在）

- [ ] **Step 3: 移除伺服器端的 shutdown**

`src/server.js` 三處：

1. 刪除 `makeShutdown` 整段（含其上方註解，原第 22–28 行）
2. `createApp` 內刪除這兩處：

```js
  const shutdown = deps.onShutdown || (() => process.exit(0));
```

```js
  // 前端視窗關閉時會打這個端點，讓伺服器自己結束（配合啟動器達成「關窗即結束」）
  app.post('/shutdown', (_req, res) => {
    res.status(200).end();
    shutdown();
  });
```

3. `start()` 內改為：

```js
  const app = createApp();
```

- [ ] **Step 4: 移除前端的 beacon**

`public/app.js` 刪除第 267–271 行整段（含註解）：

```js
// 視窗關閉時通知伺服器結束（配合啟動器達成「關窗即結束」）。
// 註：在 App 視窗模式下，離開頁面幾乎只會發生於關窗；重新整理雖也會觸發，但 App 模式極少手動重整。
window.addEventListener('pagehide', () => {
  try { navigator.sendBeacon('/shutdown'); } catch { /* 忽略 */ }
});
```

- [ ] **Step 5: 跑測試確認通過**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|not ok"`
Expected: PASS，`fail 0`，總數由 54 減為 51

- [ ] **Step 6: 確認沒有殘留參照**

Run: `grep -rn "shutdown\|APP_MODE" src public test | grep -v "已移除"`
Expected: 無輸出（只剩回歸測試名稱那一行會被 grep 排除）

- [ ] **Step 7: Commit**

```bash
git add src/server.js public/app.js test/server.test.js
git commit -m "refactor: drop close-to-quit shutdown path now that the server is resident"
```

---

## Task 5: 移除舊 App bundle 與啟動器，更新文件

**Files:**
- Delete: `scripts/build-app.sh`、`scripts/launch.template.sh`、`scripts/Info.plist`
- Delete（未納入 git，直接 `rm`）: `Browser AI Note.app/`、`assets/icon.iconset/`
- Modify: `.gitignore`（移除兩行）
- Modify: `README.md`「三、使用」節

**Interfaces:**
- Consumes: 無
- Produces: 無（純移除與文件更新）

- [ ] **Step 1: 刪除啟動器相關檔案**

```bash
git rm -q scripts/build-app.sh scripts/launch.template.sh scripts/Info.plist
rm -rf "Browser AI Note.app" assets/icon.iconset
```

`Browser AI Note.app/` 與 `assets/icon.iconset/` 皆列於 `.gitignore`，未納入版控，故用 `rm` 而非 `git rm`。

- [ ] **Step 2: 清掉 .gitignore 中已無意義的兩行**

`.gitignore` 移除：

```
/Browser AI Note.app/
/assets/icon.iconset/
```

- [ ] **Step 3: 更新 README「三、使用」節**

把原本的第 1–4 點與其下三行引言，整段換成：

```markdown
1. 首次安裝：`bash scripts/install-launchagent.sh`（伺服器會在每次登入時自動於背景啟動）。
2. 接著在 Chrome 開啟 http://localhost:3000/ → ⋮ →「投放、儲存及分享」→「安裝頁面為應用程式」。
   完成後 `~/Applications/Chrome Apps.localized/Browser AI Note.app` 即為正式 App，可拖到 Dock。
3. **點 Dock 上的圖示**開啟視窗 → 填標題（可跳過）→ 開始錄音 →（可暫停/繼續/重新開始）→ 停止並分析 → 取得 Notion 連結或 `.md` 路徑。
4. 關閉視窗只是關視窗，背景伺服器持續運作，下次點圖示即可瞬開。

> 需要 Google Chrome。若沒設定 Notion，結果會存成桌面 `.md`。
> 視窗大小由 Chrome 記憶：手動調整後，關窗時的大小會成為下次開啟的大小。
> **Chrome 沒在執行時，第一次點圖示會慢幾秒**——App 視窗由 Chrome 主程序承載，
> 系統得先啟動 Chrome 才輪到這個視窗。這是 Chrome PWA 的共通行為（任何已安裝的
> 網頁應用程式皆然），非本工具的缺陷。Chrome 已在執行時則接近瞬開。
> 停用背景伺服器：`bash scripts/install-launchagent.sh --uninstall`。
> 開發時仍可 `npm start`（需先 `--uninstall` 或改用其他 `PORT`，否則埠會衝突）。
```

- [ ] **Step 4: 跑完整測試**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|not ok"`
Expected: PASS，`fail 0`，總數 51

- [ ] **Step 5: 確認沒有殘留參照**

Run: `grep -rn "build-app\|launch.template\|Browser AI Note.app" README.md docs/*.md src public test scripts 2>/dev/null`
Expected: 僅 `docs/superpowers/` 下的舊 spec / plan 會命中（歷史文件，不動）；`src`、`public`、`test`、`scripts`、`README.md` 皆無輸出

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove shell-script app bundle in favour of the Chrome PWA shim"
```

---

## Task 6: 收尾驗證與整合

**Files:** 無（驗證與整合）

**Interfaces:**
- Consumes: Task 1–5 全部產出
- Produces: 可合併回 `main` 的分支

- [ ] **Step 1: 從乾淨狀態完整驗證一次**

```bash
bash scripts/install-launchagent.sh --uninstall
bash scripts/install-launchagent.sh
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/
npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Expected: `HTTP 200`；`pass 51`、`fail 0`

- [ ] **Step 2: 請使用者做最終實機確認**

- 點 Dock 圖示 → 視窗開啟，大小為上次關窗時的大小
- 完整跑一次錄音 → 分析 → 取得 Notion 連結或 `.md` 路徑
- 關閉視窗後 `curl http://localhost:3000/` 仍回 200（伺服器續存）
- 日常 Chrome 完好無損，未被任何步驟關閉

- [ ] **Step 3: 檢視完整 diff**

```bash
git diff main --stat
```

- [ ] **Step 4: 依 superpowers:finishing-a-development-branch 決定合併方式**

---

## 自我檢查結果

- **Spec 涵蓋**：manifest → Task 1；LaunchAgent → Task 3；移除舊 `.app` → Task 5；移除 shutdown → Task 4；手動安裝 → Task 2；兩階段關卡 → Task 2 的硬性關卡與 Global Constraints。皆有對應任務。
- **命名一致性**：`install-launchagent.sh` 的三個模式（無參數／`--uninstall`／`--print-plist`）在 Task 3、5、6 與 README 中用法一致；Label `com.local.browser-ai-note` 全篇一致。
- **測試計數**：49 →（Task 1）51 →（Task 3）54 →（Task 4）51 →（`f201e93` 硬化安裝腳本，追加「未知參數」測試，回填說明見 Task 3 Step 3）52。各 Task 內文的 Expected 仍依當時的計數標註；分支最終狀態是 **52 個測試、0 個失敗**。
