# Donut AI Note

在瀏覽器即時錄音 → Gemini 免費版產出「逐字稿＋議題摘要＋待辦」→ 寫進指定的 Notion 資料庫（或桌面 `.md`）。全繁體中文、本機執行。

> **僅支援 macOS，且需要 Google Chrome。**
> 常駐伺服器用的是 macOS 的 LaunchAgent、App 視窗用的是 Chrome 的 PWA 機制、
> log 寫在 `~/Library/Logs/`——這三項都沒有 Windows／Linux 的對應實作。

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

3. **`NOTION_DATABASE_ID`（選填）**
   每場會議會成為**資料庫裡的一列**，所以要先有一個資料庫，且需具備兩個欄位：
   - `Name`（標題型態）— 放會議標題
   - `Date`（日期型態）— 放會議日期

   建好之後，在該資料庫頁面右上 `•••` → Connections → 加入剛剛建立的 integration
   （沒加的話會寫入失敗，而且錯誤訊息只會說找不到資料庫）。

   資料庫網址中 `notion.so/` 之後、`?` 之前那段 32 碼英數即為 database id，貼進 `.env`。

> 沒填 Notion 兩項時，結果會自動改存成**桌面 `.md` 檔**。

## 三、使用

1. 首次安裝：`bash scripts/install-launchagent.sh`（伺服器會在每次登入時自動於背景啟動）。
2. 接著在 Chrome 開啟 http://localhost:3737/ → ⋮ →「投放、儲存及分享」→「安裝頁面為應用程式」。
   完成後 `~/Applications/Chrome Apps.localized/Donut AI Note.app` 即為正式 App，可拖到 Dock。
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
- **行為異常時先看 log**：`~/Library/Logs/donut-ai-note.log`，伺服器的 stdout/stderr 都寫在這裡。（早期版本寫在 `/tmp`，但那裡重開機會被清空。）
- **刪掉專案資料夾前忘了 `--uninstall`**（目前無法自動復原的孤兒情境）：
  `~/Library/LaunchAgents/com.local.donut-ai-note.plist` 會留在原地，launchd 每 10 秒重試一次已經不存在的執行檔，而原本能移除它的腳本也隨資料夾一起消失了。手動清除：
  ```
  launchctl bootout gui/$UID/com.local.donut-ai-note
  rm ~/Library/LaunchAgents/com.local.donut-ai-note.plist
  ```
- **PORT 設定不一致**：`PORT` 是在安裝當下從執行 shell 的環境變數寫進 plist 的。若安裝時的 shell 有另外 export 過 `PORT`，常駐服務會改聽那個埠，但已安裝的 Chrome shim 仍指向舊的埠號——症狀是點圖示出現連線錯誤。安裝前先確認 `echo $PORT` 是空的（或等於 3737），或重新以未覆寫 `PORT` 的 shell 執行安裝腳本。

## 五、測試

- 自動化：`npm test`
- 自動化測試涵蓋 `src/` 全部模組（151 個）。前端 `public/app.js` 沒有測試環境，改動後請手動走一次：
  錄音 → 停止 → 處理中那頁 → 摘要 → New AI Note，並確認分析清單三種狀態（分析中／待分析／已完成）顯示正確。

## 六、費用與限制

- **不產生費用**，用的是 Gemini 免費版。
- **額度以 token 計，不是以次數計。** Google 已不再公佈固定的額度表格，要看自己專案的實際額度請到
  https://aistudio.google.com/rate-limit（網路上流傳的「每天幾次」數字互相矛盾，不可信）。
  實測撞到上限時只發出約 52 次請求，擋住的是 token 量——所以該看的是錄音長度，不是次數。
- **錄音滿三小時會自動停止並開始分析。** 再長下去會超過上傳大小上限，而錄音在上傳成功前
  只存在於瀏覽器記憶體裡，超過就救不回來了。
- 額度用完時錄音仍會正常保留在分析清單，等額度恢復（太平洋時間午夜）再按「立即分析」即可。
- **隱私**：錄音會上傳到 Gemini 進行分析，分析結束後程式會主動刪除雲端那份。
  本機那份在分析成功後也會刪掉，失敗則留著等你重試。
  免費版的資料可能被 Google 用於改善模型，機密會議請斟酌。

## 七、授權

本專案原始碼採 [MIT License](LICENSE)。

`public/fonts/` 內的字體為第三方作品，依 SIL Open Font License 1.1 隨專案散布，
不在 MIT 的涵蓋範圍內——授權全文與版權聲明見 `public/fonts/`。
