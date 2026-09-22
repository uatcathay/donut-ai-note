# Donut AI Note — 改用 Chrome PWA 承載視窗 設計文件

**日期**：2026-08-04
**狀態**：設計定案，待寫實作計畫
**分支**：`feature/pwa-app-shim`
**專案**：donut-ai-note（v1.1 已合併 main；本文件為視窗承載方式的架構調整）

---

## 一句話目標

讓 Donut AI Note 在 Dock 上是一個**有專屬圖示、點了會回到既有視窗**的真正 App——把視窗承載方式從「shell script 啟動器 + Chrome `--app`」換成 **Chrome PWA app shim**，伺服器改由 macOS LaunchAgent 登入常駐。

## 背景與動機

2026-08-04 這天在啟動器上改了三次，每次解掉一個問題、長出另一個：

| commit | 改了什麼 | 結果 |
|---|---|---|
| `93855f4` | 加入「已開啟就把視窗帶到前面」守衛 | 無效，方向錯誤 |
| `4704b90` | 拿掉 `--user-data-dir`，改用日常 Chrome | 啟動變快、點 Dock 不再跳新視窗，但**視窗變滿版**、**Dock 甜甜圈消失** |

**滿版視窗的根因**（已查證）：`--window-size` 只對「該指令自己啟動的 Chrome 瀏覽器程序」生效。日常 Chrome 已在執行時，這道指令會被單一實例機制轉交給既有程序，只有網址被接收、視窗參數整包被忽略，新視窗改用 `browser.window_placement`（該設定檔記錄為 `1728×1075`，故呈滿版）。

**此問題已自行解決，不需程式碼修改**：Chrome 會把 app 模式視窗的大小記在 `browser.app_window_placement`（以網址推導的鍵，如 `localhost_/…`），**每次關窗覆寫、下次開窗沿用**。使用者實測確認：拉成 500×800 關掉再開即為 500×800，再拉成 700×1000 亦然。

**Dock 甜甜圈消失的根因**（已查證）：`scripts/Info.plist` 並未設定 `LSUIElement` 或 `LSBackgroundOnly`；真正原因是該 `.app` 的執行檔為純 shell script，全程未連上 window server，macOS 等不到它註冊成 GUI App 就把 Dock 圖示收掉（`lsappinfo list` 完全查不到 `com.local.donut-ai-note` 可佐證）。使用者先前看到的甜甜圈，其實是 Chrome 獨立實例的 Dock 圖示。

因此本次唯一要解的是**「App 身分」**：Dock 專屬圖示、點圖示回到既有視窗、執行中指示點、⌘-Tab 與 Spotlight 中為獨立項目。

## 可行性查證（已在本機驗證，非推論）

- `~/Applications/Chrome Apps.localized/YouTube.app` 為既有 Chrome PWA shim：執行檔 `app_mode_loader`、bundle id `com.google.Chrome.app.<shortcutID>`、`CrAppModeUserDataDir` 指向 Chrome 標準設定檔根目錄 → **PWA shim 是真正的 macOS App，且跑在日常 Chrome 的設定檔上**（不會另起實例，故啟動快）。
- `Profile 2/Preferences` 存在 `browser.app_window_placement`，其中一筆鍵為 `localhost_/…`、記錄 `1200×1035` → **Chrome 會逐 app 分開記住視窗大小，且對 localhost 有效**。

## 非目標（YAGNI）

- **不處理視窗初始大小**。PWA 沒有任何 manifest 欄位可指定初始視窗尺寸；沿用 Chrome 「記住上次大小」的既有行為（首次開啟為 Chrome 預設大小，手動調整一次後即沿用）。
- 不改後端（Gemini / Notion / pipeline / 錄音流程皆不變）。
- 不改錄音頁外觀。
- 不改寫成 Electron / Tauri。
- 不做離線快取（Service Worker）。PWA 安裝不需要 Service Worker，且本 App 本來就依賴本機伺服器。

## 已評估並否決的方案

| 方案 | 否決理由 |
|---|---|
| 復原 `4704b90` 回到獨立 `--user-data-dir` | 甜甜圈會回來，但啟動慢 5 秒、點 Dock 跳新視窗兩個問題一併回來 |
| 把專案自製 `.app` 拖進 Dock 釘住 | 零成本可得常駐圖示，但點圖示無法回到既有視窗（會重複開窗）、無執行中指示點；使用者選擇要完整 App 身分 |
| 用 AppleScript / System Events 控制視窗 | 實測堵死：Chrome 的 AppleScript 介面看不到 app 模式視窗；System Events 需要「輔助使用」權限 |

---

## 元件設計

### 1. Web App Manifest

**新增** `public/manifest.webmanifest`：

| 欄位 | 值 | 理由 |
|---|---|---|
| `name` / `short_name` | `Donut AI Note` | 決定 shim 的 App 名稱 |
| `start_url` | `/` | |
| `display` | `standalone` | 無網址列、無標籤列，等同現在的 `--app` 外觀 |
| `background_color` / `theme_color` | 取自 `index.html` 既有 CSS 變數 | 視窗外框與載入畫面配色一致 |
| `icons` | 192×192、512×512 PNG | Chrome 安裝 PWA 的最低要求 |

`public/index.html` 的 `<head>` 加 `<link rel="manifest" href="/manifest.webmanifest">`。

圖示由現成的 `assets/icon.png`（512×512）以 `sips` 產生，輸出到 `public/icons/`。

**本項不需改動 `src/server.js`**：既有 `express.static(PUBLIC_DIR)` 會服務 `public/` 下的檔案，`.webmanifest` 的 MIME（`application/manifest+json`）由 `express.static` 內建對應表處理。（第二階段會另行改動 `server.js` 以移除 `/shutdown`，與本項無關。）

### 2. LaunchAgent：伺服器登入常駐

**新增** `scripts/install-launchagent.sh`，產生並載入 `~/Library/LaunchAgents/com.local.donut-ai-note.plist`：

- `ProgramArguments`：node 絕對路徑 + `src/server.js`（launchd 的 PATH 極精簡，**必須**注入絕對路徑，沿用 `build-app.sh` 既有的 `command -v node` 做法）
- `WorkingDirectory`：專案根目錄（伺服器需讀取專案根的 `.env`）
- `EnvironmentVariables.PORT`：安裝當下從執行 shell 的環境變數讀入（預設 `3000`），寫死進 plist
- `RunAtLoad`：`true`
- `KeepAlive`：`true`（crash 自動重啟）
- `StandardOutPath` / `StandardErrorPath`：`/tmp/donut-ai-note.log`

腳本行為：偵測專案路徑與 node 路徑 → 寫入 plist → `launchctl bootout`（若已存在）→ `launchctl bootstrap` → 以 `curl` 輪詢驗證 `localhost:3000` 起得來，失敗則印出 log 尾端。提供 `--uninstall` 反安裝、`--print-plist` 只印出 plist 內容供測試（不產生任何副作用）；未知參數會被拒絕並印出用法說明。

**已知限制**：plist 內含專案絕對路徑，日後搬移專案目錄需重跑本腳本。腳本會在載入前檢查路徑是否存在並明確報錯。

**失敗自我收尾**：`curl` 輪詢逾時仍未驗證成功時，腳本會卸載剛載入的 job 並移除剛寫入的 plist，讓機器回到「未安裝」的乾淨狀態，而不是留下一個 `KeepAlive` 會無限重啟的壞掉服務。

### 3. 移除舊 App Bundle

刪除 `Donut AI Note.app`、`scripts/build-app.sh`、`scripts/launch.template.sh`、`scripts/Info.plist`。舊程式碼保留在 git 歷史。

### 4. 移除「關窗即結束」機制

伺服器改為常駐後，`APP_MODE` 永遠不會被設定，`public/app.js` 於 `pagehide` 送出的 `/shutdown` beacon 只會在每次關窗時於 log 留下一行「已忽略」。屬於必然不執行的死程式碼，一併清除：

- `src/server.js`：`/shutdown` 路由與 `APP_MODE` 分支
- `public/app.js`：`pagehide` 監聽與 `sendBeacon('/shutdown')`
- 對應的既有測試

**行為變更**：關閉視窗只是關閉視窗，伺服器持續在背景執行。使用者已知悉並同意。

### 5. PWA 安裝（一次性手動步驟）

Chrome 無可靠的命令列安裝介面，需使用者手動執行一次：在日常 Chrome 開啟 `http://localhost:3000/` → 網址列右側或 ⋮ 選單 →「投放、儲存及分享」→「安裝頁面為應用程式」。完成後 `~/Applications/Chrome Apps.localized/Donut AI Note.app` 出現，可拖入 Dock 釘住。

---

## 資料流

```
開機登入 → launchd 啟動 node（:3000 常駐）
使用者點 Dock 甜甜圈 → app_mode_loader → 交給日常 Chrome（同設定檔）
                      → 開啟 standalone 視窗載入 localhost:3000
                      → 視窗大小沿用 app_window_placement 記錄
關閉視窗 → 僅關閉視窗，伺服器續存
```

中間無 shell script、無等待迴圈、無第二個 Chrome 實例。

## 兩階段執行與驗收關卡

**採兩階段，是因為 PWA 的實際行為有部分無法在不安裝的情況下驗證。第一階段只做加法，未通過關卡前不刪任何東西。**

### 第一階段：只加不刪

範圍：manifest、圖示、`<link>` 標籤、安裝步驟說明。
舊 `.app`、啟動器、`/shutdown` 機制、伺服器行為**全部維持原狀**。

**驗收關卡（須由使用者實機確認全部通過）**：

1. Chrome 對 `localhost:3000` 出現「安裝頁面為應用程式」選項
2. 安裝後 Dock 出現甜甜圈圖示，且**點擊會回到既有視窗**（不重複開窗）
3. **麥克風可正常錄音，且不需重新授權**（同源同設定檔，理論上沿用既有權限，但未實測）
4. 視窗大小關窗後會被記住
5. Chrome 已在執行時，開啟速度接近瞬開

**未通過的退場方式**：`git checkout` 掉新增檔案、於 Chrome 移除該 App，等同未發生。

### 第二階段：動刀（僅在第一階段全數通過後執行）

範圍：LaunchAgent 安裝腳本、刪除舊 `.app` 與 `scripts/` 三個檔案、移除 `/shutdown` 機制與對應測試。

---

## 錯誤處理

| 情況 | 處理 |
|---|---|
| launchd 找不到 node | 安裝腳本於寫入 plist 前檢查絕對路徑並明確報錯 |
| 專案目錄搬移導致 plist 失效 | 重跑 `install-launchagent.sh`（腳本會覆寫舊 plist） |
| 伺服器 crash | `KeepAlive` 自動重啟 |
| PWA 開啟時伺服器未就緒 | 視窗顯示連線失敗；安裝腳本載入後會立即以 `curl` 驗證，避免此情況 |
| 連接埠 3000 被佔用 | 沿用既有行為（伺服器啟動失敗並寫入 `/tmp/donut-ai-note.log`） |

## 測試

- **新增**：`GET /manifest.webmanifest` 回應 200、MIME 正確、必要欄位（`name`、`start_url`、`display`、`icons`）齊全
- **移除**：`/shutdown` 與 `APP_MODE` 相關的既有測試（第二階段）
- **新增**：`install-launchagent.sh --print-plist` 的輸出（label、`RunAtLoad`、`KeepAlive`、`ProgramArguments` 為絕對路徑、`WorkingDirectory` 指向專案根），以及未知參數會被拒絕。此模式無副作用，故可自動化
- **不寫自動化測試**：`launchctl` 的實際載入行為與 PWA 安裝屬系統層設定，會變動機器狀態，以實機驗收關卡涵蓋
- 其餘既有測試維持全綠

## 風險

1. **麥克風權限是唯一真正的未知數**。同源同設定檔理應沿用，但未實測；列為第一階段關卡第 3 項，不通過就退場。
2. 伺服器常駐後，錄音資料的存取不再有「關窗即停」這道界線。
3. 常駐 node 程序約佔 40MB 記憶體。
4. **網路曝露面從「時間窗」變成「無限期」**。伺服器原本只在 App 視窗開著的幾分鐘內存在，改常駐後變成開機後即持續運作，且 `/api/process` 無任何身分驗證。若監聽位址是 `0.0.0.0`（wildcard），同一區網（例如咖啡店、辦公室 Wi-Fi）內的任何人都能打這個端點，消耗使用者的 Gemini 額度、寫入使用者的 Notion 父頁面或桌面 `.md`。**決定**：`src/server.js` 的 `app.listen` 明確綁定 `127.0.0.1`（loopback），不接受區網連線；這是本次設計沿用既有錄音／分析流程之外，唯一需要異動 `server.js` 監聽行為的項目。
