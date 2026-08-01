# Browser AI Note — App 打包與介面優化 設計文件

**日期**：2026-08-01
**狀態**：設計定案，待寫實作計畫
**專案**：meeting-recorder（v1 已完成並合併 main；本文件為 v1.1 體驗優化）

---

## 一句話目標

把現有「雙擊 .command → 終端機跑伺服器 → 瀏覽器分頁」的體驗，升級成「雙擊 App 圖示 → 乾淨獨立小視窗 → 關窗即結束」的類原生桌面 App 體驗，並把錄音頁外觀依使用者提供的參考設計重做。

## 背景與動機

v1 能用，但三個體驗痛點：
1. 結束方式不直覺（要關掉終端機視窗或 Ctrl+C）。
2. 啟動器 `會議記錄.command` 長得像文件、很醜，名稱也不理想。
3. 錄音頁是普通瀏覽器分頁，外觀陽春、且混在其他分頁裡。

決定走**輕量路線**：維持現有「本機 Node 伺服器 + 瀏覽器頁面」架構，不改寫成 Electron（體積數百 MB、複雜度高）。用 macOS app bundle 外殼 + Chrome 應用程式視窗模式，達成類原生 App 的外觀與開關體驗。

## 非目標（YAGNI）

- 不改寫成 Electron / Tauri 等原生框架。
- 不動後端（Gemini / Notion / pipeline 皆不變），現有 39 個自動化測試維持綠。
- 不改變錄音功能流程（四狀態、暫停/繼續/重新開始、輸出目的地皆不變），本次只改「外殼、視窗、外觀」。
- v1.1 仍為本機個人版；跨機器/團隊分享的路徑不在本次範圍。

## 實作輸入（需使用者於實作時提供）

- **圖示檔**：512×512 PNG（橘→粉漸層甜甜圈環）。需放到專案可存取的路徑，實作時轉成 `.icns`。（提供 1024×1024 可讓 Retina 更銳利，但 512 可用。）
- **視覺參考設計**：Figma 連結或設計圖，錄音頁外觀依此重做。

---

## 元件設計

### 1. macOS App Bundle：`Browser AI Note.app`

取代 `會議記錄.command`。標準 app bundle 結構：

```
Browser AI Note.app/
└── Contents/
    ├── Info.plist            # CFBundleName=Browser AI Note、CFBundleExecutable=launch、CFBundleIconFile=icon
    ├── MacOS/
    │   └── launch            # 可執行 shell 腳本（見元件 2）
    └── Resources/
        └── icon.icns         # 由使用者 512 PNG 轉出
```

- `Info.plist` 設定 App 名稱、執行檔、圖示檔名。
- `icon.icns`：由 PNG 經 `sips` 產生多尺寸 iconset、再用 `iconutil` 打包。以 512 來源可產到 512×512（供 512@1x / 256@2x）。
- App bundle 放在專案根目錄或桌面；亦可拖進 Dock。
- 移除舊的 `會議記錄.command`。

### 2. 啟動與結束腳本：`Contents/MacOS/launch`

一支 bash 腳本，雙擊 App 時由 macOS 執行。行為：

1. `cd` 到專案目錄（絕對路徑，實作時依本機路徑寫入）。
2. **確保伺服器就緒**：若 `localhost:$PORT` 未回應 → 背景啟動 `node src/server.js`，記錄其 PID，輪詢至就緒（逾時則報錯並結束）。若已在跑，則沿用、不重啟（PID 記為空）。
3. **開啟獨立視窗**：以 Chrome 應用程式視窗模式啟動：
   ```
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
     --user-data-dir="$HOME/.browser-ai-note-chrome" \
     --app="http://localhost:$PORT" \
     --window-size=480,720
   ```
   使用**專屬 user-data-dir** 讓它成為獨立的 Chrome 實例（與使用者日常 Chrome 分開），這也是「等待視窗關閉」得以成立的關鍵。
4. **關窗即結束**：上述指令會阻塞直到該 Chrome 實例的視窗全部關閉；返回後，若本腳本啟動過伺服器（PID 非空）則 `kill` 之。App 生命週期隨之結束（Dock 圖示消失）。

**設計理由**：關窗即停、無背景殘留、無需在頁面加「結束」鈕、無需後端加 shutdown 端點。
**已知限制**：若先前有其他來源啟動的伺服器占用 $PORT（孤兒程序），本腳本不接管、也不會於關窗時清掉它；屬邊界情況，v1.1 不處理。
**前置檢查**：找不到 Chrome（路徑不存在）時，於視窗或終端輸出清楚訊息。

### 3. 獨立小視窗

- 由元件 2 的 Chrome `--app` 模式提供：無網址列、無分頁、無書籤，純淨小窗。
- 初始尺寸暫定 **480×720**（直式，近手機比例），日後可於腳本調整。

### 4. 錄音頁視覺重做

- 只改 `public/index.html`（排版/標記）與其 CSS；`public/app.js` 的錄音邏輯、狀態機、與 `/api/process` 串接**維持不變**（如需微調也僅限對應新標記的元素選取，不動流程）。
- 維持四狀態：開始前 / 錄音中（計時＋波形＋暫停/繼續/重新開始）/ 處理中 / 完成（Notion 連結或 .md 路徑 + 摘要重點預覽）。
- 外觀依使用者提供的參考設計實作；需維持 480×720 小窗下的可用性與繁體中文文案。
- 所有既有元素 id 若沿用則不變（保 app.js 正常）；若參考設計需調整結構，app.js 對應的 `$('...')` 選取要同步更新，並確保四狀態與六個按鈕行為不變。

---

## 影響範圍與測試

**影響檔案**：新增 `Browser AI Note.app/`（bundle 內含 Info.plist、launch、icon.icns）；改寫 `public/index.html` 與 CSS，可能微調 `public/app.js` 的元素選取；移除 `會議記錄.command`；更新 `README.md`。後端 `src/`、`test/` 不動。

**測試策略**（本次多為打包與外觀，難自動化 → 手動測試清單）：
- [ ] 雙擊 `Browser AI Note.app` → 出現自訂圖示於 Dock，開啟一個約 480×720、無網址列的獨立小窗。
- [ ] 視窗外觀符合參考設計；四狀態切換正確、繁中文案正確。
- [ ] 錄音 → 停止 → Gemini 分析 → 寫入 Notion 資料庫一列（或桌面 .md），流程與 v1 一致。
- [ ] 暫停/繼續（波形靜止/恢復）、重新開始（確認後歸零）正常。
- [ ] 關閉視窗 → 背景 `node src/server.js` 一併結束（`lsof -ti:$PORT` 無殘留）。
- [ ] 再次雙擊可正常重開。
- 後端：沿用現有 `npm test`，應維持全綠、不受影響。

**README 更新**：使用說明由「雙擊 `會議記錄.command`」改為「雙擊 Browser AI Note」，並說明關窗即結束。

---

## 全域約束（沿用 v1）

- 繁體中文 UI 文案。
- API key 只存本機 `.env`，不進前端/版控。
- 本機執行，不引入需付費或重量級相依（不裝 Electron）。
- 後端行為與測試不得因本次變更而破壞。
