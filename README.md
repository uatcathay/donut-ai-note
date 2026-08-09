# 會議記錄工具

瀏覽器即時錄音 → Gemini 免費版產出「逐字稿＋摘要＋重點」→ 寫進指定 Notion 頁面底下（或桌面 `.md`）。全繁體中文、本機執行。

## 一、安裝

需要 Node.js 20 以上。
```bash
npm install
cp .env.example .env
```

## 二、申請三把鑰匙，填進 `.env`

1. **`GEMINI_API_KEY`（必要，免費）**
   到 https://aistudio.google.com/apikey 用 Google 帳號登入 → 建立 API key → 複製貼到 `.env`。

2. **`NOTION_TOKEN`（選填，要寫 Notion 才需要）**
   到 https://www.notion.so/my-integrations → New integration → 複製 Internal Integration Token。

3. **`NOTION_PARENT_PAGE_ID`（選填）**
   在 Notion 開啟你要放會議記錄的「父頁面」→ 右上 `•••` → Connections → 加入剛剛建立的 integration（否則會寫入失敗）。
   父頁面網址結尾那段 32 碼英數即為 page id，貼進 `.env`。

> 沒填 Notion 兩項時，結果會自動改存成**桌面 `.md` 檔**。

## 三、使用

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

## 四、故障排除

- **搬動了專案目錄**：plist 內寫死的是絕對路徑，搬移後常駐服務會失效，重新執行 `bash scripts/install-launchagent.sh` 即可（腳本會用新路徑覆寫舊 plist）。
- **行為異常時先看 log**：`/tmp/browser-ai-note.log`，伺服器的 stdout/stderr 都寫在這裡。
- **刪掉專案資料夾前忘了 `--uninstall`**（目前無法自動復原的孤兒情境）：
  `~/Library/LaunchAgents/com.local.browser-ai-note.plist` 會留在原地，launchd 每 10 秒重試一次已經不存在的執行檔，而原本能移除它的腳本也隨資料夾一起消失了。手動清除：
  ```
  launchctl bootout gui/$UID/com.local.browser-ai-note
  rm ~/Library/LaunchAgents/com.local.browser-ai-note.plist
  ```
- **PORT 設定不一致**：`PORT` 是在安裝當下從執行 shell 的環境變數寫進 plist 的。若安裝時的 shell 有另外 export 過 `PORT`，常駐服務會改聽那個埠，但已安裝的 Chrome shim 仍指向 `localhost:3000`——症狀是點圖示出現連線錯誤。安裝前先確認 `echo $PORT` 是空的（或等於 3000），或重新以未覆寫 `PORT` 的 shell 執行安裝腳本。

## 五、測試

- 自動化：`npm test`
- 前端手動測試清單見 `docs/superpowers/plans/2026-07-31-meeting-recorder.md` Task 10 Step 3——該清單寫於 2026-08-02 錄音頁重新設計之前，描述的是舊版 UI，僅供對照測試步驟的大致流程，畫面細節請以目前實際畫面為準。

## 六、費用與限制

- Gemini 免費版：約每天 250 次請求、單場會議建議 2 小時內。個人用足夠，且不產生費用。
- 免費版資料可能被 Google 用於改善模型；機密會議請斟酌。
